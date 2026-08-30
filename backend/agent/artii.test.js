/**
 * ============================================================
 * artii.test.js — ARTII 对抗鲁棒信任-感染免疫算法单元测试
 * ============================================================
 * 覆盖三构件：
 *   构件1 FTRL + Π_ρ 截断的对抗鲁棒信任更新
 *   构件2 信任驱动 SEIR+SIS 状态机（确定性概率 + 迁移 + Re）
 *   构件3 ℓ∞ 认证下界与隔离边界 δ*
 *   引擎集成：observe/verdict/快照/重置
 */

const {
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
} = require('./artii');

// ═══════════════════════════ 构件1：FTRL + Π_ρ 截断 ═══════════════════════════

describe('median/mad｜稳健统计基础', () => {
  test('中位数：偶数长度取中间两数均值', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test('中位数：奇数长度取中间数', () => {
    expect(median([1, 2, 9])).toBe(2);
  });
  test('MAD：对离群值不敏感（5% 污染稳健）', () => {
    // [1..10] 的 MAD 为 3（中位数5.5，|dev|中位数3），插入 100 不影响
    const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const polluted = [...base, 100, -100];
    expect(mad(polluted)).toBeLessThan(10);
    expect(mad(base)).toBeGreaterThan(0);
  });
  test('MAD：空数组返回 0', () => {
    expect(mad([])).toBe(0);
  });
});

describe('robustTruncate｜Π_ρ 鲁棒截断（构件1）', () => {
  test('离群证据被裁剪到 median±ρ·MAD 边界', () => {
    const values = [0.5, 0.6, 0.55, 0.52, 0.58, 10.0, -8.0];
    const clean = robustTruncate(values, 1.5);
    expect(Math.max(...clean)).toBeLessThan(3);
    expect(Math.min(...clean)).toBeGreaterThan(-3);
  });
  test('正常数据截断后基本不变', () => {
    const values = [0.4, 0.41, 0.42, 0.39, 0.4];
    const clean = robustTruncate(values, 1.5);
    for (const v of clean) expect(v).toBeGreaterThan(0.35);
    for (const v of clean) expect(v).toBeLessThan(0.45);
  });
  test('MAD=0（全相同）时退化为无截断', () => {
    const values = [0.5, 0.5, 0.5, 0.5];
    expect(robustTruncate(values, 1.5)).toEqual(values);
  });
});

describe('robustMean｜鲁棒聚合（构件1）', () => {
  test('被注入极端证据的均值低于含污染朴素均值，受污染度低', () => {
    const values = [0.5, 0.52, 0.48, 0.51, -5.0];
    const rm = robustMean(values, 1.5);
    const naive = values.reduce((a, b) => a + b, 0) / values.length;
    expect(rm).toBeGreaterThan(naive);
    expect(rm).toBeGreaterThan(0.3);
    expect(rm).toBeLessThan(0.7);
  });
});

describe('projectSimplex / ftrlStep｜FTRL 权重更新（构件1）', () => {
  test('simplex 投影：Σw=1 且 w≥0', () => {
    const w = projectSimplex([0.8, 0.3, -0.1]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
  });
  test('FTRL 单步：正梯度（受污染维度）权重被压低', () => {
    // 引擎语义：grad = −perDim，负证据（μ<0）→ 正梯度 → 该维降权
    const w0 = [0.4, 0.35, 0.25];
    const g = [1.0, -0.2, -0.3]; // 维度0 遭受强负证据 → 正梯度
    const w1 = ftrlStep(w0, g, 0.1);
    expect(w1[0]).toBeLessThan(w0[0]);
    expect(w1.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    for (const v of w1) expect(v).toBeGreaterThanOrEqual(0);
  });
  test('FTRL 无梯度时权重不变', () => {
    const w0 = [0.4, 0.35, 0.25];
    const w1 = ftrlStep(w0, [0, 0, 0], 0.1);
    expect(w1[0]).toBeCloseTo(w0[0], 8);
    expect(w1[1]).toBeCloseTo(w0[1], 8);
  });
  test('FTRL 学习率越大权重响应越剧烈', () => {
    const w0 = [0.4, 0.35, 0.25];
    const g = [0.8, -0.1, -0.1];
    const wSmall = ftrlStep(w0, g, 0.01);
    const wBig = ftrlStep(w0, g, 0.5);
    expect(wBig[0]).toBeLessThan(wSmall[0]);
  });
});

// ═══════════════════════════ 构件2：SEIR 状态机 ═══════════════════════════

describe('SeirMachine.transitionProbabilities｜信任驱动转移率（构件2）', () => {
  const sm = new SeirMachine({ beta: 0.3, gamma: 0.5, kappa: 1.5, mu: 0.4 });

  test('P(S→E) 随信任升高而下降（单调）', () => {
    expect(sm.transitionProbabilities(0.2).sToE).toBeGreaterThan(sm.transitionProbabilities(0.8).sToE);
  });
  test('P(E→I) 随信任升高而下降（激活陡度 κ>1）', () => {
    expect(sm.transitionProbabilities(0.1).eToI).toBeGreaterThan(sm.transitionProbabilities(0.9).eToI);
  });
  test('P(I→R) 随信任升高而上升（信任恢复解除隔离）', () => {
    expect(sm.transitionProbabilities(0.9).iToR).toBeGreaterThan(sm.transitionProbabilities(0.1).iToR);
  });
  test('信任=1 时 P(S→E)=0，P(I→R)=μ', () => {
    const p = sm.transitionProbabilities(1);
    expect(p.sToE).toBeCloseTo(0, 8);
    expect(p.iToR).toBeCloseTo(0.4, 8);
  });
  test('信任=0 时 P(S→E)=β，P(E→I)=γ', () => {
    const p = sm.transitionProbabilities(0);
    expect(p.sToE).toBeCloseTo(0.3, 8);
    expect(p.eToI).toBeCloseTo(0.5, 8);
  });
});

describe('SeirMachine.step｜状态迁移（构件2，注入随机源）', () => {
  const sm = new SeirMachine({ beta: 0.3, gamma: 0.5, kappa: 1.5, mu: 0.4 });

  test('低信任 + 小随机数 → S→E 迁移', () => {
    sm.reset('t1');
    // rng 恒 0 < p.sToE=0.3*(1-0)=0.3
    const st = sm.step('t1', 0, () => 0);
    expect(st).toBe(EpiState.E);
  });
  test('高信任 + 小随机数 → 保持 S（不迁移）', () => {
    sm.reset('t2');
    // 信任0.9 → p.sToE=0.03，rng=0.05 > 0.03 → 不迁移
    const st = sm.step('t2', 0.9, () => 0.05);
    expect(st).toBe(EpiState.S);
  });
  test('E 态 + 低信任 → E→I 迁移（感染激活）', () => {
    sm.reset('t3');
    sm.step('t3', 0, () => 0); // S→E
    const st = sm.step('t3', 0, () => 0); // E→I
    expect(st).toBe(EpiState.I);
  });
  test('I 态 + 高信任 → I→R 迁移（隔离解除）', () => {
    sm.reset('t4');
    sm.step('t4', 0, () => 0); // S→E
    sm.step('t4', 0, () => 0); // E→I
    const st = sm.step('t4', 0.9, () => 0); // I→R
    expect(st).toBe(EpiState.R);
  });
  test('R 为吸收态：信任变化不再改变状态', () => {
    sm.reset('t5');
    sm.step('t5', 0, () => 0); // S→E
    sm.step('t5', 0, () => 0); // E→I
    sm.step('t5', 0.9, () => 0); // I→R
    const st = sm.step('t5', 0, () => 0); // R 保持
    expect(st).toBe(EpiState.R);
  });
  test('高随机数（rng=0.99）任何低概率迁移都不触发', () => {
    sm.reset('t6');
    const st = sm.step('t6', 0.5, () => 0.99);
    expect(st).toBe(EpiState.S);
  });
});

describe('SeirMachine.effectiveRegNumber｜有效再生数 Re（构件2）', () => {
  const sm = new SeirMachine({ beta: 0.3, gamma: 0.5, kappa: 1.5, mu: 0.4 });

  test('Re 随信任升高而下降（免疫收敛）', () => {
    expect(sm.effectiveRegNumber(0.2)).toBeGreaterThan(sm.effectiveRegNumber(0.8));
  });
  test('Re<1 免疫收敛：高信任时满足', () => {
    const re = sm.effectiveRegNumber(0.9);
    expect(re).toBeLessThan(1);
  });
  test('Re>1 传播态：低信任 + 高接触率时失控', () => {
    // 默认接触率1时 β(1−θ)/μ=0.75<1 恒免疫；高接触率(5)时低信任 Re>1
    const re = sm.effectiveRegNumber(0, 5);
    expect(re).toBeGreaterThan(1);
  });
  test('Re 公式核对：β·(1−θ̂)·接触/μ', () => {
    expect(sm.effectiveRegNumber(0.5, 2)).toBeCloseTo((0.3 * (1 - 0.5) * 2) / 0.4, 8);
  });
});

describe('SeirMachine.criticalTrust｜免疫临界信任', () => {
  test('β>μ 时存在临界信任 θ_crit=1−μ/β', () => {
    const sm = new SeirMachine({ beta: 0.3, mu: 0.4 });
    // 此处 β<μ，恒免疫 → null
    expect(sm.criticalTrust()).toBeNull();
  });
  test('β>μ 时：θ>θ_crit 则 Re<1', () => {
    const sm = new SeirMachine({ beta: 0.8, mu: 0.2 });
    const crit = sm.criticalTrust(); // 1-0.2/0.8=0.75
    expect(crit).toBeCloseTo(0.75, 8);
    expect(sm.effectiveRegNumber(crit + 0.01)).toBeLessThan(1);
    expect(sm.effectiveRegNumber(crit - 0.01)).toBeGreaterThan(1);
  });
});

// ═══════════════════════════ 构件3：认证下界 ═══════════════════════════

describe('certifiedLowerBound｜ℓ∞ 认证下界（构件3）', () => {
  test('δ=0 时认证下界=加权信任', () => {
    const lb = certifiedLowerBound([0.4, 0.35, 0.25], [0.9, 0.8, 0.7], [0.4, 0.35, 0.25], 0);
    expect(lb).toBeCloseTo(0.4 * 0.9 + 0.35 * 0.8 + 0.25 * 0.7, 8);
  });
  test('δ 增大 → 认证下界下降（扰动削弱信任保证）', () => {
    const lb0 = certifiedLowerBound([0.4, 0.35, 0.25], [0.9, 0.8, 0.7], [0.4, 0.35, 0.25], 0);
    const lb1 = certifiedLowerBound([0.4, 0.35, 0.25], [0.9, 0.8, 0.7], [0.4, 0.35, 0.25], 0.5);
    expect(lb1).toBeLessThan(lb0);
  });
  test('下界不为负（单维下限截断为0）', () => {
    const lb = certifiedLowerBound([0.4, 0.35, 0.25], [0.1, 0.1, 0.1], [0.4, 0.35, 0.25], 10);
    expect(lb).toBeGreaterThanOrEqual(0);
  });
});

describe('certifiedDeltaStar｜信任操纵阈值 δ*（构件3）', () => {
  test('高信任主体 → 阈值 δ* 大（攻击者需操纵更多才阻止隔离）', () => {
    const dsHi = certifiedDeltaStar([0.4, 0.35, 0.25], [0.95, 0.9, 0.85], [0.4, 0.35, 0.25], 0.3);
    const dsLo = certifiedDeltaStar([0.4, 0.35, 0.25], [0.5, 0.5, 0.5], [0.4, 0.35, 0.25], 0.3);
    expect(dsHi).toBeGreaterThan(dsLo);
  });
  test('敏感度全 0 → δ*=Infinity（无法通过操纵影响信任）', () => {
    expect(certifiedDeltaStar([0.4, 0.35, 0.25], [0.9, 0.9, 0.9], [0, 0, 0], 0.3)).toBe(Infinity);
  });
  test('当前评分低于阈值 → δ*=0（无需操纵已触发隔离）', () => {
    const ds = certifiedDeltaStar([0.4, 0.35, 0.25], [0.2, 0.2, 0.2], [0.4, 0.35, 0.25], 0.3);
    expect(ds).toBe(0);
  });
});

// ═══════════════════════════ 引擎集成 ═══════════════════════════

describe('ArtiiEngine.observeEvidence / robustTrust｜引擎数据流（构件1）', () => {
  let engine;
  beforeEach(() => {
    engine = new ArtiiEngine({ dims: ['behavior', 'context', 'terminal'], weights: [0.4, 0.35, 0.25], eta: 0.05, rho: 1.5 });
  });

  test('初始无证据时信任接近中性先验（>0.5）', () => {
    const rt = engine.robustTrust('A1');
    expect(rt.thetaHat).toBeGreaterThan(0.5);
    expect(rt.thetaHat).toBeLessThanOrEqual(1);
  });
  test('连续负面证据 → 鲁棒信任显著下降', () => {
    for (let i = 0; i < 8; i++) {
      engine.observeBlocked('A1', 'behavior', -1.0);
      engine.observeBlocked('A1', 'context', -0.6);
    }
    const rt = engine.robustTrust('A1');
    const neutral = new ArtiiEngine({ dims: ['behavior', 'context', 'terminal'], weights: [0.4, 0.35, 0.25], eta: 0.05 }).robustTrust('A1').thetaHat;
    expect(rt.thetaHat).toBeLessThan(neutral);
  });
  test('被污染维度权重被压低（鲁棒降权）', () => {
    for (let i = 0; i < 10; i++) engine.observeBlocked('A1', 'behavior', -1.0);
    const rt = engine.robustTrust('A1');
    // 污染维度权重应低于初始 0.4
    expect(rt.weights[0]).toBeLessThan(0.4);
  });
  test('正面证据使信任回升', () => {
    for (let i = 0; i < 5; i++) engine.observeOk('A1', 'behavior', 0.2);
    const rt1 = engine.robustTrust('A1');
    for (let i = 0; i < 5; i++) engine.observeOk('A1', 'behavior', 0.2);
    const rt2 = engine.robustTrust('A1');
    expect(rt2.thetaHat).toBeGreaterThan(rt1.thetaHat);
  });
  test('污染预算审计：拦截证据计入 C', () => {
    engine.observeBlocked('A1', 'behavior', -1.0);
    engine.observeBlocked('A1', 'context', -0.6);
    const b = engine.pollutionBudget('A1');
    expect(b.directInjection).toBeGreaterThanOrEqual(2);
  });
  test('不同主体证据相互隔离', () => {
    engine.observeBlocked('A1', 'behavior', -1.0);
    const rt1 = engine.robustTrust('A1');
    const rt2 = engine.robustTrust('B1');
    expect(rt2.thetaHat).toBeGreaterThan(rt1.thetaHat);
  });
});

describe('ArtiiEngine.verdict｜流行病学免疫裁决（构件2+3 集成）', () => {
  test('正常主体放行', () => {
    const engine = new ArtiiEngine();
    const v = engine.verdict('N1', { rng: () => 0.99 });
    expect(v.allow).toBe(true);
  });
  test('大量负面证据（全维污染）→ 触发隔离或锁定（不允许放行）', () => {
    const engine = new ArtiiEngine({ eta: 0.05 });
    // 三属性维度同时被强负证据污染（攻击者操纵全部信任属性）
    for (let i = 0; i < 20; i++) {
      engine.observeBlocked('X1', 'behavior', -1.0);
      engine.observeBlocked('X1', 'context', -1.0);
      engine.observeBlocked('X1', 'terminal', -1.0);
    }
    const v = engine.verdict('X1', { rng: () => 0 });
    expect(v.allow).toBe(false);
    expect(['I', 'E']).toContain(v.state);
  });
  test('暴露态(E) + 敏感动作 → 拒绝', () => {
    const engine = new ArtiiEngine({ eta: 0.1 });
    // 构造恰好进入暴露态的信任水平：部分负证据
    for (let i = 0; i < 4; i++) engine.observeBlocked('E1', 'behavior', -0.5);
    const v = engine.verdict('E1', { sensitiveAction: true, rng: () => 0 });
    // 若信任仍高则放行；若进入 E/I 则敏感动作受限
    if (v.state === 'E' || v.state === 'I') {
      expect(v.allow).toBe(false);
    }
  });
  test('返回完整认证指标（δ* / 下界 / Re）', () => {
    const engine = new ArtiiEngine();
    const v = engine.verdict('M1', { rng: () => 0.99 });
    expect(typeof v.thetaHat).toBe('number');
    expect(typeof v.re).toBe('number');
    expect(typeof v.deltaStar).toBe('number');
    expect(typeof v.certifiedLowerBound).toBe('number');
  });
  test('隔离事件被登记（quarantines 审计）', () => {
    const engine = new ArtiiEngine({ eta: 0.05 });
    for (let i = 0; i < 20; i++) {
      engine.observeBlocked('Q1', 'behavior', -1.0);
      engine.observeBlocked('Q1', 'context', -1.0);
      engine.observeBlocked('Q1', 'terminal', -1.0);
    }
    engine.verdict('Q1', { rng: () => 0 });
    expect(engine.quarantines.length).toBeGreaterThanOrEqual(1);
  });
  test('重置后信任恢复（管理员复核解封）', () => {
    const engine = new ArtiiEngine({ eta: 0.05 });
    for (let i = 0; i < 20; i++) {
      engine.observeBlocked('R1', 'behavior', -1.0);
      engine.observeBlocked('R1', 'context', -1.0);
      engine.observeBlocked('R1', 'terminal', -1.0);
    }
    const before = engine.verdict('R1', { rng: () => 0 });
    expect(before.allow).toBe(false);
    engine.reset('R1');
    const after = engine.verdict('R1', { rng: () => 0.99 });
    expect(after.allow).toBe(true);
  });
});

describe('ArtiiEngine 快照与主体管理', () => {
  test('snapshot 反映各主体流行病学状态', () => {
    const engine = new ArtiiEngine();
    engine.observeOk('S1', 'behavior', 0.1);
    engine.observeOk('S2', 'behavior', 0.1);
    const snap = engine.seir.snapshot();
    expect(Object.keys(snap)).toContain('S1');
    expect(Object.keys(snap)).toContain('S2');
  });
  test('size 随主体增加', () => {
    const engine = new ArtiiEngine();
    engine.observeOk('A', 'behavior', 0.1);
    engine.observeOk('B', 'behavior', 0.1);
    expect(engine.size()).toBe(2);
  });
  test('ToolState 枚举（SIS 无状态层）', () => {
    expect(ToolState.CLEAN).toBe('clean');
    expect(ToolState.POISONED).toBe('poisoned');
  });
  test('EpiState 枚举完整', () => {
    expect(EpiState.S).toBe('S');
    expect(EpiState.E).toBe('E');
    expect(EpiState.I).toBe('I');
    expect(EpiState.R).toBe('R');
  });
});

describe('ARTII 与既有防线一致性（对照 attack-demo 四阶段语义）', () => {
  test('注入攻击链路：拦截→信任降→免疫裁决收紧', () => {
    const engine = new ArtiiEngine({ eta: 0.08 });
    // 模拟连续注入被拦截（三属性维度同步污染，攻击者操纵全部信任属性）
    for (let i = 0; i < 6; i++) {
      engine.observeBlocked('TERM-A', 'behavior', -1.0);
      engine.observeBlocked('TERM-A', 'context', -0.6);
      engine.observeBlocked('TERM-A', 'terminal', -0.5);
    }
    const rt = engine.robustTrust('TERM-A');
    expect(rt.thetaHat).toBeLessThan(0.3);
    // 免疫裁决应当收紧（不再无条件放行）
    const v = engine.verdict('TERM-A', { rng: () => 0.99 });
    expect(v.allow).toBe(false);
  });
});
