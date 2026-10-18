/**
 * ============================================================
 * ARTII — Adversarially Robust Trust-Infection Immunization
 * 对抗鲁棒信任-感染免疫算法（恒盾智航·信疫盾 / 全新算法 V001）
 * ============================================================
 *
 * 三角耦合：对抗鲁棒信任评估 × 流行病学免疫动力学 × 访问控制
 *
 * 构件1 对抗鲁棒信任更新（FTRL + Π_ρ 截断）
 *   - 将信任更新建模为带污染反馈的在线学习（T 轮）
 *   - Π_ρ 截断：clip(y, median ± ρ·MAD)，剔除信任清洗/极端证据注入
 *   - FTRL 权重更新：w_{t+1} = argmin_w[ Σℓ_s(w) + (1/2η)‖w−w_t‖² ]，
 *     聚合到概率单纯形（simplex 投影，保证 w_j≥0 且 Σw=1）
 *   - 抗污染 regret 界：R_T ≤ O(logN/Δ + C)（参照 Amir 2020，C=污染预算）
 *
 * 构件2 信任驱动 SEIR+SIS 状态机（替代 MMCA 固定转移率）
 *   - Agent 层状态：S 易感 / E 暴露 / I 感染 / R 隔离免疫
 *   - 转移率是"对抗鲁棒后信任"θ̂ 的单调函数：
 *       P(S→E)=β(1−θ̂)
 *       P(E→I)=γ(1−θ̂)^κ   (κ≥1 激活陡度)
 *       P(I→R)=μθ̂           (隔离解除依赖信任恢复)
 *   - 有效再生数 Re(θ̂)=β·Σ接触·(1−θ̂ⱼ)/μ；Re<1 系统免疫收敛
 *   - 工具层 SIS（无状态）：clean↔poisoned（由暴露事件驱动）
 *
 * 构件3 ℓ∞ 认证鲁棒性（隔离边界）
 *   - 攻击者操纵单 Agent 信任属性的 ℓ∞ 扰动 δ，聚合评分认证下界：
 *       θ̂ ≥ Σ w_j·(X_j − δ·M_j)，M_j 为第 j 维属性敏感度
 *   - 存在信任操纵量级阈值 δ*：操纵幅度 ≤ δ* 无法阻止触发隔离
 *
 * 设计目标：增量接入现有 trust-engine / dispatcher，纯内存实现、
 *           确定性可测（状态机迁移支持注入随机数以便单测），
 *           单次评估 < 1ms，不引入外部依赖。
 * ============================================================
 */

// ───────────────────────── 构件1：纯函数工具 ─────────────────────────

/**
 * 中位数
 * @param {number[]} arr
 * @returns {number}
 */
function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 中位数绝对偏差（MAD）
 * MAD = median(|x_i − median(x)|)
 * @param {number[]} arr
 * @returns {number}
 */
function mad(arr) {
  const m = median(arr);
  const devs = arr.map((x) => Math.abs(x - m));
  return median(devs);
}

/**
 * Π_ρ 鲁棒截断：剔除/收缩超出 median ± ρ·MAD 的离群证据（信任清洗/极端证据注入）
 * @param {number[]} values 证据值序列
 * @param {number} rho 截断倍数（默认 1.5，稳健统计惯例）
 * @returns {number[]} 截断后的干净证据（离群点被裁剪到边界）
 */
function robustTruncate(values, rho = 1.5) {
  if (!values || values.length === 0) return [];
  const m = median(values);
  const scale = mad(values);
  // MAD=0（全部相同）时退化为 0 扰动（无离群）
  const lo = scale === 0 ? m : m - rho * scale;
  const hi = scale === 0 ? m : m + rho * scale;
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

/**
 * 一步 FTRL 权重更新（L2 邻近正则 + 线性化损失），输出投影到概率单纯形
 * w_{t+1} = argmin_w [ g_t·w + (1/2η)‖w − w_t‖² ]
 * 闭式解：w = w_t − η·g，再投影到 {w≥0, Σw=1}
 * @param {number[]} w 当前权重（已归一化）
 * @param {number[]} g 本轮损失梯度（污染证据会给出异常大梯度）
 * @param {number} eta 学习率（默认 0.1）
 * @returns {number[]} 更新后权重（Σ=1, 各≥0）
 */
function ftrlStep(w, g, eta = 0.1) {
  if (!w || w.length === 0) return w;
  const n = w.length;
  const grad = g || new Array(n).fill(0);
  // 投影：w' = w − η·g，随后 simplex 投影
  const raw = w.map((v, i) => v - eta * (grad[i] || 0));
  return projectSimplex(raw);
}

/**
 * 欧几里得投影到概率单纯形 Δ^{n-1} = {x≥0, Σx=1}
 * 参考 Held et al. / Duchi et al. 的经典 O(n log n) 实现
 * @param {number[]} v
 * @returns {number[]}
 */
function projectSimplex(v) {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rhoIdx = -1;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (t < u[i]) rhoIdx = i;
  }
  // 重新按 rhoIdx 处的累计和求阈值（避免 rho 之后继续累加的 cssv 污染）
  let theta = -Infinity;
  if (rhoIdx >= 0) {
    let css = 0;
    for (let i = 0; i <= rhoIdx; i++) css += u[i];
    theta = (css - 1) / (rhoIdx + 1);
  }
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * MAD 鲁棒聚合：对证据流做 Π_ρ 截断后取均值（干净证据的稳健估计）
 * @param {number[]} values
 * @param {number} rho
 * @returns {number}
 */
function robustMean(values, rho = 1.5) {
  const clean = robustTruncate(values, rho);
  if (clean.length === 0) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

// ───────────────────────── 构件2：SEIR 状态机 ─────────────────────────

/** 流行病学状态枚举 */
const EpiState = Object.freeze({
  S: 'S', // 易感 Susceptible
  E: 'E', // 暴露 Exposed（检测到可疑暴露证据，未激活）
  I: 'I', // 感染 Infected（已激活，需隔离）
  R: 'R', // 隔离免疫 Recovered/Quarantined
});

/** 工具层 SIS 状态枚举（无状态基础设施） */
const ToolState = Object.freeze({
  CLEAN: 'clean',
  POISONED: 'poisoned',
});

/**
 * 单主体 SEIR 状态机：转移率由对抗鲁棒信任 θ̂ 驱动
 * 确定性概率计算（供单测断言）+ 带随机数推进（供运行仿真）
 */
class SeirMachine {
  /**
   * @param {Object} opts
   *   beta  基础暴露系数（默认 0.3）
   *   gamma 激活系数（默认 0.5）
   *   kappa 激活陡度 κ≥1（默认 1.5）
   *   mu    恢复系数（默认 0.4）
   */
  constructor(opts = {}) {
    this.beta = opts.beta ?? 0.3;
    this.gamma = opts.gamma ?? 0.5;
    this.kappa = opts.kappa ?? 1.5;
    this.mu = opts.mu ?? 0.4;
    // subject -> { state, since }
    this._states = new Map();
  }

  _ensure(subject) {
    if (!this._states.has(subject)) {
      this._states.set(subject, { state: EpiState.S, since: Date.now() });
    }
    return this._states.get(subject);
  }

  /**
   * 转移概率（确定性，θ̂∈[0,1]）
   * @param {number} thetaHat 对抗鲁棒信任分 [0,1]
   * @returns {Object} { sToE, eToI, iToR }
   */
  transitionProbabilities(thetaHat) {
    const t = Math.min(1, Math.max(0, thetaHat));
    return {
      sToE: this.beta * (1 - t),
      eToI: this.gamma * Math.pow(1 - t, this.kappa),
      iToR: this.mu * t,
    };
  }

  /**
   * 推进一步状态迁移（幂等：非触发路径不迁移）
   * @param {string} subject
   * @param {number} thetaHat 对抗鲁棒信任分 [0,1]
   * @param {Function} [rng] 随机源（默认 Math.random），单测注入固定值
   * @returns {string} 迁移后状态
   */
  step(subject, thetaHat, rng = Math.random) {
    const rec = this._ensure(subject);
    const p = this.transitionProbabilities(thetaHat);
    const r = rng();

    switch (rec.state) {
      case EpiState.S:
        if (r < p.sToE) rec.state = EpiState.E;
        break;
      case EpiState.E:
        if (r < p.eToI) rec.state = EpiState.I;
        break;
      case EpiState.I:
        if (r < p.iToR) rec.state = EpiState.R;
        break;
      // R 为吸收态（隔离免疫，仅管理员复核后 reset）
      default:
        break;
    }
    rec.since = Date.now();
    return rec.state;
  }

  /**
   * 有效再生数 Re(θ̂) = β·接触·(1−θ̂)/μ
   * @param {number} thetaHat
   * @param {number} contactRate 平均接触率（默认 1.0 归一化）
   * @returns {number}
   */
  effectiveRegNumber(thetaHat, contactRate = 1.0) {
    const t = Math.min(1, Math.max(0, thetaHat));
    if (this.mu <= 0) return Infinity;
    return (this.beta * contactRate * (1 - t)) / this.mu;
  }

  /**
   * Re<1 免疫收敛条件对应的信任临界值 θ_crit
   * 由 β·(1−θ)/μ = 1 解得：θ_crit = 1 − μ/β
   * @param {number} contactRate
   * @returns {number|null} 无解（β≤μ 恒免疫）返回 null
   */
  criticalTrust(contactRate = 1.0) {
    const denom = this.beta * contactRate;
    if (denom <= this.mu) return null; // 恒有 Re<1，任意信任均免疫
    return 1 - this.mu / denom;
  }

  /** 查询状态 */
  getState(subject) {
    return this._ensure(subject).state;
  }

  /** 重置主体 */
  reset(subject) {
    this._states.delete(subject);
  }

  /** 全部主体状态快照 */
  snapshot() {
    const out = {};
    for (const [k, v] of this._states.entries()) out[k] = v.state;
    return out;
  }
}

// ───────────────────────── 构件3：认证下界 ─────────────────────────

/**
 * 认证下界：θ̂ ≥ Σ w_j·(X_j − δ·M_j)
 * @param {number[]} weights 维度权重（已归一化）
 * @param {number[]} scores  各维信任分 X_j
 * @param {number[]} sens    各维属性敏感度 M_j
 * @param {number} delta     ℓ∞ 扰动幅度（攻击者单维最大操纵量）
 * @returns {number} 认证下界（原始 0-1 尺度）
 */
function certifiedLowerBound(weights, scores, sens, delta) {
  const n = Math.min(weights.length, scores.length, sens.length);
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += weights[j] * Math.max(0, scores[j] - delta * sens[j]);
  }
  return sum;
}

/**
 * 信任操纵量级阈值 δ*：使认证下界恰好等于激活阈值 θ_act 的最大扰动
 * 求解 Σ w_j·(X_j − δ·M_j) = θ_act → δ* = (Σw_j X_j − θ_act) / (Σw_j M_j)
 * 物理含义：攻击者操纵幅度 ≤ δ* 时，信任评分无法跌破激活阈值，隔离必然触发。
 * @param {number[]} weights
 * @param {number[]} scores
 * @param {number[]} sens
 * @param {number} thetaAct 激活阈值（0-1 尺度，默认 0.30 对应现有 30 分）
 * @returns {number} δ*（扰动无量纲，幅度越大越难阻止）
 */
function certifiedDeltaStar(weights, scores, sens, thetaAct = 0.3) {
  const n = Math.min(weights.length, scores.length, sens.length);
  let wSum = 0;
  let wmSum = 0;
  for (let j = 0; j < n; j++) {
    wSum += weights[j] * scores[j];
    wmSum += weights[j] * sens[j];
  }
  if (wmSum <= 0) return Infinity; // 敏感度全 0 → 无法通过操纵影响
  const num = wSum - thetaAct;
  return Math.max(0, num / wmSum);
}

// ───────────────────────── 核心引擎 ─────────────────────────

/**
 * ARTII 引擎：整合三构件，面向单主体提供
 *   observeEvidence / robustTrust / epiVerdict / certifiedBound / verdict
 * 纯内存实现，主体维度默认行为/会话/终端三维。
 */
class ArtiiEngine {
  /**
   * @param {Object} opts
   *   dims         维度名数组（默认 ['behavior','context','terminal']）
   *   weights      初始维度权重（默认 [0.40, 0.35, 0.25]，将归一化）
   *   sensitivity  各维属性敏感度 M_j（默认取初始权重，表示对聚合的敏感贡献）
   *   eta          FTRL 学习率
   *   rho          Π_ρ 截断倍数
   *   activeThreshold 隔离激活阈值（0-1 尺度，默认 0.30）
   *   lockThreshold   全拒阈值（0-1 尺度，默认 0.30）
   *   seir         SeirMachine 构造参数（透传）
   */
  constructor(opts = {}) {
    this.dims = opts.dims || ['behavior', 'context', 'terminal'];
    const n = this.dims.length;
    const initW = opts.weights || [0.4, 0.35, 0.25];
    // 归一化初始权重
    let total = initW.reduce((a, b) => a + b, 0);
    if (total <= 0) total = 1;
    this.weights = initW.map((w) => w / total);
    this.sensitivity = opts.sensitivity || this.weights.slice();
    this.eta = opts.eta ?? 0.1;
    this.rho = opts.rho ?? 1.5;
    this.activeThreshold = opts.activeThreshold ?? 0.3; // 对应现有 30 分
    this.lockThreshold = opts.lockThreshold ?? this.activeThreshold;

    this.seir = new SeirMachine(opts.seir || {});

    // 证据流：subject -> [{ t, dim, value, label, seq }]
    this._evidence = new Map();
    this._seq = 0;
    // 污染预算审计：subject -> { directInjection, privilegeEscalation, confusionBypass, other }
    this._pollutionBudget = new Map();
    // 触发隔离登记（审计展示）
    this._quarantines = [];
  }

  _dimIndex(dim) {
    const idx = this.dims.indexOf(dim);
    return idx >= 0 ? idx : 0;
  }

  /**
   * 登记一条信任证据（构件1 输入流）
   * @param {string} subject
   * @param {Object} ev { dim, value, label?, pollute? }
   *   dim    维度名（behavior/context/terminal）
   *   value  证据值，正证据 ∈ (0,1]（越高越信任），负证据 ∈ [-1,0)（越低越不信任）
   *   label  可选语义标签（'blocked'/'ok'/'escalation'...），用于污染预算审计
   *   pollute 显式标记该证据可能受污染（攻击路径证据），计入污染预算 C
   */
  observeEvidence(subject, ev) {
    const key = String(subject);
    if (!this._evidence.has(key)) this._evidence.set(key, []);
    const dim = ev.dim || this.dims[0];
    const entry = {
      t: Date.now(),
      dim,
      value: Number(ev.value) || 0,
      label: ev.label || '',
      seq: ++this._seq,
    };
    this._evidence.get(key).push(entry);
    // 有证据即纳入流行病学跟踪（便于 snapshot / 免疫裁决）
    this.seir.getState(key);
    // 污染预算审计
    const budget = this._pollutionBudget.get(key) || { directInjection: 0, privilegeEscalation: 0, confusionBypass: 0, other: 0 };
    if (ev.pollute || ev.label === 'blocked' || ev.label === 'escalation') {
      if (ev.label === 'blocked') budget.directInjection += 1;
      else if (ev.label === 'escalation') budget.privilegeEscalation += 1;
      else budget.other += 1;
    }
    this._pollutionBudget.set(key, budget);
    return entry;
  }

  /** 语义化：拦截类负面证据（污染路径，计入 C） */
  observeBlocked(subject, dim = 'behavior', value = -1.0) {
    return this.observeEvidence(subject, { dim, value, label: 'blocked', pollute: true });
  }

  /** 语义化：正常完成正面证据 */
  observeOk(subject, dim = 'behavior', value = 0.1) {
    return this.observeEvidence(subject, { dim, value, label: 'ok' });
  }

  /** 某主体累计污染预算 C（攻击者累计污染量，审计口径） */
  pollutionBudget(subject) {
    return this._pollutionBudget.get(String(subject)) || { directInjection: 0, privilegeEscalation: 0, confusionBypass: 0, other: 0 };
  }

  /** 某主体全部污染预算之和 */
  totalPollution(subject) {
    const b = this.pollutionBudget(subject);
    return b.directInjection + b.privilegeEscalation + b.confusionBypass + b.other;
  }

  /**
   * 按维度聚合干净证据均值（Π_ρ 截断后的每维证据）
   * @param {string} subject
   * @returns {Object} { behavior, context, terminal } 各维 ∈[-1,1] 尺度
   */
  _perDimRobustMean(subject) {
    const evs = this._evidence.get(String(subject)) || [];
    const out = {};
    for (const dim of this.dims) out[dim] = [];
    for (const e of evs) {
      if (out[e.dim]) out[e.dim].push(e.value);
      else out[this.dims[0]].push(e.value);
    }
    const res = {};
    for (const dim of this.dims) {
      res[dim] = robustMean(out[dim], this.rho);
    }
    return res;
  }

  /**
   * 构件1：对抗鲁棒信任更新 → 返回鲁棒聚合信任 θ̂（0-1 尺度）
   * 流程：
   *   1) 对每维证据流做 Π_ρ 截断得到稳健证据均值 μ_j
   *   2) 由污染梯度驱动 FTRL 更新权重（被污染维度梯度大 → 权重被压）
   *   3) θ̂ = Σ w_j·σ(μ_j)，σ 为 sigmoid 压缩到 (0,1)
   * @param {string} subject
   * @returns {Object} { thetaHat, weights, perDim, pollution }
   */
  robustTrust(subject) {
    const key = String(subject);
    const perDim = this._perDimRobustMean(key);
    // 污染梯度：负面证据越强（μ 越负）该维梯度越大（对信任负贡献）
    const grad = this.dims.map((d) => -perDim[d]); // 梯度 = −证据均值
    // FTRL 单步更新权重（保持 w 变化温和，η 小）
    this.weights = ftrlStep(this.weights, grad, this.eta);

    // sigmoid 压缩：μ∈[-1,1] → (0,1)，先验偏移 c 使无证据时偏正常（约 0.77）
    // X_j = σ(5·μ_j + 1.2)：μ=-1→≈0.02（强污染压低），μ=0→≈0.77（无证据偏正常）
    const sigma = (x) => 1 / (1 + Math.exp(-(5 * x + 1.2)));
    const scores = this.dims.map((d) => sigma(perDim[d]));
    let thetaHat = 0;
    for (let j = 0; j < this.dims.length; j++) {
      thetaHat += this.weights[j] * scores[j];
    }
    return {
      thetaHat,
      weights: this.weights.slice(),
      perDim,
      scores,
      pollution: this.totalPollution(key),
    };
  }

  /**
   * 构件3：认证下界与信任操纵阈值 δ*
   * @param {string} subject
   * @param {number} delta ℓ∞ 扰动幅度（默认 0.1）
   * @returns {Object} { lowerBound, deltaStar, activeThreshold }
   */
  certifiedBound(subject, delta = 0.1) {
    const rt = this.robustTrust(subject);
    const lb = certifiedLowerBound(this.weights, rt.scores, this.sensitivity, delta);
    const ds = certifiedDeltaStar(this.weights, rt.scores, this.sensitivity, this.activeThreshold);
    return {
      lowerBound: lb,
      deltaStar: ds,
      activeThreshold: this.activeThreshold,
      thetaHat: rt.thetaHat,
    };
  }

  /**
   * 构件2：流行病学免疫裁决（与访问控制融合）
   * @param {string} subject
   * @param {number} thetaHat 对抗鲁棒信任（不传则内部计算）
   * @param {Function} [rng] 随机源
   * @returns {Object} { state, allow, restricted, reason, re, critical }
   */
  epiVerdict(subject, thetaHat, rng = Math.random) {
    const rt = thetaHat !== undefined ? { thetaHat } : this.robustTrust(subject);
    const t = Math.min(1, Math.max(0, rt.thetaHat));
    const state = this.seir.step(subject, t, rng);
    const re = this.seir.effectiveRegNumber(t);
    const critical = this.seir.criticalTrust();

    let allow = true;
    let restricted = false;
    let reason = '';
    let action = 'allow';

    if (state === EpiState.I) {
      // 感染：强制隔离（等同信任锁定，全拒）
      allow = false;
      restricted = true;
      action = 'quarantine';
      reason = `ARTII 免疫隔离：主体处于感染态(I)，信任 θ̂=${t.toFixed(2)}，全量拒绝`;
      this._recordQuarantine(subject, 'I', t, reason);
    } else if (t < this.lockThreshold) {
      // 信任锁定（对抗鲁棒评分过低，即使未激活也全拒）
      allow = false;
      restricted = true;
      action = 'lock';
      reason = `ARTII 信任锁定：θ̂=${t.toFixed(2)}<${this.lockThreshold}，全量拒绝`;
      this._recordQuarantine(subject, state, t, reason);
    } else if (state === EpiState.E) {
      // 暴露：只读降权（敏感动作受限）
      allow = true;
      restricted = true;
      action = 'readonly';
      reason = `ARTII 暴露降权：主体处于暴露态(E)，仅允许只读基础操作`;
    } else {
      reason = `ARTII 正常：状态=${state}，Re=${re.toFixed(2)}${critical !== null ? `（临界信任 ${critical.toFixed(2)}）` : '（恒免疫）'}`;
    }

    return { state, allow, restricted, reason, re, critical, action, thetaHat: t };
  }

  _recordQuarantine(subject, state, thetaHat, reason) {
    this._quarantines.push({
      subject: String(subject),
      state,
      thetaHat: Math.round(thetaHat * 100) / 100,
      reason,
      at: new Date().toISOString(),
    });
  }

  /**
   * 综合裁决（trust-engine 之外的一层叠加，供 dispatcher 调用）
   * 规则优先级：感染隔离/信任锁定（全拒）> 暴露只读 > 正常放行
   * @param {string} subject
   * @param {Object} opts { sensitiveAction?: boolean, rng? }
   * @returns {Object}
   */
  verdict(subject, opts = {}) {
    const rt = this.robustTrust(subject);
    const epi = this.epiVerdict(subject, rt.thetaHat, opts.rng || Math.random);
    const cb = this.certifiedBound(subject, 0.1);

    // 敏感动作在暴露态下受限
    let allow = epi.allow;
    let restricted = epi.restricted;
    let reason = epi.reason;
    let action = epi.action;
    if (epi.state === EpiState.E && opts.sensitiveAction) {
      allow = false;
      restricted = true;
      action = 'sensitive_deny';
      reason = `ARTII 暴露态敏感动作受限（θ̂=${rt.thetaHat.toFixed(2)}）`;
    }

    return {
      allow,
      restricted,
      reason,
      state: epi.state,
      thetaHat: rt.thetaHat,
      re: epi.re,
      critical: epi.critical,
      deltaStar: cb.deltaStar,
      certifiedLowerBound: cb.lowerBound,
      weights: rt.weights,
      action: epi.action,
    };
  }

  /** 隔离/锁定事件登记（管理端展示） */
  get quarantines() {
    return this._quarantines.slice();
  }

  /** 重置主体（管理员复核解封） */
  reset(subject) {
    const key = String(subject);
    this._evidence.delete(key);
    this._pollutionBudget.delete(key);
    this.seir.reset(key);
  }

  /** 已跟踪主体数 */
  size() {
    return this._evidence.size;
  }
}

module.exports = {
  ArtiiEngine,
  SeirMachine,
  EpiState,
  ToolState,
  median,
  mad,
  robustTruncate,
  robustMean,
  ftrlStep,
  projectSimplex,
  certifiedLowerBound,
  certifiedDeltaStar,
};
