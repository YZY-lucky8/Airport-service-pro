/**
 * ============================================================
 * 安全防线 2.5：动态信任引擎 (Trust Engine)
 * 参考：Josang 主观逻辑信任模型 / Beta 分布贝叶斯信任
 *       EigenTrust、TRUST-IT 设计理念
 * 适用：机场自助终端智能体（恒盾智航·信疫盾）
 * ============================================================
 *
 * 一、三维动态信任（权重）
 *   - 行为维度 Behavior 权重 0.40：交互行为质量（注入拦截、请求被拒、异常频率）
 *   - 会话维度 Context 权重 0.35：会话一致性（正常完成交互、会话延续、历史吻合）
 *   - 终端维度 Terminal 权重 0.25：终端可信度（设备在线/健康、终端长期信誉）
 *
 * 二、贝叶斯更新（Beta 分布）
 *   每个维度维护一对参数 (alpha, beta)：
 *     - 信任分 = alpha / (alpha + beta)，取值 [0, 1]
 *     - 收到正面证据（正常完成 / 通过检查）→ alpha 增加权重
 *     - 收到负面证据（注入拦截 / 请求被拒 / 异常）→ beta 增加权重
 *     先验 (7, 3) → 初始信任 70 分（NORMAL）
 *
 * 三、等级策略（综合分）
 *   score >= 60        → NORMAL      正常：全量放行
 *   30 <= score < 60   → DOWNGRADED  降权：拒绝敏感动作，仅放行只读基础能力
 *   score < 30         → LOCKED      锁定：拒绝一切动作
 *
 * 纯内存实现（无 DB 依赖），单测友好，单次评估 < 1ms。
 */

const TrustLevel = Object.freeze({
  LOCKED: 'locked',
  DOWNGRADED: 'downgraded',
  NORMAL: 'normal',
});

// 默认敏感动作（降权后禁止）：涉及状态变更 / 信息敏感
const DEFAULT_SENSITIVE_ACTIONS = ['check_in', 'security_analyze'];

// 维度键
const DIMENSIONS = {
  BEHAVIOR: 'behavior',
  CONTEXT: 'context',
  TERMINAL: 'terminal',
};

class TrustEngine {
  /**
   * @param {Object} options
   *   behaviorWeight / contextWeight / terminalWeight：三维权重（默认 0.40 / 0.35 / 0.25）
   *   downgradeThreshold / lockThreshold：降权 / 锁定阈值（默认 60 / 30）
   *   sensitiveActions：降权后禁止的动作集合
   *   priorAlpha / priorBeta：Beta 先验参数（默认 7 / 3 → 初始 70 分）
   */
  constructor(options = {}) {
    this.behaviorWeight = options.behaviorWeight ?? 0.40;
    this.contextWeight = options.contextWeight ?? 0.35;
    this.terminalWeight = options.terminalWeight ?? 0.25;
    this.downgradeThreshold = options.downgradeThreshold ?? 60;
    this.lockThreshold = options.lockThreshold ?? 30;
    this.sensitiveActions = new Set(options.sensitiveActions || DEFAULT_SENSITIVE_ACTIONS);
    this.priorAlpha = options.priorAlpha ?? 7;
    this.priorBeta = options.priorBeta ?? 3;

    // 权重归一化保护：防止配置和不为 1 导致分数越界
    const total = this.behaviorWeight + this.contextWeight + this.terminalWeight;
    if (total > 0) {
      this.behaviorWeight /= total;
      this.contextWeight /= total;
      this.terminalWeight /= total;
    }

    // 内部状态：subjectId -> { behavior:{alpha,beta}, context:{alpha,beta}, terminal:{alpha,beta}, updatedAt }
    this._state = new Map();

    // 分数历史（信任曲线）：subjectId -> [{ timestamp, score }]，供 trust/history 展示
    this._history = new Map();
    // 会话元信息：subjectId -> { role?, reason? }（由 dispatcher 在评估时登记）
    this._meta = new Map();
  }

  // ───────────────────────── 信任曲线历史 ─────────────────────────

  /** 记录一个信任分数快照点（相同分数 5s 内合并，避免抖动刷屏） */
  _pushHistory(subject, score) {
    let arr = this._history.get(subject);
    if (!arr) {
      arr = [];
      this._history.set(subject, arr);
    }
    const now = Date.now();
    const last = arr[arr.length - 1];
    if (last && last.score === score && now - last.timestamp < 5000) {
      last.timestamp = now;
      return;
    }
    arr.push({ timestamp: now, score });
  }

  /** 获取某会话的信任分数历史（按时间升序） */
  getHistory(subject) {
    const arr = this._history.get(String(subject)) || [];
    return arr
      .map((p) => ({ timestamp: p.timestamp, score: p.score }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ───────────────────────── 会话元信息 ─────────────────────────

  /** 登记/合并会话元信息（role、reason 等） */
  setMeta(subject, meta = {}) {
    const cur = this._meta.get(String(subject)) || {};
    this._meta.set(String(subject), Object.assign({}, cur, meta));
  }

  /** 读取会话元信息 */
  getMeta(subject) {
    return this._meta.get(String(subject)) || {};
  }

  // ───────────────────────── 内部工具 ─────────────────────────

  _newVars() {
    return { alpha: this.priorAlpha, beta: this.priorBeta };
  }

  _getEntry(subject) {
    if (!this._state.has(subject)) {
      this._state.set(subject, {
        behavior: this._newVars(),
        context: this._newVars(),
        terminal: this._newVars(),
        updatedAt: Date.now(),
      });
    }
    return this._state.get(subject);
  }

  /** 单维 Beta 评分：[0,1] */
  _betaScore(vars) {
    const denom = vars.alpha + vars.beta;
    return denom === 0 ? 0 : vars.alpha / denom;
  }

  /** 综合分（0-100 整数） */
  _aggregate(entry) {
    const b = this._betaScore(entry.behavior);
    const c = this._betaScore(entry.context);
    const t = this._betaScore(entry.terminal);
    const raw = this.behaviorWeight * b + this.contextWeight * c + this.terminalWeight * t;
    return {
      behaviorScore: b,
      contextScore: c,
      terminalScore: t,
      score: Math.round(raw * 100),
    };
  }

  /** 分数 → 等级 */
  _levelOf(score) {
    if (score < this.lockThreshold) return TrustLevel.LOCKED;
    if (score < this.downgradeThreshold) return TrustLevel.DOWNGRADED;
    return TrustLevel.NORMAL;
  }

  // ───────────────────────── 证据记录 ─────────────────────────

  /**
   * 记录一条证据并做 Beta 更新
   * @param {string} subject 主体（终端ID/用户ID）
   * @param {string} dim 维度：behavior | context | terminal
   * @param {boolean} positive true=正面证据(alpha+) / false=负面证据(beta+)
   * @param {number} weight 证据强度权重（默认 1）
   */
  record(subject, dim, positive, weight = 1) {
    const existed = this._state.has(subject);
    const entry = this._getEntry(subject);
    const vars = entry[dim] || (entry[dim] = this._newVars());
    if (positive) {
      vars.alpha += weight;
    } else {
      vars.beta += weight;
    }
    entry.updatedAt = Date.now();
    // 首次建档记录初始分数点（先验 70），随后每次证据更新记录一个快照点
    if (!existed) {
      this._pushHistory(subject, Math.round(this._betaScore(this._newVars()) * 100));
    }
    this._pushHistory(subject, this._aggregate(entry).score);
    return this._betaScore(vars);
  }

  /** 语义化：行为维度证据（注入检查 / 请求裁决结果） */
  recordBehavior(subject, ok, weight = 1) {
    return this.record(subject, DIMENSIONS.BEHAVIOR, ok, weight);
  }

  /** 语义化：会话维度证据（会话是否正常延续 / 完成） */
  recordContext(subject, ok, weight = 1) {
    return this.record(subject, DIMENSIONS.CONTEXT, ok, weight);
  }

  /** 语义化：终端维度证据（终端健康 / 在线状态） */
  recordTerminal(subject, ok, weight = 1) {
    return this.record(subject, DIMENSIONS.TERMINAL, ok, weight);
  }

  // ───────────────────────── 状态查询 ─────────────────────────

  /** 查询主体当前信任状态 */
  getStatus(subject) {
    if (!this._state.has(subject)) {
      return {
        subject,
        score: Math.round(this._betaScore(this._newVars()) * 100),
        level: TrustLevel.NORMAL,
        behaviorScore: this._betaScore(this._newVars()),
        contextScore: this._betaScore(this._newVars()),
        terminalScore: this._betaScore(this._newVars()),
        dims: null,
        updatedAt: Date.now(),
      };
    }
    const entry = this._state.get(subject);
    const agg = this._aggregate(entry);
    return {
      subject,
      score: agg.score,
      level: this._levelOf(agg.score),
      behaviorScore: agg.behaviorScore,
      contextScore: agg.contextScore,
      terminalScore: agg.terminalScore,
      dims: {
        [DIMENSIONS.BEHAVIOR]: { alpha: entry.behavior.alpha, beta: entry.behavior.beta, score: agg.behaviorScore },
        [DIMENSIONS.CONTEXT]: { alpha: entry.context.alpha, beta: entry.context.beta, score: agg.contextScore },
        [DIMENSIONS.TERMINAL]: { alpha: entry.terminal.alpha, beta: entry.terminal.beta, score: agg.terminalScore },
      },
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * 对某主体的某个动作做权限裁决
   * @returns {allow, level, score, restricted, reason}
   */
  evaluate(subject, action) {
    const status = this.getStatus(subject);
    const { score, level } = status;

    // LOCKED：锁定，拒绝一切动作
    if (level === TrustLevel.LOCKED) {
      return {
        allow: false,
        level,
        score,
        restricted: true,
        reason: `信任锁定（score=${score}<${this.lockThreshold}）：该主体已被冻结，所有操作暂不可用，请联系安全管理员复核`,
      };
    }

    // DOWNGRADED：降权，敏感动作拒绝
    if (level === TrustLevel.DOWNGRADED) {
      if (this.sensitiveActions.has(action)) {
        return {
          allow: false,
          level,
          score,
          restricted: true,
          reason: `信任降权（score=${score}<${this.downgradeThreshold}）：敏感动作「${action}」已受限，仅开放只读基础查询`,
        };
      }
      return {
        allow: true,
        level,
        score,
        restricted: true,
        reason: `信任降权（score=${score}<${this.downgradeThreshold}）：仅允许只读基础动作`,
      };
    }

    // NORMAL：全量放行
    return {
      allow: true,
      level,
      score,
      restricted: false,
      reason: `信任正常（score=${score}）：全量权限`,
    };
  }

  /** 重置某主体信任 */
  reset(subject) {
    this._state.delete(subject);
  }

  /** 已跟踪主体数 */
  size() {
    return this._state.size;
  }

  /** 导出全部状态快照（管理端展示） */
  snapshot() {
    const list = [];
    for (const [subject, entry] of this._state.entries()) {
      const agg = this._aggregate(entry);
      list.push({
        subject,
        score: agg.score,
        level: this._levelOf(agg.score),
        behavior: entry.behavior,
        context: entry.context,
        terminal: entry.terminal,
        updatedAt: entry.updatedAt,
      });
    }
    return list;
  }
}

module.exports = { TrustEngine, TrustLevel, DIMENSIONS };
