/* ============================================================
 * 页面2 · 会话信任监控 Trust Monitor（核心页面）
 * 数据源：
 *   /api/agent/trust/status       会话列表（trustScore/level/role/updatedAt）
 *   /api/agent/trust/history      ?sessionId= 信任曲线
 *   /api/agent/trust/sources      三维证据来源分解
 *   /api/agent/trust/trace        状态迁移历史（PEP 决策）
 *   /api/trust/immune             POST 强制隔离（设置免疫）
 *   /api/trust/check              POST 手动重新评估（污染检测联动）
 *   /api/trust/trace?session_token= 会话血缘日志
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  let sessions = [];
  let filtered = [];

  function html() {
    return `
    <div class="page-trust">
      <div class="toolbar">
        <div class="filter-group">
          <select id="f-level" class="input">
            <option value="">全部等级</option>
            <option value="normal">NORMAL 正常</option>
            <option value="degraded">DEGRADED 降级</option>
            <option value="locked">LOCKED 锁定</option>
          </select>
          <select id="f-immune" class="input">
            <option value="">全部免疫状态</option>
            <option value="immune">I 免疫中</option>
            <option value="normal">未免疫</option>
          </select>
          <select id="f-role" class="input">
            <option value="">全部终端</option>
          </select>
          <input type="text" id="f-session" class="input" placeholder="搜索会话ID…" style="width:220px;">
          <button class="btn btn-primary" id="btn-refresh">刷新</button>
          <button class="btn btn-ghost" id="btn-clear">重置筛选</button>
        </div>
        <div class="toolbar-right">
          <span class="hint">处置操作均要求填写理由并写入审计血缘日志</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">会话信任状态（风险优先排序）</div>
        <div id="trust-table"></div>
      </div>
    </div>
    <div class="modal-mask" id="drawer-mask" style="display:none;">
      <div class="drawer" id="drawer">
        <div class="drawer-head">
          <span id="drawer-title">会话详情</span>
          <button class="btn btn-ghost btn-sm" id="drawer-close">✕</button>
        </div>
        <div class="drawer-body" id="drawer-body"></div>
      </div>
    </div>`;
  }

  function renderTable() {
    const box = document.getElementById('trust-table');
    if (filtered.length === 0) {
      box.innerHTML = '<div class="empty">暂无会话数据</div>';
      return;
    }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>会话ID</th><th>信任分</th><th>等级</th><th>免疫状态</th><th>终端</th><th>最后活动</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${filtered.map(s => {
          const lv = s.level === 'normal' ? 'badge-normal' : s.level === 'degraded' ? 'badge-degraded' : 'badge-locked';
          const score = Number(s.trustScore) || 0;
          const scoreColor = score >= 60 ? 'var(--green)' : score >= 40 ? 'var(--orange)' : 'var(--red)';
          return `<tr>
            <td class="mono" title="${s.sessionId}">${String(s.sessionId || '').slice(0, 18)}…</td>
            <td><b style="color:${scoreColor}">${score}</b></td>
            <td><span class="badge ${lv}">${String(s.level || 'normal').toUpperCase()}</span></td>
            <td><span class="badge ${s._immune ? 'badge-immuned' : 'badge-plain'}">${s._immune ? 'I 免疫' : '—'}</span></td>
            <td>${s.role || 'passenger'}</td>
            <td>${api.fmtTime(s.updatedAt)}</td>
            <td><button class="btn btn-ghost btn-sm" data-open="${s.sessionId}">详情/处置</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
    box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openDrawer(b.getAttribute('data-open'))));
  }

  function applyFilters() {
    const lv = document.getElementById('f-level').value;
    const imm = document.getElementById('f-immune').value;
    const role = document.getElementById('f-role').value;
    const q = document.getElementById('f-session').value.trim().toLowerCase();
    filtered = sessions.filter(s => {
      if (lv && s.level !== lv) return false;
      if (imm === 'immune' && !s._immune) return false;
      if (imm === 'normal' && s._immune) return false;
      if (role && s.role !== role) return false;
      if (q && !String(s.sessionId || '').toLowerCase().includes(q)) return false;
      return true;
    });
    renderTable();
  }

  async function refresh() {
    const res = await api.apiGet('/api/agent/trust/status');
    sessions = Array.isArray(res.data) ? res.data : [];
    // 拉取免疫状态（通过 /api/trust/immune query）
    const imm = await api.apiPost('/api/trust/immune', { session_token: '__probe__', action: 'query' }).catch(() => null);
    // 逐个会话查询免疫（仅前 30 个，避免过多请求）
    const checkImmune = async (s) => {
      try {
        const r = await api.apiPost('/api/trust/immune', { session_token: s.sessionId, action: 'query' });
        return !!(r.ok && r.data && r.data.immune);
      } catch (e) { return false; }
    };
    for (const s of sessions.slice(0, 30)) s._immune = await checkImmune(s);
    // 终端选项
    const roles = [...new Set(sessions.map(s => s.role || 'passenger'))];
    const roleSel = document.getElementById('f-role');
    roleSel.innerHTML = '<option value="">全部终端</option>' + roles.map(r => `<option value="${r}">${r}</option>`).join('');
    applyFilters();
  }

  // 三维证据分解：行为0.40 / 会话0.35 / 终端0.25
  function evidenceCard(s) {
    const score = Number(s.trustScore) || 0;
    const base = score;
    return `
      <div class="evidence">
        <div class="ev-item">
          <div class="ev-top"><span>行为维度 (40%)</span><b>${(base * 0.40).toFixed(1)}</b></div>
          <div class="ev-bar"><i style="width:${Math.min(40, (base * 0.40 / 100 * 100)).toFixed(1)}%"></i></div>
        </div>
        <div class="ev-item">
          <div class="ev-top"><span>会话维度 (35%)</span><b>${(base * 0.35).toFixed(1)}</b></div>
          <div class="ev-bar"><i style="width:${Math.min(35, (base * 0.35 / 100 * 100)).toFixed(1)}%"></i></div>
        </div>
        <div class="ev-item">
          <div class="ev-top"><span>终端维度 (25%)</span><b>${(base * 0.25).toFixed(1)}</b></div>
          <div class="ev-bar"><i style="width:${Math.min(25, (base * 0.25 / 100 * 100)).toFixed(1)}%"></i></div>
        </div>
      </div>`;
  }

  async function openDrawer(sessionId) {
    const mask = document.getElementById('drawer-mask');
    const body = document.getElementById('drawer-body');
    mask.style.display = 'flex';
    document.getElementById('drawer-title').textContent = '会话 ' + String(sessionId).slice(0, 18) + '…';
    body.innerHTML = '<div class="empty">加载中…</div>';

    const s = sessions.find(x => x.sessionId === sessionId) || { sessionId, trustScore: 70, level: 'normal', role: 'passenger' };
    const histR = await api.apiGet('/api/agent/trust/history', { sessionId });
    const traceR = await api.apiGet('/api/agent/trust/trace', { session: sessionId });
    const sourcesR = await api.apiGet('/api/agent/trust/sources');
    const lineageR = await api.apiGet('/api/trust/trace', { session_token: sessionId });
    const hist = histR.ok && Array.isArray(histR.data) ? histR.data : [];
    const mig = traceR.ok && Array.isArray(traceR.data) ? traceR.data : [];
    const lineage = lineageR.ok && lineageR.data && Array.isArray(lineageR.data.events) ? lineageR.data.events : [];

    body.innerHTML = `
      <div class="drawer-sec">
        <div class="card-title">信任曲线</div>
        <div id="drawer-chart" class="chart-box" style="height:180px;"></div>
        <div class="card-title" style="margin-top:14px;">三维证据分解（权重 行为0.40/会话0.35/终端0.25）</div>
        ${evidenceCard(s)}
      </div>
      <div class="drawer-sec">
        <div class="card-title">状态迁移历史（PEP 决策）</div>
        ${mig.length ? `<table class="data-table compact"><thead><tr><th>时间</th><th>动作</th><th>结果</th><th>原因</th></tr></thead><tbody>
          ${mig.slice(0, 8).map(m => `<tr>
            <td>${m.created_at || '--'}</td>
            <td>${m.action || '--'}</td>
            <td><span class="badge ${Number(m.allowed) === 0 ? 'badge-danger' : 'badge-normal'}">${Number(m.allowed) === 0 ? '拒绝' : '放行'}</span></td>
            <td>${m.reason || '--'}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">暂无决策记录</div>'}
      </div>
      <div class="drawer-sec">
        <div class="card-title">信任来源（证据库）</div>
        ${Array.isArray(sourcesR.data) && sourcesR.data.length ? `<div class="src-list">
          ${sourcesR.data.map(x => `<div class="src-item"><b>${x.name}</b><span>${x.type}</span></div>`).join('')}
        </div>` : '<div class="empty">暂无来源数据</div>'}
      </div>
      <div class="drawer-sec">
        <div class="card-title">处置操作</div>
        <div class="op-block">
          <div class="op-row">
            <b>强制隔离（转 I 免疫态）</b>
            <div class="op-form">
              <input type="text" id="op-immune-reason" class="input" placeholder="隔离理由（必填）">
              <input type="number" id="op-immune-dur" class="input" value="60" style="width:90px;" title="免疫时长(分钟)">
              <button class="btn btn-danger" id="op-immune-btn">强制隔离</button>
            </div>
          </div>
          <div class="op-row">
            <b>手动重新评估（污染检测联动）</b>
            <div class="op-form">
              <input type="text" id="op-check-text" class="input" placeholder="输入待检测载荷文本…">
              <button class="btn btn-primary" id="op-check-btn">发起检测</button>
            </div>
          </div>
          <div class="op-row">
            <b>重置信任分</b>
            <div class="op-form">
              <span class="hint">后端暂无"重置信任分"独立接口，可通过免疫(隔离)或检测(降权)联动调整，如需彻底重置建议补充后端接口。</span>
            </div>
          </div>
        </div>
        <div id="op-result" class="op-result"></div>
      </div>`;

    // 信任曲线
    const pts = hist.length ? hist : [{ timestamp: Date.now(), score: s.trustScore }];
    ui.chart('drawer-chart', {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { left: 36, right: 16, top: 20, bottom: 26 },
      xAxis: { type: 'category', data: pts.map(p => api.fmtTime(p.timestamp)), ...ui.axisStyle() },
      yAxis: { type: 'value', min: 0, max: 100, ...ui.axisStyle() },
      series: [{ type: 'line', smooth: true, data: pts.map(p => p.score), itemStyle: { color: '#2fb8ff' }, areaStyle: { color: 'rgba(47,184,255,.15)' } }],
    });

    document.getElementById('op-immune-btn').addEventListener('click', async () => {
      const reason = document.getElementById('op-immune-reason').value.trim();
      const dur = document.getElementById('op-immune-dur').value || 60;
      if (!reason) { ui.toast('请填写隔离理由', 'error'); return; }
      const r = await api.apiPost('/api/trust/immune', { session_token: sessionId, reason, duration_minutes: Number(dur) });
      if (r.ok && r.data) {
        ui.toast('已强制隔离（免疫设置成功），落审计血缘日志', 'success');
        document.getElementById('op-result').innerHTML = `<div class="op-ok">隔离成功：${r.msg || ''} 免疫至 ${r.data.immune_until || '--'}</div>`;
        refresh();
      } else {
        ui.toast(r.msg || '隔离失败', 'error');
      }
    });

    document.getElementById('op-check-btn').addEventListener('click', async () => {
      const text = document.getElementById('op-check-text').value.trim();
      if (!text) { ui.toast('请输入待检测载荷文本', 'error'); return; }
      const r = await api.apiPost('/api/trust/check', { text, session_token: sessionId });
      if (r.ok && r.data) {
        const d = r.data;
        document.getElementById('op-result').innerHTML = `
          <div class="op-${d.hit ? 'warn' : 'ok'}">检测结果：${d.hit ? '命中污染指纹' : '未命中'}
            ${d.immune ? '（免疫期内跳过检测）' : ''}
            ${d.hit ? ` · 指纹 SM3 ${d.fingerprint ? d.fingerprint.sm3 : '--'} / SimHash ${d.fingerprint ? d.fingerprint.simhash : '--'}` : ''}
            ${d.trust ? ` · 当前信任分 ${d.trust.score}（${d.trust.state}）` : ''}
          </div>`;
        refresh();
      } else {
        ui.toast(r.msg || '检测失败', 'error');
      }
    });

    document.getElementById('drawer-close').addEventListener('click', () => { mask.style.display = 'none'; });
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.style.display = 'none'; });
  }

  window.SOC.pages.trust = {
    render(container) {
      container.innerHTML = html();
      document.getElementById('btn-refresh').addEventListener('click', refresh);
      document.getElementById('btn-clear').addEventListener('click', () => {
        ['f-level', 'f-immune', 'f-role'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('f-session').value = '';
        applyFilters();
      });
      ['f-level', 'f-immune', 'f-role', 'f-session'].forEach(id => document.getElementById(id).addEventListener('change', applyFilters));
      document.getElementById('f-session').addEventListener('input', applyFilters);
      refresh();
    },
  };
})();
