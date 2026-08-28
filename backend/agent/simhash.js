/**
 * ============================================================
 * SimHash 近似指纹（污染指纹家族归并核心）
 * ============================================================
 * 用途：对攻击内容生成 64 位 SimHash 指纹，同一家族的变体攻击
 *       （如注入语句小幅改写、加空格/大小写混淆）指纹海明距离较小，
 *       据此可将"变体攻击"归并到同一条污染指纹，实现抗混淆的
 *       攻击家族识别。
 *
 * 算法要点：
 *   - tokenize：字符 n-gram（默认 bigram），对中文/英文混合内容均有效；
 *   - 每 token 取 sha256 前 8 字节作为 64 位哈希；
 *   - 64 维权重向量按 token 哈希各位累加（位=1 则 +1，否则 -1）；
 *   - 符号位汇聚为 64 位 BigInt 指纹；
 *   - 海明距离 <= SIMHASH_THRESHOLD 视为同一家族（可归并）。
 * ============================================================
 */

const crypto = require('crypto');

/** 默认归并阈值：64 位海明距离（unigram 下加空格/大小写变体经验值 <=6） */
const SIMHASH_THRESHOLD = 6;

/** 字符 n-gram 分词 */
function tokenize(text, n = 2) {
  const s = String(text === null || text === undefined ? '' : text);
  const out = [];
  for (let i = 0; i <= s.length - n; i++) {
    out.push(s.slice(i, i + n));
  }
  return out;
}

/** 对 token 生成 64 位哈希（sha256 前 8 字节） */
function hash64(token) {
  const h = crypto.createHash('sha256').update(String(token)).digest();
  return h.readBigUInt64BE(0);
}

/**
 * 计算文本的 64 位 SimHash 指纹
 * @param {string} text
 * @param {Object} [opts] { gram?: number }
 * @returns {bigint}
 */
function simhash(text, { gram = 1 } = {}) {
  const toks = tokenize(text, gram);
  const vec = new Array(64).fill(0);
  for (const t of toks) {
    const h = hash64(t);
    for (let b = 0; b < 64; b++) {
      if ((h >> BigInt(b)) & 1n) vec[b] += 1;
      else vec[b] -= 1;
    }
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) {
    if (vec[b] > 0) out |= 1n << BigInt(b);
  }
  return out;
}

/** 二进制 1 的个数 */
function popcount(x) {
  let c = 0;
  while (x) {
    x &= x - 1n;
    c++;
  }
  return c;
}

/** 两个 SimHash 指纹的海明距离 */
function hamming(a, b) {
  return popcount(a ^ b);
}

/** 归一化相似度 0~1 */
function similarity(a, b) {
  return 1 - hamming(a, b) / 64;
}

/** 指纹转稳定十六进制串（含 sim: 前缀，用于指纹库主键展示） */
function toHex(v) {
  return 'sim:' + v.toString(16).padStart(16, '0');
}

module.exports = { simhash, hamming, similarity, toHex, tokenize, SIMHASH_THRESHOLD };
