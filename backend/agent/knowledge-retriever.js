/**
 * ============================================================
 * 知识库检索引擎 (Knowledge Retriever)
 * 参考：RAG (Retrieval-Augmented Generation) 轻量实现
 * ============================================================
 *
 * 核心策略：
 * - 第一级：keywords 字段精确分词匹配（最高权重）
 * - 第二级：title 字段模糊匹配（中权重）
 * - 第三级：content 全文匹配（低权重）
 * - 应用层后处理：查询中的长词优先（更具体 = 更相关）
 */

class KnowledgeRetriever {
  constructor(pool) {
    this.pool = pool;
  }

  async search(query, category = null, limit = 3) {
    if (!query || !query.trim()) return { results: [], bestMatch: null, score: 0 };

    let bestResult = null;
    let bestScore = 0;
    const allResults = [];

    // === 第一级：关键词匹配 ===
    const kwResults = await this._keywordMatch(query, category, limit);
    for (const r of kwResults) {
      r.matchType = "keyword";
      allResults.push(r);
    }

    // === 第二级：模糊匹配 ===
    if (allResults.length < limit) {
      const fuzzyResults = await this._fuzzyMatch(query, category, limit);
      for (const r of fuzzyResults) {
        r.matchType = "fuzzy";
        allResults.push(r);
      }
    }

    // === 第三级：全文检索 ===
    if (allResults.length < limit) {
      const ftResults = await this._fulltextMatch(query, category, limit);
      for (const r of ftResults) {
        r.matchType = "fulltext";
        allResults.push(r);
      }
    }

    // 去重 + 排序
    const seen = new Set();
    const unique = allResults
      .filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (unique.length > 0) {
      bestResult = unique[0];
      bestScore = unique[0].score;
    }

    return { results: unique, bestMatch: bestResult, score: bestScore };
  }

  /**
   * 核心匹配：从 keywords / title / content 三字段打分
   *
   * 打分规则（每条记录独立计分）：
   * - keywords 命中 1 个查询词 → +10 分
   * - title 命中 1 个查询词     → +5 分
   * - content 命中 1 个查询词    → +1 分
   * - 命中词越长分越高（3字符×2, 4+字符×3）
   * - 最终 score = 字段分 × priority 加权
   */
  async _keywordMatch(query, category, limit) {
    const stopWords = new Set([
      "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
      "都", "一", "一个", "上", "也", "很", "到", "说", "要",
      "去", "你", "会", "着", "没有", "看", "好", "自己", "这",
      "能", "吗", "怎么", "什么", "可以", "需要", "什么",
    ]);

    // 查询分词：先用标点拆，然后对长片段再拆出2-5字符的token
    const rawWords = query.split(/[,，。、；:：!?！？\s]+/).filter(w => w.trim());
    const tokens = new Set();
    for (const w of rawWords) {
      if (w.length >= 2 && !stopWords.has(w)) tokens.add(w);
      if (w.length > 2) {
        for (let len = 2; len <= Math.min(4, w.length); len++) {
          for (let i = 0; i <= w.length - len; i++) {
            const sub = w.substring(i, i + len);
            if (!stopWords.has(sub)) tokens.add(sub);
          }
        }
      }
    }

    if (tokens.size === 0) return [];

    // 取查询中最长的前15个token（更具体的词优先）
    const tokenArr = Array.from(tokens)
      .sort((a, b) => b.length - a.length)
      .slice(0, 15);

    // 先拉取所有候选记录（任一token命中任一字段即入候选池）
    let sql =
      "SELECT id, title, content, category, keywords, priority FROM knowledge_base WHERE is_active = 1";
    const params = [];

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    // 用长token优先匹配 keywords 和 title（减少噪声）
    const longTokens = tokenArr.filter(t => t.length >= 2);
    if (longTokens.length > 0) {
      const orParts = longTokens.map(
        () => "(keywords LIKE ? OR title LIKE ?)"
      ).join(" OR ");
      sql += " AND (" + orParts + ")";
      for (const t of longTokens) {
        params.push(`%${t}%`, `%${t}%`);
      }
    }

    sql += " ORDER BY priority DESC LIMIT 50"; // 放宽上限，应用层重排序

    try {
      const [rows] = await this.pool.query(sql, params);

      // 应用层逐条打分
      const scored = rows.map(row => {
        let score = 0;

        for (const t of tokenArr) {
          const lenBonus = t.length >= 4 ? 3 : t.length >= 3 ? 2 : 1;

          // keywords 字段（逗号分隔的关键词）
          const kwParts = (row.keywords || '').split(/[,，]/).map(k => k.trim());
          if (kwParts.some(k => k.includes(t) || t.includes(k))) {
            score += 10 * lenBonus;
          }

          // title 字段
          if ((row.title || '').includes(t)) {
            score += 5 * lenBonus;
          }

          // content 字段
          if ((row.content || '').includes(t)) {
            score += 1 * lenBonus;
          }
        }

        return {
          ...row,
          score: score * (row.priority / 50), // priority 加权（50为基准）
        };
      });

      // 只返回有分数的，按分数排序取前 limit
      return scored
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  async _fuzzyMatch(query, category, limit) {
    let sql = `
      SELECT id, title, content, category, keywords, priority
      FROM knowledge_base
      WHERE is_active = 1
      AND (title LIKE ? OR content LIKE ? OR keywords LIKE ?)
    `;
    const params = [`%${query}%`, `%${query}%`, `%${query}%`];

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += " ORDER BY priority DESC LIMIT ?";
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.map((r) => ({ ...r, score: r.priority * 0.5 }));
    } catch (e) {
      return [];
    }
  }

  async _fulltextMatch(query, category, limit) {
    let sql = `
      SELECT id, title, content, category, keywords, priority,
        MATCH(title, content, keywords) AGAINST(?) AS relevance
      FROM knowledge_base
      WHERE is_active = 1
      AND MATCH(title, content, keywords) AGAINST(?)
    `;
    const params = [query, query];

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += " ORDER BY relevance DESC, priority DESC LIMIT ?";
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.map((r) => ({ ...r, score: (r.relevance || 0) * 5 }));
    } catch (e) {
      return [];
    }
  }

  formatReply(result) {
    if (!result) return null;
    return {
      answer: result.content,
      title: result.title,
      category: result.category,
      confidence: Math.min(1, result.score / 100),
      matchType: result.matchType,
    };
  }

  fallbackReply(query) {
    const suggestions = [
      `抱歉，我暂时找不到关于"${query}"的准确答案。`,
      "您可以尝试换个说法，或者告诉我您的具体需求。",
      "如果您有航班号，我也可以帮您查询航班相关信息。",
    ];
    return suggestions.join(" ");
  }
}

module.exports = KnowledgeRetriever;
