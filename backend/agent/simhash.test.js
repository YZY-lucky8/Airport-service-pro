/**
 * simhash.test.js
 * 验证 SimHash 近似指纹能力：
 *   1. simhash 算法：相同内容 -> 相同指纹；不同内容 -> 指纹不同；
 *   2. 海明距离：轻微变体（加空格/大小写/等价改写）距离小，可归并；
 *   3. pollution-tracker 集成：simhash 类型的变体攻击归并到同一指纹家族，
 *      且 mergedCount 累计；明显不同的内容不归并。
 */
const { simhash, hamming, similarity, toHex } = require('./simhash');
const { PollutionTracker } = require('./pollution-tracker');

describe('simhash｜算法基础', () => {
  test('相同内容 -> 相同指纹', () => {
    const a = simhash("SELECT * FROM users WHERE id = 1 OR '1'='1'");
    const b = simhash("SELECT * FROM users WHERE id = 1 OR '1'='1'");
    expect(a).toBe(b);
  });

  test('不同内容 -> 指纹不同（海明距离明显）', () => {
    const a = simhash('正常业务查询');
    const b = simhash('恶意注入攻击负载');
    expect(hamming(a, b)).toBeGreaterThan(10);
  });

  test('轻微变体 -> 海明距离小（<= 阈值 6）', () => {
    const base = simhash("INSERT INTO logs VALUES('x'); -- 注入");
    const variant = simhash("INSERT INTO  logs VALUES('x');-- 注入");
    expect(hamming(base, variant)).toBeLessThanOrEqual(6);
  });

  test('toHex 输出稳定 64 位十六进制串（含 sim: 前缀）', () => {
    const v = simhash('abc');
    const h = toHex(v);
    expect(h.startsWith('sim:')).toBe(true);
    expect(h).toHaveLength(4 + 16);
  });
});

describe('pollution-tracker｜simhash 近似归并', () => {
  test('变体攻击归并到同一指纹家族，mergedCount 累计', () => {
    const t = new PollutionTracker();
    const base = "SELECT * FROM user WHERE name='admin' AND '1'='1'";
    const v1 = "SELECT * FROM user WHERE name='admin' AND '1' = '1'"; // 加空格
    const v2 = "SELECT  *  FROM user WHERE name='admin' AND '1'='1'"; // 双空格

    const e1 = t.register({ fingerprintType: 'simhash', sourceType: 'DIRECT_INJECTION', content: base, session: 's1', reason: '注入拦截' });
    const e2 = t.register({ fingerprintType: 'simhash', sourceType: 'DIRECT_INJECTION', content: v1, session: 's2', reason: '注入拦截(变体)' });
    const e3 = t.register({ fingerprintType: 'simhash', sourceType: 'DIRECT_INJECTION', content: v2, session: 's3', reason: '注入拦截(变体2)' });

    expect(e1.fingerprint).toBe(e2.fingerprint);
    expect(e1.fingerprint).toBe(e3.fingerprint);
    const list = t.list();
    expect(list).toHaveLength(1);
    expect(list[0].hitCount).toBe(3);
    expect(list[0].mergedCount).toBe(2);
    expect(list[0].crossSessionHits).toBe(3);
  });

  test('明显不同的攻击内容不归并，各自成指纹', () => {
    const t = new PollutionTracker();
    t.register({ fingerprintType: 'simhash', sourceType: 'DIRECT_INJECTION', content: "SELECT * FROM users WHERE '1'='1'", session: 's1' });
    t.register({ fingerprintType: 'simhash', sourceType: 'REPLAY_ATTACK', content: '重放攻击载荷', session: 's2' });
    expect(t.size()).toBe(2);
  });

  test('sm3 精确摘要行为不受影响（向后兼容）', () => {
    const t = new PollutionTracker();
    const e1 = t.register({ fingerprintType: 'sm3', sourceType: 'DIRECT_INJECTION', content: 'SELECT 1', session: 's1' });
    const e2 = t.register({ fingerprintType: 'sm3', sourceType: 'DIRECT_INJECTION', content: 'SELECT 1', session: 's2' });
    // 完全相同内容 -> 同一指纹，hitCount=2
    expect(e1.fingerprint).toBe(e2.fingerprint);
    expect(t.list()[0].hitCount).toBe(2);
    // 加空格 -> 精确摘要不同 -> 新指纹
    t.register({ fingerprintType: 'sm3', sourceType: 'DIRECT_INJECTION', content: 'SELECT  1', session: 's3' });
    expect(t.size()).toBe(2);
  });
});
