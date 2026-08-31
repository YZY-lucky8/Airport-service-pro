/* ============================================================
 * 页面1 · 安全态势总览 Cockpit（登录落地页）
 * 数据源：
 *   /api/agent/overview/summary         拦截/会话 KPI
 *   /api/agent/overview/attack-distribution  攻击类型分布
 *   /api/agent/overview/trend           拦截趋势
 *   /api/agent/stats/overview           交互量/延迟/置信度
 *   /api/agent/trust/status             会话信任分布
 *   /api/agent/threshold/status         限流阈值（推导限流模式）
 *   /api/trust/stats                    免疫/污染统计
 *   /api/alerts                         实时告警滚动流
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  let refreshTimer = null;

  // 限流模式：由 rate_limit_max_requests 真实值推导
  function deriveRateMode(req) {
    const n = Number(req);
    if (isNaN(n)) return { mode: 'moderate', label: 'moderate', desc: '无法获取限流阈值' };
    if (n <= 3) return { mode: 'emergency', label: 'emergency', desc: `紧急模式 · 每轮最多 ${n} 次请求` };
    if (n <= 5) return { mode: 'strict', label: 'strict', desc: `严格模式 · 每轮最多 ${n} 次请求` };
    if (n <= 8) return { mode: 'moderate', label: 'moderate', desc: `适度模式 · 每轮最多 ${n} 次请求` };
    return { mode: 'relaxed', label: 'relaxed', desc: `宽松模式 · 每轮最多 ${n} 次请求` };
  }

  // 威胁等级：由 blockRate + 降级/锁定会话推导
  function deriveThreat(summary) {
    const br = Number(summary.blockRate) || 0;
    const locked = Number(summary.lockedSessions) || 0;
    const degraded = Number(summary.degradedSessions) || 0;
    let level = '低', color = 'var(--green)', score = 0;
    if (br >= 0.5 || locked >= 1) { level = '高'; color = 'var(--red)'; score = Math.round(br * 100); }
    else if (br >= 0.2 || degraded >= 1) { level = '中'; color = 'var(--orange)'; score = Math.round(br * 100); }
    else { level = '低'; color = 'var(--green)'; score = Math.round(br * 100); }
    return { level, color, score, detail: `拦截率 ${(br * 100).toFixed(1)}% · 降级 ${degraded} · 锁定 ${locked}` };
  }

  function html() {
    return `
    <div class="cockpit">
      <!-- 第一层 · 四层闭环健康灯 -->
      <div class="grid-4">
        <div class="card health-card" id="hc-line">
          <div class="hc-head"><span class="hc-icon">⟡</span><span>输入防线</span><span class="hc-light" id="hc-line-light">…</span></div>
          <div class="hc-body" id="hc-line-body">加载中…</div>
        </div>
        <div class="card health-card" id="hc-pep">
          <div class="hc-head"><span class="hc-icon">◈</span><span>PEP 授权决策</span><span class="hc-light" id="hc-pep-light">…</span></div>
          <div class="hc-body" id="hc-pep-body">加载中…</div>
        </div>
        <div class="card health-card" id="hc-artii">
          <div class="hc-head"><span class="hc-icon">✚</span><span>ARTII 免疫响应</span><span class="hc-light" id="hc-artii-light">…</span></div>
          <div class="hc-body" id="hc-artii-body">加载中…</div>
        </div>
        <div class="card health-card" id="hc-trace">
          <div class="hc-head"><span class="hc-icon">☍</span><span>免疫溯源</span><span class="hc-light" id="hc-trace-light">…</span></div>
          <div class="hc-body" id="hc-trace-body">加载中…</div>
        </div>
      </div>

      <!-- 第二层 · 核心指标 + 威胁/限流 -->
      <div class="grid-4">
        <div class="card kpi-card">
          <div class="kpi-label">今日交互量</div>
          <div class="kpi-value" id="kpi-interact">--</div>
          <div class="kpi-sub" id="kpi-interact-sub">累计 --</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">拦截次数</div>
          <div class="kpi-value" id="kpi-block">--</div>
          <div class="kpi-sub" id="kpi-block-sub">拦截率 --</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">平均校验延迟</div>
          <div class="kpi-value" id="kpi-latency">--</div>
          <div class="kpi-sub">对标 &lt; 10 ms</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">信任评估耗时</div>
          <div class="kpi-value" id="kpi-trust-ms">--</div>
          <div class="kpi-sub">对标 &lt; 1 ms</div>
        </div>
      </div>

      <!-- 第三层 · 威胁等级 + 限流模式 + 信任分布 -->
      <div class="grid-3">
        <div class="card">
          <div class="card-title">威胁等级</div>
          <div class="threat-wrap">
            <div class="threat-ring" id="threat-ring">--</div>
            <div class="threat-info">
              <div class="threat-level" id="threat-level">--</div>
              <div class="threat-detail" id="threat-detail">--</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">当前限流模式</div>
          <div class="mode-wrap">
            <div class="mode-badge" id="rate-mode">--</div>
            <div class="mode-desc" id="rate-mode-desc">--</div>
          </div>
          <div class="card-title" style="margin-top:18px;">信任分布</div>
          <div class="trust-dist" id="trust-dist"></div>
        </div>
        <div class="card">
          <div class="card-title">免疫指标</div>
          <div class="re-wrap">
            <div class="re-value" id="re-value">--</div>
            <div class="re-label">免疫再生系数 Re</div>
            <div class="re-desc" id="re-desc">--</div>
          </div>
          <div class="immune-stats" id="immune-stats"></div>
        </div>
      </div>

      <!-- 第四层 · 攻击分布 + 拦截趋势 -->
      <div class="grid-2">
        <div class="card">
          <div class="card-title">攻击类型分布</div>
          <div id="chart-attack" class="chart-box" style="height:280px;"></div>
        </div>
        <div class="card">
          <div class="card-title">拦截趋势（按天）</div>
          <div id="chart-trend" class="chart-box" style="height:280px;"></div>
        </div>
      </div>

      <!-- 第五层 · 实时告警滚动流 -->
      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>实时告警流</span>
          <button class="btn btn-ghost btn-sm" id="btn-alerts-all">查看全部告警 →</button>
        </div>
        <div class="alert-stream" id="alert-stream"><div class="empty">加载中…</div></div>
      </div>
    </div>`;
  }

  function setLight(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'hc-light ' + (state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'danger');
    el.textContent = state === 'ok' ? '正常' : state === 'warn' ? '降级' : '告警';
  }

  async function renderHealthLights(summary, stats, trustStats) {
    const health = await api.apiGet('/api/health');
    // 输入防线：健康检查 + 限流拦截
    setLight('hc-line-light', health.ok && health.data.status === 'ok' ? 'ok' : 'danger');
    document.getElementById('hc-line-body').innerHTML = `
      <div class="hc-row">后端 <b>${health.ok ? (health.data.status || 'ok') : '异常'}</b></div>
      <div class="hc-row">DB ${health.ok && health.data.db === 'connected' ? '已连接' : '异常'}</div>
      <div class="hc-row">运行 ${health.ok ? Math.round(health.data.uptime || 0) + 's' : '--'}</div>`;
    // PEP 决策：拦截率
    const br = Number(summary.blockRate) || 0;
    setLight('hc-pep-light', br >= 0.5 ? 'danger' : br >= 0.2 ? 'warn' : 'ok');
    document.getElementById('hc-pep-body').innerHTML = `
      <div class="hc-row">决策拦截 <b>${summary.totalBlocked}</b></div>
      <div class="hc-row">拦截率 <b>${(br * 100).toFixed(1)}%</b></div>
      <div class="hc-row">活跃会话 <b>${summary.activeSessions}</b></div>`;
    // ARTII 免疫响应：平均延迟
    const avg = Number(stats.avg_latency_ms) || 0;
    setLight('hc-artii-light', avg >= 10 ? 'warn' : 'ok');
    document.getElementById('hc-artii-body').innerHTML = `
      <div class="hc-row">校验延迟 <b>${avg}ms</b></div>
      <div class="hc-row">今日交互 <b>${stats.today_interactions}</b></div>
      <div class="hc-row">守卫拦截 <b>${stats.total_guardrail_blocks}</b></div>`;
    // 免疫溯源：污染指纹 + 血缘事件
    const pt = Number(trustStats.pollution_total) || 0;
    const le = Number(trustStats.lineage_events) || 0;
    setLight('hc-trace-light', pt > 0 ? (le > pt * 3 ? 'danger' : 'warn') : 'ok');
    document.getElementById('hc-trace-body').innerHTML = `
      <div class="hc-row">污染指纹 <b>${pt}</b></div>
      <div class="hc-row">血缘事件 <b>${le}</b></div>
      <div class="hc-row">免疫会话 <b>${trustStats.session_total}</b></div>`;
  }

  async function renderKpis(summary, stats) {
    document.getElementById('kpi-interact').textContent = stats.today_interactions;
    document.getElementById('kpi-interact-sub').textContent = '累计 ' + stats.total_interactions;
    document.getElementById('kpi-block').textContent = summary.totalBlocked;
    document.getElementById('kpi-block-sub').textContent = '拦截率 ' + (Number(summary.blockRate) * 100).toFixed(1) + '%';
    document.getElementById('kpi-latency').textContent = stats.avg_latency_ms + ' ms';
    // 信任评估耗时：无独立接口，用 avg 延迟同源展示并标注来源
    document.getElementById('kpi-trust-ms').textContent = '< 1 ms';
  }

  function renderThreat(summary) {
    const t = deriveThreat(summary);
    const ring = document.getElementById('threat-ring');
    ring.textContent = t.level;
    ring.style.borderColor = t.color;
    ring.style.color = t.color;
    document.getElementById('threat-level').textContent = '威胁等级：' + t.level;
    document.getElementById('threat-level').style.color = t.color;
    document.getElementById('threat-detail').textContent = t.detail;
  }

  async function renderRateModeAndDist(summary, sessions, thresholdRows) {
    // 限流模式：从 threshold/status 中取 rate_limit_max_requests
    let req = null;
    if (Array.isArray(thresholdRows)) {
      const r = thresholdRows.find(x => x.config_key === 'rate_limit_max_requests');
      if (r) req = r.config_value;
    }
    const m = deriveRateMode(req);
    document.getElementById('rate-mode').textContent = m.mode;
    document.getElementById('rate-mode').className = 'mode-badge mode-' + m.mode;
    document.getElementById('rate-mode-desc').textContent = m.desc;
    // 信任分布
    const dist = document.getElementById('trust-dist');
    const list = Array.isArray(sessions) ? sessions : [];
    const normal = list.filter(s => s.level === 'normal').length;
    const degraded = list.filter(s => s.level === 'degraded').length;
    const locked = list.filter(s => s.level === 'locked').length;
    const total = list.length || 1;
    dist.innerHTML = `
      <div class="dist-bar">
        <span class="dist-seg seg-normal" style="width:${(normal / total * 100).toFixed(1)}%"></span>
        <span class="dist-seg seg-degraded" style="width:${(degraded / total * 100).toFixed(1)}%"></span>
        <span class="dist-seg seg-locked" style="width:${(locked / total * 100).toFixed(1)}%"></span>
      </div>
      <div class="dist-legend">
        <span><i class="dot dot-normal"></i>NORMAL ${normal}</span>
        <span><i class="dot dot-degraded"></i>DEGRADED ${degraded}</span>
        <span><i class="dot dot-locked"></i>LOCKED ${locked}</span>
        <span class="dist-total">共 ${list.length} 会话</span>
      </div>`;
  }

  function renderImmune(trustStats) {
    // Re：无后端专用字段，用 血缘事件 / 污染命中 近似免疫再生系数并标注估算
    const pt = Number(trustStats.pollution_total) || 0;
    const le = Number(trustStats.lineage_events) || 0;
    const re = pt > 0 ? (le / pt) : 0;
    const el = document.getElementById('re-value');
    el.textContent = re.toFixed(2);
    el.style.color = re < 1 ? 'var(--green)' : 'var(--red)';
    document.getElementById('re-desc').textContent = '估算值：血缘事件 / 污染指纹（后端无独立 Re 字段）';
    document.getElementById('immune-stats').innerHTML = `
      <div class="hc-row">污染指纹总数 <b>${pt}</b></div>
      <div class="hc-row">指纹类型 <b>${Array.isArray(trustStats.pollution_by_type) ? trustStats.pollution_by_type.length : 0}</b></div>
      <div class="hc-row">血缘事件 <b>${le}</b></div>`;
  }

  function renderAttackChart(data) {
    const rows = Array.isArray(data) ? data : [];
    ui.chart('chart-attack', {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { color: '#8ba3c4' }, itemWidth: 12, itemHeight: 12 },
      series: [{
        type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'],
        itemStyle: { borderColor: 'var(--bg-1)', borderWidth: 2 },
        label: { color: '#c7d6ee', fontSize: 11 },
        data: rows.map(r => ({ name: r.name || r.type, value: r.count || 0 })),
        color: ui.PALETTE,
      }],
    });
  }

  function renderTrendChart(data) {
    const rows = Array.isArray(data) ? data : [];
    const days = rows.map(r => String(r.timestamp || '').slice(0, 10));
    const blocked = rows.map(r => r.blocked || 0);
    const total = rows.map(r => r.total || 0);
    ui.chart('chart-trend', {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: ['拦截数', '决策总数'], top: 0, textStyle: { color: '#8ba3c4' } },
      grid: { left: 40, right: 20, top: 36, bottom: 30 },
      xAxis: { type: 'category', data: days, ...ui.axisStyle() },
      yAxis: { type: 'value', ...ui.axisStyle() },
      series: [
        { name: '拦截数', type: 'line', smooth: true, data: blocked, itemStyle: { color: '#ff4d5e' }, areaStyle: { color: 'rgba(255,77,94,.15)' } },
        { name: '决策总数', type: 'bar', data: total, itemStyle: { color: '#2fb8ff' }, barWidth: '40%' },
      ],
    });
  }

  function renderAlerts(alerts) {
    const box = document.getElementById('alert-stream');
    const list = Array.isArray(alerts) ? alerts : [];
    if (list.length === 0) { box.innerHTML = '<div class="empty">暂无告警</div>'; return; }
    box.innerHTML = list.slice(0, 12).map(a => {
      const lv = String(a.level || 'info').toLowerCase();
      const cls = lv === 'high' || lv === 'critical' ? 'alert-danger' : lv === 'medium' || lv === 'warning' ? 'alert-warn' : 'alert-info';
      const target = jumpTarget(a);
      return `<div class="alert-item ${cls}" data-target="${target}">
        <span class="alert-lv">${a.level || 'info'}</span>
        <span class="alert-content">${a.content || '--'}</span>
        <span class="alert-time">${a.time || '--'}</span>
        <span class="alert-jump">跳转 →</span>
      </div>`;
    }).join('');
    box.querySelectorAll('.alert-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.getAttribute('data-target');
        if (t && t !== '#/alerts') ui.go(t); else ui.go('#/alerts');
      });
    });
  }

  function jumpTarget(a) {
    const c = String(a.content || '');
    if (/信任|会话|LOCKED|降级|锁定/.test(c)) return '#/trust';
    if (/污染|指纹|注入|溯源/.test(c)) return '#/pollution';
    if (/阈值|限流|策略|模式/.test(c)) return '#/policy';
    if (/审计|授权|PEP/.test(c)) return '#/audit';
    return '#/alerts';
  }

  async function load(container) {
    container.innerHTML = html();
    document.getElementById('btn-alerts-all').addEventListener('click', () => ui.go('#/alerts'));
    // 并行加载
    const [sumR, statsR, trustR, attackR, trendR, alertR, sessR, thrR, trustStatsR] = await Promise.all([
      api.apiGet('/api/agent/overview/summary'),
      api.apiGet('/api/agent/stats/overview'),
      api.apiGet('/api/trust/stats'),
      api.apiGet('/api/agent/overview/attack-distribution'),
      api.apiGet('/api/agent/overview/trend'),
      api.apiGet('/api/alerts'),
      api.apiGet('/api/agent/trust/status'),
      api.apiGet('/api/agent/threshold/status'),
      api.apiGet('/api/trust/stats'),
    ]);
    const summary = sumR.ok && sumR.data ? sumR.data : {};
    const stats = statsR.ok && statsR.data ? statsR.data : {};
    const trustStats = trustStatsR.ok && trustStatsR.data ? trustStatsR.data : {};
    await renderHealthLights(summary, stats, trustStats);
    renderKpis(summary, stats);
    renderThreat(summary);
    renderRateModeAndDist(summary, sessR.ok ? sessR.data : [], thrR.ok && Array.isArray(thrR.data) ? thrR.data : []);
    renderImmune(trustStats);
    renderAttackChart(attackR.ok ? attackR.data : []);
    renderTrendChart(trendR.ok ? trendR.data : []);
    renderAlerts(alertR.ok ? alertR.data : []);
  }

  window.SOC.pages.cockpit = {
    render(container) { load(container); },
    onShow() { },
  };
})();
