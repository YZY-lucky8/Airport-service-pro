/**
 * ============================================================
 * PEP 授权执行点 (Policy Enforcement Point)
 * 恒盾智航·信疫盾(TrustVax) — 任务一 D1 后端决策层核心模块
 * ============================================================
 *
 * 设计定位：智能体调度器（dispatcher）运行时监控层（安全防线 2）
 * 的决策引擎，采用确定性策略（非 LLM 语义），规避依赖大模型
 * 判断带来的可证伪性与性能开销。
 *
 * 能力构成（三层）：
 *   1) RBAC 角色-动作矩阵
 *      - 角色：passenger（旅客自助终端）/ operator（地勤操作员）
 *              / admin（安全管理员）
 *      - 每个角色绑定可执行动作白名单，最小权限原则
 *   2) 敏感操作正则
 *      - 数据破坏 / 读取个人隐私(PII) / 数据外发 / 安全配置变更
 *      - 命中敏感模式时，仅 admin 角色可继续，其余一律拒绝
 *   3) HMAC JIT 令牌（Just-In-Time Token）
 *      - 动作执行前签发、绑定单动作 + 会话、7s 过期、一次性
 *      - 执行完成后立即作废，防重放、防越权复用
 *
 * 参考：
 *   - LangGraph 运行时授权 / OWASP LLM Top 10 (2025) 权限管控
 *   - Beyond-LlM / CanLLM 的访问控制与工具执行授权实践
 *   - MAC/DAC 模型在 Agent 工具调用上的落地裁剪
 */

const crypto = require('crypto');

// ── 智能体动作全集（与 dispatcher.ALLOWED_ACTIONS 保持一致） ──
const ALL_ACTIONS = [
  'query_flight',        // 航班查询
  'query_gate',          // 登机口查询
  'query_baggage',       // 行李查询
  'search_knowledge',    // 知识库检索
  'navigate_location',   // 地点导航
  'query_weather',       // 天气查询
  'emotion_soothe',      // 情绪安抚
  'small_talk_reply',    // 闲聊
  'check_in',            // 在线值机
  'generate_itinerary',  // 行程建议生成
  'security_analyze',    // 安全分析（管理端）
];
const ALL_ACTIONS_SET = new Set(ALL_ACTIONS);

// ── RBAC 角色-动作矩阵 ──
const READ_ONLY_ACTIONS = [
  'query_flight',
  'query_gate',
  'query_baggage',
  'search_knowledge',
  'navigate_location',
  'query_weather',
  'emotion_soothe',
  'small_talk_reply',
];

const ROLE_ACTIONS = {
  // 旅客：只读 + 对话，无任何写操作与管理操作
  passenger: READ_ONLY_ACTIONS,
  // 地勤操作员：在旅客基础上开放值机与行程建议生成
  operator: [...READ_ONLY_ACTIONS, 'check_in', 'generate_itinerary'],
  // 安全管理员：全量动作（含 security_analyze）
  admin: ALL_ACTIONS,
};

// 角色优先级（用于敏感操作放行判定）
const ROLE_RANK = { passenger: 0, operator: 1, admin: 2 };

// ── 敏感操作正则（数据破坏 / PII / 外发 / 配置变更） ──
const SENSITIVE_PATTERNS = [
  {
    id: 'data_mutation',
    desc: '数据删改（订单/航班/用户记录）',
    requiredRole: 'admin',
    pattern: /(删除|移除|清空|修改|更新|覆盖|篡改).{0,8}(航班|订单|数据|记录|行李|用户|票价|库存)|(\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bUPDATE\b)\s+(FROM\s+|TABLE\s+)?(flight|order|user|passenger|baggage|itinerary)/i,
  },
  {
    id: 'pii_read',
    desc: '读取个人隐私(PII)',
    requiredRole: 'admin',
    pattern: /(读取|查询|查看|获取|导出).{0,4}(身份证|护照|手机号|手机号码|电话|住址|家庭住址|登机牌|PII|隐私|个人资料)/i,
  },
  {
    id: 'data_exfiltration',
    desc: '数据外发（外部远程传输）',
    requiredRole: 'admin',
    pattern: /(发送|外发|传输|导出|上传|转发|回传).{0,8}(外部|远程|服务器|接口|邮箱|URL|http|https|ftp|第三方|攻击者)/i,
  },
  {
    id: 'config_mutation',
    desc: '安全配置变更（阈值/黑白名单/防护开关）',
    requiredRole: 'admin',
    pattern: /(修改|调整|关闭|禁用|绕过|跳过|停用).{0,8}(阈值|白名单|黑名单|防护|检测|防线|限流|拦截|防火墙)/i,
  },
];

// JIT 令牌默认生命周期（毫秒）
const JIT_TOKEN_TTL_MS = parseInt(process.env.PEP_JIT_TTL_MS || '7000', 10);

/**
 * PEP 授权执行点
 */
class PepGuard {
  /**
   * @param {Object} options
   *   - secret: HMAC 签名密钥（缺省时从环境变量 PEP_HMAC_SECRET 读取，
   *     无环境变量则使用项目默认派生密钥，生产环境必须注入）
   */
  constructor(options = {}) {
    this.secret =
      options.secret ||
      process.env.PEP_HMAC_SECRET ||
      crypto.createHash('sha256').update('airport-service-pro-pep-jit-v1').digest('hex');

    this.ttlMs = options.ttlMs || JIT_TOKEN_TTL_MS;

    // 已签发令牌表：token -> { action, sessionId, role, exp, revoked }
    this._issued = new Map();
    this._lastCleanup = Date.now();
  }

  /**
   * 获取 RBAC 矩阵（只读快照，供审计/前端展示）
   */
  getMatrix() {
    const matrix = {};
    for (const [role, actions] of Object.entries(ROLE_ACTIONS)) {
      matrix[role] = [...actions];
    }
    return matrix;
  }

  /**
   * 解析角色安全等级
   */
  getRoleRank(role) {
    return ROLE_RANK[role] || ROLE_RANK.passenger;
  }

  /**
   * ============================================================
   * 核心决策：evaluate
   * ============================================================
   * 输入一次「动作 + 主体角色 + 原始文本」，输出确定性授权结论。
   *
   * @param {Object} ctx
   *   - role:      'passenger' | 'operator' | 'admin'（缺省 passenger）
   *   - action:    意图映射后的动作名
   *   - text:      用户原始输入（用于敏感操作正则检测）
   *   - sessionId: 会话标识（审计锚点，可选）
   * @returns {Object} { allowed, decision, reason, role, action, requiredRole }
   */
  evaluate(ctx = {}) {
    const role = String(ctx.role || 'passenger').toLowerCase();
    const action = ctx.action || '';
    const text = typeof ctx.text === 'string' ? ctx.text : '';
    const sessionId = ctx.sessionId || null;

    // 1. 动作不明 → 一律拒绝（配合 dispatcher 白名单形成双保险）
    if (!ALL_ACTIONS_SET.has(action)) {
      return {
        allowed: false,
        decision: 'deny_unknown_action',
        reason: `未知动作已拦截: ${action}`,
        role,
        action,
        requiredRole: null,
        sessionId,
        timestamp: Date.now(),
      };
    }

    // 2. 敏感操作正则：命中且角色低于所需等级 → 拒绝
    for (const sp of SENSITIVE_PATTERNS) {
      if (sp.pattern.test(text)) {
        const rank = this.getRoleRank(role);
        const needRank = this.getRoleRank(sp.requiredRole);
        if (rank < needRank) {
          return {
            allowed: false,
            decision: 'deny_sensitive',
            reason: `命中敏感操作[${sp.id}: ${sp.desc}]，需要角色 ${sp.requiredRole}，当前 ${role}`,
            role,
            action,
            requiredRole: sp.requiredRole,
            sessionId,
            timestamp: Date.now(),
          };
        }
        // 高权限角色命中敏感模式：放行但标记（审计可见）
        return {
          allowed: true,
          decision: 'allow_sensitive_privileged',
          reason: `敏感操作[${sp.id}] 由高权限角色 ${role} 放行`,
          role,
          action,
          requiredRole: sp.requiredRole,
          sessionId,
          timestamp: Date.now(),
        };
      }
    }

    // 3. RBAC 角色-动作矩阵
    const allowedActions = ROLE_ACTIONS[role];
    if (!allowedActions) {
      return {
        allowed: false,
        decision: 'deny_rbac',
        reason: `未知角色: ${role}`,
        role,
        action,
        requiredRole: null,
        sessionId,
        timestamp: Date.now(),
      };
    }
    if (!allowedActions.includes(action)) {
      const candidates = Object.entries(ROLE_ACTIONS)
        .filter(([, acts]) => acts.includes(action))
        .map(([r]) => r);
      return {
        allowed: false,
        decision: 'deny_rbac',
        reason: `角色 ${role} 无权执行动作 ${action}（可用角色: ${candidates.join('/') || '无'}）`,
        role,
        action,
        requiredRole: candidates[0] || null,
        sessionId,
        timestamp: Date.now(),
      };
    }

    return {
      allowed: true,
      decision: 'allow',
      reason: 'PEP 授权通过',
      role,
      action,
      requiredRole: null,
      sessionId,
      timestamp: Date.now(),
    };
  }

  /**
   * ============================================================
   * JIT 令牌：签发（Just-In-Time）
   * ============================================================
   * 绑定单动作 + 会话，TTL 默认 7s。返回一次性令牌。
   *
   * @param {Object} opts { action, sessionId, role }
   * @returns {Object|null} { token, exp, action, sessionId, role } | null
   */
  issueToken(opts = {}) {
    const { action, sessionId, role = 'passenger' } = opts;
    if (!action || !sessionId) return null;

    this._cleanup();

    const nonce = crypto.randomBytes(8).toString('hex');
    const ts = Date.now();
    const exp = ts + this.ttlMs;
    const payload = `${action}|${sessionId}|${ts}|${nonce}`;
    const token = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');

    this._issued.set(token, { action, sessionId, role, exp, revoked: false, ts });
    return {
      token,
      exp,
      ttlMs: this.ttlMs,
      action,
      sessionId,
      role,
    };
  }

  /**
   * JIT 令牌：校验
   * @param {string} token
   * @param {Object} expect { action, sessionId }（可选强约束）
   * @returns {Object} { ok, reason, data }
   */
  verifyToken(token, expect = {}) {
    if (!token) return { ok: false, reason: '缺少令牌', data: null };

    const rec = this._issued.get(token);
    if (!rec) return { ok: false, reason: '令牌不存在或已作废', data: null };
    if (rec.revoked) return { ok: false, reason: '令牌已作废(一次性)', data: null };
    if (rec.exp < Date.now()) {
      this._issued.delete(token);
      return { ok: false, reason: '令牌已过期', data: null };
    }
    if (expect.action && rec.action !== expect.action) {
      return { ok: false, reason: `令牌绑定动作不匹配(期望 ${expect.action})`, data: null };
    }
    if (expect.sessionId && rec.sessionId !== expect.sessionId) {
      return { ok: false, reason: '令牌绑定会话不匹配', data: null };
    }

    return { ok: true, reason: '令牌有效', data: { ...rec } };
  }

  /**
   * JIT 令牌：作废（执行完成后调用，幂等）
   * @returns {boolean}
   */
  revokeToken(token) {
    if (!token) return false;
    const rec = this._issued.get(token);
    if (!rec) return false;
    rec.revoked = true;
    return true;
  }

  /**
   * 周期清理过期令牌，防止内存增长
   */
  _cleanup() {
    if (Date.now() - this._lastCleanup < this.ttlMs) return;
    const now = Date.now();
    for (const [token, rec] of this._issued.entries()) {
      if (rec.exp < now || rec.revoked) this._issued.delete(token);
    }
    this._lastCleanup = now;
  }

  /**
   * 当前在册令牌数（诊断用）
   */
  get issuedCount() {
    return this._issued.size;
  }
}

module.exports = PepGuard;
module.exports.SENSITIVE_PATTERNS = SENSITIVE_PATTERNS;
module.exports.ROLE_ACTIONS = ROLE_ACTIONS;
module.exports.ALL_ACTIONS = ALL_ACTIONS;
