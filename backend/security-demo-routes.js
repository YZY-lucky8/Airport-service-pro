const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const rateLimitRecords = new Map();
const demoLogs = [];

const WINDOW_MS = 1000;
const MAX_REQUESTS = 30;
const { pushSecurityEvent } = require('./ws-bridge');

const REPLAY_SECRET =
  process.env.REPLAY_DEMO_SECRET || 'change-this-demo-secret';

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function addLog(req, attackType, blocked, detail) {
  demoLogs.unshift({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    ip: getClientIp(req),
    attack_type: attackType,
    src_ip: getClientIp(req),
    status: blocked ? 'blocked' : 'allowed',
    detail,
  });

  if (demoLogs.length > 100) {
    demoLogs.length = 100;
  }
}

function rateLimitMiddleware(req, res, next) {
  // 只对限流测试接口生效，其他接口直接放行，避免误伤防线测试/日志接口
  if (!req.originalUrl.startsWith('/api/test-rate-limit')) {
    return next();
  }
  const ip = getClientIp(req);
  const now = Date.now();

  let record = rateLimitRecords.get(ip);

  if (!record || now - record.start >= WINDOW_MS) {
    record = {
      start: now,
      count: 0,
    };
  }

  record.count += 1;
  rateLimitRecords.set(ip, record);

  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.setHeader(
    'X-RateLimit-Remaining',
    String(Math.max(0, MAX_REQUESTS - record.count))
  );

  if (record.count > MAX_REQUESTS) {
    addLog(
      req,
      '限流攻击',
      true,
      `1秒内第 ${record.count} 次请求`
    );
    console.log(`[限流] 拦截 ${req.ip} 第${record.count}次请求`);

    pushSecurityEvent({
      type: 'attack_event',
      data: {
        time: new Date().toISOString(),
        attackType: 'HTTP Flood',
        defense: '限流',
        action: '拦截',
        status: 'blocked'
      }
    });

    return res.status(429).json({
      success: false,
      blocked: true,
      code: 'RATE_LIMIT_EXCEEDED',
      message: '请求频率过高，已被运行时监控拦截',
    });
  }

  next();
}

// GET /api/test-rate-limit

router.get('/api/test-rate-limit', rateLimitMiddleware, (req, res) => {
  console.log(`[限流测试] 请求到达 ${req.ip}`);
  addLog(req, '限流测试', false, '请求通过限流检查');
  pushSecurityEvent({
    type: 'attack_event',
    data: {
      time: new Date().toISOString(),
      attackType: 'HTTP Flood',
      defense: '限流',
      action: '放行',
      status: 'allowed'
    }
  });

  res.json({
    success: true,
    blocked: false,
    message: '请求通过限流检查',
    timestamp: new Date().toISOString(),
  });
});

function createHmacToken(timestamp) {
  return crypto
    .createHmac('sha256', REPLAY_SECRET)
    .update(String(timestamp))
    .digest('hex');
}

function equalToken(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

// POST /api/test-replay
router.post('/api/test-replay', express.json(), (req, res) => {
  const token = req.get('X-Token');
  const timestamp = Number(req.get('X-Timestamp'));

  if (!token || !timestamp) {
    console.log(`[重放] 拦截 ${req.ip}: 缺少 X-Token`);
    addLog(req, '重放攻击', true, '缺少 X-Token 或 X-Timestamp');
    pushSecurityEvent({
      type: 'attack_event',
      data: {
        time: new Date().toISOString(),
        attackType: '令牌鉴权攻击',
        defense: 'HMAC 校验',
        action: '拦截',
        status: 'blocked'
      }
    });

    return res.status(401).json({
      success: false,
      blocked: true,
      code: 'TOKEN_MISSING',
      message: '缺少令牌，请求被拦截',
    });
  }

  if (
    !Number.isFinite(timestamp) ||
    Math.abs(Date.now() - timestamp) > 30000
  ) {
    console.log(`[重放] 拦截 ${req.ip}: 时间戳过期`);

    addLog(req, '重放攻击', true, '请求时间戳已过期');
    pushSecurityEvent({
      type: 'attack_event',
      data: {
        time: new Date().toISOString(),
        attackType: '令牌鉴权攻击',
        defense: 'HMAC 校验',
        action: '拦截',
        status: 'blocked'
      }
    });

    return res.status(401).json({
      success: false,
      blocked: true,
      code: 'TOKEN_EXPIRED',
      message: '令牌过期，请求被拦截',
    });
  }

  const expectedToken = createHmacToken(timestamp);

  if (!equalToken(token, expectedToken)) {
    console.log(`[重放] 拦截 ${req.ip}: HMAC 校验失败`);

    addLog(req, '重放攻击', true, 'HMAC 令牌校验失败');
    pushSecurityEvent({
      type: 'attack_event',
      data: {
        time: new Date().toISOString(),
        attackType: '令牌鉴权攻击',
        defense: 'HMAC 校验',
        action: '拦截',
        status: 'blocked'

      }
    });

    return res.status(401).json({
      success: false,
      blocked: true,
      code: 'TOKEN_INVALID',
      message: '令牌校验失败，请求被拦截',
    });
  }
  console.log(`[重放] 放行 ${req.ip}: 令牌校验通过`);

  addLog(req, '重放测试', false, 'HMAC 令牌校验通过');
  pushSecurityEvent({
    type: 'attack_event',
    data: {
      time: new Date().toISOString(),
      attackType: '令牌鉴权攻击',
      defense: 'HMAC 校验',
      action: '放行',
      status: 'allowed'
    }
  });

  res.json({
    success: true,
    blocked: false,
    message: '令牌校验通过',
  });
});

// 看板专用日志接口
router.get('/api/security-demo-logs', (req, res) => {
  res.json({
    success: true,
    data: demoLogs,
  });
});

setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of rateLimitRecords.entries()) {
    if (now - record.start > 10000) {
      rateLimitRecords.delete(ip);
    }
  }
}, 10000).unref();
router.post('/api/security-demo-logs', express.json(), (req, res) => {
  const allowedTypes = new Set([
    'Prompt Injection', 'SQL 注入', 'XSS 跨站脚本', '零宽字符注入',
    '内部信息泄露', '命令注入', '越权工具调用', '输出敏感信息',
    'HTTP Flood', '令牌鉴权攻击',
  ]);

  const attackType = String(req.body.attackType || '').slice(0, 50);
  const blocked = req.body.blocked === true;
  const detail = String(req.body.detail || '').slice(0, 200);

  if (!allowedTypes.has(attackType)) {
    return res.status(400).json({
      success: false,
      message: '不支持的演示类型',
    });
  }

  addLog(req, attackType, blocked, detail);
  console.log(`[防线] 记录 ${attackType} -> ${blocked ? '拦截' : '放行'}`);

  return res.json({ success: true });
});
module.exports = router;