/**
 * ============================================================
 * 知识库检索引擎 (Knowledge Retriever)
 * 参考：RAG (Retrieval-Augmented Generation) 轻量实现
 * ============================================================
 *
 * 核心策略：
 * - 第一级：keywords 字段精确分词匹配（最高权重）
 * - 第二级：title 字段模糊匹配（中权重）
 * - 第三级：全文检索（LIKE 降级，兼容 MySQL/SQLite）
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

    // === 第三级：全文检索（LIKE 降级，兼容 MySQL/SQLite） ===
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
   * - 最终 score = 字段分 × priority 加权（上限2倍）
   */
  async _keywordMatch(query, category, limit) {
    const stopWords = new Set([
      "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
      "都", "一", "一个", "上", "也", "很", "到", "说", "要",
      "去", "你", "会", "着", "没有", "看", "好", "自己", "这",
      "能", "吗", "怎么", "什么", "可以", "需要", "哪个", "请问",
      "有没有", "哪儿", "啥", "啥时候", "怎么着", "怎样", "如何",
      "啊", "呀", "哦", "呢", "吧", "嘛", "啦", "呗", "哈", "哟",
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

    // 先拉取候选记录（任一token命中任一字段即入候选池）
    // 如果候选池为空，降级为拉取所有 active 记录在应用层打分
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

    let rows = [];
    try {
      const [result] = await this.pool.query(sql, params);
      rows = result;
    } catch (e) {
      return [];
    }

    // 如果候选池为空，降级为拉取所有 active 记录在应用层打分
    if (rows.length === 0) {
      try {
        let fallbackSql =
          "SELECT id, title, content, category, keywords, priority FROM knowledge_base WHERE is_active = 1";
        const fallbackParams = [];
        if (category) {
          fallbackSql += " AND category = ?";
          fallbackParams.push(category);
        }
        fallbackSql += " ORDER BY priority DESC";
        const [fallbackRows] = await this.pool.query(fallbackSql, fallbackParams);
        rows = fallbackRows;
      } catch (e) {
        return [];
      }
    }

    // 应用层逐条打分
    try {
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
          score: score * Math.min(row.priority / 50, 2.0), // priority 加权（50为基准，上限2倍）
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

  /**
   * 模糊匹配：把 query 拆成独立词分别匹配，而不是整个 query 当一个 LIKE 模式
   */
  async _fuzzyMatch(query, category, limit) {
    const stopWords = new Set([
      "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
      "都", "一", "一个", "上", "也", "很", "到", "说", "要",
      "去", "你", "会", "着", "没有", "看", "好", "自己", "这",
      "能", "吗", "怎么", "什么", "可以", "需要", "哪个", "请问",
      "有没有", "哪儿", "啥", "啥时候", "怎么着", "怎样", "如何",
      "啊", "呀", "哦", "呢", "吧", "嘛", "啦", "呗", "哈", "哟",
    ]);

    // 拆词：按标点拆分，过滤停用词
    const words = query.split(/[,，。、；:：!?！？\s]+/).filter(
      w => w.trim().length >= 1 && !stopWords.has(w.trim())
    ).map(w => w.trim());

    if (words.length === 0) {
      // 如果全是停用词，退化为原始 query 匹配
      return this._fuzzyMatchRaw(query, category, limit);
    }

    // 用拆分后的词构建 LIKE 条件
    const conditions = [];
    const params = [];
    for (const word of words) {
      conditions.push("title LIKE ?");
      conditions.push("content LIKE ?");
      conditions.push("keywords LIKE ?");
      params.push(`%${word}%`);
      params.push(`%${word}%`);
      params.push(`%${word}%`);
    }

    let sql = `
      SELECT id, title, content, category, keywords, priority
      FROM knowledge_base
      WHERE is_active = 1
      AND (${conditions.join(" OR ")})
    `;

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += " ORDER BY priority DESC LIMIT ?";
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      if (rows.length > 0) {
        return rows.map((r) => ({ ...r, score: r.priority * 0.5 }));
      }

      // 降级：拉取所有 active 记录在应用层按词打分
      let fallbackSql =
        "SELECT id, title, content, category, keywords, priority FROM knowledge_base WHERE is_active = 1";
      const fallbackParams = [];
      if (category) {
        fallbackSql += " AND category = ?";
        fallbackParams.push(category);
      }
      fallbackSql += " ORDER BY priority DESC";
      const [fallbackRows] = await this.pool.query(fallbackSql, fallbackParams);
      const scored = fallbackRows.map(row => {
        let score = 0;
        for (const word of words) {
          if ((row.title || '').includes(word)) score += 5;
          if ((row.content || '').includes(word)) score += 2;
          if ((row.keywords || '').includes(word)) score += 10;
        }
        return score > 0
          ? { ...row, score: score * Math.min(row.priority / 50, 2.0) }
          : null;
      }).filter(Boolean);
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (e) {
      return [];
    }
  }

  /**
   * 原始模糊匹配（query 拆词后全是停用词时的降级方案）
   */
  async _fuzzyMatchRaw(query, category, limit) {
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

  /**
   * 全文检索降级：用 LIKE 替代 MySQL 的 MATCH...AGAINST
   * 兼容 MySQL 和 SQLite
   */
  async _fulltextMatch(query, category, limit) {
    // 拆分 query 为词，用 LIKE 匹配（替代 MATCH...AGAINST）
    const words = query.split(/[,，。、；:：!?！？\s]+/).filter(w => w.trim()).map(w => w.trim());
    if (words.length === 0) return [];

    const conditions = [];
    const params = [];
    for (const word of words) {
      conditions.push("title LIKE ?");
      conditions.push("content LIKE ?");
      conditions.push("keywords LIKE ?");
      params.push(`%${word}%`);
      params.push(`%${word}%`);
      params.push(`%${word}%`);
    }

    let sql = `
      SELECT id, title, content, category, keywords, priority
      FROM knowledge_base
      WHERE is_active = 1
      AND (${conditions.join(" OR ")})
    `;
    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }
    sql += " ORDER BY priority DESC LIMIT ?";
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      // 用简单词命中数作为 relevance 近似
      return rows.map(row => {
        let matches = 0;
        for (const word of words) {
          if ((row.title || '').includes(word)) matches++;
          if ((row.content || '').includes(word)) matches++;
          if ((row.keywords || '').includes(word)) matches++;
        }
        return { ...row, score: (matches || 0) * 5 };
      });
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
