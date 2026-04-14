const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
// ==================== 王晓恩添加位置 (开始) ====================
// 引入刚刚安装的 bloom-filter 模块
const BloomFilter = require('bloom-filter');

// 初始化布隆过滤器：预计存储1000个IP，误差率0.01 (1%)
const ipBlacklistFilter = new BloomFilter(1000, 0.01);

// 模拟加载黑名单数据 (实际项目中通常从数据库读取)
const bannedIPs = ['192.168.1.100', '10.0.0.5', '127.0.0.2'];
bannedIPs.forEach(ip => {
    ipBlacklistFilter.insert(ip);
});
// ==================== 王晓恩添加位置 (结束) ====================
const app = express();
const port = 3000;
// ==================== 王晓恩添加位置 (开始) ====================
// 新增：布隆过滤器中间件，用于拦截黑名单IP
app.use((req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    // 2. 👇 在这里打印 IP，用于验证是否获取成功
    console.log(`👀 捕获到请求 IP: ${clientIp}`);
    // 检查IP是否在布隆过滤器中
    if (ipBlacklistFilter.has(clientIp)) {
        console.warn(`🚫 拦截请求：IP ${clientIp} 在黑名单中`);
        return res.status(403).json({
            success: false,
            error: 'Forbidden: Your IP is blocked.'
        });
    }

    // 如果不在黑名单，继续处理请求
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

