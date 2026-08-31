/* ============================================================
 * 页面7 · 系统管理 System
 * 数据源：
 *   /api/terminals                  终端在线状态
 *   /api/health                     健康检查（status/uptime/memory/db）
 *   /api/agent/llm/stats            LLM 用量统计
 *   /api/agent/llm/switch           LLM 模型切换（真实写审计）
 *   登录态/退出：/api/security/login（兼容）、/api/auth/login、/api/auth/logout、/api/security/logout
 *   保留既有能力入口：限流/Bloom/HMAC/白名单/关键服务（security.js 能力）
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;

  function html() {
    return `
    <div class="page-system">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">系统健康检查</div>
          <div id="sys-health"></div>
        </div>
        <div class="card">
          <div class="card-title">终端在线状态</div>
          <div id="sys-terminals"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">LLM 模型切换与用量统计</div>
        <div class="llm-block">
          <div class="llm-form">
            <input type="text" id="llm-provider" class="input" placeholder="Provider，如 deepseek" style="width:160px;">
            <input type="text" id="llm-model" class="input" placeholder="Model，如 deepseek-chat" style="width:200px;">
            <input type="password" id="llm-apikey" class="input" placeholder="API Key（可选）" style="width:200px;">
            <button class="btn btn-primary" id="btn-llm-switch">切换模型</button>
          </div>
          <div id="llm-stats" class="llm-stats"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">登录态与既有能力入口</div>
        <div class="sys-links">
          <button class="btn btn-ghost" id="btn-sys-logout">退出登录</button>
          <span class="hint">保留既有能力访问（原 security.html）：</span>
          <button class="btn btn-ghost" id="btn-legacy">打开原有安全中心</button>
          <button class="btn btn-ghost" id="btn-demo-overview">打开演示·态势大屏</button>
          <button class="btn btn-ghost" id="btn-demo-panel">打开演示·信任免疫面板</button>
          <button class="btn btn-ghost" id="btn-demo-trace">打开演示·溯源视图</button>
        </div>
      </div>
    </div>`;
  }

  async function loadHealth() {
    const box = document.getElementById('sys-health');
    const res = await api.apiGet('/api/health').catch(() => null);
    if (!res || !res.ok || !res.data) { box.innerHTML = '<div class="empty">健康检查接口不可用</div>'; return; }
    const d = res.data;
    const status = d.status === 'ok' ? 'badge-normal' : 'badge-danger';
    box.innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><td>服务状态</td><td><span class="badge ${status}">${d.status || '--'}</span></td></tr>
          <tr><td>运行时长</td><td>${d.uptime != null ? Math.round(d.uptime) + ' 秒' : '--'}</td></tr>
          <tr><td>内存</td><td>${d.memory ? JSON.stringify(d.memory) : '--'}</td></tr>
          <tr><td>数据库</td><td>${d.db ? JSON.stringify(d.db) : '--'}</td></tr>
          <tr><td>时间戳</td><td>${d.timestamp || '--'}</td></tr>
        </tbody>
      </table>`;
  }

  async function loadTerminals() {
    const box = document.getElementById('sys-terminals');
    const res = await api.apiGet('/api/terminals');
    const rows = res.ok && Array.isArray(res.data) ? res.data : [];
    if (rows.length === 0) { box.innerHTML = '<div class="empty">暂无终端数据</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>设备</th><th>位置</th><th>状态</th><th>最后心跳</th></tr></thead>
      <tbody>
        ${rows.map(t => `<tr>
          <td class="mono">${t.device_id}</td>
          <td>${t.location || '--'}</td>
          <td><span class="badge ${t.status === 'online' ? 'badge-normal' : 'badge-danger'}">${t.status || '--'}</span></td>
          <td>${t.last_heartbeat || '--'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  async function loadLlmStats() {
    const box = document.getElementById('llm-stats');
    const res = await api.apiGet('/api/agent/llm/stats').catch(() => null);
    if (!res || !res.ok) { box.innerHTML = '<div class="empty">LLM 统计接口不可用（无数据）</div>'; return; }
    const d = res.data;
    box.innerHTML = `<div class="llm-stats-row"><pre>${JSON.stringify(d, null, 2)}</pre></div>`;
  }

  window.SOC.pages.system = {
    render(container) {
      container.innerHTML = html();
      loadHealth();
      loadTerminals();
      loadLlmStats();
      document.getElementById('btn-llm-switch').addEventListener('click', async () => {
        const provider = document.getElementById('llm-provider').value.trim();
        const model = document.getElementById('llm-model').value.trim();
        const apiKey = document.getElementById('llm-apikey').value.trim();
        if (!provider || !model) { ui.toast('请填写 Provider 与 Model', 'error'); return; }
        const body = { provider, model };
        const u = api.getUser() || {};
        if (apiKey) body.apiKey = apiKey;
        body.approved_by = u.username || 'admin';
        const r = await api.apiPost('/api/agent/llm/switch', body);
        if (r.ok) { ui.toast(r.data?.message || r.msg || 'LLM 已切换', 'success'); loadLlmStats(); }
        else ui.toast(r.msg || '切换失败', 'error');
      });
      document.getElementById('btn-sys-logout').addEventListener('click', async () => {
        await api.apiPost('/api/security/logout').catch(() => null);
        await api.apiPost('/api/auth/logout').catch(() => null);
        api.clearAuth();
        SOC.router.gotoLogin();
      });
      document.getElementById('btn-legacy').addEventListener('click', () => { window.open('assets/security.html', '_blank'); });
      document.getElementById('btn-demo-overview').addEventListener('click', () => { window.open('../demo/index.html#/overview', '_blank'); });
      document.getElementById('btn-demo-panel').addEventListener('click', () => { window.open('../demo/index.html#/panel', '_blank'); });
      document.getElementById('btn-demo-trace').addEventListener('click', () => { window.open('../demo/index.html#/trace', '_blank'); });
    },
  };
})();
