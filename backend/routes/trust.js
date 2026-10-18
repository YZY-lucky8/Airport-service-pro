/**
 * 智能体劫持信任免疫 · 记忆层 3 接口（段琼馨 D3 交付）
 *
 * 接口清单（契约 v0.1，供决策层 trust-engine / 前端信任免疫面板对接）：
 *   1. POST /api/trust/check      —— 载荷污染检测：入站消息指纹比对 + 信任降权联动
 *   2. POST /api/trust/immune     —— 跨会话免疫：设置/查询免疫状态
 *   3. GET  /api/trust/trace      —— 事件溯源：血缘链 + 血缘日志查询
 *   4. GET  /api/trust/stats      —— 指纹库/信任状态统计（评测面板用）
 */
'use strict';

const express = require('express');
const router = express.Router();
const trustMemory = require('../memory/trust-memory');

let pool = null;
function initTrustRouter(p) {
  pool = p;
  trustMemory.setPool(p);
  return router;
}

// 统一响应包装
function ok(res, data, msg = 'ok') {
  res.json({ code: 0, msg, data });
}
function fail(res, msg, code = 1, status = 200) {
  res.status(status).json({ code, msg, data: null });
}

// ---------- 1. 载荷污染检测 ----------
router.post('/check', async (req, res) => {
  try {
    const { text, session_token, terminal_id } = req.body || {};
    if (!text || !session_token) return fail(res, '缺少 text 或 session_token');

    // 免疫期内直接放行（跨会话免疫）
    const imm = await trustMemory.getImmune(session_token);
    if (imm.immune) {
      return ok(res, {
        session_token,
        hit: false,
        immune: true,
        immune_reason: imm.reason,
        immune_until: imm.immune_until,
        trust: { score: imm.trust_score, state: imm.trust_state },
      }, '免疫期内，跳过污染检测');
    }

    // 指纹检测：SM3 精确 + SimHash 近似
    const result = await trustMemory.checkPollution(text, session_token);

    let trust = null;
    if (result.hit) {
      // 污染命中：行为维度降权（命中 1 次扣 0.12，敏感载荷按困难度加扣）
      const penalty = 0.12 + (result.source.detail_json ? 0 : 0);
      trust = await trustMemory.updateTrust(session_token, 'behavior', penalty, `pollution_hit:${result.source.source_uid}`);
      await trustMemory.logLineage('pollution_hit', {
        session_token,
        source_uid: result.source.source_uid,
        parent_uid: result.source.parent_uid || null,
        exact: result.exact,
        simhash_dist: result.simhash_dist || null,
        new_state: trust.state,
      });
    }

    return ok(res, {
      session_token,
      hit: result.hit,
      exact: result.exact,
      similar: result.similar,
      simhash_dist: result.simhash_dist || null,
      matched_source: result.hit ? {
        source_uid: result.source.source_uid,
        payload_type: result.source.payload_type,
        intent_tag: result.source.intent_tag,
        status: result.source.status,
      } : null,
      fingerprint: { sm3: result.fp.sm3.slice(0, 16) + '…', simhash: result.fp.simhash },
      trust,
    }, result.hit ? '检测到污染载荷' : '未命中污染指纹');
  } catch (e) {
    console.error('[trust/check] error:', e);
    fail(res, '检测失败: ' + e.message);
  }
});

// ---------- 2. 跨会话免疫 ----------
router.post('/immune', async (req, res) => {
  try {
    const { session_token, action, reason, duration_minutes, global_uid } = req.body || {};
    if (!session_token) return fail(res, '缺少 session_token');
    if (action === 'query') {
      const st = await trustMemory.getImmune(session_token);
      return ok(res, st, '免疫状态查询成功');
    }
    const result = await trustMemory.setImmune(session_token, {
      reason: reason || '人工免疫',
      duration_minutes: duration_minutes || 60,
      global_uid: global_uid || null,
    });
    return ok(res, result, '免疫设置成功');
  } catch (e) {
    console.error('[trust/immune] error:', e);
    fail(res, '免疫设置失败: ' + e.message);
  }
});

// ---------- 3. 事件溯源血缘 ----------
router.get('/trace', async (req, res) => {
  try {
    const { source_uid, session_token } = req.query || {};
    if (source_uid) {
      const lineage = await trustMemory.getLineage(source_uid);
      return ok(res, lineage, '血缘链查询成功');
    }
    if (session_token) {
      const events = await trustMemory.getSessionLineage(session_token);
      return ok(res, { session_token, events }, '会话血缘日志查询成功');
    }
    return fail(res, '缺少 source_uid 或 session_token');
  } catch (e) {
    console.error('[trust/trace] error:', e);
    fail(res, '血缘查询失败: ' + e.message);
  }
});

// ---------- 4. 统计（评测面板） ----------
router.get('/stats', async (req, res) => {
  try {
    const st = await trustMemory.stats();
    return ok(res, st, '统计查询成功');
  } catch (e) {
    console.error('[trust/stats] error:', e);
    fail(res, '统计查询失败: ' + e.message);
  }
});

// ---------- 5. 污染指纹列表（SOC 溯源中心，演示亮点） ----------
router.get('/pollution/list', async (req, res) => {
  try {
    const list = await trustMemory.listPollution();
    return ok(res, list, '污染指纹列表查询成功');
  } catch (e) {
    console.error('[trust/pollution/list] error:', e);
    fail(res, '污染指纹列表查询失败: ' + e.message);
  }
});

module.exports = { initTrustRouter, router };
