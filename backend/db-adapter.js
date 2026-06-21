/**
 * ============================================================
 * 数据库适配层 (Database Adapter)
 * ============================================================
 *
 * - 优先连接 MySQL（比赛/生产环境）
 * - 连接失败自动降级到 SQLite（开发环境，零依赖安装）
 * - 对外暴露统一的 pool.query / pool.execute 接口
 * - SQLite 模式下自动生成所有表结构
 * ============================================================
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let mode = 'mysql';
let pool = null;

// ── MySQL 连接 ──
async function connectMySQL() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'project_user',
      password: process.env.DB_PASSWORD || 'Airport123!',
      database: process.env.DB_NAME || 'airport_db',
      connectTimeout: 2000,
    });
    await conn.execute('SELECT 1');
    await conn.end();

    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'project_user',
      password: process.env.DB_PASSWORD || 'Airport123!',
      database: process.env.DB_NAME || 'airport_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 2000,
    });

    mode = 'mysql';
    console.log('✅ 数据库连接成功: MySQL');
    return true;
  } catch (err) {
    return false;
  }
}

// ── SQLite 回退 ──
async function connectSQLite() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', 'data', 'airport.db');

  // 确保 data 目录存在
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // 模拟 mysql2 pool 接口
  pool = {
    query(sql, params = []) {
      let stmt;
      try {
        stmt = sqlite.prepare(sql);
      } catch (e) {
        const cleaned = sql.replace(/\bANY_VALUE\s*\([^)]+\)/gi, '($1)');
        stmt = sqlite.prepare(cleaned);
      }
      return [stmt.all(...params)];
    },
    execute(sql, params = []) {
      let stmt;
      try {
        stmt = sqlite.prepare(sql);
      } catch (e) {
        const cleaned = sql.replace(/\bANY_VALUE\s*\([^)]+\)/gi, '($1)');
        stmt = sqlite.prepare(cleaned);
      }
      const info = stmt.run(...params);
      return [{ insertId: info.lastInsertRowid, affectedRows: info.changes }];
    },
  };

  // 初始化表结构
  initSQLiteSchema(sqlite);

  mode = 'sqlite';
  console.log('✅ 数据库连接成功: SQLite (回退模式) —', dbPath);
  return true;
}

// ── SQLite 初始化 ──
function initSQLiteSchema(sqlite) {
  console.log('📦 正在初始化 SQLite 表结构...');

  // 基础表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT, level TEXT, message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passenger_flow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      terminal_id INTEGER, area_code TEXT,
      passenger_count INTEGER DEFAULT 0,
      avg_dwell_time REAL DEFAULT 0,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS terminal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE, location TEXT,
      ip_address TEXT, status TEXT DEFAULT 'online',
      last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS flight (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_no TEXT UNIQUE, airline TEXT,
      departure_city TEXT, arrival_city TEXT,
      scheduled_departure DATETIME, scheduled_arrival DATETIME,
      gate TEXT, status TEXT DEFAULT '正常'
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT, terminal_id INTEGER,
      content TEXT, status TEXT DEFAULT 'unhandled',
      time DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS call_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      terminal_id INTEGER, call_type TEXT,
      status TEXT, admin_id INTEGER,
      call_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      handle_time DATETIME, handle_result TEXT
    );

    CREATE TABLE IF NOT EXISTS voice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_text TEXT, intent_type TEXT,
      recognition_result TEXT, response_text TEXT,
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attack_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attack_type TEXT, src_ip TEXT, dst_ip TEXT,
      protocol TEXT, detection_method TEXT,
      action_taken TEXT, severity TEXT,
      create_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE, user_id TEXT,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT, user_id TEXT,
      details TEXT, ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT UNIQUE, description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ip_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT UNIQUE, reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rate_limit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT, request_count INTEGER,
      window_start DATETIME, window_end DATETIME
    );

    CREATE TABLE IF NOT EXISTS bloom_filter_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT, verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bloom_filter_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capacity INTEGER, error_rate REAL,
      inserted_count INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hmac_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      algorithm TEXT DEFAULT 'sha256',
      token_ttl INTEGER DEFAULT 300,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hmac_token_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT, status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS critical_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE, description TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS defense_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_type TEXT, source TEXT,
      details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT, action_type TEXT,
      action_content TEXT, ip_address TEXT,
      result TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS security_system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE, config_value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Agent 表
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT UNIQUE,
      passenger_id INTEGER, terminal_id INTEGER,
      flight_no TEXT, state TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_interaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL,
      user_input TEXT, intent TEXT,
      emotion TEXT, entities TEXT,
      action_chosen TEXT, tool_called TEXT,
      response_text TEXT,
      confidence REAL, guardrail_flagged INTEGER DEFAULT 0,
      guardrail_reason TEXT, latency_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, content TEXT NOT NULL,
      category TEXT NOT NULL,
      keywords TEXT, priority INTEGER DEFAULT 50,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS airport_poi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, type TEXT NOT NULL,
      area TEXT NOT NULL, floor TEXT DEFAULT '1F',
      walking_time_min INTEGER DEFAULT 5,
      description TEXT, nearby_gates TEXT,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS security_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      total_requests INTEGER NOT NULL,
      attack_count INTEGER NOT NULL,
      attack_ratio REAL NOT NULL,
      current_threshold INTEGER NOT NULL,
      suggested_threshold INTEGER NOT NULL,
      reason TEXT, confidence REAL,
      action TEXT DEFAULT 'no_change'
    );

    CREATE TABLE IF NOT EXISTS security_threshold_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE, config_value TEXT,
      agent_suggested_value TEXT,
      suggestion_reason TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS passenger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_type TEXT, id_number TEXT UNIQUE,
      name TEXT, phone TEXT
    );

    CREATE TABLE IF NOT EXISTS passenger_flight (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      passenger_id INTEGER, flight_id INTEGER,
      check_in_status TEXT DEFAULT '未值机',
      seat_number TEXT, baggage_count INTEGER DEFAULT 0
    );
  `);

  // 插入初始数据
  initSQLiteData(sqlite);

  console.log('✅ SQLite 表结构初始化完成');
}

function initSQLiteData(sqlite) {
  // 航班数据
  const flights = [
    ['CA1234', '中国国航', '北京', '上海', '2026-06-21 18:00:00', '2026-06-21 20:10:00', 'D12', '正常'],
    ['MU5678', '中国东方航空', '北京', '广州', '2026-06-21 19:30:00', '2026-06-21 22:40:00', 'E05', '正常'],
    ['CZ9012', '中国南方航空', '北京', '深圳', '2026-06-21 20:15:00', '2026-06-21 23:20:00', 'D08', '正常'],
    ['3U3456', '四川航空', '北京', '成都', '2026-06-21 17:45:00', '2026-06-21 20:00:00', 'E10', '延误'],
    ['ZH7890', '深圳航空', '北京', '杭州', '2026-06-21 21:00:00', '2026-06-21 23:15:00', 'D15', '正常'],
  ];

  const insFlight = sqlite.prepare('INSERT OR IGNORE INTO flight (flight_no, airline, departure_city, arrival_city, scheduled_departure, scheduled_arrival, gate, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  flights.forEach(f => insFlight.run(...f));

  // 终端设备
  const terminals = [
    ['T3-B1-001', 'B区1号', '10.0.1.1', 'online'],
    ['T3-B2-002', 'B区2号', '10.0.1.2', 'online'],
    ['T3-C1-003', 'C区1号', '10.0.2.1', 'online'],
    ['T3-C2-004', 'C区2号', '10.0.2.2', 'fault'],
    ['T3-A1-005', 'A区1号', '10.0.3.1', 'offline'],
  ];
  const insTerminal = sqlite.prepare('INSERT OR IGNORE INTO terminal (device_id, location, ip_address, status) VALUES (?, ?, ?, ?)');
  terminals.forEach(t => insTerminal.run(...t));

  // 知识库
  const kb = [
    ['充电宝托运规定', '充电宝属于锂电池，必须随身携带，禁止托运。额定能量不超过100Wh可直接携带，100-160Wh需航司批准，超过160Wh禁止携带。每个旅客最多携带2个充电宝。', '行李规定', '充电宝,锂电池,托运,携带,额定能量,Wh,限制', 95],
    ['行李超重处理', '您的行李超重了。国内航班经济舱免费托运额度为20kg，超出部分按超重费用的1.5%计算。请前往C岛人工柜台办理超重行李托运手续。', '行李规定', '行李,超重,托运,额度,柜台,费用,支付', 90],
    ['液体携带规定', '随身携带液体每瓶不超过100ml，总量不超过1L，需放在透明密封袋中。超过100ml的液体必须托运。', '安检须知', '液体,携带,安检,透明袋,毫升,托运,喷雾', 85],
    ['打火机管制', '打火机、火柴属于易燃物品，严禁随身携带和托运。请在进入安检前丢弃或使用。', '安检须知', '打火机,火柴,易燃,携带,托运,安检,丢弃', 95],
    ['机场Wi-Fi使用', '机场提供免费Wi-Fi，名称为"Airport-Free-WiFi"，连接后输入手机号获取验证码即可使用。', '机场设施', 'Wi-Fi,网络,免费,连接,认证,手机,验证码', 60],
    ['机场餐厅推荐', 'T3航站楼内有多家餐厅：B区有老北京炸酱面（人均45元）、星巴克；C区有麦当劳、肯德基、真功夫（人均25-35元）。', '机场设施', '餐厅,美食,吃饭,餐饮,推荐,人均,价格', 75],
    ['卫生间位置', '卫生间分布：安检前B区一层/二层各有一个，安检后A区、C区均有卫生间和母婴室。', '机场设施', '卫生间,厕所,母婴室,位置,步行', 70],
    ['航班延误处理', '航班延误时，航司会提供延误证明和相应补偿。延误超过4小时提供餐食，超过8小时可提供住宿。', '航班服务', '延误,补偿,餐食,住宿,证明,起飞时间,原因', 88],
    ['特殊旅客服务', '老人、孕妇、残疾人等特殊旅客可申请轮椅服务、优先通道、专人协助。请提前告知工作人员。', '航班服务', '特殊旅客,轮椅,优先,老人,孕妇,残疾人,协助', 82],
    ['航班取消处理', '航班取消后，航司会免费为您改签最近航班或办理全额退票。请前往航司柜台或自助机上办理。', '航班服务', '取消,改签,退票,全额,天气,柜台,在线', 88],
    ['停车收费标准', 'T3停车场收费标准：首小时10元，之后每30分钟5元，24小时封顶80元。长期停车场每日30元。', '机场设施', '停车,收费,标准,ETC,扫码,长期,封顶', 65],
    ['婴儿儿童乘机', '婴儿（2岁以下）票价10%，儿童（2-12岁）票价50%。可提前预约婴儿摇篮服务。', '航司规则', '婴儿,儿童,票价,出生证明,身份证,户口本,摇篮', 78],
  ];
  const insKb = sqlite.prepare('INSERT OR IGNORE INTO knowledge_base (title, content, category, keywords, priority) VALUES (?, ?, ?, ?, ?)');
  kb.forEach(k => insKb.run(...k));

  // POI 数据
  const pois = [
    ['老北京炸酱面', 'restaurant', 'B区', '1F', 3, '人均45元，地道北京风味', 'D12,D15'],
    ['星巴克', 'restaurant', 'B区', '2F', 5, '精品咖啡轻食', 'D12'],
    ['麦当劳', 'restaurant', 'C区', '1F', 6, '人均25元', 'E05,E08'],
    ['肯德基', 'restaurant', 'C区', '1F', 6, '人均25元', 'E05'],
    ['海底捞', 'restaurant', '安检后', '1F', 10, '人均120元', 'D08'],
    ['DUTY FREE免税店', 'shop', '安检后', '2F', 7, '化妆品香水烟酒', 'D12-D15'],
    ['机场书店', 'shop', '安检后', '1F', 9, '书籍文具纪念品', 'D08,D10'],
    ['华为旗舰店', 'shop', 'C区', '2F', 8, '数码产品', 'E10'],
    ['洗手间-B区', 'toilet', 'B区', '1F', 2, '含无障碍设施', null],
    ['洗手间-安检后', 'toilet', '安检后', '1F', 4, '含母婴室', 'D08-D15'],
    ['安检口-1号通道', 'security', 'B区', '1F', 4, '国内航班安检', null],
    ['值机柜台-C岛', 'checkin', 'C区', '1F', 3, 'C01-C20柜台', null],
    ['行李转盘-3号', 'baggage', '到达层', '1F', 0, '国内航班3号转盘', null],
  ];
  const insPoi = sqlite.prepare('INSERT OR IGNORE INTO airport_poi (name, type, area, floor, walking_time_min, description, nearby_gates) VALUES (?, ?, ?, ?, ?, ?, ?)');
  pois.forEach(p => insPoi.run(...p));

  // 关键服务
  const critical = [
    ['/api/emergency-help', '紧急求助服务', 1],
    ['/api/emergency', '紧急通道', 1],
    ['/api/critical/assistance', '紧急协助', 1],
  ];
  const insCritical = sqlite.prepare('INSERT OR IGNORE INTO critical_services (path, description, enabled) VALUES (?, ?, ?)');
  critical.forEach(c => insCritical.run(...c));

  // 阈值配置
  sqlite.prepare("INSERT OR IGNORE INTO security_threshold_config (config_key, config_value) VALUES ('rate_limit_max_requests', '5')").run();

  // HMAC 配置
  sqlite.prepare("INSERT OR IGNORE INTO hmac_config (algorithm, token_ttl) VALUES ('sha256', 300)").run();

  // 告警
  const alerts = [
    ['warning', 1, '终端T3-B1-001响应延迟超过阈值', 'unhandled'],
    ['error', 4, '终端T3-C2-004故障，请检修', 'handled'],
    ['info', null, '系统运行正常，已持续运行72小时', 'handled'],
  ];
  const insAlert = sqlite.prepare('INSERT OR IGNORE INTO alerts (level, terminal_id, content, status) VALUES (?, ?, ?, ?)');
  alerts.forEach(a => insAlert.run(...a));

  // 攻击日志（模拟数据）
  const attacks = [
    ['HTTP Flood', '192.168.1.100', '10.0.0.1', 'TCP', '滑动窗口频率检测', 'blocked', 'high'],
    ['SYN Flood', '10.0.0.5', '10.0.0.1', 'TCP', 'Bloom过滤器黑名单', 'blocked', 'high'],
    ['Slowloris', '172.16.0.50', '10.0.0.1', 'HTTP', '攻击监控', 'blocked', 'medium'],
    ['DNS Amplification', '203.0.113.10', '10.0.0.1', 'UDP', '流量异常检测', 'blocked', 'critical'],
    ['HTTP Flood', '192.168.1.200', '10.0.0.1', 'TCP', '滑动窗口频率检测', 'blocked', 'medium'],
  ];
  const insAttack = sqlite.prepare('INSERT OR IGNORE INTO attack_log (attack_type, src_ip, dst_ip, protocol, detection_method, action_taken, severity) VALUES (?, ?, ?, ?, ?, ?, ?)');
  attacks.forEach(a => insAttack.run(...a));
}

// ── 统一入口 ──
async function connect() {
  // 尝试 MySQL
  const mysqlOk = await connectMySQL();
  if (mysqlOk) return pool;

  // 降级 SQLite
  await connectSQLite();
  return pool;
}

const dbAdapter = { connect, getPool: () => pool, getMode: () => mode };
Object.defineProperty(dbAdapter, "pool", { get: () => pool });
module.exports = dbAdapter;
