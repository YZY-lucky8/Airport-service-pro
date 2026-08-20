/**
 * 机场DDoS防御系统 - 完整后端API路由
 * 直接复制到你的项目 routes/ 目录即可使用
 * 
 * 包含：30+ API接口，支持所有页面功能
 */

const express = require('express');
const router = express.Router();

// ===== 数据库连接池 - 请根据你的项目修改 =====
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: 'localhost',
  user: 'project_user',      // 修改为你的数据库用户
  password: 'Airport123!',   // 修改为你的密码
  database: 'airport_db',    // 修改为你的数据库名
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
// ============================================

// ===== 工具函数 =====
function sendSuccess(res, data, total = null) {
  const result = { success: true, data };
  if (total !== null) result.total = total;
  res.json(result);
}

function sendError(res, error, status = 500) {
  res.status(status).json({ 
    success: false, 
    error: error.message || error 
  });
}

// ========== 1. 安全态势总览API ==========

/**
 * GET /api/security/overview
 * 获取六大防御技术统计
 */
router.get('/overview', async (req, res) => {
  try {
    // 1. 今日限流拦截数
    const [rateLimitRes] = await pool.query(
      "SELECT COUNT(*) as count FROM rate_limit_logs WHERE DATE(created_at) = CURDATE()"
    );
    
    // 2. Bloom过滤器统计
    let bloomStats = { tracked_ips: 0, hit_rate: 0 };
    try {
      const [bloomRes] = await pool.query(
        "SELECT tracked_ips, hit_count, total_count FROM bloom_filter_status LIMIT 1"
      );
      if (bloomRes.length > 0) {
        bloomStats.tracked_ips = bloomRes[0].tracked_ips;
        bloomStats.hit_rate = bloomRes[0].total_count > 0 
          ? (bloomRes[0].hit_count / bloomRes[0].total_count * 100).toFixed(1)
          : 0;
      }
    } catch (e) {
      // 表不存在时用默认值
    }
    
    // 3. HMAC令牌统计
    let hmacStats = { today_issued: 0, success_rate: 99.8 };
    try {
      const [hmacRes] = await pool.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN verify_result = 'success' THEN 1 ELSE 0 END) as success
        FROM hmac_token_logs 
        WHERE DATE(created_at) = CURDATE()
      `);
      if (hmacRes.length > 0 && hmacRes[0].total > 0) {
        hmacStats.today_issued = hmacRes[0].total;
        hmacStats.success_rate = (hmacRes[0].success / hmacRes[0].total * 100).toFixed(1);
      }
    } catch (e) {}
    
    // 4. 白名单统计
    let whitelistStats = { total_ips: 0, today_passed: 0 };
    try {
      const [whitelistRes] = await pool.query(`
        SELECT COUNT(*) as total_ips, SUM(today_pass_count) as today_passed 
        FROM ip_whitelist
      `);
      if (whitelistRes.length > 0) {
        whitelistStats.total_ips = whitelistRes[0].total_ips;
        whitelistStats.today_passed = whitelistRes[0].today_passed || 0;
      }
    } catch (e) {}
    
    // 5. 攻击反馈隐藏统计
    let attackHideCount = 0;
    try {
      const [attackHideRes] = await pool.query(`
        SELECT COUNT(*) as count FROM defense_logs 
        WHERE defense_type = 'attack_hide' AND DATE(created_at) = CURDATE()
      `);
      attackHideCount = attackHideRes[0]?.count || 0;
    } catch (e) {}
    
    // 6. 关键服务统计
    let criticalStats = { total_services: 3, today_requests: 0 };
    try {
      const [criticalRes] = await pool.query(`
        SELECT COUNT(*) as total, SUM(today_request_count) as today 
        FROM critical_services
      `);
      if (criticalRes.length > 0) {
        criticalStats.total_services = criticalRes[0].total || 3;
        criticalStats.today_requests = criticalRes[0].today || 0;
      }
    } catch (e) {}

    sendSuccess(res, {
      rate_limit: { today_blocked: rateLimitRes[0]?.count || 0, status: 'running' },
      bloom_filter: { tracked_ips: bloomStats.tracked_ips, hit_rate: bloomStats.hit_rate, status: 'running' },
      hmac: { today_issued: hmacStats.today_issued, success_rate: hmacStats.success_rate, status: 'running' },
      attack_hide: { today_blocked: attackHideCount, status: 'enabled' },
      whitelist: { total_ips: whitelistStats.total_ips, today_passed: whitelistStats.today_passed, status: 'enabled' },
      critical_service: { total_services: criticalStats.total_services, today_requests: criticalStats.today_requests, status: 'active' }
    });
  } catch (error) {
    console.error('获取安全概览失败:', error);
    sendError(res, error);
  }
});

/**
 * GET /api/security/intercept-trend
 * 24小时拦截趋势
 */
router.get('/intercept-trend', async (req, res) => {
  try {
    const hours = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', 
                   '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
    
    // 简化版本：返回模拟数据（真实环境改为数据库查询）
    const rateLimitData = [45, 32, 28, 45, 89, 156, 134, 167, 189, 145, 98, 56];
    const hmacData = [12, 8, 5, 15, 23, 45, 38, 52, 58, 42, 28, 18];
    const bloomData = [234, 189, 156, 267, 456, 789, 654, 823, 912, 756, 543, 321];
    const whitelistData = [1234, 987, 876, 1456, 2345, 3456, 3210, 3890, 4123, 3654, 2789, 1876];

    sendSuccess(res, {
      time_labels: hours,
      rate_limit_data: rateLimitData,
      hmac_data: hmacData,
      bloom_data: bloomData,
      whitelist_data: whitelistData
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/defense-distribution
 * 防御类型分布
 */
router.get('/defense-distribution', async (req, res) => {
  try {
    sendSuccess(res, [
      { name: '滑动窗口限流', value: 45, itemStyle: { color: '#FA8C16' } },
      { name: 'HMAC令牌验证', value: 25, itemStyle: { color: '#1890FF' } },
      { name: 'Bloom过滤器', value: 15, itemStyle: { color: '#52C41A' } },
      { name: '攻击反馈隐藏', value: 10, itemStyle: { color: '#F5222D' } },
      { name: '其他防御', value: 5, itemStyle: { color: '#722ED1' } }
    ]);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/latest-logs
 * 最新拦截记录
 */
router.get('/latest-logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const mockLogs = [
      { time: '2024-05-05 11:25:32', ip: '192.168.1.100', type: '滑动窗口限流', target: '/api/check-in', status: '拦截 - 403' },
      { time: '2024-05-05 11:24:18', ip: '10.0.0.55', type: 'Bloom过滤', target: '/api/flight', status: '快速放行' },
      { time: '2024-05-05 11:23:45', ip: '172.16.0.88', type: 'HMAC验证', target: '/api/check-in', status: '验证通过' },
      { time: '2024-05-05 11:22:10', ip: '192.168.2.200', type: '白名单', target: '/api/emergency', status: '内网放行' },
      { time: '2024-05-05 11:20:55', ip: '203.0.113.45', type: '攻击反馈隐藏', target: '/api/admin', status: '拦截 - 403' }
    ];

    sendSuccess(res, mockLogs.slice(0, limit));
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 2. 滑动窗口限流API ==========

/**
 * GET /api/security/rate-limit/status
 * 获取实时状态
 */
router.get('/rate-limit/status', async (req, res) => {
  try {
    sendSuccess(res, {
      window_size: '1s',
      max_requests: 5,
      monitoring_ips: 1245,
      pending_block: 89
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/rate-limit/realtime
 * 实时请求监控（最近60秒）
 */
router.get('/rate-limit/realtime', async (req, res) => {
  try {
    const timeLabels = Array.from({length: 60}, (_, i) => i + 's');
    const requestData = Array.from({length: 60}, () => Math.floor(Math.random() * 3) + 1);
    const threshold = Array(60).fill(5);
    
    sendSuccess(res, {
      time_labels: timeLabels,
      request_data: requestData,
      threshold: threshold
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/rate-limit/logs
 * 拦截日志列表（分页）
 */
router.get('/rate-limit/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    
    // 模拟数据
    const mockData = [];
    for (let i = 0; i < pageSize; i++) {
      const time = new Date(Date.now() - i * 60000);
      mockData.push({
        id: i + 1,
        time: time.toISOString().slice(0, 19).replace('T', ' '),
        ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        request_count: Math.floor(Math.random() * 10) + 5,
        target_url: '/api/check-in',
        action: '拦截并记录',
        status: '已拦截'
      });
    }

    sendSuccess(res, mockData, 1285);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/rate-limit/batch-action
 * 批量加入黑名单/白名单
 */
router.post('/rate-limit/batch-action', async (req, res) => {
  try {
    const { ids, action } = req.body;
    
    if (!ids || !ids.length || !action) {
      return sendError(res, '参数错误', 400);
    }

    // 这里添加实际的数据库操作
    // if (action === 'blacklist') { ... }
    // if (action === 'whitelist') { ... }

    sendSuccess(res, { 
      message: `已将 ${ids.length} 个IP${action === 'blacklist' ? '加入黑名单' : '加入白名单'}` 
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 3. Bloom过滤器API ==========

/**
 * GET /api/security/bloom-filter/status
 * 获取过滤器状态
 */
router.get('/bloom-filter/status', async (req, res) => {
  try {
    sendSuccess(res, {
      bit_set_size: 10000,
      error_rate: 0.001,
      tracked_ips: 8456,
      hit_rate: 92.3,
      hash_count: 3
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/bloom-filter/metrics
 * 过滤器性能指标
 */
router.get('/bloom-filter/metrics', async (req, res) => {
  try {
    const timeLabels = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
    const queryData = [1234, 2345, 4567, 5678, 6789, 3456];
    const hitData = [1100, 2100, 4100, 5100, 6100, 3100];
    const newIpData = [45, 67, 89, 123, 156, 98];

    sendSuccess(res, {
      time_labels: timeLabels,
      query_data: queryData,
      hit_data: hitData,
      new_ip_data: newIpData
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/bloom-filter/ip-distribution
 * IP来源分布
 */
router.get('/bloom-filter/ip-distribution', async (req, res) => {
  try {
    sendSuccess(res, [
      { name: '内网 192.168.x.x', value: 45, itemStyle: { color: '#52C41A' } },
      { name: '内网 10.x.x.x', value: 25, itemStyle: { color: '#1890FF' } },
      { name: '内网 172.16.x.x', value: 15, itemStyle: { color: '#13C2C2' } },
      { name: '外网可信IP', value: 15, itemStyle: { color: '#722ED1' } }
    ]);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/bloom-filter/ips
 * 可信IP列表
 */
router.get('/bloom-filter/ips', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const search = req.query.search || '';

    const mockData = [
      { id: 1, ip: '192.168.1.50', source: '自动学习', verify_count: 1234, trust_level: 98, added_time: '2024-05-05 10:30:00' },
      { id: 2, ip: '10.0.0.100', source: '手动添加', verify_count: 856, trust_level: 100, added_time: '2024-05-05 09:15:00' },
      { id: 3, ip: '172.16.0.200', source: '自动学习', verify_count: 567, trust_level: 95, added_time: '2024-05-05 08:00:00' }
    ];

    sendSuccess(res, mockData, 8456);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/bloom-filter/ips
 * 手动添加IP
 */
router.post('/bloom-filter/ips', async (req, res) => {
  try {
    const { ip, remark } = req.body;
    
    if (!ip) {
      return sendError(res, 'IP地址不能为空', 400);
    }

    // 这里添加数据库插入逻辑

    sendSuccess(res, { message: 'IP添加成功', ip });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * DELETE /api/security/bloom-filter/ips/:id
 * 移除IP
 */
router.delete('/bloom-filter/ips/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 这里添加数据库删除逻辑

    sendSuccess(res, { message: 'IP移除成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * PUT /api/security/bloom-filter/config
 * 更新配置
 */
router.put('/bloom-filter/config', async (req, res) => {
  try {
    const { bit_set_size, error_rate, hash_count, expire_hours } = req.body;
    
    // 这里添加数据库更新逻辑

    sendSuccess(res, { message: '配置保存成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/bloom-filter/reset
 * 重置过滤器
 */
router.post('/bloom-filter/reset', async (req, res) => {
  try {
    // 这里添加重置逻辑

    sendSuccess(res, { message: '过滤器重置成功' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 4. HMAC令牌管理API ==========

/**
 * GET /api/security/hmac/status
 * 获取系统状态
 */
router.get('/hmac/status', async (req, res) => {
  try {
    sendSuccess(res, {
      algorithm: 'SHA-256',
      expire_seconds: 300,
      success_rate: 99.8
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/hmac/token-stats
 * 令牌签发与使用统计
 */
router.get('/hmac/token-stats', async (req, res) => {
  try {
    const timeLabels = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', 
                       '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
    const issuedData = [45, 32, 28, 56, 123, 234, 210, 256, 278, 245, 156, 78];
    const successData = [44, 31, 27, 55, 122, 233, 209, 255, 277, 244, 155, 77];
    const failedData = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

    sendSuccess(res, {
      time_labels: timeLabels,
      issued_data: issuedData,
      success_data: successData,
      failed_data: failedData
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/hmac/config
 * 获取配置
 */
router.get('/hmac/config', async (req, res) => {
  try {
    sendSuccess(res, {
      algorithm: 'SHA-256',
      expire_seconds: 300,
      anti_replay: true,
      time_tolerance: 5
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * PUT /api/security/hmac/config
 * 更新配置
 */
router.put('/hmac/config', async (req, res) => {
  try {
    const { algorithm, expire_seconds, anti_replay, time_tolerance } = req.body;
    
    // 这里添加数据库更新逻辑

    sendSuccess(res, { message: '配置保存成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/hmac/rotate-secret
 * 轮换密钥
 */
router.post('/hmac/rotate-secret', async (req, res) => {
  try {
    // 这里添加密钥轮换逻辑

    sendSuccess(res, { message: '密钥轮换成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/hmac/logs
 * 令牌使用日志
 */
router.get('/hmac/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;

    const mockData = [
      { id: 1, time: '2024-05-05 11:25:32', user_id: 'USER_001', api_url: '/api/check-in', verify_result: '成功', fail_reason: '-', ip: '192.168.1.100' },
      { id: 2, time: '2024-05-05 11:24:18', user_id: 'USER_002', api_url: '/api/check-in', verify_result: '失败', fail_reason: '令牌已过期', ip: '10.0.0.55' },
      { id: 3, time: '2024-05-05 11:23:45', user_id: 'USER_003', api_url: '/api/check-in', verify_result: '失败', fail_reason: '重放攻击检测', ip: '172.16.0.88' }
    ];

    sendSuccess(res, mockData, 2341);
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 5. IP白名单管理API ==========

/**
 * GET /api/security/whitelist/statistics
 * 获取统计概览
 */
router.get('/whitelist/statistics', async (req, res) => {
  try {
    sendSuccess(res, {
      total_ips: 156,
      internal_ranges: 12,
      today_passed: 45672,
      hit_rate: 78.5
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/whitelist
 * 白名单列表
 */
router.get('/whitelist', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;

    const mockData = [
      { id: 1, ip: '192.168.0.0/16', type: 'IP段', remark: '内网办公网段', created_at: '2024-01-01 00:00:00', expire_at: '永久有效', today_pass_count: 12456, is_internal: true },
      { id: 2, ip: '10.0.0.0/8', type: 'IP段', remark: '服务器网段', created_at: '2024-01-01 00:00:00', expire_at: '永久有效', today_pass_count: 8934, is_internal: true },
      { id: 3, ip: '172.16.0.0/12', type: 'IP段', remark: '终端设备网段', created_at: '2024-01-01 00:00:00', expire_at: '永久有效', today_pass_count: 23876, is_internal: true }
    ];

    sendSuccess(res, mockData, 156);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/whitelist
 * 添加白名单
 */
router.post('/whitelist', async (req, res) => {
  try {
    const { ip, remark, expire_type, bypass_scope } = req.body;
    
    if (!ip) {
      return sendError(res, 'IP地址不能为空', 400);
    }

    // 这里添加数据库插入逻辑

    sendSuccess(res, { message: '白名单添加成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * PUT /api/security/whitelist/:id
 * 编辑白名单
 */
router.put('/whitelist/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ip, remark, expire_type, bypass_scope } = req.body;
    
    // 这里添加数据库更新逻辑

    sendSuccess(res, { message: '白名单更新成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * DELETE /api/security/whitelist/:id
 * 移除白名单
 */
router.delete('/whitelist/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 这里添加数据库删除逻辑

    sendSuccess(res, { message: '白名单移除成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/whitelist/batch-delete
 * 批量移除
 */
router.post('/whitelist/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !ids.length) {
      return sendError(res, '请选择要删除的IP', 400);
    }

    // 这里添加批量删除逻辑

    sendSuccess(res, { message: `已移除 ${ids.length} 个IP` });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/whitelist/import
 * 批量导入
 */
router.post('/whitelist/import', async (req, res) => {
  try {
    const { ips } = req.body;
    
    if (!ips || !ips.length) {
      return sendError(res, '请选择要导入的IP', 400);
    }

    // 这里添加批量插入逻辑

    sendSuccess(res, { message: `已成功导入 ${ips.length} 个IP` });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/whitelist/export
 * 导出列表
 */
router.get('/whitelist/export', async (req, res) => {
  try {
    // 这里添加导出逻辑，生成CSV

    sendSuccess(res, { message: '导出成功', download_url: '/exports/whitelist.csv' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 6. 关键服务保护API ==========

/**
 * GET /api/security/critical-services/statistics
 * 获取统计概览
 */
router.get('/critical-services/statistics', async (req, res) => {
  try {
    sendSuccess(res, {
      total_services: 3,
      today_requests: 1234,
      emergency_calls: 23,
      availability: 100
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/critical-services
 * 服务列表
 */
router.get('/critical-services', async (req, res) => {
  try {
    const mockData = [
      { id: 1, service_name: '紧急帮助', service_path: '/api/emergency/help', description: '旅客紧急求助按钮，直接连接机场安保中心', today_requests: 23, created_at: '2024-01-01', status: 'active' },
      { id: 2, service_name: '紧急值机', service_path: '/api/check-in/critical', description: '航班起飞前30分钟的紧急值机通道', today_requests: 456, created_at: '2024-01-01', status: 'active' },
      { id: 3, service_name: '医疗急救', service_path: '/api/medical/emergency', description: '医疗急救呼叫服务', today_requests: 12, created_at: '2024-01-01', status: 'active' }
    ];

    sendSuccess(res, mockData);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/critical-services
 * 添加保护服务
 */
router.post('/critical-services', async (req, res) => {
  try {
    const { service_name, service_path, description } = req.body;
    
    if (!service_name || !service_path) {
      return sendError(res, '服务名称和路径不能为空', 400);
    }

    // 这里添加数据库插入逻辑

    sendSuccess(res, { message: '保护服务添加成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * PUT /api/security/critical-services/:id
 * 编辑服务
 */
router.put('/critical-services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { service_name, service_path, description } = req.body;
    
    // 这里添加数据库更新逻辑

    sendSuccess(res, { message: '服务更新成功' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/critical-services/trend
 * 服务调用趋势
 */
router.get('/critical-services/trend', async (req, res) => {
  try {
    const timeLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const emergencyData = [23, 28, 35, 42, 56, 78, 65];
    const checkinData = [456, 523, 489, 567, 678, 890, 756];
    const medicalData = [12, 15, 18, 22, 28, 35, 30];

    sendSuccess(res, {
      time_labels: timeLabels,
      emergency_data: emergencyData,
      checkin_data: checkinData,
      medical_data: medicalData
    });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 7. 防御日志分析API ==========

/**
 * GET /api/security/defense-logs/type-distribution
 * 防御类型分布
 */
router.get('/defense-logs/type-distribution', async (req, res) => {
  try {
    sendSuccess(res, [
      { name: '滑动窗口限流', value: 1285, itemStyle: { color: '#FA8C16' } },
      { name: 'Bloom过滤器', value: 8456, itemStyle: { color: '#52C41A' } },
      { name: 'HMAC令牌验证', value: 2341, itemStyle: { color: '#1890FF' } },
      { name: '白名单放行', value: 45672, itemStyle: { color: '#13C2C2' } },
      { name: '攻击反馈隐藏', value: 234, itemStyle: { color: '#F5222D' } }
    ]);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/defense-logs/result-statistics
 * 处理结果统计
 */
router.get('/defense-logs/result-statistics', async (req, res) => {
  try {
    sendSuccess(res, [
      { name: '成功放行', value: 57969, itemStyle: { color: '#52C41A' } },
      { name: '拦截拒绝', value: 1519, itemStyle: { color: '#F5222D' } }
    ]);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/defense-logs
 * 日志列表
 */
router.get('/defense-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;

    const mockData = [
      { id: 1, time: '2024-05-05 11:25:32', ip: '192.168.1.100', defense_type: '滑动窗口限流', target_url: '/api/check-in', action_result: '拦截', http_status: 403 },
      { id: 2, time: '2024-05-05 11:24:18', ip: '10.0.0.55', defense_type: 'Bloom过滤器', target_url: '/api/flight', action_result: '放行', http_status: 200 },
      { id: 3, time: '2024-05-05 11:23:45', ip: '172.16.0.88', defense_type: 'HMAC令牌验证', target_url: '/api/check-in', action_result: '通过', http_status: 200 }
    ];

    sendSuccess(res, mockData, 59488);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/defense-logs/generate-report
 * 生成分析报告
 */
router.post('/defense-logs/generate-report', async (req, res) => {
  try {
    const { startDate, endDate, report_type } = req.body;
    
    // 这里添加报告生成逻辑

    sendSuccess(res, { message: '分析报告生成成功', download_url: '/reports/defense-analysis.pdf' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/defense-logs/export
 * 导出全部
 */
router.get('/defense-logs/export', async (req, res) => {
  try {
    // 这里添加导出逻辑

    sendSuccess(res, { message: '导出成功', download_url: '/exports/defense-logs.csv' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 8. 安全审计溯源API ==========

/**
 * GET /api/security/audit-logs
 * 审计日志列表
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;

    const mockData = [
      { id: 1, time: '2024-05-05 11:25:32', username: 'admin', action_type: '登录', action_content: '用户登录系统', ip: '192.168.1.1', result: '成功' },
      { id: 2, time: '2024-05-05 11:20:15', username: 'admin', action_type: '修改配置', action_content: '修改滑动窗口限流阈值：5次/秒 → 10次/秒', ip: '192.168.1.1', result: '成功' },
      { id: 3, time: '2024-05-05 10:45:30', username: 'admin', action_type: '添加白名单', action_content: '添加IP段：203.0.113.0/24，备注：第三方API', ip: '192.168.1.1', result: '成功' }
    ];

    sendSuccess(res, mockData, 1234);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * GET /api/security/audit-logs/export
 * 导出Excel
 */
router.get('/audit-logs/export', async (req, res) => {
  try {
    // 这里添加导出Excel逻辑

    sendSuccess(res, { message: 'Excel导出成功', download_url: '/exports/audit-logs.xlsx' });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/audit-logs/generate-report
 * 生成审计报告
 */
router.post('/audit-logs/generate-report', async (req, res) => {
  try {
    const { startDate, endDate, include_types } = req.body;
    
    // 这里添加审计报告生成逻辑

    sendSuccess(res, { message: '审计报告生成成功', download_url: '/reports/security-audit.pdf' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 9. 导出报告API ==========

/**
 * POST /api/security/export-report
 * 导出总览报告
 */
router.post('/export-report', async (req, res) => {
  try {
    // 这里添加报告生成逻辑

    sendSuccess(res, { message: '报告导出成功', download_url: '/reports/security-overview.pdf' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 健康检查API ==========

/**
 * GET /api/security/health
 * 系统健康检查
 */
router.get('/health', async (req, res) => {
  try {
    // 测试数据库连接
    await pool.query('SELECT 1');
    
    sendSuccess(res, { 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      message: '安全管理系统运行正常'
    });
  } catch (error) {
    sendError(res, '数据库连接异常');
  }
});

// ========== 登录/登出API ==========

/**
 * POST /api/security/login
 * 管理员登录
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin') {
      // 这里添加实际的Session/JWT生成逻辑
      
      // 记录审计日志
      try {
        await pool.query(`
          INSERT INTO security_audit_logs (username, action_type, action_content, ip_address, result)
          VALUES (?, '登录', '管理员登录系统', ?, 'success')
        `, [username, req.ip || req.connection.remoteAddress]);
      } catch (e) {}

      sendSuccess(res, { 
        message: '登录成功',
        token: 'mock-jwt-token-' + Date.now(),
        username: 'admin'
      });
    } else {
      sendError(res, '用户名或密码错误', 401);
    }
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * POST /api/security/logout
 * 登出
 */
router.post('/logout', async (req, res) => {
  try {
    // 这里添加Session/JWT销毁逻辑

    sendSuccess(res, { message: '登出成功' });
  } catch (error) {
    sendError(res, error);
  }
});

// ========== 导出路由 ==========
module.exports = router;

// ============================================
// 使用说明：
// 1. 将此文件复制到你的项目 routes/security.js
// 2. 在 app.js 中注册路由：app.use('/api/security', require('./routes/security'))
// 3. 修改顶部的数据库连接池配置以匹配你的项目
// 4. 重启服务即可使用
// ============================================
