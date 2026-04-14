const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

// ========== 中间件引入 ==========
const unifyResponse = require('../middleware/unifyResponse');
const { ipWhitelistMiddleware } = require('../middleware/ipwhitelist');
const bypassForCriticalMiddleware = require('../middleware/bypassForCritical');

const app = express();
const port = 3000;

// ========== 数据库连接池 ==========
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'your_password',
    database: 'airport',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ========== 王晓恩：布隆过滤器 IP 黑名单 ==========
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
const bannedIPs = [
    '192.168.1.100',
    '10.0.0.5',
    '127.0.0.2',
    '::1',
    '::ffff:127.0.0.1'
];
bannedIPs.forEach(ip => ipBlacklistFilter.insert(ip));

// IP 黑名单拦截中间件
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

// ========== 全局中间件 ==========
app.use(cors());
app.use(express.json());
app.use(express.static('/home/ubuntu/public'));

// 自定义中间件
app.use(unifyResponse);
app.use(ipWhitelistMiddleware);
app.use(bypassForCriticalMiddleware);

// ========== 测试路由 ==========
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true, 
        isWhitelisted: req.isWhitelisted,
        isCritical: req.criticalBypass 
    });
});

app.post('/api/emergency-help', (req, res) => {
    res.json({ 
        success: true, 
        bypassActive: req.criticalBypass 
    });
});

app.get('/api/rate-limit-test', (req, res) => {
    res.json({ message: 'Rate limit test endpoint' });
});

// ========== 攻击日志接口 ==========
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

// ========== 小时统计接口 ==========
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

// ========== 后台管理接口 ==========

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

// ========== 启动服务器 ==========
app.listen(port, () => {
    console.log(`✅ API server running at http://localhost:${port}`);
    pool.getConnection()
        .then(conn => { console.log('✅ Database connected'); conn.release(); })
        .catch(err => console.error('❌ Database connection failed:', err.message));
});