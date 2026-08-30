/**
 * 溯源视图 —— D3 完整实现（mock 数据驱动）· SOC 深色科技版
 * 血缘链路图：污染源 → 命中会话 → 越权调用 → 拦截/降权
 * D4 切真实接口后无需改本文件（数据由 api.js 统一分发）
 */
let traceChart = null;

/* 节点分类：中文名 + 颜色 */
const TRACE_CATEGORIES = [
    { name: '污染源', color: '#ff5252' },
    { name: '会话',   color: '#ffa726' },
    { name: '调用',   color: '#00d4ff' },
    { name: '结果',   color: '#00e676' }
];

async function loadTrace() {
    const container = document.getElementById('page-container');
    container.innerHTML = `
        <div class="panel-grid">
            <div class="card card-wide">
                <div class="card-title">攻击溯源血缘图
                    <span class="card-sub">污染源 → 命中会话 → 越权调用 → 拦截 / 降权</span>
                </div>
                <div id="trace-chart" class="chart-box chart-box-lg"></div>
            </div>
            <div class="card card-wide">
                <div class="card-title">链路节点明细
                    <span class="card-sub">点击血缘图节点可高亮其上下游</span>
                </div>
                <div class="table-scroll"><div id="trace-table"></div></div>
            </div>
        </div>`;

    const json = await apiGet('/api/agent/trace/chain');
    renderTraceChart(json.data || { nodes: [], links: [] });
    renderTraceTable((json.data && json.data.nodes) || []);
}

/* 1) 血缘图：graph 关系图，按分类着色 */
function renderTraceChart(data) {
    const el = document.getElementById('trace-chart');
    if (!el) return;
    traceChart = echarts.init(el);

    const catIndex = name => TRACE_CATEGORIES.findIndex(c => c.name === name);
    const nodes = data.nodes.map(n => {
        const ci = catIndex(n.category) >= 0 ? catIndex(n.category) : 0;
        return {
            id: n.id,
            name: n.name,
            category: ci,
            value: n.desc || '',
            symbolSize: n.category === 'source' ? 46 : (n.category === 'result' ? 40 : 36),
            label: {
                show: true,
                color: '#dce9ff',
                fontSize: 12,
                fontFamily: 'Consolas, monospace'
            },
            itemStyle: {
                shadowBlur: 12,
                shadowColor: TRACE_CATEGORIES[ci].color + '55'
            }
        };
    });

    traceChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(10, 22, 40, 0.92)',
            borderColor: 'rgba(0, 212, 255, 0.4)',
            textStyle: { color: '#dce9ff', fontFamily: 'Consolas, monospace', fontSize: 13 },
            formatter: p => '<b>' + p.name + '</b><br/>' + (p.value || '')
        },
        legend: {
            top: 4,
            textStyle: { color: '#7d92b8', fontFamily: 'Consolas, monospace', fontSize: 12 },
            itemWidth: 14, itemHeight: 10
        },
        animationDurationUpdate: 600,
        animationEasingUpdate: 'quinticInOut',
        series: [{
            type: 'graph',
            layout: 'force',
            roam: true,
            draggable: true,
            categories: TRACE_CATEGORIES,
            data: nodes,
            links: data.links.map(l => ({
                source: l.source,
                target: l.target,
                lineStyle: {
                    color: 'rgba(0, 212, 255, 0.55)',
                    width: 2,
                    curveness: 0.12
                }
            })),
            label: { position: 'bottom' },
            emphasis: {
                focus: 'adjacency',
                lineStyle: { width: 4, color: '#00d4ff' }
            },
            force: {
                repulsion: 420,
                edgeLength: 120,
                gravity: 0.12
            }
        }]
    });
    window.addEventListener('resize', () => traceChart && traceChart.resize());
}

/* 2) 节点明细表 */
function renderTraceTable(nodes) {
    const el = document.getElementById('trace-table');
    if (!nodes.length) { el.innerHTML = '<div class="empty">暂无溯源数据</div>'; return; }
    el.innerHTML = `<table class="data-table">
        <thead><tr><th>节点</th><th>类型</th><th>说明</th></tr></thead>
        <tbody>${nodes.map(n => `
            <tr>
                <td>${n.name}</td>
                <td><span class="tag">${n.category}</span></td>
                <td>${n.desc || '-'}</td>
            </tr>`).join('')}
        </tbody></table>`;
}
