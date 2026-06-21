/**
 * ============================================================
 * Airport-service-pro — 主入口 (app.js)
 * ============================================================
 * 整合了所有安全模块：
 *   - Bloom Filter 黑名单
 *   - 滑动窗口频率检测
 *   - HMAC 一次性令牌
 *   - JWT 管理员认证
 *   - IP 白名单/黑名单（数据库持久化）
 *   - CSRF 保护（可选）
 *   - 智能体系统路由
 * ============================================================
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// ── 环境变量（必须在所有 process.env 使用之前） ──
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('crypto');

// ── 数据库适配层 ──
const db = require('./db-adapter');

const port = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true);

// ── 认证中间件 ──
const { authMiddleware, optionalAuth, authenticateUser, sign, addAdminUser, removeAdminUser, getAdminList, hashPassword } = require('../middleware/auth');

// ==================== Bloom Filter ====================
class BloomFilter {
    constructor(size = 10000, errorRate = 0.001) {
        const m = Math.ceil(-size * Math.log(errorRate) / (Math.log(2) ** 2));
        const k = Math.ceil((m / size) * Math.log(2));
        this.size = m;
        this.hashCount = k;
        this.bits = new Uint8Array(Math.ceil(m / 8));
    }
    insert(item) {
        let h1 = this._hash1(item);
        let h2 = this._hash2(item);
        for (let i = 0; i < this.hashCount; i++) {
            const pos = (h1 + i * h2) % this.size;
            const byte = Math.floor(pos / 8);
            const bit = pos % 8;
            this.bits[byte] |= 1 << bit;
        }
    }
    has(item) {
        let h1 = this._hash1(item);
        let h2 = this._hash2(item);
        for (let i = 0; i < this.hashCount; i++) {
            const pos = (h1 + i * h2) % this.size;
            const byte = Math.floor(pos / 8);
            const bit = pos % 8;
            if ((this.bits[byte] & (1 << bit)) === 0) return false;
        }
        return true;
    }
    _hash1(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }
    _hash2(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }
}

const ipBlacklistFilter = new BloomFilter(10000, 0.001);

// 本地黑名单（生产环境从数据库加载）
const bannedIPs = [
    '192.168.1.100',
    '10.0.0.5',
    '127.0.0.2'
];
bannedIPs.forEach(ip => ipBlacklistFilter.insert(ip));

// ==================== 中间件 ====================
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ── 安全 HTTP 头 ──
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// ── 滑动窗口频率检测 ──
const requestCounts = new Map();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

app.use((req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
    const now = Date.now();
    let timestamps = requestCounts.get(ip);
    if (!timestamps) {
        timestamps = [];
        requestCounts.set(ip, timestamps);
    }
    while (timestamps.length && timestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
        timestamps.shift();
    }
    if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
        console.log(`[Rate Limit] 拦截 IP ${ip}`);
        try {
            db.pool?.execute(
                'INSERT INTO attack_log (attack_type, src_ip, dst_ip, detection_method) VALUES (?, ?, ?, ?)',
                ['HTTP Flood', ip, req.socket?.localAddress || '127.0.0.1', '滑动窗口频率检测']
            ).catch(() => {});
        } catch (e) {}
        return res.status(403).json({ error: 'Too many requests. Please try again later.' });
    }
    timestamps.push(now);
    next();
});

// ── IP 白名单检查（从数据库读取） ──
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/health') || req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/agent') || req.path.startsWith('/api/token') || req.path === '/api/check-in' || req.path === '/api/csrf-token') {
    return next();
  }
  try {
    const clientIp = req.ip || req.connection?.remoteAddress;
    const [whitelistRows] = await db.pool?.query('SELECT ip_address FROM ip_whitelist WHERE 1=1 AND (ip_address = ? OR ip_address LIKE ?)', [clientIp, clientIp + '.%']);
    if (whitelistRows && whitelistRows.length > 0) {
      return next();
    }
  } catch (e) {}
  next();
});

// ── IP 黑名单拦截（Bloom Filter + 数据库持久化） ──
app.use(async (req, res, next) => {
  if (req.path === '/api/auth/login' || req.path === '/api/auth/verify' || req.path.startsWith('/api/health')) {
    return next();
  }
  const clientIp = req.ip || req.connection?.remoteAddress;
  try {
    if (!global.__blacklistLoaded && db.pool) {
      try {
        const [rows] = await db.pool.query('SELECT ip_address FROM ip_blacklist');
        if (rows) rows.forEach(r => ipBlacklistFilter.insert(r.ip_address));
      } catch (e) {}
      global.__blacklistLoaded = true;
    }
  } catch (e) {}
  if (ipBlacklistFilter.has(clientIp)) {
    console.warn(`🚫 已拦截黑名单IP：${clientIp}`);
    return res.status(403).json({ success: false, error: 'Access denied: Your IP is blocked' });
  }
  next();
});

// ── 攻击监控 ──
const attackMonitor = {
  failedAttempts: new Map(),
  rateLimit: new Map(),
  detectBruteForce: function(ip, success) {
    const key = `brute_${ip}`;
    let attempts = this.failedAttempts.get(key) || { count: 0, timestamp: Date.now() };
    if (!success) {
      attempts.count++;
      attempts.timestamp = Date.now();
      this.failedAttempts.set(key, attempts);
      if (attempts.count >= 5) { this.logAttack(ip, 'BRUTE_FORCE'); return true; }
    } else {
      this.failedAttempts.delete(key);
    }
    if (Date.now() - attempts.timestamp > 600000) this.failedAttempts.delete(key);
    return false;
  },
  checkRateLimit: function(ip, limit = 100, window = 60000) {
    const key = `rate_${ip}`;
    const now = Date.now();
    let record = this.rateLimit.get(key);
    if (!record) { record = { count: 1, timestamp: now }; this.rateLimit.set(key, record); return false; }
    if (now - record.timestamp > window) { record.count = 1; record.timestamp = now; return false; }
    record.count++;
    if (record.count > limit) { this.logAttack(ip, 'RATE_LIMIT_EXCEEDED'); return true; }
    return false;
  },
  logAttack: async function(ip, type) {
    try {
      await db.pool?.execute('INSERT INTO attack_log (attack_type, src_ip, dst_ip, create_time) VALUES (?, ?, ?, NOW())', [type, ip, 'localhost']);
    } catch (e) {}
  },
  cleanup: function() {
    const now = Date.now();
    this.failedAttempts.forEach((v, k) => { if (now - v.timestamp > 600000) this.failedAttempts.delete(k); });
  }
};
setInterval(() => attackMonitor.cleanup(), 300000);

app.use((req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress;
  if (attackMonitor.checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests.' });
  }
  next();
});

// ── HMAC 令牌 ──
const HMAC_SECRET = process.env.HMAC_SECRET || crypto.createHash('sha256').update('airport-hmac-secret-change-in-production').digest('hex');
const TOKEN_TTL = parseInt(process.env.TOKEN_TTL) || 300;

const generateToken = (userId = 'guest') => {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${timestamp}:${nonce}:${userId}`;
  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(message).digest('hex');
  return { token: `${signature}:${timestamp}:${nonce}`, timestamp, nonce, expires_in: TOKEN_TTL };
};

const verifyToken = async (token, userId = 'guest') => {
  try {
    const parts = token.split(':');
    if (parts.length !== 3) return { valid: false, reason: 'invalid_format' };
    const [signature, timestampStr, nonce] = parts;
    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > TOKEN_TTL) return { valid: false, reason: 'expired' };
    if (timestamp > now) return { valid: false, reason: 'future_timestamp' };
    const message = `${timestamp}:${nonce}:${userId}`;
    const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(message).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return { valid: false, reason: 'invalid_signature' };
    const isUsed = await isTokenUsed(token);
    if (isUsed) return { valid: false, reason: 'replayed' };
    await recordTokenUsage(token, userId);
    return { valid: true, timestamp, nonce };
  } catch (e) {
    return { valid: false, reason: 'verification_error' };
  }
};

const recordTokenUsage = async (token, userId) => {
  try { await db.pool?.execute('INSERT INTO token_usage (token, user_id) VALUES (?, ?)', [token, userId]); return true; } catch (e) { return false; }
};
const isTokenUsed = async (token) => {
  try { const [rows] = await db.pool?.execute('SELECT id FROM token_usage WHERE token = ? LIMIT 1', [token]); return rows && rows.length > 0; } catch (e) { return false; }
};

// ── 安全日志 ──
const logSecurityEvent = async (eventType, details) => {
  try { await db.pool?.execute('INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)', ['security', 'info', JSON.stringify(details)]); } catch (e) {}
};

// ── 审计日志 ──
const auditLog = async (req, action, userId, details = {}) => {
  try {
    await db.pool?.execute(
      'INSERT INTO audit_logs (action, user_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [action, userId || 'guest', JSON.stringify(details), req.ip || req.connection?.remoteAddress || '', req.headers['user-agent'] || '']
    );
  } catch (e) {}
};

// ── 输入验证 ──
function validateInput(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const field in schema) {
      const rules = schema[field];
      const value = req.body[field];
      if (rules.required && (value === undefined || value === null || value === '')) { errors.push(`${field} is required`); continue; }
      if (value !== undefined && value !== null) {
        if (rules.type === 'string' && typeof value !== 'string') errors.push(`${field} must be a string`);
        if (rules.type === 'number' && typeof value !== 'number') errors.push(`${field} must be a number`);
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) errors.push(`${field} exceeds max length`);
        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) errors.push(`${field} too short`);
        if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) errors.push(`${field} format invalid`);
      }
    }
    if (errors.length > 0) return res.status(400).json({ success: false, errors });
    next();
  };
}

// ── CSRF ──
const csrfTokens = new Map();
const generateCSRFToken = (userId = 'guest') => {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, { userId, expires: Date.now() + 3600000 });
  setTimeout(() => { if (csrfTokens.has(token) && csrfTokens.get(token).expires <= Date.now()) csrfTokens.delete(token); }, 3600000);
  return token;
};
const verifyCSRFToken = (token, userId) => {
  const stored = csrfTokens.get(token);
  if (!stored || stored.expires < Date.now()) { csrfTokens.delete(token); return false; }
  return stored.userId === userId;
};
const csrfProtection = (req, res, next) => {
  if (req.method === 'GET') return next();
  const csrfToken = req.headers['x-csrf-token'] || req.body.csrfToken;
  const userId = req.cookies?.userId || 'guest';
  if (!csrfToken || !verifyCSRFToken(csrfToken, userId)) return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
  next();
};
// 管理端 API 启用 CSRF 保护（公开 API 不启用）
// app.use(csrfProtection);

// ============================================================
// 🔐 认证路由 (Auth Routes)
// ============================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '请输入用户名和密码' });
  const user = authenticateUser(username, password);
  if (!user) {
    try { await db.pool?.execute('INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)', ['auth', 'warn', `登录失败: ${username} from ${req.ip}`]); } catch (e) {}
    return res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
  const token = sign({ username: user.username, role: user.role });
  res.json({ success: true, token, username: user.username, role: user.role, message: '登录成功' });
});

// POST /api/auth/verify
app.post('/api/auth/verify', authMiddleware, async (req, res) => {
  res.json({ success: true, user: req.user, message: 'token 有效' });
});

// GET /api/csrf-token
app.get('/api/csrf-token', (req, res) => {
  const token = generateCSRFToken(req.cookies?.userId || 'guest');
  res.json({ success: true, csrf_token: token });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ success: false, error: '请输入旧密码和新密码' });
  const user = authenticateUser(req.user.username, oldPassword);
  if (!user) return res.status(403).json({ success: false, error: '旧密码错误' });
  addAdminUser(req.user.username, newPassword);
  try { await db.pool?.execute('INSERT INTO audit_logs (action, user_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)', ['password_change', req.user.username, JSON.stringify({ target_user: req.user.username }), req.ip, req.headers['user-agent'] || '']); } catch (e) {}
  const newToken = sign({ username: req.user.username, role: req.user.role });
  res.json({ success: true, token: newToken, message: '密码修改成功' });
});

// POST /api/auth/add-admin
app.post('/api/auth/add-admin', authMiddleware, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
  addAdminUser(username, password);
  try { await db.pool?.execute('INSERT INTO audit_logs (action, user_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)', ['admin_added', req.user.username, JSON.stringify({ new_admin: username }), req.ip, req.headers['user-agent'] || '']); } catch (e) {}
  res.json({ success: true, message: `管理员 ${username} 添加成功` });
});

// POST /api/auth/remove-admin
app.post('/api/auth/remove-admin', authMiddleware, async (req, res) => {
  const { username } = req.body;
  if (!username || username === req.user.username) return res.status(400).json({ success: false, error: '不能删除自己或用户名无效' });
  removeAdminUser(username);
  try { await db.pool?.execute('INSERT INTO audit_logs (action, user_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)', ['admin_removed', req.user.username, JSON.stringify({ removed_admin: username }), req.ip, req.headers['user-agent'] || '']); } catch (e) {}
  res.json({ success: true, message: `管理员 ${username} 已删除` });
});

// GET /api/auth/admins
app.get('/api/auth/admins', authMiddleware, async (req, res) => {
  res.json({ success: true, admins: getAdminList() });
});

// ============================================================
// 🔓 公开 API (Passenger-facing)
// ============================================================

// POST /api/log
app.post('/api/log', async (req, res) => {
  const { module, level, message } = req.body;
  if (!module || !message) return res.status(400).json({ error: '缺少必要字段' });
  try { const [result] = await db.pool.execute('INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)', [module, level || 'info', message]); res.json({ success: true, id: result.insertId }); } catch (e) { console.error('日志写入失败:', e); res.status(500).json({ error: '服务器内部错误' }); }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try { const [rows] = await db.pool.query('SELECT COUNT(*) as total_records, SUM(passenger_count) as total_passengers, AVG(avg_dwell_time) as avg_dwell_time_seconds FROM passenger_flow'); res.json({ success: true, data: rows[0] }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// GET /api/logs?type=attack
app.get('/api/logs', async (req, res) => {
  if (req.query.type !== 'attack') return res.status(400).json({ error: '仅支持 type=attack' });
  try { const [rows] = await db.pool.query('SELECT id, attack_type, src_ip, dst_ip, create_time FROM attack_log ORDER BY create_time DESC LIMIT 100'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// GET /api/hourly-stats
app.get('/api/hourly-stats', async (req, res) => {
  try {
    const [rows] = await db.pool.query(`SELECT ANY_VALUE(DATE_FORMAT(start_time, '%H:00')) as hour, SUM(passenger_count) as \`usage\` FROM passenger_flow WHERE start_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY DATE_FORMAT(start_time, '%Y-%m-%d %H:00') ORDER BY MIN(start_time)`);
    res.json({ success: true, data: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// GET /api/token/generate
app.get('/api/token/generate', async (req, res) => {
  try {
    const userId = req.query.userId || req.cookies?.userId || 'guest';
    const tokenData = generateToken(userId);
    await logSecurityEvent('token_generated', { userId, timestamp: tokenData.timestamp });
    res.json({ success: true, token: tokenData.token, expires_in: tokenData.expires_in, timestamp: tokenData.timestamp });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/check-in (受 HMAC 令牌保护)
app.post('/api/check-in', validateInput({
  flightNumber: { required: true, type: 'string', pattern: /^[A-Z0-9]{4,10}$/ },
  passengerName: { required: true, type: 'string', maxLength: 100, minLength: 2 }
}), async (req, res) => {
  try {
    const token = req.query.token || req.headers['x-token'];
    if (!token) return res.status(401).json({ success: false, error: 'Missing token' });
    const userId = req.cookies?.userId || 'guest';
    const result = await verifyToken(token, userId);
    if (!result.valid) {
      const reasonMap = { expired: 'Token expired', invalid_signature: 'Invalid signature', replayed: 'Token used', invalid_format: 'Invalid format' };
      return res.status(401).json({ success: false, error: reasonMap[result.reason] || 'Invalid token' });
    }
    const { flightNumber, passengerName } = req.body;
    await logSecurityEvent('check_in', { userId, flightNumber, passengerName, timestamp: new Date().toISOString() });
    res.json({ success: true, message: 'Check-in completed', data: { flightNumber, passengerName, timestamp: new Date().toISOString() } });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/health/db
app.get('/api/health/db', async (req, res) => {
  try { const [rows] = await db.pool.query('SELECT 1 as test'); res.json({ success: true, message: 'Database connected', data: rows }); } catch (e) { res.status(500).json({ success: false, message: 'Database connection failed', error: e.message }); }
});

// ============================================================
// 🔒 管理端 API (需 JWT 认证)
// ============================================================

// 1. 数据监控摘要
app.get('/api/admin/dashboard', authMiddleware, async (req, res) => {
    try {
        const [terminals] = await db.pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status = "online" THEN 1 ELSE 0 END) as online, SUM(CASE WHEN status = "offline" THEN 1 ELSE 0 END) as offline, SUM(CASE WHEN status = "fault" THEN 1 ELSE 0 END) as fault FROM terminal');
        const [todayUsage] = await db.pool.query('SELECT SUM(passenger_count) as total FROM passenger_flow WHERE DATE(start_time) = CURDATE()');
        const [topQuestion] = await db.pool.query('SELECT command_text, COUNT(*) as cnt FROM voice_log WHERE create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY command_text ORDER BY cnt DESC LIMIT 1');
        const [unhandled] = await db.pool.query('SELECT COUNT(*) as count FROM alerts WHERE status = "unhandled"');
        res.json({ success: true, data: { online_terminals: terminals[0].online, total_terminals: terminals[0].total, offline_terminals: terminals[0].offline, fault_terminals: terminals[0].fault, today_usage: todayUsage[0].total || 0, top_question: topQuestion[0]?.command_text || '暂无', top_question_count: topQuestion[0]?.cnt || 0, unhandled_alerts: unhandled[0].count, inbound_traffic: '150Mbps', outbound_traffic: '80Mbps', cpu_usage: 45, memory_usage: 62 } });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 2. 终端状态
app.get('/api/terminals', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT device_id, location, status, last_heartbeat FROM terminal ORDER BY id'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 3. 告警列表
app.get('/api/alerts', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT level, terminal_id, time, content, status FROM alerts ORDER BY time DESC'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 4. 使用统计
app.get('/api/usage-stats', authMiddleware, async (req, res) => {
    try {
        const [today] = await db.pool.query('SELECT SUM(passenger_count) as total FROM passenger_flow WHERE DATE(start_time) = CURDATE()');
        const [week] = await db.pool.query('SELECT SUM(passenger_count) as total FROM passenger_flow WHERE YEARWEEK(start_time) = YEARWEEK(CURDATE())');
        const [month] = await db.pool.query('SELECT SUM(passenger_count) as total FROM passenger_flow WHERE MONTH(start_time) = MONTH(CURDATE()) AND YEAR(start_time) = YEAR(CURDATE())');
        res.json({ success: true, data: { today: today[0].total || 0, week: week[0].total || 0, month: month[0].total || 0 } });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 5. 高频问题统计
app.get('/api/faq-stats', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT command_text as question, COUNT(*) as count FROM voice_log WHERE create_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY command_text ORDER BY count DESC LIMIT 10'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 6. 呼叫记录
app.get('/api/call-records', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT terminal_id, call_time, call_type, status, admin_id, handle_time, handle_result FROM call_record ORDER BY call_time DESC'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 7. 攻击防护状态
app.get('/api/attack-status', authMiddleware, async (req, res) => {
    try {
        const [attackRecent] = await db.pool.query('SELECT COUNT(*) as count FROM attack_log WHERE create_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)');
        res.json({ success: true, data: { inbound_traffic: '150Mbps', outbound_traffic: '80Mbps', ddos_status: attackRecent[0].count > 0 ? '检测到攻击' : '正常', cpu_usage: 45, memory_usage: 62 } });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 8. IP 白名单
app.get('/api/whitelist', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT id, ip_address, description, created_at FROM ip_whitelist ORDER BY created_at DESC'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});
app.post('/api/whitelist', authMiddleware, async (req, res) => {
    const { ip_address, description } = req.body;
    if (!ip_address) return res.status(400).json({ error: 'IP地址不能为空' });
    try { const [result] = await db.pool.execute('INSERT INTO ip_whitelist (ip_address, description) VALUES (?, ?)', [ip_address, description || '']); res.json({ success: true, id: result.insertId }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});
app.delete('/api/whitelist/:id', authMiddleware, async (req, res) => {
    try { await db.pool.execute('DELETE FROM ip_whitelist WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 9. IP 黑名单
app.get('/api/blacklist', authMiddleware, async (req, res) => {
    try { const [rows] = await db.pool.query('SELECT id, ip_address, reason, created_at FROM ip_blacklist ORDER BY created_at DESC'); res.json({ success: true, data: rows }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});
app.post('/api/blacklist', authMiddleware, async (req, res) => {
    const { ip_address, reason } = req.body;
    if (!ip_address) return res.status(400).json({ error: 'IP地址不能为空' });
    try { const [result] = await db.pool.execute('INSERT INTO ip_blacklist (ip_address, reason) VALUES (?, ?)', [ip_address, reason || '']); res.json({ success: true, id: result.insertId }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});
app.delete('/api/blacklist/:id', authMiddleware, async (req, res) => {
    try { await db.pool.execute('DELETE FROM ip_blacklist WHERE id = ?', [req.params.id]); res.json({ success: true }); } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 10. 防御日志
app.get('/api/defense-logs', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 10, type, startDate, endDate } = req.query;
        const offset = (page - 1) * limit;
        let sql = 'SELECT id, attack_type, src_ip, dst_ip, create_time FROM attack_log WHERE 1=1';
        const params = [];
        if (type) { sql += ' AND attack_type = ?'; params.push(type); }
        if (startDate && endDate) { sql += ' AND create_time BETWEEN ? AND ?'; params.push(startDate, endDate); }
        sql += ' ORDER BY create_time DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        const [rows] = await db.pool.execute(sql, params);
        let countSql = 'SELECT COUNT(*) as total FROM attack_log WHERE 1=1';
        const countParams = [];
        if (type) { countSql += ' AND attack_type = ?'; countParams.push(type); }
        if (startDate && endDate) { countSql += ' AND create_time BETWEEN ? AND ?'; countParams.push(startDate, endDate); }
        const [countResult] = await db.pool.execute(countSql, countParams);
        res.json({ success: true, data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) } });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 11. 导出防御日志
app.get('/api/defense-logs/export', authMiddleware, async (req, res) => {
    try {
        const { type, startDate, endDate, format = 'csv' } = req.query;
        let sql = 'SELECT id, attack_type, src_ip, dst_ip, create_time FROM attack_log WHERE 1=1';
        const params = [];
        if (type) { sql += ' AND attack_type = ?'; params.push(type); }
        if (startDate && endDate) { sql += ' AND create_time BETWEEN ? AND ?'; params.push(startDate, endDate); }
        sql += ' ORDER BY create_time DESC';
        const [rows] = await db.pool.execute(sql, params);
        if (format === 'csv') {
            const csv = ['ID,攻击类型,来源IP,目标IP,时间', ...rows.map(r => `${r.id},${r.attack_type},${r.src_ip},${r.dst_ip},${r.create_time}`)].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=defense-logs.csv');
            res.send(csv);
        } else {
            res.json({ success: true, data: rows });
        }
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 12. 审计日志
app.get('/api/audit-logs', authMiddleware, async (req, res) => {
    try {
        const { page = 1, limit = 10, action, startDate, endDate, userId } = req.query;
        const offset = (page - 1) * limit;
        let sql = 'SELECT id, action, user_id, details, ip_address, created_at FROM audit_logs WHERE 1=1';
        const params = [];
        if (action) { sql += ' AND action = ?'; params.push(action); }
        if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
        if (startDate && endDate) { sql += ' AND created_at BETWEEN ? AND ?'; params.push(startDate, endDate); }
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        const [rows] = await db.pool.execute(sql, params);
        let countSql = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1';
        const countParams = [];
        if (action) { countSql += ' AND action = ?'; countParams.push(action); }
        if (userId) { countSql += ' AND user_id = ?'; countParams.push(userId); }
        if (startDate && endDate) { countSql += ' AND created_at BETWEEN ? AND ?'; countParams.push(startDate, endDate); }
        const [countResult] = await db.pool.execute(countSql, countParams);
        res.json({ success: true, data: rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) } });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 13. 导出审计日志
app.get('/api/audit-logs/export', authMiddleware, async (req, res) => {
    try {
        const { action, startDate, endDate, userId, format = 'csv' } = req.query;
        let sql = 'SELECT id, action, user_id, details, ip_address, created_at FROM audit_logs WHERE 1=1';
        const params = [];
        if (action) { sql += ' AND action = ?'; params.push(action); }
        if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
        if (startDate && endDate) { sql += ' AND created_at BETWEEN ? AND ?'; params.push(startDate, endDate); }
        sql += ' ORDER BY created_at DESC';
        const [rows] = await db.pool.execute(sql, params);
        if (format === 'csv') {
            const csv = ['ID,操作类型,用户ID,详情,IP地址,时间', ...rows.map(r => `${r.id},${r.action},${r.user_id},${JSON.stringify(r.details)},${r.ip_address},${r.created_at}`)].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
            res.send(csv);
        } else {
            res.json({ success: true, data: rows });
        }
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器内部错误' }); }
});

// 14. 审计日志查询
app.get('/api/audit/logs', authMiddleware, async (req, res) => {
  try {
    const { action, startDate, endDate, userId, limit } = req.query;
    let sql = 'SELECT id, action, user_id, details, ip_address, created_at FROM audit_logs WHERE 1=1';
    const params = [];
    if (action) { sql += ' AND action = ?'; params.push(action); }
    if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
    if (startDate && endDate) { sql += ' AND created_at BETWEEN ? AND ?'; params.push(startDate, endDate); }
    else if (startDate) { sql += ' AND created_at >= ?'; params.push(startDate); }
    else if (endDate) { sql += ' AND created_at <= ?'; params.push(endDate); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 100);
    const [rows] = await db.pool.execute(sql, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// 15. 审计报告导出
app.get('/api/audit/report', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, format } = req.query;
    let sql = 'SELECT action, COUNT(*) as count, user_id, DATE(created_at) as date FROM audit_logs WHERE 1=1';
    const params = [];
    if (startDate && endDate) { sql += ' AND created_at BETWEEN ? AND ?'; params.push(startDate, endDate); }
    sql += ' GROUP BY action, user_id, DATE(created_at) ORDER BY date DESC, count DESC';
    const [rows] = await db.pool.execute(sql, params);
    if (format === 'csv') {
      const csv = ['Action,Count,User ID,Date', ...rows.map(r => `${r.action},${r.count},${r.user_id},${r.date}`)].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-report.csv');
      res.send(csv);
    } else {
      res.json({ success: true, data: rows });
    }
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ============================================================
// 🔒 智能体系统路由注册 (Agent System)
// ============================================================
try {
    const { router: agentRouter, initAgent } = require('./routes/agent');
    app.use('/api/agent', agentRouter);
} catch (e) {
    console.log('⚠️  智能体路由加载失败（模块未找到）:', e.message);
}

// ============================================================
// 启动服务器
// ============================================================
app.listen(port, async () => {
    console.log(`✅ API server running at http://localhost:${port}`);
    try {
        await db.connect();
        console.log(`✅ Database connected (${db.mode})`);
        // 初始化智能体系统
        try {
            const { initAgent } = require('./routes/agent');
            initAgent(db.pool);
        } catch (e) {
            console.log('⚠️  智能体初始化失败:', e.message);
        }
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
    }
});

module.exports = app;
