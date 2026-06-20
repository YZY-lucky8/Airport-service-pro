/**
 * ============================================================
 * 安全管理端 — 智能阈值调整 (Security Management Agent)
 * 参考：VeriGuard 形式化验证 + 自适应安全策略
 * ============================================================
 *
 * 功能：
 * - 实时分析总请求量和攻击日志比例
 * - 动态建议滑动窗口阈值调整
 * - 生成安全分析报告
 *
 * 核心逻辑（基于论文 Multi-Agent Defense Pipeline）：
 *   - 攻击日志占比 < 5% 且 总请求量 > 1000/s → 建议阈值 50次/秒（减少误拦）
 *   - 攻击日志占比 5%-20% → 保持当前阈值
 *   - 攻击日志占比 > 20% → 建议阈值 20次/秒（加强防护）
 *   - 攻击日志占比 > 50% → 紧急模式，阈值 5次/秒 + 告警
 */

class SecurityManagementAgent {
  constructor(pool) {
    this.pool = pool;

    // 阈值调整策略规则（形式化策略代码，参考 VeriGuard 离线验证理念）
    this.policies = [
      {
        id: 'relaxed',
        condition: (stats) => stats.attackRatio < 5 && stats.totalRequests > 1000,
        suggestion: { threshold: 50, action: 'increase', reason: '攻击日志占比<5%且总请求量>1000/s，建议放宽阈值减少误拦' },
      },
      {
        id: 'moderate',
        condition: (stats) => stats.attackRatio >= 5 && stats.attackRatio <= 20,
        suggestion: { threshold: null, action: 'no_change', reason: '攻击日志占比在5%-20%之间，维持当前阈值' },
      },
      {
        id: 'strict',
        condition: (stats) => stats.attackRatio > 20 && stats.attackRatio <= 50,
        suggestion: { threshold: 20, action: 'decrease', reason: '攻击日志占比>20%，建议降低阈值到20次/秒加强防护' },
      },
      {
        id: 'emergency',
        condition: (stats) => stats.attackRatio > 50,
        suggestion: { threshold: 5, action: 'decrease', reason: '紧急！攻击日志占比>50%，建议立即降低阈值到5次/秒' },
      },
    ];
  }

  /**
   * 主分析方法
   * @param {number} timeWindowMinutes 分析时间窗口（分钟）
   * @returns {Promise<Object>} 分析结果
   */
  async analyze(timeWindowMinutes = 30) {
    const startTime = new Date(Date.now() - timeWindowMinutes * 60000);

    try {
      // 1. 统计当前时间窗口内的总请求量
      const [totalRows] = await this.pool.query(`
        SELECT COUNT(*) as total
        FROM agent_interaction_log
        WHERE created_at >= ?
      `, [startTime]);
      const totalRequests = totalRows[0].total;

      // 2. 统计攻击日志数量
      const [attackRows] = await this.pool.query(`
        SELECT COUNT(*) as attack_count
        FROM attack_log
        WHERE create_time >= ?
      `, [startTime]);
      const attackCount = attackRows[0].attack_count;

      // 3. 计算攻击占比
      const attackRatio = totalRequests > 0
        ? Math.round((attackCount / totalRequests) * 10000) / 100
        : 0;

      // 4. 获取当前阈值
      const [configRows] = await this.pool.query(`
        SELECT config_value FROM security_threshold_config
        WHERE config_key = 'rate_limit_max_requests'
        LIMIT 1
      `);
      const currentThreshold = configRows.length > 0
        ? parseFloat(configRows[0].config_value)
        : 5; // 默认 5

      // 5. 匹配策略规则
      const stats = { totalRequests, attackCount, attackRatio, currentThreshold };
      const matchedPolicy = this._matchPolicy(stats);

      // 6. 计算置信度
      const confidence = this._calculateConfidence(stats, matchedPolicy);

      // 7. 生成报告
      const report = {
        analysisTime: new Date().toISOString(),
        timeWindow: `${timeWindowMinutes}min`,
        stats: {
          totalRequests,
          attackCount,
          attackRatio: `${attackRatio}%`,
          currentThreshold,
        },
        recommendation: {
          suggestedThreshold: matchedPolicy.suggestion.threshold,
          action: matchedPolicy.suggestion.action,
          reason: matchedPolicy.suggestion.reason,
          confidence: `${Math.round(confidence * 100)}%`,
          policyId: matchedPolicy.id,
        },
      };

      // 8. 持久化分析报告
      await this._saveReport(report);

      return report;

    } catch (error) {
      console.error('安全分析失败:', error);
      return {
        analysisTime: new Date().toISOString(),
        error: error.message,
        recommendation: {
          action: 'no_change',
          reason: '分析失败，维持当前配置',
          confidence: '0%',
        },
      };
    }
  }

  /**
   * 匹配策略规则
   */
  _matchPolicy(stats) {
    for (const policy of this.policies) {
      if (policy.condition(stats)) {
        return policy;
      }
    }
    // 默认：无变化
    return {
      id: 'default',
      suggestion: {
        threshold: stats.currentThreshold,
        action: 'no_change',
        reason: '无足够数据做出调整建议，维持当前阈值',
      },
    };
  }

  /**
   * 计算建议置信度
   */
  _calculateConfidence(stats, policy) {
    // 数据量越大置信度越高
    const dataConfidence = Math.min(1, (stats.totalRequests + stats.attackCount) / 100);

    // 攻击占比越极端（接近0或接近100）置信度越高
    let ratioConfidence = 0.5;
    if (stats.attackRatio < 5 || stats.attackRatio > 90) {
      ratioConfidence = 0.9;
    } else if (stats.attackRatio > 50) {
      ratioConfidence = 0.8;
    } else if (stats.attackRatio > 20) {
      ratioConfidence = 0.7;
    }

    // 综合置信度
    return (dataConfidence * 0.4 + ratioConfidence * 0.6);
  }

  /**
   * 保存分析报告到数据库
   */
  async _saveReport(report) {
    try {
      await this.pool.execute(`
        INSERT INTO security_analysis (
          analysis_time, total_requests, attack_count, attack_ratio,
          current_threshold, suggested_threshold, reason, confidence, action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        report.analysisTime,
        report.stats.totalRequests,
        report.stats.attackCount,
        parseFloat(report.stats.attackRatio),
        report.stats.currentThreshold,
        report.recommendation.suggestedThreshold || report.stats.currentThreshold,
        report.recommendation.reason,
        parseFloat(report.recommendation.confidence) / 100,
        report.recommendation.action,
      ]);
    } catch (e) {
      console.error('保存安全分析报告失败:', e);
    }
  }

  /**
   * 获取历史分析报告
   */
  async getHistory(limit = 20) {
    try {
      const [rows] = await this.pool.query(`
        SELECT * FROM security_analysis
        ORDER BY analysis_time DESC
        LIMIT ?
      `, [limit]);
      return rows;
    } catch (e) {
      return [];
    }
  }

  /**
   * 应用阈值调整（需要人工审批后才调用）
   */
  async applyThreshold(newThreshold) {
    // 阈值范围验证（形式化约束）
    if (newThreshold < 1 || newThreshold > 100) {
      throw new Error('阈值必须在 1-100 范围内');
    }

    try {
      await this.pool.execute(`
        UPDATE security_threshold_config
        SET config_value = ?, agent_suggested_value = ?,
            suggestion_reason = ?, updated_at = NOW()
        WHERE config_key = 'rate_limit_max_requests'
      `, [newThreshold, newThreshold, '智能体自动调整', new Date()]);

      return { success: true, newThreshold };
    } catch (e) {
      throw new Error('应用阈值失败: ' + e.message);
    }
  }
}

module.exports = SecurityManagementAgent;
