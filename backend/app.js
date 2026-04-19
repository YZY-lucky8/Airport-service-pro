// ========== 基础依赖和配置 ==========
require('dotenv').config(); // 必须在最开始加载环境变量
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path'); // 用于路径处理

const app = express();
const port = process.env.PORT || 3000;

// ========== 中间件配置 ==========
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 修复静态文件路径 - 使用相对路径，兼容 Windows 和 Linux
const publicDir = path.join(__dirname, '..', 'frontend', 'public');
app.use(express.static(publicDir));

// ========== 数据库连接池 ==========
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'project_user',
    password: process.env.DB_PASSWORD || 'Airport123!',
    database: process.env.DB_NAME || 'airport_terminal',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ========== 安全工具函数 ==========
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

const logSecurityEvent = async (eventType, details = {}) => {
  try {
    // 确保 details 是对象
    const safeDetails = typeof details === 'object' && details !== null ? details : {};
    const message = JSON.stringify({
      ...safeDetails,
      timestamp: new Date().toISOString()
    });
    const sql = 'INSERT INTO system_logs (module, level, message) VALUES (?, ?, ?)';
    await pool.execute(sql, ['security', eventType.includes('failed') ? 'error' : 'info', message]);
    return true;
  } catch (error) {
    console.error('安全日志记录失败:', error);
    return false;
  }
};

// ========== HMAC 令牌系统 ==========
const generateToken = (userId = 'guest') => {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${timestamp}:${nonce}:${userId}`;
  
  // 验证 HMAC_SECRET 是否存在
  if (!process.env.HMAC_SECRET) {
    throw new Error('HMAC_SECRET environment variable is not set');
  }
  
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
    // 安全的空值检查
    if (!token || typeof token !== 'string') {
      await logSecurityEvent('token_verification_failed', { reason: 'missing_or_invalid_token', userId });
      return { valid: false, reason: 'invalid_format' };
    }
    
    const parts = token.split(':');
    if (parts.length !== 3) {
      await logSecurityEvent('token_verification_failed', { reason: 'invalid_format', token, userId });
      return { valid: false, reason: 'invalid_format' };
    }
    
    const [signature, timestampStr, nonce] = parts;
    
    // 验证时间戳
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      await logSecurityEvent('token_verification_failed', { reason: 'invalid_timestamp', token, userId });
      return { valid: false, reason: 'invalid_format' };
    }
    
    const now = Math.floor(Date.now() / 1000);
    const ttl = parseInt(process.env.TOKEN_TTL) || 300;
    
    if (now - timestamp > ttl) {
      await logSecurityEvent('token_verification_failed', { reason: 'expired', token, userId });
      return { valid: false, reason: 'expired' };
    }
    
    if (timestamp > now + 300) { // 允许5分钟的时钟偏移
      await logSecurityEvent('token_verification_failed', { reason: 'future_timestamp', token, userId });
      return { valid: false, reason: 'future_timestamp' };
    }
    
    const message = `${timestamp}:${nonce}:${userId}`;
    const expectedSig = crypto
      .createHmac('sha256', process.env.HMAC_SECRET)
      .update(message)
      .digest('hex');
    
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature), 
      Buffer.from(expectedSig)
    );
    
    if (!isValid) {
      await logSecurityEvent('token_verification_failed', { reason: 'invalid_signature', token, userId });
      return { valid: false, reason: 'invalid_signature' };
    }
    
    const isUsed = await isTokenUsed(token);
    if (isUsed) {
      await logSecurityEvent('token_verification_failed', { reason: 'replayed', token, userId });
      return { valid: false, reason: 'replayed' };
    }
    
    await recordTokenUsage(token, userId);
    
    return { valid: true, timestamp, nonce };
  } catch (e) {
    console.error('Token verification error:', e);
    await logSecurityEvent('token_verification_error', { error: e.message, token, userId });
    return { valid: false, reason: 'verification_error' };
  }
};

// ========== 输入验证中间件 ==========
const validateInput = (schema) => {
  return (req, res, next) => {
    const errors = [];
    const data = req.body || {}; // 确保 data 不是 undefined
    
    for (const field in schema) {
      const rules = schema[field];
      const value = data[field];
      
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      
      if (value !== undefined && value !== null) {
        if (rules.type === 'string' && typeof value !== 'string') {
          errors.push(`${field} must be a string`);
        }
        
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
          errors.push(`${field} exceeds maximum length of ${rules.maxLength}`);
        }
        
        if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }
    
    next();
  };
};

// ==================== 原有接口 ====================
app.post('/api/log', async (req, res) => {
    const { module, level, message } = req.body || {};
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

app.get('/api/stats', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) as total_records,
                SUM(passenger_count) as total_passengers,
                AVG(avg_dwell_time) as avg_dwell_time_seconds
            FROM passenger_flow
        `);
        res.json({ success: true, data: rows[0] || {} });
    } catch (error) {
        console.error('获取统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

app.get('/api/logs', async (req, res) => {
    const logType = req.query?.type;
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
                online_terminals: terminals[0]?.online || 0,
                total_terminals: terminals[0]?.total || 0,
                offline_terminals: terminals[0]?.offline || 0,
                fault_terminals: terminals[0]?.fault || 0,
                today_usage: todayUsage[0]?.total || 0,
                top_question: topQuestion[0]?.command_text || '暂无',
                top_question_count: topQuestion[0]?.cnt || 0,
                unhandled_alerts: unhandled[0]?.count || 0,
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
                today: today[0]?.total || 0,
                week: week[0]?.total || 0,
                month: month[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('获取使用统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

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

app.get('/api/attack-status', async (req, res) => {
    try {
        const [attackRecent] = await pool.query(`
            SELECT COUNT(*) as count FROM attack_log 
            WHERE create_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        `);
        const status = attackRecent[0]?.count > 0 ? '检测到攻击' : '正常';
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

// ========== 新增：生成令牌接口 ==========
app.get('/api/token/generate', async (req, res) => {
  try {
    // 安全地获取 userId
    const userId = (req.query?.userId && typeof req.query.userId === 'string') ? req.query.userId : 'guest';
    const tokenData = generateToken(userId);
    
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ========== 新增：值机接口（受令牌保护） ==========
app.post('/api/check-in', 
  validateInput({
    flightNumber: { required: true, type: 'string', pattern: /^[A-Z0-9]{4,10}$/ },
    passengerName: { required: true, type: 'string', maxLength: 100 }
  }),
  async (req, res) => {
    try {
      // 安全地获取 token
      let token = null;
      if (req.query?.token && typeof req.query.token === 'string') {
        token = req.query.token;
      } else if (req.headers?.['x-token'] && typeof req.headers['x-token'] === 'string') {
        token = req.headers['x-token'];
      }
      
      if (!token) {
        await logSecurityEvent('missing_token', { ip: req.ip, path: req.path });
        return res.status(401).json({ success: false, error: 'Missing token' });
      }
      
      // 安全地获取 userId
      const userId = (req.cookies?.userId && typeof req.cookies.userId === 'string') ? req.cookies.userId : 'guest';
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
      
      const { flightNumber, passengerName } = req.body;
      
      await logSecurityEvent('check_in', {
        userId,
        flightNumber,
        passengerName,
        timestamp: new Date().toISOString()
      });
      
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
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ========== 健康检查和启动 ==========
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Airport Terminal API'
    });
});

app.listen(port, () => {
    console.log(`✅ API server running at http://localhost:${port}`);
    console.log(`📋 Health check: http://localhost:${port}/health`);
    
    // 测试数据库连接
    pool.getConnection()
        .then(conn => { 
            console.log('✅ Database connected'); 
            conn.release(); 
        })
        .catch(err => {
            console.error('❌ Database connection failed:', err.message);
            console.error('💡 Please check your database configuration and .env file');
        });
});