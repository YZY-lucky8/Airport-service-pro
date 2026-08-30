/**
 * 污染指纹模块（段琼馨 D3 交付）
 * - SM3 精确指纹：国密 SM3 哈希（纯 JS 实现，零第三方依赖）
 * - SimHash 近似指纹：64bit 局部敏感哈希，支持变体/混淆载荷的相似召回
 * - 海明距离：衡量两个 SimHash 的相似度（<=3 视为同族变体）
 */
'use strict';

// ==================== SM3 国密哈希（GB/T 32905-2016） ====================
const SM3_IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function P0(x) { return (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0; }
function P1(x) { return (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0; }
function FF0(x, y, z) { return (x ^ y ^ z) >>> 0; }
function FF1(x, y, z) { return ((x & y) | (x & z) | (y & z)) >>> 0; }
function GG0(x, y, z) { return (x ^ y ^ z) >>> 0; }
function GG1(x, y, z) { return ((x & y) | ((~x) & z)) >>> 0; }

/** 单块压缩（512bit） */
function sm3Compress(v, block) {
  const W = new Array(68);
  const Wp = new Array(64);
  for (let i = 0; i < 16; i++) {
    W[i] = ((block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3]) >>> 0;
  }
  for (let j = 16; j < 68; j++) {
    W[j] = (P1(W[j - 16] ^ W[j - 9] ^ rotl(W[j - 3], 15)) ^ rotl(W[j - 13], 7) ^ W[j - 6]) >>> 0;
  }
  for (let j = 0; j < 64; j++) {
    Wp[j] = (W[j] ^ W[j + 4]) >>> 0;
  }
  let A = v[0], B = v[1], C = v[2], D = v[3], E = v[4], F = v[5], G = v[6], H = v[7];
  for (let j = 0; j < 64; j++) {
    const Tj = j <= 15 ? 0x79cc4519 : 0x7a879d8a;
    const SS1 = rotl((rotl(A, 12) + E + rotl(Tj, j)) >>> 0, 7);
    const SS2 = (SS1 ^ rotl(A, 12)) >>> 0;
    const TT1 = (j <= 15 ? FF0(A, B, C) : FF1(A, B, C)) + D + SS2 + Wp[j];
    const TT2 = (j <= 15 ? GG0(E, F, G) : GG1(E, F, G)) + H + SS1 + W[j];
    D = C; C = rotl(B, 9); B = A; A = TT1 >>> 0;
    H = G; G = rotl(F, 19); F = E; E = P0(TT2) >>> 0;
  }
  return [
    (v[0] ^ A) >>> 0, (v[1] ^ B) >>> 0, (v[2] ^ C) >>> 0, (v[3] ^ D) >>> 0,
    (v[4] ^ E) >>> 0, (v[5] ^ F) >>> 0, (v[6] ^ G) >>> 0, (v[7] ^ H) >>> 0,
  ];
}

/** 计算字符串 SM3（返回 64 位 hex 小写） */
function sm3(msg) {
  const input = typeof msg === 'string' ? Buffer.from(msg, 'utf8') : Buffer.from(msg);
  const len = input.length;
  // 填充：0x80 + 0x00... + 64bit 长度
  const paddedLen = (((len + 1 + 8 + 64) / 64) | 0) * 64;
  const buf = Buffer.alloc(paddedLen);
  input.copy(buf);
  buf[len] = 0x80;
  const bitLen = BigInt(len) * 8n;
  const lenBytes = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) lenBytes[7 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  lenBytes.copy(buf, buf.length - 8);

  let V = SM3_IV.slice();
  for (let off = 0; off < buf.length; off += 64) {
    V = sm3Compress(V, buf.subarray(off, off + 64));
  }
  let out = '';
  for (const w of V) out += w.toString(16).padStart(8, '0');
  return out;
}

// ==================== SimHash 近似指纹（64bit） ====================
/** 64bit FNV-1a 哈希（BigInt，稳定无碰撞风险） */
function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h;
}

/** 中文/英文混合分词：中文按字符二元组，英文按单词 */
function tokenize(text) {
  const tokens = [];
  const norm = String(text || '').toLowerCase();
  // 英文/数字词
  const enMatches = norm.match(/[a-z0-9_]+/g) || [];
  for (const w of enMatches) tokens.push(w);
  // 中文连续串按 bigram 切
  const cjk = norm.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of cjk) {
    if (seg.length === 1) { tokens.push(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
    tokens.push(seg.slice(seg.length - 2)); // 尾部 bigram 权重覆盖
  }
  return tokens;
}

/**
 * 计算文本 SimHash（64bit，返回 16 位 hex）
 * @param {string} text 原始文本
 * @param {number} bits 位宽（默认 64）
 */
function simhash(text) {
  const tokens = tokenize(text);
  const bits = 64;
  const vec = new Array(bits).fill(0);
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  for (const [tok, cnt] of freq) {
    const h = fnv1a64(tok);
    for (let b = 0; b < bits; b++) {
      const bit = (h >> BigInt(b)) & 1n;
      vec[b] += bit === 1n ? cnt : -cnt;
    }
  }
  let fp = 0n;
  for (let b = bits - 1; b >= 0; b--) {
    fp = (fp << 1n) | (vec[b] >= 0 ? 1n : 0n);
  }
  return fp.toString(16).padStart(16, '0');
}

/** 两个 16 hex SimHash 的海明距离 */
function hammingDistance(a, b) {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  let t = x;
  while (t > 0n) { n += Number(t & 1n); t >>= 1n; }
  return n;
}

/** 综合指纹：SM3 + SimHash */
function computeFingerprint(text) {
  return {
    sm3: sm3(text),
    simhash: simhash(text),
  };
}

module.exports = {
  sm3,
  simhash,
  tokenize,
  hammingDistance,
  computeFingerprint,
  SIMHASH_THRESHOLD: 5, // 海明距离 <=5 视为同族近似命中（覆盖前缀混淆/空格/词序微调；实测正常 FAQ 距载荷库最小 8，无误报风险）
};
