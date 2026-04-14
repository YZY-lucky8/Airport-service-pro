const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
// ==================== 王晓恩添加位置 (开始) ====================
// 🎯 生产级原生布隆过滤器（零依赖，机场正式环境推荐）
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

// 初始化（生产环境可支持 10000 个黑名单 IP）
const ipBlacklistFilter = new BloomFilter(10000, 0.001);

// 黑名单（本地测试用，上线可从数据库读取）
const bannedIPs = [
    '192.168.1.100',
    '10.0.0.5',
    '127.0.0.2',
    '::1',
    '::ffff:127.0.0.1'
];
bannedIPs.forEach(ip => ipBlacklistFilter.insert(ip));
// ==================== 王晓恩添加位置 (结束) ====================
const app = express();

// ========== 新增：安全配置 ==========（xin）
require('dotenv').config();
const crypto = require('crypto');

const port = 3000;
// ==================== 王晓恩添加位置 (开始) ====================
// IP 黑名单拦截中间件（全局生效，生产可用）
app.use((req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (ipBlacklistFilter.has(clientIp)) {
        console.warn(`🚫 已拦截黑名单IP：${clientIp}`);
        return res.status(403).json({
            success: false,
            error: 'Access denied: Your IP is blocked'
        });
    }
    next();
});
// ==================== 王晓恩添加位置 (结束) ====================
app.use(cors());
app.use(express.json());
app.use(express.static('/home/ubuntu/public'));

const pool = mysql.createPool({
    host: 'localhost',
    user: 'project_user',
    password: 'Airport123!',   // 请改为你的真实密码
    database: 'airport_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


// ========== 新增：安全模块 ==========(xin)
// 攻击监控中间件
// ========== 新增：攻击监控中间件 ==========
const attackMonitor = {
  failedAttempts: new Map(), // IP -> {count, timestamp}
  rateLimit: new Map(),      // IP -> {count, timestamp}
  
  // 检测暴力攻击
  detectBruteForce: function(ip, success) {
    const key = `brute_${ip}`;
    let attempts = this.failedAttempts.get(key) || { count: 0, timestamp: Date.now() };
    
    if (!success) {
      attempts.count++;
      attempts.timestamp = Date.now();
      this.failedAttempts.set(key, attempts);
      
      // 超过5次失败标记为攻击
      if (attempts.count >= 5) {
        this.logAttack(ip, 'BRUTE_FORCE');
        return true;
      }
    } else {
      // 成功后重置计数
      this.failedAttempts.delete(key);
    }
    
    // 清理过期记录（10分钟后）
    if (Date.now() - attempts.timestamp > 600000) {
      this.failedAttempts.delete(key);
    }
    
    return false;
  },
  
  // 检测速率限制
  checkRateLimit: function(ip, limit = 100, window = 60000) {
    const key = `rate_${ip}`;
    const now = Date.now();
    
    let record = this.rateLimit.get(key);
    if (!record) {
      record = { count: 1, timestamp: now };
      this.rateLimit.set(key, record);
      return false;
    }
    
    if (now - record.timestamp > window) {
      record.count = 1;
      record.timestamp = now;
      return false;
    }
    
    record.count++;
    if (record.count > limit) {
      this.logAttack(ip, 'RATE_LIMIT_EXCEEDED');
      return true;
    }
    
    return false;
  },
  
  // 记录攻击事件
  logAttack: async function(ip, type) {
    try {
      const sql = 'INSERT INTO attack_log (attack_type, src_ip, dst_ip, create_time) VALUES (?, ?, ?, NOW())';
      await pool.execute(sql, [type, ip, 'localhost']);
      
      // 同时记录到系统日志
      await logSecurityEvent('attack_detected', {
        type,
        ip,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('记录攻击事件失败:', error);
    }
  },
  
  // 清理过期记录
  cleanup: function() {
    const now = Date.now();
    const expiredKeys = [];
    
    this.failedAttempts.forEach((value, key) => {
      if (now - value.timestamp > 600000) {
        expiredKeys.push(key);
      }
    });
    
    expiredKeys.forEach(key => this.failedAttempts.delete(key));
  }
};

// 定期清理过期记录
setInterval(() => attackMonitor.cleanup(), 300000); // 每5分钟清理一次
// ========== 应用到所有请求 ==========
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  
  // 检测速率限制
  if (attackMonitor.checkRateLimit(ip)) {
    return res.status(429).json({ 
      success: false, 
      error: 'Too many requests. Please try again later.' 
    });
  }
  
  next();
});
// 令牌使用记录函数
// ========== 在 app.js 顶部添加 ==========
require('dotenv').config();
const crypto = require('crypto');

// ========== HMAC 令牌生成和验证 ==========
const generateToken = (userId = 'guest') => {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${timestamp}:${nonce}:${userId}`;
  
  const signature = crypto
    .createHmac('sha256', process.env.HMAC_SECRET)
    .update(message)
    .digest('hex');
  
  return {
    token: `${signature}:${timestamp}:${nonce}`,
    timestamp,
    nonce,
    expires_in: parseInt(process.env.TOKEN_TTL) || 300
  };
};

const verifyToken = async (token, userId = 'guest') => {
  try {
    // 1. 解析令牌
    const parts = token.split(':');
    if (parts.length !== 3) {
      await logSecurityEvent('token_verification_failed', { 
        reason: 'invalid_format', 
        token 
      });
      return { valid: false, reason: 'invalid_format' };
    }
    
    const [signature, timestampStr, nonce] = parts;
    const timestamp = parseInt(timestampStr, 10);
    
    // 2. 检查时间有效性
    const now = Math.floor(Date.now() / 1000);
    const ttl = parseInt(process.env.TOKEN_TTL) || 300;
    
    if (now - timestamp > ttl) {
      await logSecurityEvent('token_verification_failed', { 
        reason: 'expired', 
        token,
        userId 
      });
      return { valid: false, reason: 'expired' };
    }
    
    if (timestamp > now) {
      await logSecurityEvent('token_verification_failed', { 
        reason: 'future_timestamp', 
        token,
        userId 
      });
      return { valid: false, reason: 'future_timestamp' };
    }
    
    // 3. 重新计算签名
    const message = `${timestamp}:${nonce}:${userId}`;
    const expectedSig = crypto
      .createHmac('sha256', process.env.HMAC_SECRET)
      .update(message)
      .digest('hex');
    
    // 4. 恒定时间比较防止时序攻击
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature), 
      Buffer.from(expectedSig)
    );
    
    if (!isValid) {
      await logSecurityEvent('token_verification_failed', { 
        reason: 'invalid_signature', 
        token,
        userId 
      });
      return { valid: false, reason: 'invalid_signature' };
    }
    
    // 5. 防重放检查
    const isUsed = await isTokenUsed(token);
    if (isUsed) {
      await logSecurityEvent('token_verification_failed', { 
        reason: 'replayed', 
        token,
        userId 
      });
      return { valid: false, reason: 'replayed' };
    }
    
    // 6. 标记为已使用
    await recordTokenUsage(token, userId);
    
    return { 
      valid: true,
      timestamp,
      nonce 
    };
  } catch (e) {
    console.error('Token verification error:', e);
    await logSecurityEvent('token_verification_error', { 
      error: e.message,
      token,
      userId 
    });
    return { valid: false, reason: 'verification_error' };
  }
};
// 安全日志记录函数
// ========== 新增：令牌使用记录功能 ==========
const recordTokenUsage = async (token, userId = 'guest') => {
  try {
    const sql = 'INSERT INTO token_usage (token, user_id) VALUES (?, ?)';
    await pool.execute(sql, [token, userId]);
    return true;
  } catch (error) {
    console.error('记录令牌使用失败:', error);
    return false;
  }
};

const isTokenUsed = async (token) => {
  try {
    const sql = 'SELECT id FROM token_usage WHERE token = ? LIMIT 1';
    const [rows] = await pool.execute(sql, [token]);
    return rows.length > 0;
  } catch (error) {
    console.error('检查令牌使用状态失败:', error);
    return false;
  }
};

// ========== 新增：安全日志记录 ==========
const logSecurityEvent = async (eventType, details) => {
  try {
    const message = JSON.stringify(details);
    const sql = 'INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)';
    await pool.execute(sql, ['security', 'info', message]);
    return true;
  } catch (error) {
    console.error('安全日志记录失败:', error);
    return false;
  }
};
// ========== 新增：生成令牌接口 ==========
app.get('/api/token/generate', async (req, res) => {
  try {
    const userId = req.query.userId || req.cookies.userId || 'guest';
    
    // 生成令牌
    const tokenData = generateToken(userId);
    
    // 记录安全事件
    await logSecurityEvent('token_generated', {
      userId,
      timestamp: tokenData.timestamp,
      nonce: tokenData.nonce
    });
    
    res.json({
      success: true,
      token: tokenData.token,
      expires_in: tokenData.expires_in,
      timestamp: tokenData.timestamp
    });
  } catch (error) {
    console.error('Token generation error:', error);
    await logSecurityEvent('token_generation_failed', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ========== 新增：值机接口（受令牌保护） ==========
app.post('/api/check-in', async (req, res) => {
  try {
    // 1. 获取令牌（从URL参数或header）
    const token = req.query.token || req.headers['x-token'];
    if (!token) {
      await logSecurityEvent('missing_token', { 
        ip: req.ip,
        path: req.path 
      });
      
      return res.status(401).json({
        success: false,
        error: 'Missing token'
      });
    }
    
    // 2. 获取用户ID
    const userId = req.cookies.userId || 'guest';
    
    // 3. 验证令牌
    const verificationResult = await verifyToken(token, userId);
    
    if (!verificationResult.valid) {
      const reasonMap = {
        'expired': 'Token expired',
        'invalid_signature': 'Invalid signature',
        'replayed': 'Token has been used',
        'invalid_format': 'Invalid token format',
        'future_timestamp': 'Invalid timestamp',
        'verification_error': 'Verification error'
      };
      
      return res.status(401).json({
        success: false,
        error: reasonMap[verificationResult.reason] || 'Invalid token'
      });
    }
    
    // 4. 执行值机逻辑
    const { flightNumber, passengerName } = req.body;
    
    // 验证必填字段
    if (!flightNumber || !passengerName) {
      return res.status(400).json({
        success: false,
        error: 'Flight number and passenger name are required'
      });
    }
    
    // 5. 记录值机日志
    await logSecurityEvent('check_in', {
      userId,
      flightNumber,
      passengerName,
      timestamp: new Date().toISOString()
    });
    
    // 6. 返回成功响应
    res.json({
      success: true,
      message: 'Check-in completed successfully',
      data: {
        flightNumber,
        passengerName,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Check-in error:', error);
    await logSecurityEvent('check_in_failed', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});
// HMAC 令牌系统
// ========== 新增：审计日志记录 ==========
const auditLog = async (action, userId = 'guest', details = {}) => {
  try {
    const sql = `
      INSERT INTO audit_logs (action, user_id, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    
    await pool.execute(sql, [
      action,
      userId,
      JSON.stringify(details),
      ipAddress,
      userAgent
    ]);
    
    return true;
  } catch (error) {
    console.error('审计日志记录失败:', error);
    return false;
  }
};

// ========== 新增：审计日志查询接口 ==========
app.get('/api/audit/logs', async (req, res) => {
  try {
    const { action, startDate, endDate, userId, limit } = req.query;
    
    let sql = 'SELECT id, action, user_id, details, ip_address, created_at FROM audit_logs WHERE 1=1';
    const params = [];
    
    if (action) {
      sql += ' AND action = ?';
      params.push(action);
    }
    
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    
    if (startDate || endDate) {
      if (startDate && endDate) {
        sql += ' AND created_at BETWEEN ? AND ?';
        params.push(startDate, endDate);
      } else if (startDate) {
        sql += ' AND created_at >= ?';
        params.push(startDate);
      } else if (endDate) {
        sql += ' AND created_at <= ?';
        params.push(endDate);
      }
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 100);
    
    const [rows] = await pool.execute(sql, params);
    
    res.json({
      success: true,
      data: rows,
      count: rows.length
    });
  } catch (error) {
    console.error('查询审计日志失败:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ========== 新增：审计报告导出接口 ==========
app.get('/api/audit/report', async (req, res) => {
  try {
    const { startDate, endDate, format } = req.query;
    
    let sql = `
      SELECT 
        action,
        COUNT(*) as count,
        user_id,
        DATE(created_at) as date
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];
    
    if (startDate && endDate) {
      sql += ' AND created_at BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }
    
    sql += ' GROUP BY action, user_id, DATE(created_at) ORDER BY date DESC, count DESC';
    
    const [rows] = await pool.execute(sql, params);
    
    if (format === 'csv') {
      // 生成CSV
      const csv = [
        'Action,Count,User ID,Date',
        ...rows.map(row => 
          `${row.action},${row.count},${row.user_id},${row.date}`
        )
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-report.csv');
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: rows
      });
    }
  } catch (error) {
    console.error('生成审计报告失败:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});
// 输入验证中间件
// ========== 新增：输入验证中间件 ==========
const validateInput = (schema) => {
  return (req, res, next) => {
    const errors = [];
    const data = req.body;
    
    for (const field in schema) {
      const rules = schema[field];
      const value = data[field];
      
      // 必填验证
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      
      // 类型验证
      if (value !== undefined && value !== null) {
        if (rules.type === 'string' && typeof value !== 'string') {
          errors.push(`${field} must be a string`);
        }
        
        if (rules.type === 'number' && typeof value !== 'number') {
          errors.push(`${field} must be a number`);
        }
        
        // 长度验证
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
          errors.push(`${field} exceeds maximum length of ${rules.maxLength}`);
        }
        
        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }
        
        // 正则验证
        if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({ 
        success: false, 
        errors 
      });
    }
    
    next();
  };
};

// 使用示例（在值机接口中）
app.post('/api/check-in', 
  validateInput({
    flightNumber: { 
      required: true, 
      type: 'string',
      pattern: /^[A-Z0-9]{4,10}$/ 
    },
    passengerName: { 
      required: true, 
      type: 'string', 
      maxLength: 100,
      minLength: 2
    }
  }),
  async (req, res) => {
    // ... 原有逻辑 ...
  }
);
// ========== 新增：CSRF令牌管理 ==========
const csrfTokens = new Map();

const generateCSRFToken = (userId = 'guest') => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 3600000; // 1小时
  
  csrfTokens.set(token, { userId, expires });
  
  // 清理过期令牌
  setTimeout(() => {
    if (csrfTokens.has(token) && csrfTokens.get(token).expires <= Date.now()) {
      csrfTokens.delete(token);
    }
  }, 3600000);
  
  return token;
};

const verifyCSRFToken = (token, userId = 'guest') => {
  const stored = csrfTokens.get(token);
  
  if (!stored) return false;
  if (stored.expires < Date.now()) {
    csrfTokens.delete(token);
    return false;
  }
  
  return stored.userId === userId;
};

// ========== CSRF保护中间件 ==========
const csrfProtection = (req, res, next) => {
  // 跳过GET请求
  if (req.method === 'GET') {
    return next();
  }
  
  const csrfToken = req.headers['x-csrf-token'] || req.body.csrfToken;
  const userId = req.cookies.userId || 'guest';
  
  if (!csrfToken || !verifyCSRFToken(csrfToken, userId)) {
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid CSRF token' 
    });
  }
  
  next();
};

// 应用CSRF保护（可选，根据需要启用）
// app.use(csrfProtection);
// 安全HTTP头
// ========== 新增：安全HTTP头 ==========
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// ==================== 原有接口 ====================

// POST /api/log
app.post('/api/log', async (req, res) => {
    const { module, level, message } = req.body;
    if (!module || !message) {
        return res.status(400).json({ error: '缺少必要字段' });
    }
    try {
        const sql = 'INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)';
        const [result] = await pool.execute(sql, [module, level || 'info', message]);
        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('日志写入失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) as total_records,
                SUM(passenger_count) as total_passengers,
                AVG(avg_dwell_time) as avg_dwell_time_seconds
            FROM passenger_flow
        `);
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('获取统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// GET /api/logs?type=attack
app.get('/api/logs', async (req, res) => {
    const logType = req.query.type;
    if (logType !== 'attack') {
        return res.status(400).json({ error: '目前仅支持 type=attack 的查询' });
    }
    try {
        const sql = 'SELECT id, attack_type, src_ip, dst_ip, create_time FROM attack_log ORDER BY create_time DESC LIMIT 100';
        const [rows] = await pool.query(sql);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取攻击日志失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// GET /api/hourly-stats
app.get('/api/hourly-stats', async (req, res) => {
    try {
        const sql = `
            SELECT
                DATE_FORMAT(start_time, '%H:00') as hour,
                SUM(passenger_count) as \`usage\`
            FROM passenger_flow
            WHERE start_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY DATE_FORMAT(start_time, '%Y-%m-%d %H:00')
            ORDER BY start_time
        `;
        const [rows] = await pool.query(sql);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取小时统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// ==================== 新增后台管理接口 ====================

// 1. 数据监控摘要
app.get('/api/admin/dashboard', async (req, res) => {
    try {
        const [terminals] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online,
                SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline,
                SUM(CASE WHEN status = 'fault' THEN 1 ELSE 0 END) as fault
            FROM terminal
        `);
        const [todayUsage] = await pool.query(`
            SELECT SUM(passenger_count) as total FROM passenger_flow 
            WHERE DATE(start_time) = CURDATE()
        `);
        const [topQuestion] = await pool.query(`
            SELECT command_text, COUNT(*) as cnt FROM voice_log 
            WHERE create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY command_text ORDER BY cnt DESC LIMIT 1
        `);
        const [unhandled] = await pool.query(`SELECT COUNT(*) as count FROM alerts WHERE status = 'unhandled'`);

        res.json({
            success: true,
            data: {
                online_terminals: terminals[0].online,
                total_terminals: terminals[0].total,
                offline_terminals: terminals[0].offline,
                fault_terminals: terminals[0].fault,
                today_usage: todayUsage[0].total || 0,
                top_question: topQuestion[0]?.command_text || '暂无',
                top_question_count: topQuestion[0]?.cnt || 0,
                unhandled_alerts: unhandled[0].count,
                inbound_traffic: '150Mbps',
                outbound_traffic: '80Mbps',
                cpu_usage: 45,
                memory_usage: 62
            }
        });
    } catch (error) {
        console.error('获取仪表盘数据失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 2. 终端状态列表
app.get('/api/terminals', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT device_id, location, status, last_heartbeat 
            FROM terminal ORDER BY id
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取终端列表失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 3. 告警列表
app.get('/api/alerts', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT level, terminal_id, time, content, status FROM alerts ORDER BY time DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取告警列表失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 4. 使用统计（今日、本周、本月）
app.get('/api/usage-stats', async (req, res) => {
    try {
        const [today] = await pool.query(`
            SELECT SUM(passenger_count) as total FROM passenger_flow 
            WHERE DATE(start_time) = CURDATE()
        `);
        const [week] = await pool.query(`
            SELECT SUM(passenger_count) as total FROM passenger_flow 
            WHERE YEARWEEK(start_time) = YEARWEEK(CURDATE())
        `);
        const [month] = await pool.query(`
            SELECT SUM(passenger_count) as total FROM passenger_flow 
            WHERE MONTH(start_time) = MONTH(CURDATE()) AND YEAR(start_time) = YEAR(CURDATE())
        `);
        res.json({
            success: true,
            data: {
                today: today[0].total || 0,
                week: week[0].total || 0,
                month: month[0].total || 0
            }
        });
    } catch (error) {
        console.error('获取使用统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 5. 高频问题统计
app.get('/api/faq-stats', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT command_text as question, COUNT(*) as count 
            FROM voice_log 
            WHERE create_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY command_text 
            ORDER BY count DESC 
            LIMIT 10
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取高频问题失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 6. 呼叫记录
app.get('/api/call-records', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT terminal_id, call_time, call_type, status, admin_id, handle_time, handle_result
            FROM call_record ORDER BY call_time DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('获取呼叫记录失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 7. 攻击防护状态
app.get('/api/attack-status', async (req, res) => {
    try {
        const [attackRecent] = await pool.query(`
            SELECT COUNT(*) as count FROM attack_log 
            WHERE create_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        `);
        const status = attackRecent[0].count > 0 ? '检测到攻击' : '正常';
        res.json({
            success: true,
            data: {
                inbound_traffic: '150Mbps',
                outbound_traffic: '80Mbps',
                ddos_status: status,
                cpu_usage: 45,
                memory_usage: 62
            }
        });
    } catch (error) {
        console.error('获取攻击防护状态失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

app.listen(port, () => {
    console.log(`✅ API server running at http://localhost:${port}`);
    pool.getConnection()
        .then(conn => { console.log('✅ Database connected'); conn.release(); })
        .catch(err => console.error('❌ Database connection failed:', err.message));
});

