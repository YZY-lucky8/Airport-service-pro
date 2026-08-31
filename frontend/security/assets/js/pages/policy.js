/* ============================================================
 * 页面5 · 自适应策略管理 Policy
 * 数据源：
 *   /api/agent/threshold/status      当前阈值 + Agent 建议
 *   /api/agent/threshold/history     阈值变更历史 + 审计轨迹
 *   /api/agent/threshold/set-mode    手动/Agent 接管切换
 *   /api/agent/threshold/adjust      手动调整单个阈值
 *   /api/agent/threshold/apply-agent 一键应用 Agent 建议
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  let configs = [];

  function html() {
    return `
    <div class="page-policy">
      <div class="toolbar">
        <div class="filter-group">
          <span class="hint">阈值管理模式：</span>
          <button class="btn btn-ghost" id="btn-mode-manual">切至人工模式</button>
          <button class="btn btn-ghost" id="btn-mode-agent">切至 Agent 接管</button>
          <span id="mode-current" class="hint"></span>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-primary" id="btn-apply-agent">一键应用全部 Agent 建议</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">AI 建议卡片（Agent 建议值 / 触发原因 / 置信度）</div>
        <div id="suggest-cards"></div>
      </div>
      <div class="card">
        <div class="card-title">当前阈值配置</div>
        <div id="config-table"></div>
      </div>
      <div class="card">
        <div class="card-title">阈值变更历史 + 审计轨迹</div>
        <div id="history-table"></div>
      </div>
    </div>`;
  }

  async function load() {
    const [statusR, histR] = await Promise.all([
      api.apiGet('/api/agent/threshold/status'),
      api.apiGet('/api/agent/threshold/history', { limit: 50 }),
    ]);
    configs = statusR.ok && Array.isArray(statusR.data) ? statusR.data : [];
    renderSuggestCards();
    renderConfigTable();
    renderHistory(histR.ok && Array.isArray(histR.data) ? histR.data : []);
  }

  function renderSuggestCards() {
    const box = document.getElementById('suggest-cards');
    const hasSuggest = configs.filter(c => c.agent_suggested_value != null && String(c.agent_suggested_value) !== String(c.config_value));
    if (hasSuggest.length === 0) {
      box.innerHTML = '<div class="empty">当前无待应用的 Agent 建议（阈值与建议一致）</div>';
      return;
    }
    box.innerHTML = hasSuggest.map(c => `
      <div class="suggest-card">
        <div class="s-card-head">
          <b>${c.config_key}</b>
          <span class="badge badge-plain">置信度 ${c.confidence != null ? Math.round(c.confidence * 100) : '--'}%</span>
        </div>
        <div class="s-card-row">当前值 <b>${c.config_value}</b> → 建议值 <b class="s-new">${c.agent_suggested_value}</b></div>
        <div class="s-card-reason">${c.suggestion_reason || 'Agent 建议调整'}</div>
        <button class="btn btn-primary btn-sm" data-key="${c.config_key}" data-val="${c.agent_suggested_value}">应用此建议</button>
      </div>`).join('');
    box.querySelectorAll('[data-key]').forEach(btn => btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-key');
      const val = btn.getAttribute('data-val');
      const r = await api.apiPost('/api/agent/threshold/adjust', { threshold_key: key, new_value: val });
      if (r.ok) { ui.toast(r.data?.message || r.msg || `已应用 ${key}=${val}`, 'success'); load(); }
      else ui.toast(r.msg || '应用失败', 'error');
    }));
  }

  function renderConfigTable() {
    const box = document.getElementById('config-table');
    if (configs.length === 0) { box.innerHTML = '<div class="empty">暂无阈值配置</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>配置项</th><th>当前值</th><th>Agent 建议值</th><th>建议原因</th><th>操作</th></tr></thead>
      <tbody>
        ${configs.map(c => `<tr>
          <td class="mono">${c.config_key}</td>
          <td><b>${c.config_value}</b></td>
          <td>${c.agent_suggested_value != null ? c.agent_suggested_value : '—'}</td>
          <td>${c.suggestion_reason || '—'}</td>
          <td>
            <input type="text" class="input input-sm" id="nv-${c.config_key}" value="${c.config_value}" style="width:90px;">
            <button class="btn btn-ghost btn-sm" data-adj="${c.config_key}">手动应用</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
    box.querySelectorAll('[data-adj]').forEach(btn => btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-adj');
      const val = document.getElementById('nv-' + key).value.trim();
      if (val === '') { ui.toast('请输入新值', 'error'); return; }
      const r = await api.apiPost('/api/agent/threshold/adjust', { threshold_key: key, new_value: val });
      if (r.ok) { ui.toast(r.data?.message || r.msg || `已更新 ${key}=${val}`, 'success'); load(); }
      else ui.toast(r.msg || '更新失败', 'error');
    }));
  }

  function renderHistory(rows) {
    const box = document.getElementById('history-table');
    if (rows.length === 0) { box.innerHTML = '<div class="empty">暂无变更历史</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>时间</th><th>配置项</th><th>旧值</th><th>新值</th><th>建议来源</th><th>置信度</th><th>原因</th><th>状态</th></tr></thead>
      <tbody>
        ${rows.map(h => `<tr>
          <td>${h.applied_at || '--'}</td>
          <td class="mono">${h.threshold_key}</td>
          <td>${h.old_value}</td>
          <td><b>${h.new_value}</b></td>
          <td>${h.suggested_by || '--'}</td>
          <td>${h.confidence != null ? Math.round(h.confidence * 100) + '%' : '--'}</td>
          <td>${h.reason || '--'}</td>
          <td><span class="badge badge-normal">${h.status || 'applied'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  window.SOC.pages.policy = {
    render(container) {
      container.innerHTML = html();
      document.getElementById('btn-mode-manual').addEventListener('click', async () => {
        const r = await api.apiPost('/api/agent/threshold/set-mode', { mode: 'manual' });
        if (r.ok) { ui.toast(r.data?.message || r.msg || '已切至人工模式', 'success'); document.getElementById('mode-current').textContent = '当前模式：人工'; }
        else ui.toast(r.msg || '切换失败', 'error');
      });
      document.getElementById('btn-mode-agent').addEventListener('click', async () => {
        const r = await api.apiPost('/api/agent/threshold/set-mode', { mode: 'agent' });
        if (r.ok) { ui.toast(r.data?.message || r.msg || 'Agent 已接管', 'success'); document.getElementById('mode-current').textContent = '当前模式：Agent 接管'; }
        else ui.toast(r.msg || '切换失败', 'error');
      });
      document.getElementById('btn-apply-agent').addEventListener('click', async () => {
        const r = await api.apiPost('/api/agent/threshold/apply-agent', {});
        if (r.ok) {
          const n = r.data?.changes ? r.data.changes.length : 0;
          ui.toast(`已应用 ${n} 项 Agent 建议`, 'success');
          load();
        } else ui.toast(r.msg || '应用失败', 'error');
      });
      load();
    },
  };
})();
