/**
 * 智能体劫持信任免疫 · 记忆层核心模块（段琼馨 D3 交付）
 *
 * 功能：
 *  1. 信任会话（trust_session）三维信任建模与状态流转（normal/downgraded/locked）
 *  2. 污染指纹库（pollution_source）登记、SM3 精确命中 + SimHash 近似命中
 *  3. 跨会话免疫（immune_until / immune_global_until）
 *  4. 事件溯源血缘日志（lineage_log：命中/免疫/传播全链路）
 *  5. 攻击载荷库（backend/payloads/*.json）加载与指纹化入库
 *
 * 依赖：db-adapter pool（兼容 SQLite / MySQL 双模式）
 */
'use strict';

const fp = require('./fingerprint');
const path = require('path');
const fs = require('fs');

// 三维信任权重（与决策层 trust-engine 契约对齐，0.4/0.35/0.25）
const DIM_WEIGHTS = { prompt: 0.4, behavior: 0.35, immune: 0.25 };
const STATE_NORMAL = 'normal';
const STATE_DOWNGRADED = 'downgraded';
const STATE_LOCKED = 'locked';

let pool = null;

function setPool(p) { pool = p; }

// db-adapter pool.query 返回 [rows]，统一解构
async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ============================================================
// 工具函数
// ============================================================
function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function genUid(prefix) {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${rand}`;
}

// 计算三维信任总分（0~100），支持单维修正
function calcTrustScore(dims) {
  return Math.max(0, Math.min(100,
    dims.prompt * 100 * DIM_WEIGHTS.prompt +
    dims.behavior * 100 * DIM_WEIGHTS.behavior +
    dims.immune * 100 * DIM_WEIGHTS.immune
  ));
}

// 根据分数判定状态
function stateFromScore(score, thresholds) {
  if (score < thresholds.lock) return STATE_LOCKED;
  if (score < thresholds.downgrade) return STATE_DOWNGRADED;
  return STATE_NORMAL;
}

// 血缘日志写入（事件溯源）
async function logLineage(event, payload) {
  if (!pool) return;
  const ts = nowStr();
  const detail = JSON.stringify(payload || {});
  try {
    await pool.execute(
      `INSERT INTO lineage_log (event_type, session_token, source_uid, parent_uid, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [event, payload?.session_token || null, payload?.source_uid || null, payload?.parent_uid || null, detail, ts]
    );
  } catch (e) {
    console.log('[trust-memory] lineage log error:', e.message);
  }
}

// ============================================================
// 1. 信任会话管理
// ============================================================
async function getOrCreateSession(session_token, opts = {}) {
  let rows = await q('SELECT * FROM trust_session WHERE session_token = ?', [session_token]);
  if (rows.length === 0) {
    await pool.execute(
      `INSERT INTO trust_session (session_token, passenger_id, terminal_id, dim_prompt_trust, dim_behavior_trust, dim_immune_trust, trust_score, trust_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session_token, opts.passenger_id || null, opts.terminal_id || null,
       0.40, 0.35, 0.25, 100, STATE_NORMAL, nowStr(), nowStr()]
    );
    rows = await q('SELECT * FROM trust_session WHERE session_token = ?', [session_token]);
  }
  return rows[0];
}

// 更新单维信任值并重算总分/状态
async function updateTrust(session_token, dim, delta, reason) {
  const session = await getOrCreateSession(session_token);
  const cur = {
    prompt: session.dim_prompt_trust,
    behavior: session.dim_behavior_trust,
    immune: session.dim_immune_trust,
  };
  // 污染扣分：单维最多扣到 0，扣分幅度为 0.12（对应总分 12 分/次，敏感操作可叠加）
  const newVal = Math.max(0, Math.min(1, cur[dim] - (delta || 0.12)));
  cur[dim] = newVal;
  const score = calcTrustScore(cur);
  const state = stateFromScore(score, {
    downgrade: session.threshold_downgrade,
    lock: session.threshold_lock,
  });
  await pool.execute(
    `UPDATE trust_session SET dim_${dim}_trust = ?, trust_score = ?, trust_state = ?,
       pollution_hit_count = pollution_hit_count + 1, last_pollution_at = ?, updated_at = ?
     WHERE session_token = ?`,
    [newVal, score, state, nowStr(), nowStr(), session_token]
  );
  await logLineage('trust_update', { session_token, dim, newVal, score, state, reason });
  return { score, state, dims: cur };
}

// ============================================================
// 2. 污染指纹检测与登记
// ============================================================
/**
 * 检测一条消息是否命中污染指纹库
 * 返回 { hit, exact, similar, source, fp }
 */
async function checkPollution(text, session_token) {
  const f = fp.computeFingerprint(String(text || ''));
  // SM3 精确命中
  const exact = await q('SELECT * FROM pollution_source WHERE finger_sm3 = ?', [f.sm3]);
  if (exact.length > 0) {
    await bumpHit(exact[0], session_token);
    return { hit: true, exact: true, similar: false, source: exact[0], fp: f };
  }
  // SimHash 近似命中（全表扫描比对海明距离；正式可加 simhash 分桶索引）
  const all = await q('SELECT * FROM pollution_source WHERE status != ?', ['suppressed']);
  let best = null, bestDist = Infinity;
  for (const row of all) {
    const d = fp.hammingDistance(f.simhash, row.finger_simhash);
    if (d < bestDist) { bestDist = d; best = row; }
  }
  if (best && bestDist <= fp.SIMHASH_THRESHOLD) {
    await bumpHit(best, session_token);
    return { hit: true, exact: false, similar: true, simhash_dist: bestDist, source: best, fp: f };
  }
  return { hit: false, exact: false, similar: false, simhash_dist: best ? bestDist : null, fp: f };
}

async function bumpHit(source, session_token) {
  await pool.execute(
    `UPDATE pollution_source SET hit_count = hit_count + 1, last_seen = ?, origin_session_token = COALESCE(origin_session_token, ?) WHERE id = ?`,
    [nowStr(), session_token, source.id]
  );
}

/**
 * 登记新污染源（载荷指纹入库）
 * @param {object} p {text, type, intent_tag, parent_uid, origin_session_token, origin_terminal_id}
 */
async function registerPollution(p) {
  const f = fp.computeFingerprint(p.text);
  const uid = genUid('POLL');
  let parentId = null, parentUid = null;
  if (p.parent_uid) {
    const parent = await q('SELECT id FROM pollution_source WHERE source_uid = ?', [p.parent_uid]);
    if (parent.length > 0) { parentId = parent[0].id; parentUid = p.parent_uid; }
  }
  await pool.execute(
    `INSERT INTO pollution_source (source_uid, finger_sm3, finger_simhash, payload_type, intent_tag, payload_len, payload_sample, origin_session_token, origin_terminal_id, parent_id, first_seen, last_seen, hit_count, status, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
    [uid, f.sm3, f.simhash, p.type || 'direct', p.intent_tag || 'unknown',
     String(p.text).length, String(p.text).slice(0, 200),
     p.origin_session_token || null, p.origin_terminal_id || null, parentId,
     nowStr(), nowStr(), JSON.stringify({ source: 'register', obfuscation: p.obfuscation || null }), nowStr()]
  );
  await logLineage('source_registered', { source_uid: uid, parent_uid: parentUid, payload_type: p.type });
  return { source_uid: uid, ...f };
}

// ============================================================
// 3. 跨会话免疫
// ============================================================
/**
 * 为会话设置跨会话免疫（免疫期内不再扣信任）
 * @param {string} session_token
 * @param {object} opts {reason, duration_minutes, global_uid?}
 */
async function setImmune(session_token, opts = {}) {
  const session = await getOrCreateSession(session_token);
  const d = new Date(Date.now() + (opts.duration_minutes || 60) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const until = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  await pool.execute(
    `UPDATE trust_session SET immune_until = ?, immune_reason = ?, updated_at = ? WHERE session_token = ?`,
    [until, opts.reason || '人工免疫', nowStr(), session_token]
  );
  if (opts.global_uid) {
    await pool.execute(
      `UPDATE pollution_source SET status = 'immunized', immune_global_until = ? WHERE source_uid = ?`,
      [until, opts.global_uid]
    );
  }
  await logLineage('immune_set', { session_token, source_uid: opts.global_uid, until, reason: opts.reason });
  return { session_token, immune_until: until, reason: opts.reason, global_uid: opts.global_uid || null };
}

/** 查询会话免疫状态 */
async function getImmune(session_token) {
  const rows = await q(
    `SELECT session_token, immune_until, immune_reason, trust_score, trust_state FROM trust_session WHERE session_token = ?`,
    [session_token]
  );
  if (rows.length === 0) return { session_token, immune: false, reason: null };
  const r = rows[0];
  const now = new Date();
  const until = r.immune_until ? new Date(r.immune_until.replace(' ', 'T')) : null;
  const immune = !!until && until > now;
  return { session_token, immune, reason: r.immune_reason, immune_until: r.immune_until, trust_score: r.trust_score, trust_state: r.trust_state };
}

/** 是否处于免疫期（供决策层调用） */
async function isImmune(session_token) {
  const st = await getImmune(session_token);
  return st.immune;
}

// ============================================================
// 4. 事件溯源血缘日志查询
// ============================================================
/** 按 source_uid 递归回溯血缘链（parent 链路） */
async function getLineage(source_uid) {
  const chain = [];
  let cur = await q('SELECT * FROM pollution_source WHERE source_uid = ?', [source_uid]);
  if (cur.length === 0) return { root: null, chain: [], events: [] };
  let node = cur[0];
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.push(node);
    if (node.parent_id) {
      const parent = await q('SELECT * FROM pollution_source WHERE id = ?', [node.parent_id]);
      node = parent.length > 0 ? parent[0] : null;
    } else node = null;
  }
  const events = await q(
    `SELECT * FROM lineage_log WHERE source_uid = ? OR session_token IN (SELECT origin_session_token FROM pollution_source WHERE source_uid = ?) ORDER BY id ASC`,
    [source_uid, source_uid]
  );
  return { root: chain.length ? chain[chain.length - 1].source_uid : null, chain, events };
}

/** 查询某会话的完整血缘事件流 */
async function getSessionLineage(session_token) {
  return q('SELECT * FROM lineage_log WHERE session_token = ? ORDER BY id ASC', [session_token]);
}

// ============================================================
// 5. 攻击载荷库加载与入库（量化评测数据源）
// ============================================================
const PAYLOAD_DIR = path.join(__dirname, '..', 'payloads');
const PAYLOAD_FILES = ['direct.json', 'indirect.json', 'obfuscated.json'];

function loadPayloadLibrary() {
  const lib = { direct: [], indirect: [], obfuscated: [], total: 0 };
  for (const file of PAYLOAD_FILES) {
    const type = file.replace('.json', '');
    const full = path.join(PAYLOAD_DIR, file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    lib[type] = data.payloads || [];
    lib.total += lib[type].length;
  }
  return lib;
}

/** 将载荷库全部指纹化入库（幂等：按 source_uid 唯一） */
async function seedPayloadLibrary(opts = {}) {
  const lib = loadPayloadLibrary();
  let inserted = 0, skipped = 0;
  for (const type of ['direct', 'indirect', 'obfuscated']) {
    for (const p of lib[type]) {
      const exists = await q('SELECT id FROM pollution_source WHERE source_uid = ?', [p.id]);
      if (exists.length > 0) { skipped++; continue; }
      const f = fp.computeFingerprint(p.text);
      const parentId = null;
      await pool.execute(
        `INSERT INTO pollution_source (source_uid, finger_sm3, finger_simhash, payload_type, intent_tag, payload_len, payload_sample, origin_session_token, origin_terminal_id, parent_id, first_seen, last_seen, hit_count, status, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, 'active', ?, ?)`,
        [p.id, f.sm3, f.simhash, p.type, p.intent_tag, p.text.length, p.text.slice(0, 200), parentId,
         nowStr(), null, JSON.stringify({ source: 'payload_library', difficulty: p.difficulty, obfuscation: p.obfuscation || null }), nowStr()]
      );
      inserted++;
    }
  }
  return { total: lib.total, inserted, skipped, types: { direct: lib.direct.length, indirect: lib.indirect.length, obfuscated: lib.obfuscated.length } };
}

/** 统计指纹库概况 */
async function stats() {
  const total = await q('SELECT COUNT(*) AS c FROM pollution_source');
  const byType = await q('SELECT payload_type, COUNT(*) AS c FROM pollution_source GROUP BY payload_type');
  const sessions = await q('SELECT COUNT(*) AS c FROM trust_session');
  const states = await q('SELECT trust_state, COUNT(*) AS c FROM trust_session GROUP BY trust_state');
  const events = await q('SELECT COUNT(*) AS c FROM lineage_log');
  return {
    pollution_total: total[0]?.c || 0,
    pollution_by_type: byType,
    session_total: sessions[0]?.c || 0,
    session_by_state: states,
    lineage_events: events[0]?.c || 0,
  };
}

module.exports = {
  setPool, DIM_WEIGHTS, STATE_NORMAL, STATE_DOWNGRADED, STATE_LOCKED,
  calcTrustScore, stateFromScore, logLineage,
  getOrCreateSession, updateTrust, checkPollution, registerPollution,
  setImmune, getImmune, isImmune,
  getLineage, getSessionLineage,
  loadPayloadLibrary, seedPayloadLibrary, stats,
};
