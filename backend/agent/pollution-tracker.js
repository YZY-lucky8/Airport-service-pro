/**
 * ============================================================
 * 污染指纹注册表 (Pollution Tracker)
 * ============================================================
 * 轻量内存注册表：在 guardrail 拦截 / PEP 拒绝 / 信任降权等
 * 防御动作命中时登记攻击指纹，供安全大屏展示污染指纹清单、
 * 攻击类型分布等。
 *
 * 纯内存实现（无 DB 依赖），单进程内有效，零外部依赖。
 * 字段：
 *   id              注册表自增标识（稳定唯一）
 *   fingerprint     内容/会话特征的指纹值（sha256 摘要前 32 位）
 *   fingerprintType sm3（精确摘要）| simhash（近似指纹）
 *   sourceType      攻击来源类型（5 类固定枚举）
 *   firstSeen       首次发现时间（ISO）
 *   lastSeen        最近命中时间（ISO）
 *   hitCount        累计命中次数
 *   crossSessionHits 跨会话命中数（按会话去重）
 *   immune          是否免疫（默认 false，可标记不再告警）
 *   lastReason      最近一次命中的拦截原因
 * ============================================================
 */

const crypto = require('crypto');
const { simhash, hamming, toHex, SIMHASH_THRESHOLD } = require('./simhash');

/** 攻击来源类型固定枚举（与 overview/attack-distribution 一致） */
const SOURCE_TYPES = Object.freeze({
  DIRECT_INJECTION: 'direct-injection',
  INDIRECT_INJECTION: 'indirect-injection',
  CONFUSION_BYPASS: 'confusion-bypass',
  PRIVILEGE_ESCALATION: 'privilege-escalation',
  REPLAY_ATTACK: 'replay-attack',
});

class PollutionTracker {
  constructor() {
    this._fps = new Map(); // fingerprint -> entry
    this._simValues = new Map(); // fingerprint -> simhash 数值（供近似归并比对）
    this._seq = 0;
  }

  /** 对输入内容生成稳定指纹（sha256 摘要前 32 位） */
  static hash(input) {
    if (input === null || input === undefined) input = '';
    return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 32);
  }

  /**
   * 登记一条污染指纹（命中防御动作时调用）
   * @param {Object} opts
   *   @param {string} opts.fingerprint  指纹值（不传则按 fingerprintType 自动计算）
   *   @param {string} opts.fingerprintType sm3（精确摘要）| simhash（近似指纹，默认 sm3）
   *   @param {string} opts.sourceType   攻击来源类型（SOURCE_TYPES 之一）
   *   @param {string} opts.content      原始内容（生成指纹用）
   *   @param {string} opts.session      会话/主体标识（用于跨会话去重）
   *   @param {string} opts.reason       拦截原因（写入 lastReason）
   *   @param {bigint} [opts.simValue]   显式传入的 simhash 数值（指纹类型为 simhash 时优先使用）
   * @returns {Object} 当前指纹条目（外部可读）
   */
  register({ fingerprint, fingerprintType = 'sm3', sourceType, content = '', session = 'unknown', reason = '', simValue }) {
    let fp = fingerprint;
    let approxMerged = false;

    // SimHash 近似指纹：未显式给 fingerprint 时，与已登记指纹做海明距离归并，
    // 使"变体攻击"归并到同一家族指纹，抗混淆。
    if (!fp && fingerprintType === 'simhash') {
      const value = simValue !== undefined ? simValue : simhash(content);
      for (const [existingFp, v] of this._simValues) {
        if (hamming(value, v) <= SIMHASH_THRESHOLD) {
          fp = existingFp;
          approxMerged = true;
          break;
        }
      }
      if (!approxMerged) fp = toHex(value);
    }

    fp = fp || PollutionTracker.hash(content + '|' + sourceType);
    const now = new Date().toISOString();

    if (this._fps.has(fp)) {
      const entry = this._fps.get(fp);
      entry.hitCount += 1;
      entry.lastSeen = now;
      if (reason) entry.lastReason = reason;
      // 跨会话去重：记录出现过的会话集合
      if (session && !entry.sessions.has(String(session))) {
        entry.sessions.add(String(session));
      }
      entry.crossSessionHits = entry.sessions.size;
      // 近似归并命中数（变体攻击合并统计）
      if (approxMerged) entry.mergedCount = (entry.mergedCount || 0) + 1;
      return entry;
    }

    const entry = {
      id: `${Date.now().toString(36)}-${(++this._seq).toString(36)}`,
      fingerprint: fp,
      fingerprintType,
      sourceType: SOURCE_TYPES[sourceType] || sourceType,
      firstSeen: now,
      lastSeen: now,
      hitCount: 1,
      sessions: new Set([String(session)]),
      crossSessionHits: 1,
      immune: false,
      lastReason: reason || '',
    };
    this._fps.set(fp, entry);
    // 记录 simhash 数值供后续近似归并比对
    if (fingerprintType === 'simhash') {
      this._simValues.set(fp, simValue !== undefined ? simValue : simhash(content));
    }
    return entry;
  }

  /** 导出指纹清单（按 firstSeen 降序，新→旧） */
  list() {
    const out = [];
    for (const e of this._fps.values()) {
      out.push({
        id: e.id,
        fingerprint: e.fingerprint,
        fingerprintType: e.fingerprintType,
        sourceType: e.sourceType,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
        hitCount: e.hitCount,
        crossSessionHits: e.crossSessionHits,
        mergedCount: e.mergedCount || 0,
        immune: e.immune,
        reason: e.lastReason,
        // 命中过的会话标识（供溯源血缘链构建）
        sessions: Array.from(e.sessions),
      });
    }
    out.sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : -1));
    return out;
  }

  /** 按 sourceType 聚合命中数（用于 attack-distribution） */
  countsBySource() {
    const map = {};
    for (const e of this._fps.values()) {
      map[e.sourceType] = (map[e.sourceType] || 0) + e.hitCount;
    }
    return map;
  }

  /** 总拦截命中数 */
  totalBlocked() {
    let n = 0;
    for (const e of this._fps.values()) n += e.hitCount;
    return n;
  }

  /** 标记免疫（白名单化，不再告警） */
  setImmune(fingerprint, immune = true) {
    const e = this._fps.get(fingerprint);
    if (e) e.immune = !!immune;
    return e || null;
  }

  /** 已登记指纹数 */
  size() {
    return this._fps.size;
  }
}

module.exports = { PollutionTracker, SOURCE_TYPES };
