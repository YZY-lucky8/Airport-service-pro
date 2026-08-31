/* ============================================================
 * 页面6 · 告警处理中心 Alerts
 * 数据源：
 *   GET  /api/alerts               统一告警入口（id/level/terminal_id/time/content/status/handler/note）
 *   PUT  /api/alerts/:id           处理工作流状态写入后端（pending/processing/closed + handler/note）
 *   处理工作流（待处理→处理中→已闭环，处理人+备注）：
 *     保存时真实调用后端 PUT 持久化，成功后刷新列表；
 *     后端不可用时降级写入 localStorage 本地兜底展示。
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  const LS_KEY = 'soc_alert_workflow';
  let alerts = [];
  let workflow = {};

  function loadWorkflow() {
    try { workflow = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { workflow = {}; }
  }
  function saveWorkflow() { localStorage.setItem(LS_KEY, JSON.stringify(workflow)); }

  function html() {
    return `
    <div class="page-alerts">
      <div class="toolbar">
        <div class="filter-group">
          <select id="al-level" class="input">
            <option value="">全部级别</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <select id="al-status" class="input">
            <option value="">全部状态</option>
            <option value="pending">待处理</option>
            <option value="processing">处理中</option>
            <option value="closed">已闭环</option>
          </select>
          <button class="btn btn-primary" id="btn-al-refresh">刷新</button>
        </div>
        <div class="toolbar-right">
          <span class="hint">点击告警可跳转至对应处置页面</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">统一告警中心 <span class="hint" id="al-total"></span></div>
        <div id="al-table"></div>
      </div>
    </div>
    <div class="modal-mask" id="al-modal-mask" style="display:none;">
      <div class="modal">
        <div class="modal-head">处理告警</div>
        <div class="modal-body">
          <div class="form-row"><label>告警内容</label><div id="al-modal-content" class="al-content"></div></div>
          <div class="form-row"><label>处理状态</label>
            <select id="al-modal-status" class="input">
              <option value="pending">待处理</option>
              <option value="processing">处理中</option>
              <option value="closed">已闭环</option>
            </select>
          </div>
          <div class="form-row"><label>处理人</label><input type="text" id="al-modal-owner" class="input" placeholder="处理人"></div>
          <div class="form-row"><label>备注</label><textarea id="al-modal-note" class="input" rows="3" placeholder="处理备注"></textarea></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" id="al-modal-cancel">取消</button>
          <button class="btn btn-primary" id="al-modal-save">保存</button>
        </div>
      </div>
    </div>`;
  }

  // 后端 status 归一化：数据库旧值 unhandled/handled → 前端工作流语义
  function normStatus(s) {
    if (s === 'closed' || s === 'processing' || s === 'pending') return s;
    if (s === 'handled') return 'closed';
    return 'pending';
  }
  // 取告警的有效工作流状态：优先本地兜底 workflow，其次后端字段
  function effWorkflow(a, key) {
    const local = workflow[key] || {};
    return {
      status: local.status || normStatus(a.status),
      owner: local.owner || a.handler || '',
      note: local.note || a.note || '',
      localOnly: !!local.status,
    };
  }

  function renderTable() {
    const box = document.getElementById('al-table');
    const lv = document.getElementById('al-level').value;
    const st = document.getElementById('al-status').value;
    const list = alerts.filter(a => {
      if (lv && String(a.level).toLowerCase() !== lv) return false;
      const key = String(a.id || a.time || a.content);
      const w = effWorkflow(a, key);
      if (st && w.status !== st) return false;
      return true;
    });
    document.getElementById('al-total').textContent = `共 ${list.length} 条`;
    if (list.length === 0) { box.innerHTML = '<div class="empty">暂无告警</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>级别</th><th>告警内容</th><th>终端</th><th>时间</th><th>状态</th><th>处理人</th><th>操作</th></tr></thead>
      <tbody>
        ${list.map(a => {
          const key = String(a.id || a.time || a.content);
          const w = effWorkflow(a, key);
          const lvCls = String(a.level).toLowerCase() === 'high' ? 'badge-danger' : String(a.level).toLowerCase() === 'medium' ? 'badge-degraded' : 'badge-normal';
          const stCls = w.status === 'closed' ? 'badge-normal' : w.status === 'processing' ? 'badge-degraded' : 'badge-danger';
          const stTxt = w.status === 'closed' ? '已闭环' : w.status === 'processing' ? '处理中' : '待处理';
          return `<tr>
            <td><span class="badge ${lvCls}">${a.level || '--'}</span></td>
            <td class="al-content-cell" data-jump="${jumpTarget(a)}">${a.content || '--'}</td>
            <td>${a.terminal_id || '--'}</td>
            <td>${a.time || '--'}</td>
            <td><span class="badge ${stCls}">${stTxt}</span></td>
            <td>${w.owner || '—'}</td>
            <td><button class="btn btn-ghost btn-sm" data-handle="${key}">处理</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
    box.querySelectorAll('[data-handle]').forEach(b => b.addEventListener('click', () => openModal(b.getAttribute('data-handle'))));
    box.querySelectorAll('[data-jump]').forEach(cell => cell.addEventListener('click', () => {
      const t = cell.getAttribute('data-jump');
      ui.go(t || '#/alerts');
    }));
  }

  function jumpTarget(a) {
    const c = String(a.content || '');
    if (/信任|会话|LOCKED|降级|锁定|免疫/.test(c)) return '#/trust';
    if (/污染|指纹|注入|溯源|攻击/.test(c)) return '#/pollution';
    if (/阈值|限流|策略|模式|Slowloris/.test(c)) return '#/policy';
    if (/审计|授权|PEP/.test(c)) return '#/audit';
    return '#/alerts';
  }

  let currentKey = '';
  function openModal(key) {
    currentKey = key;
    const a = alerts.find(x => String(x.id || x.time || x.content) === key) || {};
    const w = effWorkflow(a, key);
    document.getElementById('al-modal-content').textContent = a.content || '--';
    document.getElementById('al-modal-status').value = w.status || 'pending';
    document.getElementById('al-modal-owner').value = w.owner || '';
    document.getElementById('al-modal-note').value = w.note || '';
    document.getElementById('al-modal-mask').style.display = 'flex';
  }

  async function load() {
    const res = await api.apiGet('/api/alerts');
    alerts = res.ok && Array.isArray(res.data) ? res.data : [];
    renderTable();
  }

  // 保存：真实调用后端 PUT 持久化；后端失败时降级本地 workflow 兜底
  async function saveToBackend(status, owner, note) {
    const id = Number(currentKey);
    const res = await api.apiPut(`/api/alerts/${id}`, { status, handler: owner, note });
    if (res.ok) {
      delete workflow[currentKey];
      saveWorkflow();
      ui.toast('告警状态已写入后端', 'success');
      await load();
      return true;
    }
    ui.toast('后端更新失败，已本地兜底展示（' + (res.msg || '未知错误') + '）', 'error');
    return false;
  }

  window.SOC.pages.alerts = {
    render(container) {
      container.innerHTML = html();
      loadWorkflow();
      document.getElementById('btn-al-refresh').addEventListener('click', load);
      document.getElementById('al-level').addEventListener('change', renderTable);
      document.getElementById('al-status').addEventListener('change', renderTable);
      document.getElementById('al-modal-cancel').addEventListener('click', () => { document.getElementById('al-modal-mask').style.display = 'none'; });
      document.getElementById('al-modal-mask').addEventListener('click', (e) => { if (e.target.id === 'al-modal-mask') e.target.style.display = 'none'; });
      document.getElementById('al-modal-save').addEventListener('click', async () => {
        const status = document.getElementById('al-modal-status').value;
        const owner = document.getElementById('al-modal-owner').value.trim();
        const note = document.getElementById('al-modal-note').value.trim();
        const ok = await saveToBackend(status, owner, note);
        if (!ok) {
          // 后端不可用：本地兜底展示（不丢失本次处理）
          workflow[currentKey] = { status, owner, note, updatedAt: new Date().toISOString() };
          saveWorkflow();
        }
        document.getElementById('al-modal-mask').style.display = 'none';
        renderTable();
      });
      load();
    },
  };
})();
