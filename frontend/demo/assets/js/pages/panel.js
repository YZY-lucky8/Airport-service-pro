/**
 * 信任免疫面板 —— D2 完整实现（mock 数据驱动）· SOC 深色科技版
 * 信任曲线(面积渐变+阈值线) + 三态会话卡片 + 污染指纹列表
 * D4 切真实接口后无需改本文件（数据由 api.js 统一分发）
 * 仅改 UI 渲染与图表样式，数据字段与接口逻辑保持不变
 */
let trustChart = null;

async function loadPanel() {
    const container = document.getElementById('page-container');
    container.innerHTML = `
        <div class="panel-grid">
            <div class="card card-wide">
                <div class="card-title">信任曲线趋势图
                    <span class="card-sub">会话 S001 · 60 降权线 / 30 锁定线</span>
                </div>
                <div id="trust-chart" class="chart-box chart-box-lg"></div>
            </div>
            <div class="card card-wide">
                <div class="card-title">会话信任状态
                    <span class="card-sub">点击卡片展开详情</span>
                </div>
                <div id="session-list" class="session-cards"></div>
            </div>
            <div class="card card-wide">
                <div class="card-title">污染指纹库
                    <span class="card-sub">SM3 精确 + SimHash 近似 · 跨会话免疫</span>
                </div>
                <div class="table-scroll"><div id="pollution-table"></div></div>
            </div>
        </div>`;

    // 并行拉取三组数据
    const [history, status, pollution] = await Promise.all([
        apiGet('/api/agent/trust/history?sessionId=S001'),
        apiGet('/api/agent/trust/status'),
        apiGet('/api/agent/pollution/list')
    ]);

    renderTrustChart(history.data || []);
    renderSessionList(status.data || []);
    renderPollutionTable(pollution.data || []);
}

/* 1) 信任曲线：面积渐变 + 60/30 阈值虚线 + 发光 */
function renderTrustChart(data) {
    const el = document.getElementById('trust-chart');
    if (!el) return;
    trustChart = echarts.init(el);
    trustChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(10, 22, 40, 0.92)',
            borderColor: 'rgba(0, 212, 255, 0.4)',
            textStyle: { color: '#dce9ff', fontFamily: 'Consolas, monospace', fontSize: 13 }
        },
        grid: { left: 60, right: 30, top: 44, bottom: 36 },
        xAxis: {
            type: 'category',
            data: data.map(d => d.timestamp),
            axisLine: { lineStyle: { color: 'rgba(0,212,255,0.3)' } },
            axisLabel: { color: '#7d92b8', fontFamily: 'Consolas, monospace' },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value', min: 0, max: 100,
            axisLine: { show: false },
            axisLabel: { color: '#7d92b8', fontFamily: 'Consolas, monospace' },
            splitLine: { lineStyle: { color: 'rgba(0,212,255,0.10)' } }
        },
        series: [{
            name: '信任分数', type: 'line', smooth: true,
            symbol: 'circle', symbolSize: 6,
            data: data.map(d => d.score),
            lineStyle: {
                width: 3, color: '#00d4ff',
                shadowColor: 'rgba(0,212,255,0.5)', shadowBlur: 12
            },
            itemStyle: { color: '#00d4ff' },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(0, 212, 255, 0.35)' },
                    { offset: 1, color: 'rgba(0, 212, 255, 0.02)' }
                ])
            },
            markLine: {
                silent: true, symbol: 'none',
                label: { color: '#ffa726', fontSize: 12, fontFamily: 'Consolas, monospace', position: 'insideEndTop' },
                data: [
                    { yAxis: 60, name: '降权线', lineStyle: { color: '#ffa726', type: 'dashed', width: 2 } },
                    { yAxis: 30, name: '锁定线', lineStyle: { color: '#ff5252', type: 'dashed', width: 2 } }
                ]
            }
        }]
    });
    window.addEventListener('resize', () => trustChart && trustChart.resize());
}

/* 2) 会话信任状态：三态卡片（水平排列），点击展开详情 */
function renderSessionList(sessions) {
    const el = document.getElementById('session-list');
    if (!sessions.length) { el.innerHTML = '<div class="empty">暂无会话</div>'; return; }
    el.innerHTML = sessions.map(s => `
        <div class="session-item level-${s.level}" onclick="toggleSessionDetail('${s.sessionId}')">
            <div class="session-row">
                <div>
                    <div class="session-id">${s.sessionId}</div>
                    <div style="font-size:11px;color:#7d92b8;margin-top:2px;">${s.role || ''}</div>
                </div>
                <span class="badge badge-${s.level}">${badgeText(s.level)}</span>
                <span class="session-score">${s.trustScore}</span>
            </div>
            <div class="session-detail" id="detail-${s.sessionId}" style="display:none">
                <div>原因：${s.reason || '无'}</div>
                <div>更新时间：${s.updatedAt || '-'}</div>
            </div>
        </div>`).join('');
}

function toggleSessionDetail(id) {
    const el = document.getElementById('detail-' + id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function badgeText(level) {
    return { normal: '正常', degraded: '降权', locked: '锁定' }[level] || level;
}

/* 3) 污染指纹列表 */
function renderPollutionTable(list) {
    const el = document.getElementById('pollution-table');
    if (!list.length) { el.innerHTML = '<div class="empty">暂无指纹</div>'; return; }
    el.innerHTML = `<table class="data-table">
        <thead><tr><th>指纹ID</th><th>指纹摘要</th><th>类型</th><th>来源</th><th>首次发现</th><th>命中</th><th>跨会话</th><th>免疫</th></tr></thead>
        <tbody>${list.map(p => `
            <tr>
                <td>${p.id}</td>
                <td class="mono">${p.fingerprint}</td>
                <td><span class="tag">${p.fingerprintType === 'sm3' ? 'SM3' : 'SimHash'}</span></td>
                <td>${p.sourceType}</td>
                <td>${p.firstSeen}</td>
                <td>${p.hitCount}</td>
                <td>${p.crossSessionHits}</td>
                <td>${p.immune ? '<span class="tag tag-immune">已免疫</span>' : '<span class="tag tag-watch">观察中</span>'}</td>
            </tr>`).join('')}
        </tbody></table>`;
}
