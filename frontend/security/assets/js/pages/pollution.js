/* ============================================================
 * 页面4 · 污染溯源中心 Pollution Trace
 * 数据源：
 *   /api/trust/pollution/list     污染指纹列表（真实数据库 pollution_source，SM3+SimHash）
 *   /api/agent/trace/chain        血缘链图谱（source→session→call→result）
 *   /api/trust/trace              血缘链空时回填真实血缘（chain+events → nodes/links）
 *   处置：指纹加入黑名单 → /api/blacklist POST（真实接口）
 * ============================================================ */
'use strict';
window.SOC = window.SOC || {};
window.SOC.pages = window.SOC.pages || {};

(function () {
  const { ui, api } = SOC;
  let fps = [];

  function html() {
    return `
    <div class="page-pollution">
      <div class="card">
        <div class="card-title">污染血缘链视图（攻击来源 → 传播会话 → 受影响操作）</div>
        <div id="chart-chain" class="chart-box" style="height:420px;"></div>
        <div class="hint" id="chain-empty" style="display:none;">当前无血缘数据，图谱为空。</div>
      </div>
      <div class="card">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>污染指纹列表（家族归并 / 变体计数）</span>
          <span class="hint" id="fp-total"></span>
        </div>
        <div id="fp-table"></div>
      </div>
    </div>`;
  }

  // 将 /api/trust/trace 返回的 { chain, events } 转换为血缘图 nodes/links
  function traceToGraph(t) {
    if (!t || !t.chain || t.chain.length === 0) return { nodes: [], links: [] };
    const nodes = [];
    const links = [];
    const idSet = new Set();
    const addNode = (name, desc, category) => {
      if (idSet.has(name)) return;
      idSet.add(name);
      nodes.push({ name, desc, category });
    };
    const chain = t.chain;
    // chain: 从当前源回溯到根攻击源（chain[0]=当前，chain[last]=根）
    for (let i = chain.length - 1; i >= 0; i--) {
      const s = chain[i];
      const isRoot = i === chain.length - 1;
      addNode(s.source_uid, `${s.payload_type || '--'} / ${s.intent_tag || '--'}${isRoot ? '（攻击源）' : ''}`, isRoot ? 'source' : 'session');
      if (i < chain.length - 1) links.push({ source: chain[i + 1].source_uid, target: s.source_uid });
    }
    // events 血缘事件 → 会话 → 调用 → 结果 链路
    const currentUid = chain[0].source_uid;
    const events = Array.isArray(t.events) ? t.events : [];
    events.forEach((ev) => {
      const srcUid = ev.source_uid && idSet.has(ev.source_uid) ? ev.source_uid : currentUid;
      const ses = ev.session_token || `ses-${ev.id}`;
      let det = {};
      try { det = ev.detail_json ? JSON.parse(ev.detail_json) : {}; } catch (e) { det = {}; }
      const sesName = ses;
      const callName = `${ses}·call`;
      const resultName = `${ses}·result`;
      const sesDesc = `传播会话 ${ses}` + (det.terminal_id ? ` · 终端${det.terminal_id}` : '');
      // 会话节点
      addNode(sesName, sesDesc, 'session');
      links.push({ source: srcUid, target: sesName });
      // 调用 / 操作节点
      if (ev.event_type === 'call_made' || ev.event_type === 'propagated' || ev.event_type === 'result_obtained') {
        const op = det.operation || det.new_scope || det.channel || ev.event_type;
        const res = det.resource ? ' · ' + det.resource : '';
        addNode(callName, `${op}${res}` + (det.to_session ? ` → ${det.to_session}` : ''), 'call');
        links.push({ source: sesName, target: callName });
      }
      // 结果节点
      if (ev.event_type === 'result_obtained' || ev.event_type === 'matched') {
        const rtxt = det.record_count ? `取出 ${det.record_count} 条记录` : det.risk ? `风险等级 ${det.risk}` : '命中确认';
        addNode(resultName, rtxt, 'result');
        links.push({ source: callName && idSet.has(callName) ? callName : sesName, target: resultName });
      }
    });
    return { nodes, links };
  }

  function renderChain(data) {
    const nodes = data && Array.isArray(data.nodes) ? data.nodes : [];
    const links = data && Array.isArray(data.links) ? data.links : [];
    if (nodes.length === 0) {
      ui.disposeChart('chart-chain');
      document.getElementById('chain-empty').style.display = 'block';
      return;
    }
    document.getElementById('chain-empty').style.display = 'none';
    const catMap = { source: 0, session: 1, call: 2, result: 3 };
    const cats = ['污染源', '传播会话', '调用/操作', '结果'];
    ui.chart('chart-chain', {
      backgroundColor: 'transparent',
      tooltip: {
        formatter: (p) => {
          const d = p.data;
          if (d.dataType === 'node') return `<b>${d.name}</b><br/>${d.desc || ''}`;
          return `${d.source} → ${d.target}`;
        },
      },
      legend: { data: cats, top: 0, textStyle: { color: '#8ba3c4' }, itemWidth: 12, itemHeight: 12 },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        categories: cats.map(name => ({ name })),
        force: { repulsion: 180, edgeLength: [60, 140], gravity: 0.08 },
        label: { show: true, position: 'bottom', color: '#c7d6ee', fontSize: 10 },
        lineStyle: { color: '#3b5a82', curveness: 0.2 },
        data: nodes.map(n => ({
          name: n.name, desc: n.desc,
          category: catMap[n.category] ?? 0,
          symbolSize: n.category === 'source' ? 42 : n.category === 'session' ? 34 : n.category === 'call' ? 26 : 22,
          itemStyle: { color: ui.PALETTE[(catMap[n.category] ?? 0) % ui.PALETTE.length] },
          dataType: 'node',
        })),
        links: links.map(l => ({ source: l.source, target: l.target })),
      }],
    });
  }

  function renderFpTable() {
    const box = document.getElementById('fp-table');
    document.getElementById('fp-total').textContent = `共 ${fps.length} 个指纹`;
    if (fps.length === 0) { box.innerHTML = '<div class="empty">暂无污染指纹</div>'; return; }
    box.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>ID</th><th>SM3 指纹</th><th>SimHash</th><th>来源类型</th><th>指纹类型</th>
        <th>命中</th><th>跨会话命中</th><th>变体</th><th>免疫</th><th>最近出现</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${fps.map(f => `<tr>
          <td>${f.id}</td>
          <td class="mono">${String(f.fingerprint || '').slice(0, 18)}…</td>
          <td class="mono">${String(f.simhash || '').slice(0, 12)}…</td>
          <td>${f.sourceType || '--'}</td>
          <td>${f.fingerprintType || '--'}</td>
          <td><b>${f.hitCount || 0}</b></td>
          <td>${f.crossSessionHits || 0}</td>
          <td>${f.mergedCount || 0}</td>
          <td><span class="badge ${f.immune ? 'badge-immuned' : 'badge-plain'}">${f.immune ? '免疫' : '—'}</span></td>
          <td>${f.lastSeen || '--'}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-ip="${f.sourceIp || ''}" data-fp="${f.id}">加入黑名单</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
    box.querySelectorAll('[data-ip]').forEach(btn => btn.addEventListener('click', async () => {
      const ip = btn.getAttribute('data-ip');
      const fpId = btn.getAttribute('data-fp');
      if (!ip) { ui.toast('该指纹无关联 IP，无法加入 IP 黑名单（可补充后端接口扩展处置）', 'error'); return; }
      const r = await api.apiPost('/api/blacklist', { ip_address: ip, reason: `污染指纹#${fpId} 溯源处置` });
      if (r.ok) ui.toast(`已加入黑名单：${ip}`, 'success');
      else ui.toast(r.msg || '加入失败', 'error');
    }));
  }

  async function load(container) {
    container.innerHTML = html();
    // 污染指纹列表：读真实数据库（pollution_source 表，seedPayloadLibrary 预载 150 条）
    const listR = await api.apiGet('/api/trust/pollution/list');
    fps = listR.ok && Array.isArray(listR.data) ? listR.data : [];
    renderFpTable();

    // 血缘链：优先 /api/agent/trace/chain，为空时回填 /api/trust/trace 真实血缘
    let graphData = null;
    const chainR = await api.apiGet('/api/agent/trace/chain');
    if (chainR.ok && chainR.data && Array.isArray(chainR.data.nodes) && chainR.data.nodes.length) {
      graphData = chainR.data;
    } else {
      const fallbackUid = (fps[0] && fps[0].source_uid) || 'DIR-001';
      const tR = await api.apiGet('/api/trust/trace', { source_uid: fallbackUid });
      if (tR.ok && tR.data) graphData = traceToGraph(tR.data);
    }
    renderChain(graphData);
  }

  window.SOC.pages.pollution = {
    render(container) { load(container); },
  };
})();
