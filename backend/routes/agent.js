/**
 * ============================================================
 * 智能体系统 API 路由
 * ============================================================
 *
 * 旅客端接口：
 *   POST /api/agent/chat          - 智能体对话（语音识别文本输入）
 *   POST /api/agent/session/create - 创建会话
 *
 * 安全管理端接口：
 *   GET  /api/agent/security/analyze        - 安全分析（智能阈值建议）
 *   GET  /api/agent/security/history        - 分析历史
 *   POST /api/agent/security/apply          - 应用阈值调整（需审批）
 *
 * 监控接口：
 *   GET  /api/agent/stats/overview          - 智能体运行统计
 *   GET  /api/agent/stats/emotion           - 情感分析统计
 *   GET  /api/agent/knowledge/stats         - 知识库统计
 *
 * 信任免疫接口（任务一，只读，需登录）：
 *   GET  /api/agent/trust/status            - 信任引擎状态总览
 *   GET  /api/agent/trust/sources           - 信任来源清单（RBAC + 敏感正则 + JIT）
 *   GET  /api/agent/trust/trace             - PEP 决策审计跟踪
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const AgentDispatcher = require('../agent/dispatcher');
// 任务一新增：管理端鉴权中间件（信任只读接口需登录）+ PEP 信任引擎元信息
const { authMiddleware, optionalAuth } = require('../../middleware/auth');
const pepMeta = require('../agent/pep-guard');
const { SENSITIVE_PATTERNS, ROLE_ACTIONS } = pepMeta;
// 任务：污染指纹来源类型枚举（overview/attack-distribution 使用）
const { SOURCE_TYPES } = require('../agent/pollution-tracker');

// 全局 agent 实例（由 app.js 初始化时注入）
let agent = null;

/** 按信任等级给出默认原因（无历史裁决原因时的兜底文案） */
function _defaultTrustReason(level) {
  switch (level) {
    case 'locked':
      return '信任锁定：综合信任分低于锁定阈值，操作受限';
    case 'downgraded':
    case 'degraded':
      return '信任降权：综合信任分低于降权阈值，敏感动作受限';
    default:
      return '信任正常：综合信任分处于正常区间，全量放行';
  }
}

// 对外统一信任等级枚举（normal / degraded / locked），兼容引擎内部 downgraded
function _normLevel(level) {
  return level === 'downgraded' ? 'degraded' : (level || 'normal');
}

/**
 * 初始化 agent（由 app.js 调用）
 */
function initAgent(pool) {
  agent = new AgentDispatcher(pool);
  console.log('✅ AgentDispatcher 初始化完成');
  // 启动时把数据库中的限流阈值同步到限流器（避免代码默认值与库内值不一致）
  Promise.resolve()
    .then(async () => {
      const [rows] = await pool.query(
        "SELECT config_value FROM security_threshold_config WHERE config_key = 'rate_limit_max_requests' LIMIT 1"
      );
      if (rows && rows.length > 0 && rows[0].config_value !== undefined && typeof global.setRateLimitMaxRequests === 'function') {
        global.setRateLimitMaxRequests(rows[0].config_value);
      }
    })
    .catch((e) => console.log('⚠️ 启动时同步限流阈值失败（使用代码默认值）:', e.message));
}

/**
 * ============================================================
 * 旅客端接口
 * ============================================================
 */

/**
 * POST /api/agent/session/create
 * 创建新会话
 */
router.post('/session/create', async (req, res) => {
  try {
    const { passengerId, terminalId, flightNo } = req.body;
    const sessionToken = crypto.randomUUID();

    const pool = agent?.pool;
    if (pool) {
      try {
        await pool.execute(`
          INSERT INTO agent_session (session_token, passenger_id, terminal_id, flight_no)
          VALUES (?, ?, ?, ?)
        `, [sessionToken, passengerId || null, terminalId || null, flightNo || null]);
      } catch (e) {
        // 表不存在也返回 session token
      }
    }

    res.json({
      success: true,
      session_token: sessionToken,
      message: '会话创建成功',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/chat
 * 智能体对话入口（核心接口）
 *
 * 请求体：
 * {
 *   "text": "我找不到登机口了，慌得很",
 *   "session_token": "xxx",
 *   "passenger_id": 1,
 *   "flight_no": "CA1234",
 *   "terminal_id": 1
 * }
 *
 * 响应：
 * {
 *   "success": true,
 *   "response": "请别担心，您乘坐的是CA1234航班...",
 *   "intent": "emotion_support+gate_navigation",
 *   "emotion": "焦虑",
 *   "entities": { "flight_no": "CA1234" },
 *   "latency": 45
 * }
 */
router.post('/chat', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const { text, session_token, passenger_id, flight_no, terminal_id } = req.body;
    console.log(`[Agent防线] 收到攻击载荷: ${String(req.body?.text || '').slice(0, 60)}`);

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: '请输入有效内容',
        response: '请告诉我您需要什么帮助。',
      });
    }

    // 调用智能体
    const result = await agent.processRequest({
      text: text.trim(),
      userId: `passenger_${passenger_id || 'anonymous'}`,
      sessionId: session_token || `anon_${crypto.randomUUID()}`,
      flightNo: flight_no,
      terminalId: terminal_id,
    });
    console.log(`[Agent防线] 智能体返回: ${JSON.stringify(result).slice(0, 200)}`);

    res.json(result);

  } catch (error) {
    console.error('Agent chat error:', error);
    res.status(500).json({
      success: false,
      error: '智能体处理失败',
      response: '抱歉，智能体暂时不可用，请稍后再试。',
    });
  }
});

/**
 * ============================================================
 * 安全管理端接口
 * ============================================================
 */

/**
 * GET /api/agent/security/analyze?window=30
 * 安全分析（智能阈值建议）
 */
router.get('/security/analyze', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const window = parseInt(req.query.window) || 30;
    const report = await agent.processSecurityRequest({ timeWindow: window });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/security/history?limit=20
 * 获取历史分析报告
 */
router.get('/security/history', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await agent.securityAgent.getHistory(limit);
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/security/apply
 * 应用阈值调整（需要管理员权限）
 */
router.post('/security/apply', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const { threshold, approved_by } = req.body;

    if (!threshold || threshold < 1 || threshold > 100) {
      return res.status(400).json({
        success: false,
        error: '阈值必须在 1-100 之间',
      });
    }

    const result = await agent.securityAgent.applyThreshold(threshold);

    // 记录审计日志
    try {
      await agent.pool.execute(`
        INSERT INTO security_audit_logs (username, action_type, action_content, ip_address, result)
        VALUES (?, ?, ?, ?, ?)
      `, [
        approved_by || 'admin',
        'threshold_adjust',
        `安全阈值调整为 ${threshold} 次/秒`,
        req.ip || 'unknown',
        'success',
      ]);
    } catch (e) {
      // 审计日志写入失败不阻塞
    }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ============================================================
 * 监控统计接口
 * ============================================================
 */

/**
 * GET /api/agent/stats/overview
 * 智能体运行统计
 */
router.get('/stats/overview', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const pool = agent.pool;

    // 当日区间（兼容 MySQL 与 SQLite：JS 计算零点，参数化查询替代 CURDATE 避免 500）
    const _now = new Date();
    const _dayStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
    const _dayEnd = new Date(_dayStart.getTime() + 86400000);
    const _pad2 = (n) => String(n).padStart(2, '0');
    const _fmt = (d) => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())} 00:00:00`;
    const dayStartStr = _fmt(_dayStart);
    const dayEndStr = _fmt(_dayEnd);

    // 总交互数
    const [totalRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
    `);

    // 今日交互数
    const [todayRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
      WHERE created_at >= ? AND created_at < ?
    `, [dayStartStr, dayEndStr]);

    // 意图分布
    const [intentRows] = await pool.query(`
      SELECT intent, COUNT(*) as count
      FROM agent_interaction_log
      WHERE created_at >= ? AND created_at < ?
      GROUP BY intent
      ORDER BY count DESC
    `, [dayStartStr, dayEndStr]);

    // 拦截数
    const [blockRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
      WHERE guardrail_flagged = 1
    `);

    // 平均延迟
    const [latencyRows] = await pool.query(`
      SELECT AVG(latency_ms) as avg_latency FROM agent_interaction_log
      WHERE created_at >= ? AND created_at < ? AND latency_ms IS NOT NULL
    `, [dayStartStr, dayEndStr]);

    // 置信度分布
    const [confRows] = await pool.query(`
      SELECT
        SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN confidence < 0.5 THEN 1 ELSE 0 END) as low
      FROM agent_interaction_log
      WHERE created_at >= ? AND created_at < ?
    `, [dayStartStr, dayEndStr]);

    res.json({
      success: true,
      data: {
        total_interactions: totalRows[0].total,
        today_interactions: todayRows[0].total,
        total_guardrail_blocks: blockRows[0].total,
        avg_latency_ms: Math.round(latencyRows[0].avg_latency || 0),
        intent_distribution: intentRows,
        confidence: confRows[0],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/stats/emotion
 * 情感统计
 */
router.get('/stats/emotion', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Agent 未初始化' });
    }

    // 注意：agent_interaction_log 无 emotion_intensity 列（历史遗留字段），仅按 emotion 分组计数
    // 当日区间（兼容 MySQL 与 SQLite，替代 CURDATE）
    const _now = new Date();
    const _dayStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate());
    const _dayEnd = new Date(_dayStart.getTime() + 86400000);
    const _pad2 = (n) => String(n).padStart(2, '0');
    const _fmt = (d) => `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())} 00:00:00`;
    const [rows] = await pool.query(`
      SELECT emotion, COUNT(*) as count
      FROM agent_interaction_log
      WHERE created_at >= ? AND created_at < ? AND emotion IS NOT NULL AND emotion != '平静'
      GROUP BY emotion
      ORDER BY count DESC
    `, [_fmt(_dayStart), _fmt(_dayEnd)]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/knowledge/stats
 * 知识库统计
 */
router.get('/knowledge/stats', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Agent 未初始化' });
    }

    const [rows] = await pool.query(`
      SELECT category, COUNT(*) as count, AVG(priority) as avg_priority
      FROM knowledge_base
      WHERE is_active = 1
      GROUP BY category
    `);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/agent/llm/switch
 * 运行时切换 LLM 大脑
 */
router.post('/llm/switch', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }

  try {
    const { provider, model, apiKey, baseUrl, temperature, fallbackChain, systemPrompt } = req.body;

    if (!provider) {
      return res.status(400).json({ success: false, error: '请指定 provider（rule_engine | openai | vllm | claude | dashscope）' });
    }

    const result = agent.switchLLM({
      provider,
      model: model || 'none',
      apiKey: apiKey || '',
      baseUrl: baseUrl || '',
      temperature: temperature ?? 0.3,
      fallbackChain: fallbackChain || [],
      systemPrompt: systemPrompt || '',
    });

    try {
      await agent.pool.execute(`
        INSERT INTO security_audit_logs (username, action_type, action_content, ip_address, result)
        VALUES (?, ?, ?, ?, ?)
      `, [
        req.body.approved_by || 'admin',
        'llm_switch',
        `LLM 切换: ${provider} / ${model || 'none'}`,
        req.ip || 'unknown',
        'success',
      ]);
    } catch (e) { }

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agent/llm/stats
 * LLM 使用统计
 */
router.get('/llm/stats', async (req, res) => {
  if (!agent) {
    return res.status(503).json({ success: false, error: 'Agent 未初始化' });
  }
  res.json({ success: true, data: agent.getLLMStats() });
});

/**
 * GET /api/agent/knowledge/list
 * 知识库列表
 */
router.get('/knowledge/list', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Agent 未初始化' });
    }

    const category = req.query.category || null;
    let sql = 'SELECT id, title, content, category, keywords, priority FROM knowledge_base WHERE is_active = 1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY priority DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * ============================================================
 * Agent 阈值管理路由
 * ============================================================
 */

/**
 * GET /api/agent/threshold/status
 * 获取所有阈值状态（当前值 + Agent建议）
 */
router.get('/threshold/status', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) return res.status(503).json({ success: false, error: 'Agent 未初始化' });
    const [rows] = await pool.query('SELECT * FROM security_threshold_config');
    res.json({ success: true, data: rows });
  } catch (e) {
    res.json({ success: true, data: mockThresholdData() });
  }
});

/**
 * GET /api/agent/threshold/history?limit=20
 * 获取阈值修改历史
 */
router.get('/threshold/history', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) return res.status(503).json({ success: false, error: 'Agent 未初始化' });
    const limit = parseInt(req.query.limit) || 20;
    const [rows] = await pool.query(`SELECT * FROM threshold_history ORDER BY applied_at DESC LIMIT ?`, [limit]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.json({ success: true, data: mockThresholdHistory() });
  }
});

/**
 * POST /api/agent/threshold/set-mode
 * 设置阈值管理模式（人工/Agent接管）
 */
router.post('/threshold/set-mode', async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['manual', 'agent'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'mode 必须是 manual 或 agent' });
    }

    const pool = agent?.pool;
    if (pool) {
      try {
        await pool.execute(
          'INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)',
          ['threshold', 'info', `阈值管理模式切换为: ${mode}`]
        );
      } catch (_) { }
    }

    // 更新 Dispatcher 的全局阈值
    if (agent && global.agentDispatcher) {
      global.agentDispatcher.thresholdAutoMode = mode === 'agent';
    }

    res.json({ success: true, mode, message: mode === 'agent' ? 'Agent 已接管阈值管理' : '已切换为人工模式' });
  } catch (e) {
    res.json({ success: true, mode: req.body.mode, message: '模式已切换' });
  }
});

/**
 * POST /api/agent/threshold/adjust
 * 人工调整单个阈值
 */
router.post('/threshold/adjust', async (req, res) => {
  try {
    const { threshold_key, new_value } = req.body;
    if (!threshold_key || new_value === undefined) {
      return res.status(400).json({ success: false, error: '缺少参数' });
    }

    const pool = agent?.pool;
    if (!pool) return res.status(503).json({ success: false, error: 'Agent 未初始化' });

    // 获取旧值
    const [oldRows] = await pool.query('SELECT config_value FROM security_threshold_config WHERE config_key = ?', [threshold_key]);
    const old_value = oldRows[0]?.config_value || 'unknown';

    // 更新值
    await pool.execute(
      'UPDATE security_threshold_config SET config_value = ? WHERE config_key = ?',
      [new_value, threshold_key]
    );

    // 记录历史
    await pool.execute(
      'INSERT INTO threshold_history (threshold_key, old_value, new_value, suggested_by, confidence, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [threshold_key, old_value, new_value, 'manual', 0, '人工调整', 'applied']
    );

    // 如果 threshold_key 是 rate_limit_max_requests，立即生效到限流器（无需重启）
    if (threshold_key === 'rate_limit_max_requests') {
      const applied = typeof global.setRateLimitMaxRequests === 'function'
        ? global.setRateLimitMaxRequests(new_value)
        : false;
      if (!applied) {
        return res.json({ success: true, message: '阈值已写入数据库，但限流器未接受该值（需为 1-100 的整数）', old_value, new_value });
      }
    }

    res.json({ success: true, message: `阈值 ${threshold_key} 已更新为 ${new_value}（即时生效）`, old_value, new_value });
  } catch (e) {
    res.json({ success: true, message: '阈值已更新' });
  }
});

/**
 * POST /api/agent/threshold/apply-agent
 * Agent 建议应用（一键应用所有 Agent 建议）
 */
router.post('/threshold/apply-agent', async (req, res) => {
  try {
    const pool = agent?.pool;
    if (!pool) return res.status(503).json({ success: false, error: 'Agent 未初始化' });

    const [rows] = await pool.query('SELECT * FROM security_threshold_config WHERE agent_suggested_value IS NOT NULL AND agent_suggested_value != config_value');
    const changes = [];

    for (const row of rows) {
      const old_value = row.config_value;
      await pool.execute(
        'UPDATE security_threshold_config SET config_value = ? WHERE config_key = ?',
        [row.agent_suggested_value, row.config_key]
      );
      await pool.execute(
        'INSERT INTO threshold_history (threshold_key, old_value, new_value, suggested_by, confidence, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.config_key, old_value, row.agent_suggested_value, 'agent', row.confidence || 0.8, row.suggestion_reason, 'applied']
      );
      // 限流阈值同步生效到限流器
      if (row.config_key === 'rate_limit_max_requests' && typeof global.setRateLimitMaxRequests === 'function') {
        global.setRateLimitMaxRequests(row.agent_suggested_value);
      }
      changes.push({ key: row.config_key, old: old_value, new: row.agent_suggested_value });
    }

    res.json({ success: true, changes, message: `已应用 ${changes.length} 项 Agent 建议` });
  } catch (e) {
    res.json({ success: true, changes: [], message: '已应用 Agent 建议' });
  }
});

// ── Mock 数据函数（数据库不可用时） ──
function mockThresholdData() {
  return [
    { config_key: 'rate_limit_max_requests', config_value: '5', agent_suggested_value: '3', suggestion_reason: '攻击频率上升，建议降低阈值', confidence: 0.92 },
    { config_key: 'bloom_filter_capacity', config_value: '10000', agent_suggested_value: '15000', suggestion_reason: '黑名单IP增长，建议扩容', confidence: 0.85 },
    { config_key: 'hmac_token_ttl', config_value: '300', agent_suggested_value: '180', suggestion_reason: '检测到重放攻击尝试', confidence: 0.78 },
    { config_key: 'slow_connection_timeout', config_value: '30', agent_suggested_value: '20', suggestion_reason: 'Slowloris攻击风险增加', confidence: 0.90 },
  ];
}

function mockThresholdHistory() {
  return [
    { threshold_key: 'rate_limit_max_requests', old_value: '8', new_value: '5', suggested_by: 'agent', confidence: 0.92, reason: '过去1小时内检测到150次高频请求攻击', applied_at: '2026-06-21 10:30:00', status: 'applied' },
    { threshold_key: 'bloom_filter_capacity', old_value: '5000', new_value: '10000', suggested_by: 'agent', confidence: 0.85, reason: '黑名单IP数量增长至4200，接近容量上限', applied_at: '2026-06-20 16:45:00', status: 'applied' },
    { threshold_key: 'hmac_token_ttl', old_value: '600', new_value: '300', suggested_by: 'agent', confidence: 0.78, reason: '检测到3次重放攻击尝试', applied_at: '2026-06-20 14:20:00', status: 'applied' },
    { threshold_key: 'slow_connection_timeout', old_value: '60', new_value: '30', suggested_by: 'agent', confidence: 0.90, reason: 'Slowloris攻击模式识别', applied_at: '2026-06-20 09:15:00', status: 'applied' },
    { threshold_key: 'rate_limit_max_requests', old_value: '10', new_value: '8', suggested_by: 'manual', confidence: 0.0, reason: '人工调整', applied_at: '2026-06-19 18:00:00', status: 'applied' },
  ];
}

/**
 * ============================================================
 * 信任免疫接口（任务一·只读，需登录）
 * ============================================================
 * 信任来源 = RBAC 角色-动作矩阵 + 敏感操作正则 + JIT 一次性令牌
 * 决策过程：evaluate() 确定性判定 → issueToken() / verifyToken() / revokeToken()
 */

// GET /api/agent/trust/status - 会话信任状态列表
//   两种模式：
//   1) 旅客端：?sessionToken=xxx 时无需 Bearer token，返回该单个会话信任状态
//      （未评估会话不报错，按默认信任 normal/70 返回）
//   2) 管理端：携带有效 Bearer token 时返回全量会话信任状态列表
router.get('/trust/status', optionalAuth, async (req, res) => {
  try {
    const te = agent && agent.trustEngine ? agent.trustEngine : null;
    const { sessionToken } = req.query;

    // ── 模式 1：按 sessionToken 查询单个会话（旅客端无鉴权场景）──
    if (sessionToken) {
      const subject = String(sessionToken);
      if (!te) {
        return res.json({
          success: true,
          data: {
            sessionId: subject,
            role: 'passenger',
            trustScore: 70,
            level: 'normal',
            reason: '信任引擎未初始化，按默认信任处理',
            updatedAt: Date.now(),
          },
        });
      }
      const status = te.getStatus(subject);
      const meta = te.getMeta(subject);
      const level = _normLevel(status.level);
      return res.json({
        success: true,
        data: {
          sessionId: subject,
          role: meta.role || 'passenger',
          trustScore: status.score,
          level,
          reason: meta.reason || _defaultTrustReason(level),
          updatedAt: status.updatedAt,
        },
      });
    }

    // ── 模式 2：管理端全量列表（需有效 Bearer token）──
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, error: 'UNAUTHORIZED', message: '需要管理员登录或提供 sessionToken 参数' });
    }
    const list = [];
    if (te) {
      for (const s of te.snapshot()) {
        const meta = te.getMeta(s.subject);
        list.push({
          sessionId: s.subject,
          role: meta.role || 'passenger',
          trustScore: s.score,
          level: _normLevel(s.level),
          reason: meta.reason || _defaultTrustReason(s.level),
          updatedAt: s.updatedAt,
        });
      }
    }
    // 风险优先排序：低分在前
    list.sort((a, b) => a.trustScore - b.trustScore);
    return res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// GET /api/agent/trust/history?sessionId=xxx - 会话信任曲线（分数历史，时间升序）
router.get('/trust/history', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, error: '缺少 sessionId 参数' });
    }
    const te = agent && agent.trustEngine ? agent.trustEngine : null;
    if (!te) {
      return res.status(503).json({ success: false, error: '信任引擎未初始化' });
    }
    const hist = te.getHistory(String(sessionId));
    const data = hist.map((p) => ({ timestamp: new Date(p.timestamp).toISOString(), score: p.score }));
    return res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// GET /api/agent/trust/sources - 信任来源清单
router.get('/trust/sources', authMiddleware, async (req, res) => {
  const guard = agent && agent.pepGuard ? agent.pepGuard : null;
  const sources = [
    {
      id: 'rbac_matrix',
      name: '角色-动作授权矩阵',
      type: 'RBAC',
      detail: ROLE_ACTIONS,
    },
    {
      id: 'sensitive_rules',
      name: '敏感操作正则规则',
      type: 'REGEX',
      detail: SENSITIVE_PATTERNS.map((r) => ({ id: r.id, desc: r.desc, requiredRole: r.requiredRole })),
    },
    {
      id: 'jit_token',
      name: 'JIT 一次性令牌',
      type: 'HMAC',
      detail: { ttlSeconds: guard && guard.ttlMs ? guard.ttlMs / 1000 : 0, bind: ['action', 'sessionId'], revoke: '执行后作废' },
    },
  ];
  res.json({ success: true, data: sources });
});

// GET /api/agent/trust/trace - PEP 决策审计跟踪（分页）
//   过滤参数：session / action / allowed(0|1)；分页：limit(默认50, 上限200)、offset(默认0)
router.get('/trust/trace', authMiddleware, async (req, res) => {
  try {
    const { session, action, allowed } = req.query;
    const lim = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const off = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (!agent || !agent.pool) {
      return res.json({ success: false, message: '数据库不可用', data: [], total: 0 });
    }

    const where = [];
    const params = [];
    if (session) { where.push('session_token = ?'); params.push(session); }
    if (action) { where.push('action = ?'); params.push(action); }
    if (allowed === '0' || allowed === '1') { where.push('allowed = ?'); params.push(Number(allowed)); }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    const [rows] = await agent.pool.query(
      `SELECT id, session_token, action, role, allowed, reason, jit_token, terminal_id, created_at
       FROM pep_decision_log${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, lim, off]
    );
    const [[{ cnt }]] = await agent.pool.query(
      `SELECT COUNT(*) AS cnt FROM pep_decision_log${whereSql}`, params
    );

    res.json({ success: true, data: rows || [], total: Number(cnt) || 0, limit: lim, offset: off });
  } catch (e) {
    res.json({ success: false, message: '查询审计失败: ' + e.message, data: [], total: 0 });
  }
});

// GET /api/agent/pollution/list - 污染指纹列表
router.get('/pollution/list', authMiddleware, async (req, res) => {
  try {
    const tracker = agent && agent.pollutionTracker ? agent.pollutionTracker : null;
    if (!tracker) {
      return res.status(503).json({ success: false, error: '污染指纹注册表未初始化' });
    }
    return res.json({ success: true, data: tracker.list() });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// 攻击类型固定枚举（5 类，count=0 也全部返回）
const ATTACK_TYPES = [
  { type: 'direct-injection', name: '直接注入' },
  { type: 'indirect-injection', name: '间接注入' },
  { type: 'confusion-bypass', name: '混淆绕过' },
  { type: 'privilege-escalation', name: '越权提权' },
  { type: 'replay-attack', name: '重放攻击' },
];

// GET /api/agent/overview/attack-distribution - 攻击类型分布
router.get('/overview/attack-distribution', authMiddleware, async (req, res) => {
  try {
    const tracker = agent && agent.pollutionTracker ? agent.pollutionTracker : null;
    const counts = tracker ? tracker.countsBySource() : {};
    const data = ATTACK_TYPES.map((t) => ({ type: t.type, name: t.name, count: counts[t.type] || 0 }));
    return res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// GET /api/agent/overview/summary - 安全运营 KPI 总览
//   totalBlocked 来自 pep_decision_log(allowed=0) / activeSessions·degraded·locked 来自信任快照
router.get('/overview/summary', authMiddleware, async (req, res) => {
  try {
    const pool = agent && agent.pool ? agent.pool : null;
    const te = agent && agent.trustEngine ? agent.trustEngine : null;

    // 决策统计（pep_decision_log）
    let totalDecisions = 0;
    let totalBlocked = 0;
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT allowed, COUNT(*) AS cnt FROM pep_decision_log GROUP BY allowed');
        for (const r of rows || []) {
          const n = Number(r.cnt || 0);
          totalDecisions += n;
          if (Number(r.allowed) === 0) totalBlocked += n;
        }
      } catch (e) {
        // 表不可用 → 保留 0
      }
    }

    // 信任快照各 level 会话数
    const snapshot = te ? te.snapshot() : [];
    let degradedSessions = 0;
    let lockedSessions = 0;
    for (const s of snapshot) {
      const lv = _normLevel(s.level);
      if (lv === 'degraded') degradedSessions += 1;
      else if (lv === 'locked') lockedSessions += 1;
    }
    const activeSessions = snapshot.length;
    const blockRate = totalDecisions > 0 ? Number((totalBlocked / totalDecisions).toFixed(4)) : 0;

    return res.json({
      success: true,
      data: {
        totalBlocked,
        activeSessions,
        degradedSessions,
        lockedSessions,
        blockRate,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// GET /api/agent/overview/trend - 拦截趋势（按天分桶，兼容 MySQL/SQLite）
router.get('/overview/trend', authMiddleware, async (req, res) => {
  try {
    const pool = agent && agent.pool ? agent.pool : null;
    if (!pool) {
      return res.status(503).json({ success: false, error: '数据库不可用' });
    }
    let rows = [];
    try {
      [rows] = await pool.query(`
        SELECT substr(created_at, 1, 10) AS day,
               COUNT(*) AS total,
               SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) AS blocked
        FROM pep_decision_log
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day ASC
      `);
    } catch (e) {
      // 表不存在/查询失败 → 返回空数组（success:true）
      rows = [];
    }
    const data = (rows || []).map((r) => ({
      timestamp: `${r.day || ''} 00:00:00`,
      blocked: Number(r.blocked) || 0,
      total: Number(r.total) || 0,
    }));
    return res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

// GET /api/agent/trace/chain - 溯源血缘链（攻击来源 → 会话 → 调用 → 结果）
//   category：source / session / call / result；无数据时返回空 nodes/links
router.get('/trace/chain', authMiddleware, async (req, res) => {
  try {
    const tracker = agent && agent.pollutionTracker ? agent.pollutionTracker : null;
    const fps = tracker ? tracker.list() : [];
    const nodes = [];
    const links = [];
    const sessionNodes = new Map();
    let seq = 0;
    const nid = () => `n${++seq}`;

    for (const f of fps) {
      // 来源节点（攻击指纹）
      const sourceId = nid();
      nodes.push({
        id: sourceId,
        name: `攻击指纹 ${String(f.fingerprint).slice(0, 6)}`,
        category: 'source',
        desc: `来源类型 ${f.sourceType}（${f.fingerprintType}），命中 ${f.hitCount} 次`,
      });

      const sessions = f.sessions || [];
      if (sessions.length === 0) {
        // 无会话信息的独立指纹：来源 → 结果
        const resultId = nid();
        nodes.push({ id: resultId, name: '已拦截', category: 'result', desc: f.reason || '防御动作命中' });
        links.push({ source: sourceId, target: resultId });
        continue;
      }

      for (const s of sessions) {
        // 会话节点（去重复用）
        let sessId = sessionNodes.get(s);
        if (!sessId) {
          sessId = nid();
          sessionNodes.set(s, sessId);
          nodes.push({
            id: sessId,
            name: `会话 ${String(s).slice(0, 12)}`,
            category: 'session',
            desc: `会话标识 ${s}`,
          });
        }
        links.push({ source: sourceId, target: sessId });

        // 调用/决策节点
        const callId = nid();
        nodes.push({
          id: callId,
          name: `拦截调用 ${f.fingerprintType}`,
          category: 'call',
          desc: f.reason || '防御动作命中',
        });
        links.push({ source: sessId, target: callId });

        // 结果节点
        const resultId = nid();
        nodes.push({
          id: resultId,
          name: '拦截',
          category: 'result',
          desc: `已阻止（${f.sourceType}）`,
        });
        links.push({ source: callId, target: resultId });
      }
    }

    return res.json({ success: true, data: { nodes, links } });
  } catch (e) {
    res.status(500).json({ success: false, error: 'INTERNAL', message: e.message });
  }
});

module.exports = { router, initAgent };
