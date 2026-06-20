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
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const AgentDispatcher = require('../agent/dispatcher');

// 全局 agent 实例（由 app.js 初始化时注入）
let agent = null;

/**
 * 初始化 agent（由 app.js 调用）
 */
function initAgent(pool) {
  agent = new AgentDispatcher(pool);
  console.log('✅ AgentDispatcher 初始化完成');
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

    // 总交互数
    const [totalRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
    `);

    // 今日交互数
    const [todayRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
      WHERE DATE(created_at) = CURDATE()
    `);

    // 意图分布
    const [intentRows] = await pool.query(`
      SELECT intent, COUNT(*) as count
      FROM agent_interaction_log
      WHERE DATE(created_at) = CURDATE()
      GROUP BY intent
      ORDER BY count DESC
    `);

    // 拦截数
    const [blockRows] = await pool.query(`
      SELECT COUNT(*) as total FROM agent_interaction_log
      WHERE guardrail_flagged = 1
    `);

    // 平均延迟
    const [latencyRows] = await pool.query(`
      SELECT AVG(latency_ms) as avg_latency FROM agent_interaction_log
      WHERE DATE(created_at) = CURDATE() AND latency_ms IS NOT NULL
    `);

    // 置信度分布
    const [confRows] = await pool.query(`
      SELECT
        SUM(CASE WHEN confidence >= 0.8 THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN confidence >= 0.5 AND confidence < 0.8 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN confidence < 0.5 THEN 1 ELSE 0 END) as low
      FROM agent_interaction_log
      WHERE DATE(created_at) = CURDATE()
    `);

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

    const [rows] = await pool.query(`
      SELECT emotion, COUNT(*) as count, AVG(emotion_intensity) as avg_intensity
      FROM agent_interaction_log
      WHERE DATE(created_at) = CURDATE() AND emotion != '平静'
      GROUP BY emotion
      ORDER BY count DESC
    `);

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

module.exports = { router, initAgent };
