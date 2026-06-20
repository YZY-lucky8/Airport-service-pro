/**
 * ============================================================
 * 知识库检索引擎 (Knowledge Retriever)
 * 参考：RAG (Retrieval-Augmented Generation) 轻量实现
 * ============================================================
 *
 * 功能：
 * - 关键词精确匹配 + 模糊匹配 + 全文检索 三级检索
 * - 分类过滤
 * - 优先级排序
 * - 自然语言回复格式化
 */

class KnowledgeRetriever {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * 主检索方法
   * @param {string} query - 用户查询文本
   * @param {string} category - 可选分类过滤
   * @param {number} limit - 返回数量
   * @returns {Promise<Object>} { results, bestMatch, score }
   */
  async search(query, category = null, limit = 3) {
    if (!query || !query.trim()) return { results: [], bestMatch: null, score: 0 };

    let bestResult = null;
    let bestScore = 0;
    const allResults = [];

    // === 第一级：关键词精确匹配（最高优先级）===
    const kwResults = await this._keywordMatch(query, category, limit);
    for (const r of kwResults) {
      r.matchType = 'keyword_exact';
      r.score = (r.score || 0) * 3;
      allResults.push(r);
    }

    // === 第二级：模糊匹配（LIKE）===
    if (allResults.length < limit) {
      const fuzzyResults = await this._fuzzyMatch(query, category, limit);
      for (const r of fuzzyResults) {
        r.matchType = 'fuzzy';
        r.score = (r.score || 0) * 1.5;
        allResults.push(r);
      }
    }

    // === 第三级：全文检索（FULLTEXT）===
    if (allResults.length < limit) {
      const ftResults = await this._fulltextMatch(query, category, limit);
      for (const r of ftResults) {
        r.matchType = 'fulltext';
        r.score = r.score || 0;
        allResults.push(r);
      }
    }

    // 去重 + 排序
    const seen = new Set();
    const unique = allResults.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    if (unique.length > 0) {
      bestResult = unique[0];
      bestScore = unique[0].score;
    }

    return {
      results: unique,
      bestMatch: bestResult,
      score: bestScore,
    };
  }

  /**
   * 第一级：关键词精确匹配
   */
  async _keywordMatch(query, category, limit) {
    // 提取查询中的有意义词（去停用词）
    const stopWords = ['的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
                       '都', '一', '一个', '上', '也', '很', '到', '说', '要',
                       '去', '你', '会', '着', '没有', '看', '好', '自己', '这'];
    const words = query.split(/[\s,，。.、；:：!?！？]+/).filter(
      w => w.length >= 1 && !stopWords.includes(w)
    );

    if (words.length === 0) return [];

    let sql = `SELECT id, title, content, category, keywords, priority FROM knowledge_base WHERE is_active = 1`;
    const params = [];
    const conditions = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    // 关键词字段匹配
    conditions.push('keywords LIKE ?');
    params.push(`%${words[0]}%`);

    if (words.length > 1) {
      for (let i = 1; i < words.length; i++) {
        conditions.push('keywords LIKE ?');
        params.push(`%${words[i]}%`);
      }
    }

    sql += ' AND (' + conditions.join(' OR ') + ')';
    sql += ' ORDER BY priority DESC LIMIT ?';
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.map(r => ({ ...r, score: r.priority }));
    } catch (e) {
      return [];
    }
  }

  /**
   * 第二级：模糊匹配
   */
  async _fuzzyMatch(query, category, limit) {
    let sql = `
      SELECT id, title, content, category, keywords, priority
      FROM knowledge_base
      WHERE is_active = 1
      AND (title LIKE ? OR content LIKE ? OR keywords LIKE ?)
    `;
    const params = [`%${query}%`, `%${query}%`, `%${query}%`];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY priority DESC LIMIT ?';
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.map(r => ({ ...r, score: r.priority * 0.8 }));
    } catch (e) {
      return [];
    }
  }

  /**
   * 第三级：全文检索
   */
  async _fulltextMatch(query, category, limit) {
    // 分词：取有意义的词
    const stopWords = ['的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
                       '都', '一', '一个', '上', '也', '很', '到', '说', '要',
                       '去', '你', '会', '着', '没有', '看', '好', '自己', '这'];
    const words = query.split(/[\s,，。.、；:：!?！？]+/)
      .filter(w => w.length >= 2 && !stopWords.includes(w));

    if (words.length === 0) return [];

    let sql = `
      SELECT id, title, content, category, keywords, priority,
        MATCH(title, content, keywords) AGAINST(?) AS relevance
      FROM knowledge_base
      WHERE is_active = 1
      AND MATCH(title, content, keywords) AGAINST(?)
    `;
    const params = [query, query];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY relevance DESC, priority DESC LIMIT ?';
    params.push(limit);

    try {
      const [rows] = await this.pool.query(sql, params);
      return rows.map(r => ({ ...r, score: r.relevance * 10 }));
    } catch (e) {
      // FULLTEXT 可能失败，回退
      return [];
    }
  }

  /**
   * 格式化回复
   */
  formatReply(result) {
    if (!result) {
      return null;
    }
    return {
      answer: result.content,
      title: result.title,
      category: result.category,
      confidence: Math.min(1, result.score / 100),
      matchType: result.matchType,
    };
  }

  /**
   * 生成"未找到"时的友好回复
   */
  fallbackReply(query) {
    const suggestions = [
      `抱歉，我暂时找不到关于"${query}"的准确答案。`,
      '您可以尝试换个说法，或者告诉我您的具体需求。',
      '如果您有航班号，我也可以帮您查询航班相关信息。',
    ];
    return suggestions.join(' ');
  }
}

module.exports = KnowledgeRetriever;
