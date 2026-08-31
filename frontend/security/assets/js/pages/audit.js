/* ============================================================
 * 页面3 · PEP 授权审计 Decision Audit
 * 数据源：
 *   /api/agent/trust/trace        pep_decision_log 全量分页（session/action/allowed 过滤）
 *   /api/audit-logs/export        审计日志 CSV 导出（真实附件）
 *   /api/defense-logs/export      防御日志 CSV 导出（真实附件）
 *   前端 CSV 导出 pep 决策明细（真实数据）
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  let rows = [];
  let total = 0;
  let page = 1;
  const PAGE_SIZE = 20;

  function html() {
    return `
    <div class="page-audit">
      <div class="toolbar">
        <div class="filter-group">
          <select id="a-allowed" class="input">
            <option value="">全部结果</option>
            <option value="1">放行（allowed=1）</option>
            <option value="0">拒绝（allowed=0）</option>
          </select>
          <select id="a-action" class="input">
            <option value="">全部动作</option>
          </select>
          <input type="text" id="a-session" class="input" placeholder="会话ID…" style="width:180px;">
          <input type="text" id="a-role" class="input" placeholder="角色…" style="width:130px;">
          <button class="btn btn-primary" id="btn-query">查询</button>
          <button class="btn btn-ghost" id="btn-reset">重置</button>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-ghost" id="btn-export-pep">导出 PEP 决策 CSV</button>
          <button class="btn btn-ghost" id="btn-export-audit">导出审计日志 CSV</button>
          <button class="btn btn-ghost" id="btn-export-defense">导出防御日志 CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title">PEP 授权决策明细（pep_decision_log）<span class="hint" id="a-total"></span></div>
        <div id="audit-table"></div>
        <div class="pager" id="a-pager" style="display:none;">
          <button class="btn btn-ghost btn-sm" id="a-prev">上一页</button>
          <span id="a-pageinfo"></span>
          <button class="btn btn-ghost btn-sm" id="a-next">下一页</button>
        </div>
      </div>
    </div>`;
  }

  async function load(pageNo) {
    const allowed = document.getElementById('a-allowed').value;
    const action = document.getElementById('a-action').value;
    const session = document.getElementById('a-session').value.trim();
    const params = { limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE };
    if (allowed !== '') params.allowed = allowed;
    if (action) params.action = action;
    if (session) params.session = session;
    const res = await api.apiGet('/api/agent/trust/trace', params);
    rows = res.ok && Array.isArray(res.data) ? res.data : [];
    total = res.ok ? Number(res.total) || rows.length : rows.length;
    page = pageNo;
    renderTable();
  }

  function renderTable() {
    const box = document.getElementById('audit-table');
    if (rows.length === 0) { box.innerHTML = '<div class="empty">暂无决策记录</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>ID</th><th>时间</th><th>角色</th><th>动作</th><th>结果</th><th>决策原因</th><th>JIT令牌摘要</th><th>终端ID</th><th>会话ID</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${r.id}</td>
          <td>${r.created_at || '--'}</td>
          <td>${r.role || '--'}</td>
          <td>${r.action || '--'}</td>
          <td><span class="badge ${Number(r.allowed) === 0 ? 'badge-danger' : 'badge-normal'}">${Number(r.allowed) === 0 ? '拒绝' : '放行'}</span></td>
          <td title="${r.reason || ''}">${String(r.reason || '--').slice(0, 40)}</td>
          <td class="mono">${String(r.jit_token || '--').slice(0, 10)}…</td>
          <td>${r.terminal_id || '--'}</td>
          <td class="mono">${String(r.session_token || '').slice(0, 10)}…</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
    // 分页
    const pager = document.getElementById('a-pager');
    if (total > PAGE_SIZE) {
      pager.style.display = 'flex';
      const totalPages = Math.ceil(total / PAGE_SIZE);
      document.getElementById('a-pageinfo').textContent = `第 ${page}/${totalPages} 页 · 共 ${total} 条`;
      document.getElementById('a-prev').disabled = page <= 1;
      document.getElementById('a-next').disabled = page >= totalPages;
    } else {
      pager.style.display = 'none';
    }
    document.getElementById('a-total').textContent = `共 ${total} 条`;
  }

  function initActionOptions() {
    const sel = document.getElementById('a-action');
    const actions = [...new Set(rows.map(r => r.action).filter(Boolean))];
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部动作</option>' + actions.map(a => `<option value="${a}" ${a === cur ? 'selected' : ''}>${a}</option>`).join('');
  }

  // 前端 CSV 导出（真实 pep 数据）
  function exportPepCsv() {
    if (rows.length === 0) { ui.toast('无数据可导出', 'error'); return; }
    const header = ['ID', '时间', '会话ID', '角色', '动作', '结果', '决策原因', 'JIT令牌', '终端ID'];
    const objRows = rows.map(r => ({
      id: r.id, created_at: r.created_at, session_token: r.session_token, role: r.role, action: r.action,
      result: Number(r.allowed) === 0 ? '拒绝' : '放行', reason: r.reason, jit_token: r.jit_token, terminal_id: r.terminal_id,
    }));
    api.csvFromRows(header, objRows, 'pep_decision_log.csv');
    ui.toast('PEP 决策明细已导出', 'success');
  }

  window.SOC.pages.audit = {
    render(container) {
      container.innerHTML = html();
      document.getElementById('btn-query').addEventListener('click', () => { page = 1; load(1); });
      document.getElementById('btn-reset').addEventListener('click', () => {
        document.getElementById('a-allowed').value = '';
        document.getElementById('a-action').value = '';
        document.getElementById('a-session').value = '';
        document.getElementById('a-role').value = '';
        load(1);
      });
      document.getElementById('a-allowed').addEventListener('change', () => load(1));
      document.getElementById('a-prev').addEventListener('click', () => load(Math.max(1, page - 1)));
      document.getElementById('a-next').addEventListener('click', () => load(page + 1));
      document.getElementById('btn-export-pep').addEventListener('click', exportPepCsv);
      // 真实后端导出接口（带鉴权下载）
      document.getElementById('btn-export-audit').addEventListener('click', () => api.apiDownload('/api/audit-logs/export', 'audit-logs.csv'));
      document.getElementById('btn-export-defense').addEventListener('click', () => api.apiDownload('/api/defense-logs/export', 'defense-logs.csv'));
      load(1);
    },
  };
})();
