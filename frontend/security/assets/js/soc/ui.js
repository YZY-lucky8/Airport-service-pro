/* ============================================================
 * 恒盾智航 SOC · 通用 UI 组件层
 * modal / toast / 表格渲染 / 徽章 / 空状态 / ECharts 便捷初始化
 * ============================================================ */
'use strict';

window.SOC = window.SOC || {};
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, type) {
    const t = type || 'info';
    let box = $('#soc-toast');
    if (!box) {
      box = el(`<div id="soc-toast" style="position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;"></div>`);
      document.body.appendChild(box);
    }
    const color = t === 'success' ? 'var(--green)' : t === 'error' ? 'var(--red)' : t === 'warn' ? 'var(--orange)' : 'var(--cyan)';
    const item = el(`<div style="background:var(--bg-2);border:1px solid ${color};color:var(--text-hi);padding:10px 18px;font-size:13px;border-radius:2px;box-shadow:0 0 20px rgba(0,0,0,.5);max-width:480px;line-height:1.5;">${String(msg).replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`);
    box.appendChild(item);
    setTimeout(() => { item.style.opacity = '0'; item.style.transition = 'opacity .4s'; }, 3200);
    setTimeout(() => item.remove(), 3700);
  }

  // ---------- Modal ----------
  function openModal(title, bodyHtml, footHtml) {
    const mask = $('#modal-mask');
    const box = $('#modal-box');
    mask.style.display = 'flex';
    box.style.display = 'block';
    box.innerHTML = `
      <div class="modal-title"><span>${title}</span><span class="modal-close" id="modal-close">×</span></div>
      <div id="modal-body">${bodyHtml || ''}</div>
      <div class="modal-foot" id="modal-foot">${footHtml || ''}</div>
    `;
    $('#modal-close', box).onclick = closeModal;
    mask.onclick = (e) => { if (e.target === mask) closeModal(); };
    return box;
  }
  function closeModal() {
    $('#modal-mask').style.display = 'none';
    $('#modal-box').style.display = 'none';
  }

  // ---------- 徽章 ----------
  function trustLevelBadge(level) {
    const m = { normal: ['badge-normal', 'NORMAL'], degraded: ['badge-degraded', 'DEGRADED'], locked: ['badge-locked', 'LOCKED'] };
    const c = m[level] || ['badge-muted', String(level || '--').toUpperCase()];
    return `<span class="badge ${c[0]}">${c[1]}</span>`;
  }
  function immuneBadge(st) {
    const s = String(st || '').toUpperCase();
    const cls = s === 'I' ? 'badge-ok' : s === 'S' || s === 'E' ? 'badge-warn' : 'badge-muted';
    const label = { I: 'I 免疫', S: 'S 监控', E: 'E 评估', R: 'R 解除', N: 'N 正常' }[s] || s || '--';
    return `<span class="badge ${cls}">${label}</span>`;
  }
  function resultBadge(allowed) {
    return allowed == 0
      ? `<span class="badge badge-danger">拒绝</span>`
      : `<span class="badge badge-ok">放行</span>`;
  }
  function boolBadge(v, trueLabel, falseLabel) {
    return v
      ? `<span class="badge badge-ok">${trueLabel || '是'}</span>`
      : `<span class="badge badge-muted">${falseLabel || '否'}</span>`;
  }
  function statusBadge(status) {
    const s = String(status || '');
    if (/online|在线|正常|active|ok|成功/.test(s)) return `<span class="badge badge-ok">${s}</span>`;
    if (/fault|故障|异常|danger|error/.test(s)) return `<span class="badge badge-danger">${s}</span>`;
    if (/offline|离线/.test(s)) return `<span class="badge badge-muted">${s}</span>`;
    if (/warning|降级|degraded|warn/.test(s)) return `<span class="badge badge-warn">${s}</span>`;
    return `<span class="badge badge-info">${s || '--'}</span>`;
  }

  // ---------- 表格 ----------
  // cols: [{key,label,render(width?)}]  data: 数组
  function renderTable(container, cols, data, opts) {
    const o = opts || {};
    if (!data || data.length === 0) {
      container.innerHTML = `<div class="empty">${o.emptyText || '暂无数据'}</div>`;
      return;
    }
    const head = cols.map(c => `<th>${c.label}</th>`).join('');
    const body = data.map((row, i) => {
      const tds = cols.map(c => `<td>${c.render ? c.render(row, i) : (row[c.key] ?? '--')}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    container.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------- 空 / 加载 ----------
  function empty(text) { return `<div class="empty">${text || '暂无数据'}</div>`; }
  function loading(text) { return `<div class="loading"><span class="spin"></span> ${text || '加载中…'}</div>`; }

  // ---------- ECharts ----------
  const chartCache = {};
  function echarts() { return window.echarts; }
  function chart(elId, option) {
    if (!window.echarts) { console.warn('ECharts 未加载'); return null; }
    let inst = chartCache[elId];
    if (!inst) {
      const dom = document.getElementById(elId);
      if (!dom) return null;
      inst = window.echarts.init(dom);
      chartCache[elId] = inst;
    }
    inst.setOption(option, true);
    return inst;
  }
  function disposeChart(elId) {
    if (chartCache[elId]) { chartCache[elId].dispose(); delete chartCache[elId]; }
  }
  // 通用浅色 SOC 配色
  const PALETTE = ['#2fb8ff', '#4d7cfe', '#22c993', '#ffa726', '#8b7cf6', '#ff4d5e', '#5fd0c7', '#9aa7c7'];
  function axisStyle() {
    return {
      axisLine: { lineStyle: { color: '#23406b' } },
      axisLabel: { color: '#8ba3c4', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(56,89,138,.25)' } },
    };
  }

  // 打开新标签（页面跳转，统一走 hash 路由）
  function go(route) { window.location.hash = route; }

  // 全局便捷引用（供 app.js 等模块解构使用）
  SOC.$ = $;
  SOC.$$ = $$;

  SOC.ui = {
    $, $$, el, toast, openModal, closeModal,
    trustLevelBadge, immuneBadge, resultBadge, boolBadge, statusBadge,
    renderTable, empty, loading, chart, disposeChart, chartCache, PALETTE, axisStyle, go,
  };
})();
