/* ============================================================
 * 恒盾智航 SOC · API 封装层
 * - 统一 token 管理（localStorage）
 * - apiGet / apiPost 自动注入 Authorization: Bearer
 * - 兼容三种响应包装：{success:true,data} / {code:0,msg,data} / 裸对象
 * - 401 统一跳回登录
 * ============================================================ */
'use strict';

window.SOC = window.SOC || {};

(function () {
  const TOKEN_KEY = 'soc_token';
  const USER_KEY = 'soc_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token || '');
    localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
  }
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function buildQuery(params) {
    const p = params || {};
    const qs = Object.keys(p)
      .filter(k => p[k] !== undefined && p[k] !== null && p[k] !== '')
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
      .join('&');
    return qs ? '?' + qs : '';
  }

  // 统一解析：返回 { ok, data, msg, raw }
  function parseResponse(raw) {
    if (raw && typeof raw === 'object') {
      if (raw.success === true && 'data' in raw) return { ok: true, data: raw.data, msg: raw.message || raw.msg || 'ok', raw };
      if (raw.code === 0 && 'data' in raw) return { ok: true, data: raw.data, msg: raw.msg || 'ok', raw };
      if (raw.success === true) return { ok: true, data: raw.data !== undefined ? raw.data : raw, msg: raw.message || 'ok', raw };
      if (raw.code === 0) return { ok: true, data: raw.data !== undefined ? raw.data : raw, msg: raw.msg || 'ok', raw };
      if (raw.error) return { ok: false, data: null, msg: raw.error, raw };
      if (raw.message) return { ok: false, data: null, msg: raw.message, raw };
      // 裸数据对象（如 /api/health 直接返回 status 字段）
      return { ok: true, data: raw, msg: 'ok', raw };
    }
    return { ok: true, data: raw, msg: 'ok', raw };
  }

  function handle401(res) {
    if (res.status === 401) {
      clearAuth();
      if (window.SOC.router) window.SOC.router.gotoLogin();
      return true;
    }
    return false;
  }

  async function request(method, path, payload, params) {
    const url = path + buildQuery(params);
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
    } catch (e) {
      return { ok: false, data: null, msg: '网络错误：无法连接后端（' + e.message + '）', raw: null, http: 0 };
    }
    if (handle401(res)) {
      return { ok: false, data: null, msg: '登录已失效，请重新登录', raw: null, http: 401 };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
    const parsed = parseResponse(json);
    parsed.http = res.status;
    if (!parsed.ok && res.status === 503) parsed.msg = parsed.msg || '后端服务未就绪（Agent 未初始化）';
    return parsed;
  }

  async function apiGet(path, params) { return request('GET', path, undefined, params); }
  async function apiPost(path, payload, params) { return request('POST', path, payload || {}, params); }
  async function apiPut(path, payload, params) { return request('PUT', path, payload || {}, params); }

  // 文件下载（带鉴权），返回 Promise<void>；失败抛错
  async function apiDownload(path, params, filename) {
    const token = getToken();
    const res = await fetch(path + buildQuery(params), {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (res.status === 401) { clearAuth(); if (window.SOC.router) window.SOC.router.gotoLogin(); throw new Error('登录已失效'); }
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // 纯前端 CSV 导出（用于无后端导出接口的数据，如 pep_decision_log）
  function csvFromRows(headers, rows, filename) {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // 时间格式化（兼容时间戳/ISO/字符串）
  function fmtTime(v) {
    if (v === null || v === undefined || v === '') return '--';
    let d;
    if (typeof v === 'number') d = new Date(v);
    else if (typeof v === 'string') {
      if (/^\d+$/.test(v.trim())) d = new Date(Number(v));
      else { d = new Date(v.replace(/-/g, '/')); }
    } else d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  SOC.api = {
    getToken, getUser, setAuth, clearAuth,
    apiGet, apiPost, apiPut, apiDownload, csvFromRows, fmtTime,
  };
})();
