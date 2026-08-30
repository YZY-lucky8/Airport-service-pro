/**
 * 态势大屏 —— D3 完整实现（mock 数据驱动）· SOC 深色科技版
 * KPI 统计卡 + 攻击类型分布(环形) + 攻击拦截趋势(柱线)
 * D4 切真实接口后无需改本文件（数据由 api.js 统一分发）
 */
let overviewChartDist = null;
let overviewChartTrend = null;

async function loadOverview() {
    const container = document.getElementById('page-container');
    container.innerHTML = `
        <div style="display:flex;gap:16px;margin-bottom:18px;" id="kpi-row">
            <div class="card" style="flex:1;text-align:center;" id="kpi-blocked"></div>
            <div class="card" style="flex:1;text-align:center;" id="kpi-rate"></div>
            <div class="card" style="flex:1;text-align:center;" id="kpi-active"></div>
            <div class="card" style="flex:1;text-align:center;" id="kpi-abnormal"></div>
        </div>
        <div class="panel-grid">
            <div class="card">
                <div class="card-title">攻击类型分布<span class="card-sub">今日累计 · 实时</span></div>
                <div id="overview-dist" class="chart-box"></div>
            </div>
            <div class="card">
                <div class="card-title">攻击拦截趋势<span class="card-sub">每10分钟 · 拦截/总请求</span></div>
                <div id="overview-trend" class="chart-box"></div>
            </div>
        </div>`;

    const [summary, dist, trend] = await Promise.all([
        apiGet('/api/agent/overview/summary'),
        apiGet('/api/agent/overview/attack-distribution'),
        apiGet('/api/agent/overview/trend')
    ]);

    renderKpis(summary.data || {});
    renderDistChart(dist.data || []);
    renderTrendChart(trend.data || []);
}

/* 1) KPI 统计卡 */
function renderKpis(d) {
    const kpi = (elId, label, value, color) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = `
            <div style="font-size:12px;color:var(--text-secondary);letter-spacing:2px;">${label}</div>
            <div style="font-family:var(--mono);font-size:34px;font-weight:700;color:${color};margin:10px 0 4px;text-shadow:0 0 16px ${color}66;">${value}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${d.sub || '&nbsp;'}</div>`;
    };
    kpi('kpi-blocked', '今日拦截攻击', d.totalBlocked != null ? d.totalBlocked : '-', 'var(--red)');
    kpi('kpi-rate', '拦截率', d.blockRate != null ? d.blockRate + '%' : '-', 'var(--green)');
    kpi('kpi-active', '活跃会话', d.activeSessions != null ? d.activeSessions : '-', 'var(--cyan)');
    kpi('kpi-abnormal', '异常会话', (d.degradedSessions != null ? d.degradedSessions : '-') + ' 降权 / ' + (d.lockedSessions != null ? d.lockedSessions : '-') + ' 锁定', 'var(--orange)');
}

/* 2) 攻击类型分布：环形图 */
function renderDistChart(list) {
    const el = document.getElementById('overview-dist');
    if (!el) return;
    overviewChartDist = echarts.init(el);
    overviewChartDist.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(10, 22, 40, 0.92)',
            borderColor: 'rgba(0, 212, 255, 0.4)',
            textStyle: { color: '#dce9ff', fontFamily: 'Consolas, monospace', fontSize: 13 },
            formatter: '{b}<br/>{c} 次（{d}%）'
        },
        legend: {
            bottom: 0,
            textStyle: { color: '#7d92b8', fontFamily: 'Consolas, monospace', fontSize: 12 },
            itemWidth: 12, itemHeight: 12
        },
        color: ['#ff5252', '#ffa726', '#00d4ff', '#4fc3f7', '#7c4dff'],
        series: [{
            name: '攻击类型',
            type: 'pie',
            radius: ['42%', '68%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: {
                borderColor: '#0a1628',
                borderWidth: 2,
                shadowBlur: 10,
                shadowColor: 'rgba(0, 212, 255, 0.25)'
            },
            label: { color: '#aab8d0', fontFamily: 'Consolas, monospace', fontSize: 12 },
            labelLine: { lineStyle: { color: 'rgba(0,212,255,0.35)' } },
            emphasis: { scaleSize: 6 },
            data: list.map(x => ({ name: x.name || x.type, value: x.count }))
        }]
    });
    window.addEventListener('resize', () => overviewChartDist && overviewChartDist.resize());
}

/* 3) 攻击拦截趋势：柱状(总请求) + 折线(拦截) */
function renderTrendChart(data) {
    const el = document.getElementById('overview-trend');
    if (!el) return;
    overviewChartTrend = echarts.init(el);
    overviewChartTrend.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(10, 22, 40, 0.92)',
            borderColor: 'rgba(0, 212, 255, 0.4)',
            textStyle: { color: '#dce9ff', fontFamily: 'Consolas, monospace', fontSize: 13 }
        },
        legend: {
            top: 0,
            textStyle: { color: '#7d92b8', fontFamily: 'Consolas, monospace', fontSize: 12 },
            itemWidth: 14, itemHeight: 10
        },
        grid: { left: 52, right: 30, top: 40, bottom: 36 },
        xAxis: {
            type: 'category',
            data: data.map(d => d.timestamp),
            axisLine: { lineStyle: { color: 'rgba(0,212,255,0.3)' } },
            axisLabel: { color: '#7d92b8', fontFamily: 'Consolas, monospace' },
            splitLine: { show: false }
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: '#7d92b8', fontFamily: 'Consolas, monospace' },
            splitLine: { lineStyle: { color: 'rgba(0,212,255,0.10)' } }
        },
        series: [
            {
                name: '总请求', type: 'bar', barWidth: 14,
                data: data.map(d => d.total),
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(79, 195, 247, 0.55)' },
                        { offset: 1, color: 'rgba(79, 195, 247, 0.08)' }
                    ]),
                    borderRadius: [3, 3, 0, 0]
                }
            },
            {
                name: '拦截数', type: 'line', smooth: true,
                symbol: 'circle', symbolSize: 6,
                data: data.map(d => d.blocked),
                lineStyle: {
                    width: 3, color: '#ff5252',
                    shadowColor: 'rgba(255, 82, 82, 0.5)', shadowBlur: 12
                },
                itemStyle: { color: '#ff5252' }
            }
        ]
    });
    window.addEventListener('resize', () => overviewChartTrend && overviewChartTrend.resize());
}
