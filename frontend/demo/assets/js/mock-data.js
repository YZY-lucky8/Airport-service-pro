/**
 * mock 数据层 —— 虚拟数据（D1-D3 开发阶段，D5 演示增强版）
 * 字段名严格对齐 API 契约建议；D4 切换真实接口时，仅需改 api.js 中 USE_MOCK = false
 * 契约建议接口：
 *   GET /api/agent/trust/status    会话信任状态列表
 *   GET /api/agent/trust/history   信任曲线时间序列
 *   GET /api/agent/pollution/list  污染指纹列表
 *   GET /api/agent/overview/summary / attack-distribution / trend
 *   GET /api/agent/trace/chain
 */

/* ============================================================
 * 1) 会话信任状态：覆盖 正常/降权/锁定 三态 × 旅客端/运维端/登机口 多角色
 * ============================================================ */
const MOCK_TRUST_STATUS = {
    success: true,
    data: [
        { sessionId: 'S001', role: 'passenger', trustScore: 92, level: 'normal',
          reason: '', updatedAt: '2026-08-30 14:32:00' },
        { sessionId: 'S002', role: 'passenger', trustScore: 55, level: 'degraded',
          reason: 'injection_detected(间接注入命中) + 越权尝试1次', updatedAt: '2026-08-30 14:31:20' },
        { sessionId: 'S003', role: 'operator',  trustScore: 18, level: 'locked',
          reason: '越权尝试3次触发锁定', updatedAt: '2026-08-30 14:28:05' },
        { sessionId: 'S004', role: 'passenger', trustScore: 88, level: 'normal',
          reason: '', updatedAt: '2026-08-30 14:30:12' },
        { sessionId: 'S005', role: 'gate_agent', trustScore: 47, level: 'degraded',
          reason: 'prompt_injection命中 + 敏感接口访问受限', updatedAt: '2026-08-30 14:29:40' },
        { sessionId: 'S006', role: 'passenger', trustScore: 76, level: 'normal',
          reason: '', updatedAt: '2026-08-30 14:27:55' },
        { sessionId: 'S007', role: 'operator',  trustScore: 24, level: 'locked',
          reason: '重放攻击特征命中，会话强制锁定', updatedAt: '2026-08-30 14:26:30' },
        { sessionId: 'S008', role: 'passenger', trustScore: 83, level: 'normal',
          reason: '', updatedAt: '2026-08-30 14:25:48' },
        { sessionId: 'S009', role: 'gate_agent', trustScore: 61, level: 'degraded',
          reason: 'SimHash近似指纹命中，功能降权观察', updatedAt: '2026-08-30 14:24:10' },
        { sessionId: 'S010', role: 'passenger', trustScore: 68, level: 'normal',
          reason: '', updatedAt: '2026-08-30 14:22:36' }
    ]
};

/* ============================================================
 * 2) 信任曲线：正常波动 → 攻击骤降 → 恢复，跨 24 个时间点（含 60/30 阈值语义）
 * ============================================================ */
const MOCK_TRUST_HISTORY = {
    success: true,
    data: [
        { timestamp: '14:00', score: 95 },
        { timestamp: '14:05', score: 96 },
        { timestamp: '14:10', score: 94 },
        { timestamp: '14:15', score: 93 },
        { timestamp: '14:20', score: 95 },
        { timestamp: '14:25', score: 91 },
        { timestamp: '14:30', score: 92 },
        { timestamp: '14:35', score: 88 },
        { timestamp: '14:40', score: 84 },
        { timestamp: '14:45', score: 79 },
        { timestamp: '14:50', score: 73 },
        { timestamp: '14:55', score: 55 },
        { timestamp: '15:00', score: 50 },
        { timestamp: '15:05', score: 46 },
        { timestamp: '15:10', score: 30 },
        { timestamp: '15:15', score: 26 },
        { timestamp: '15:20', score: 34 },
        { timestamp: '15:25', score: 42 },
        { timestamp: '15:30', score: 50 },
        { timestamp: '15:35', score: 58 },
        { timestamp: '15:40', score: 64 },
        { timestamp: '15:45', score: 70 },
        { timestamp: '15:50', score: 74 },
        { timestamp: '15:55', score: 78 }
    ]
};

/* ============================================================
 * 3) 污染指纹列表：SM3 精确 + SimHash 近似，多来源，含免疫标记
 * ============================================================ */
const MOCK_POLLUTION_LIST = {
    success: true,
    data: [
        { id: 'P001', fingerprint: 'a3f9c2e41b7d80e5...e21c', fingerprintType: 'sm3',
          sourceType: 'malicious_webpage', firstSeen: '2026-08-30 10:22:00',
          hitCount: 7, crossSessionHits: 4, immune: true },
        { id: 'P002', fingerprint: 'sim:8f2a1d3c...11d0', fingerprintType: 'simhash',
          sourceType: 'qr_code', firstSeen: '2026-08-30 10:24:00',
          hitCount: 3, crossSessionHits: 1, immune: false },
        { id: 'P003', fingerprint: 'b77e9d0f21a3c4e8...9a02', fingerprintType: 'sm3',
          sourceType: 'sms_phishing', firstSeen: '2026-08-30 11:05:00',
          hitCount: 5, crossSessionHits: 3, immune: true },
        { id: 'P004', fingerprint: 'sim:4c9e77aa...b3f1', fingerprintType: 'simhash',
          sourceType: 'malicious_webpage', firstSeen: '2026-08-30 11:18:00',
          hitCount: 2, crossSessionHits: 0, immune: false },
        { id: 'P005', fingerprint: 'e1d04b2a9f8c7d31...5f7c', fingerprintType: 'sm3',
          sourceType: 'attachment_file', firstSeen: '2026-08-30 12:01:00',
          hitCount: 9, crossSessionHits: 6, immune: true },
        { id: 'P006', fingerprint: 'sim:77ab0d2e...c9e4', fingerprintType: 'simhash',
          sourceType: 'qr_code', firstSeen: '2026-08-30 12:33:00',
          hitCount: 1, crossSessionHits: 0, immune: false },
        { id: 'P007', fingerprint: '9f3b8a17c2d0e456...a8d1', fingerprintType: 'sm3',
          sourceType: 'prompt_injection', firstSeen: '2026-08-30 13:12:00',
          hitCount: 11, crossSessionHits: 8, immune: true },
        { id: 'P008', fingerprint: 'sim:12ef9ab0...d77c', fingerprintType: 'simhash',
          sourceType: 'malicious_webpage', firstSeen: '2026-08-30 13:40:00',
          hitCount: 4, crossSessionHits: 2, immune: false },
        { id: 'P009', fingerprint: 'c5d8e2f1a90b37c4...6b3e', fingerprintType: 'sm3',
          sourceType: 'sms_phishing', firstSeen: '2026-08-30 14:02:00',
          hitCount: 6, crossSessionHits: 3, immune: true },
        { id: 'P010', fingerprint: 'sim:8b41d6e0...f2a9', fingerprintType: 'simhash',
          sourceType: 'attachment_file', firstSeen: '2026-08-30 14:16:00',
          hitCount: 2, crossSessionHits: 1, immune: false }
    ]
};

/* ============================================================
 * 4) 态势大屏：KPI 统计 + 攻击类型分布 + 攻击拦截趋势
 * ============================================================ */
const MOCK_OVERVIEW_SUMMARY = {
    success: true,
    data: {
        totalBlocked: 2836,
        activeSessions: 87,
        degradedSessions: 3,
        lockedSessions: 2,
        blockRate: 99.4,
        sub: '近 24 小时 · 较昨日 +12.6%'
    }
};

const MOCK_ATTACK_DISTRIBUTION = {
    success: true,
    data: [
        { type: 'direct_injection', name: '直接注入', count: 1042 },
        { type: 'indirect_injection', name: '间接注入', count: 826 },
        { type: 'obfuscated_bypass', name: '混淆绕过', count: 477 },
        { type: 'privilege_escalation', name: '越权提权', count: 268 },
        { type: 'replay_attack', name: '重放攻击', count: 156 },
        { type: 'exfiltration_try', name: '数据外带', count: 67 }
    ]
};

const MOCK_ATTACK_TREND = {
    success: true,
    data: [
        { timestamp: '12:00', blocked: 96,  total: 97 },
        { timestamp: '12:10', blocked: 112, total: 113 },
        { timestamp: '12:20', blocked: 88,  total: 89 },
        { timestamp: '12:30', blocked: 143, total: 144 },
        { timestamp: '12:40', blocked: 121, total: 122 },
        { timestamp: '12:50', blocked: 156, total: 157 },
        { timestamp: '13:00', blocked: 139, total: 140 },
        { timestamp: '13:10', blocked: 171, total: 172 },
        { timestamp: '13:20', blocked: 164, total: 165 },
        { timestamp: '13:30', blocked: 97,  total: 98 },
        { timestamp: '13:40', blocked: 188, total: 189 },
        { timestamp: '13:50', blocked: 142, total: 143 },
        { timestamp: '14:00', blocked: 175, total: 176 },
        { timestamp: '14:10', blocked: 129, total: 130 },
        { timestamp: '14:20', blocked: 203, total: 204 },
        { timestamp: '14:30', blocked: 167, total: 168 },
        { timestamp: '14:40', blocked: 214, total: 215 },
        { timestamp: '14:50', blocked: 158, total: 159 },
        { timestamp: '15:00', blocked: 186, total: 187 },
        { timestamp: '15:10', blocked: 146, total: 147 },
        { timestamp: '15:20', blocked: 172, total: 173 },
        { timestamp: '15:30', blocked: 128, total: 129 },
        { timestamp: '15:40', blocked: 154, total: 155 },
        { timestamp: '15:50', blocked: 162, total: 163 }
    ]
};

/* ============================================================
 * 5) 溯源视图：血缘链路（污染源 → 命中会话 → 越权调用 → 拦截/降权）
 * ============================================================ */
const MOCK_TRACE_CHAIN = {
    success: true,
    data: {
        nodes: [
            { id: 'src1', name: '污染源P001', category: 'source', desc: 'SM3指纹 a3f9...e21c · 恶意网页' },
            { id: 'src2', name: '污染源P002', category: 'source', desc: 'SimHash指纹 sim:8f2a...11d0 · 二维码' },
            { id: 'src3', name: '污染源P005', category: 'source', desc: 'SM3指纹 e1d0...5f7c · 附件文件' },
            { id: 'src4', name: '污染源P007', category: 'source', desc: 'SM3指纹 9f3b...a8d1 · Prompt注入' },
            { id: 's1', name: '会话S002', category: 'session', desc: '旅客端 · 降权(55)' },
            { id: 's2', name: '会话S003', category: 'session', desc: '运维端 · 锁定(18)' },
            { id: 's3', name: '会话S005', category: 'session', desc: '登机口端 · 降权(47)' },
            { id: 's4', name: '会话S007', category: 'session', desc: '运维端 · 锁定(24)' },
            { id: 'call1', name: '越权调用 /api/agent/security/apply', category: 'call', desc: '间接注入触发' },
            { id: 'call2', name: '越权调用 /api/agent/trust/set-mode', category: 'call', desc: '重放尝试' },
            { id: 'call3', name: '越权调用 /api/agent/flight/update', category: 'call', desc: 'Prompt注入诱导' },
            { id: 'call4', name: '越权调用 /api/agent/passenger/export', category: 'call', desc: '数据外带尝试' },
            { id: 'res1', name: '降权拦截', category: 'result', desc: '信任55 → 权限收缩' },
            { id: 'res2', name: '锁定拦截', category: 'result', desc: '信任18 → 会话锁定' },
            { id: 'res3', name: '指纹免疫', category: 'result', desc: '跨会话命中4次' },
            { id: 'res4', name: '降权拦截', category: 'result', desc: '信任47 → 功能受限' },
            { id: 'res5', name: '锁定拦截', category: 'result', desc: '信任24 → 会话锁定' }
        ],
        links: [
            { source: 'src1', target: 's1' },
            { source: 'src1', target: 's3' },
            { source: 'src2', target: 's2' },
            { source: 'src3', target: 's1' },
            { source: 'src4', target: 's3' },
            { source: 'src4', target: 's4' },
            { source: 's1', target: 'call1' },
            { source: 's2', target: 'call2' },
            { source: 's3', target: 'call3' },
            { source: 's4', target: 'call4' },
            { source: 'call1', target: 'res1' },
            { source: 'call2', target: 'res2' },
            { source: 'src1', target: 'res3' },
            { source: 'call3', target: 'res4' },
            { source: 'call4', target: 'res5' }
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
