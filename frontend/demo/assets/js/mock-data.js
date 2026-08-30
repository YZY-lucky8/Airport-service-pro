/**
 * mock 数据层 —— D1 按契约建议造假数据
 * 字段名严格对齐 API 契约建议；D4 切换真实接口时，仅需改 api.js 中 USE_MOCK = false
 * 契约建议接口：
 *   GET /api/agent/trust/status    会话信任状态列表
 *   GET /api/agent/trust/history   信任曲线时间序列
 *   GET /api/agent/pollution/list  污染指纹列表
 */

/* 1) 会话信任状态：1 正常 + 1 降权 + 1 锁定（演示三态徽章） */
const MOCK_TRUST_STATUS = {
    success: true,
    data: [
        { sessionId: 'S001', role: 'passenger', trustScore: 92, level: 'normal',
          reason: '', updatedAt: '2026-08-26 10:30:00' },
        { sessionId: 'S002', role: 'passenger', trustScore: 55, level: 'degraded',
          reason: 'injection_detected(间接注入命中) + 越权尝试1次', updatedAt: '2026-08-26 10:28:00' },
        { sessionId: 'S003', role: 'operator',  trustScore: 18, level: 'locked',
          reason: '越权尝试3次触发锁定', updatedAt: '2026-08-26 10:25:00' }
    ]
};

/* 2) 信任曲线：正常 → 骤降 → 缓慢回升（含 60/30 阈值语义） */
const MOCK_TRUST_HISTORY = {
    success: true,
    data: [
        { timestamp: '10:20:00', score: 95 },
        { timestamp: '10:21:00', score: 96 },
        { timestamp: '10:22:00', score: 94 },
        { timestamp: '10:23:00', score: 90 },
        { timestamp: '10:24:00', score: 88 },
        { timestamp: '10:25:00', score: 55 },
        { timestamp: '10:26:00', score: 52 },
        { timestamp: '10:27:00', score: 50 },
        { timestamp: '10:28:00', score: 60 },
        { timestamp: '10:29:00', score: 63 }
    ]
};

/* 3) 污染指纹列表：SM3 精确 + SimHash 近似，含跨会话免疫标记 */
const MOCK_POLLUTION_LIST = {
    success: true,
    data: [
        { id: 'P001', fingerprint: 'a3f9...e21c', fingerprintType: 'sm3',
          sourceType: 'malicious_webpage', firstSeen: '2026-08-26 10:22:00',
          hitCount: 3, crossSessionHits: 2, immune: true },
        { id: 'P002', fingerprint: 'sim:8f2a...11d0', fingerprintType: 'simhash',
          sourceType: 'qr_code', firstSeen: '2026-08-26 10:24:00',
          hitCount: 1, crossSessionHits: 0, immune: false }
    ]
};

/* 4) 态势大屏：KPI 统计 + 攻击类型分布 + 攻击拦截趋势（D3 新增） */
const MOCK_OVERVIEW_SUMMARY = {
    success: true,
    data: {
        totalBlocked: 1287,
        activeSessions: 42,
        degradedSessions: 3,
        lockedSessions: 1,
        blockRate: 99.2
    }
};

const MOCK_ATTACK_DISTRIBUTION = {
    success: true,
    data: [
        { type: 'direct_injection', name: '直接注入', count: 512 },
        { type: 'indirect_injection', name: '间接注入', count: 386 },
        { type: 'obfuscated_bypass', name: '混淆绕过', count: 241 },
        { type: 'privilege_escalation', name: '越权提权', count: 98 },
        { type: 'replay_attack', name: '重放攻击', count: 50 }
    ]
};

const MOCK_ATTACK_TREND = {
    success: true,
    data: [
        { timestamp: '10:00', blocked: 96, total: 99 },
        { timestamp: '10:10', blocked: 112, total: 114 },
        { timestamp: '10:20', blocked: 88, total: 89 },
        { timestamp: '10:30', blocked: 143, total: 145 },
        { timestamp: '10:40', blocked: 121, total: 122 },
        { timestamp: '10:50', blocked: 156, total: 158 },
        { timestamp: '11:00', blocked: 139, total: 140 },
        { timestamp: '11:10', blocked: 171, total: 173 },
        { timestamp: '11:20', blocked: 164, total: 166 },
        { timestamp: '11:30', blocked: 97, total: 98 }
    ]
};

/* 5) 溯源视图：血缘链路（污染源 → 命中会话 → 越权调用 → 拦截/降权）（D3 新增） */
const MOCK_TRACE_CHAIN = {
    success: true,
    data: {
        nodes: [
            { id: 'src1', name: '污染源P001', category: 'source', desc: 'SM3指纹 a3f9...e21c' },
            { id: 'src2', name: '污染源P002', category: 'source', desc: 'SimHash指纹 sim:8f2a...11d0' },
            { id: 's1', name: '会话S002', category: 'session', desc: '旅客端 · 降权' },
            { id: 's2', name: '会话S003', category: 'session', desc: '运维端 · 锁定' },
            { id: 'call1', name: '越权调用 /api/agent/security/apply', category: 'call', desc: '间接注入触发' },
            { id: 'call2', name: '越权调用 /api/agent/trust/set-mode', category: 'call', desc: '重放尝试' },
            { id: 'res1', name: '降权拦截', category: 'result', desc: '信任55 → 权限收缩' },
            { id: 'res2', name: '锁定拦截', category: 'result', desc: '信任18 → 会话锁定' },
            { id: 'res3', name: '指纹免疫', category: 'result', desc: '跨会话命中3次' }
        ],
        links: [
            { source: 'src1', target: 's1' },
            { source: 'src2', target: 's2' },
            { source: 's1', target: 'call1' },
            { source: 's2', target: 'call2' },
            { source: 'call1', target: 'res1' },
            { source: 'call2', target: 'res2' },
            { source: 'src1', target: 'res3' },
            { source: 'src2', target: 'res3' }
        ]
    }
};

/* mock 分发：按 endpoint 前缀返回对应数据 */
function mockResolve(endpoint) {
    if (endpoint.includes('/trust/status')) return MOCK_TRUST_STATUS;
    if (endpoint.includes('/trust/history')) return MOCK_TRUST_HISTORY;
    if (endpoint.includes('/pollution/list')) return MOCK_POLLUTION_LIST;
    if (endpoint.includes('/overview/summary')) return MOCK_OVERVIEW_SUMMARY;
    if (endpoint.includes('/overview/attack-distribution')) return MOCK_ATTACK_DISTRIBUTION;
    if (endpoint.includes('/overview/trend')) return MOCK_ATTACK_TREND;
    if (endpoint.includes('/trace/chain')) return MOCK_TRACE_CHAIN;
    return { success: true, data: [] };
}
