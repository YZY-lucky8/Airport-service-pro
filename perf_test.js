/**
 * 性能压测脚本 - 获取真实性能数据
 * 测试：并发能力、平均响应时间、请求成功率、Agent延迟、内存占用、防护损耗
 */
const http = require('http');

const BASE = 'http://127.0.0.1:3000';

// 辅助：发送HTTP请求
function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 辅助：并发请求
async function concurrentRequests(path, method, body, concurrency, total) {
  const results = [];
  const start = Date.now();
  let done = 0;
  
  async function worker() {
    while (done < total) {
      const idx = done++;
      const t0 = Date.now();
      try {
        const r = await request(path, method, { ...body, session_token: `perf_${idx}` });
        results.push({ status: r.status, latency: Date.now() - t0, body: r.body });
      } catch (e) {
        results.push({ status: 0, latency: Date.now() - t0, error: e.message });
      }
    }
  }
  
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  
  const totalTime = Date.now() - start;
  const success = results.filter(r => r.status === 200).length;
  const latencies = results.filter(r => r.status === 200).map(r => r.latency);
  const agentLatencies = results.filter(r => r.body && r.body.latency).map(r => r.body.latency);
  
  return {
    total,
    concurrency,
    totalTime,
    rps: (total / (totalTime / 1000)).toFixed(1),
    successRate: ((success / total) * 100).toFixed(2) + '%',
    avgLatency: latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) + 'ms' : 'N/A',
    p95Latency: latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] + 'ms' : 'N/A',
    avgAgentLatency: agentLatencies.length ? (agentLatencies.reduce((a, b) => a + b, 0) / agentLatencies.length).toFixed(1) + 'ms' : 'N/A',
    failed: total - success
  };
}

async function main() {
  console.log('========================================');
  console.log('  机场智能终端系统 - 性能压测报告');
  console.log('========================================\n');

  // 1. 健康检查 & 初始内存
  console.log('【1】系统健康检查');
  const health = await request('/api/health');
  console.log(`  状态: ${health.body.status}`);
  console.log(`  数据库: ${health.body.db}`);
  console.log(`  初始内存: ${health.body.memory}`);
  console.log(`  运行时长: ${health.body.uptime.toFixed(1)}s\n`);

  // 2. Agent延迟测试（单请求，100次）
  console.log('【2】Agent 规则引擎延迟测试（100次请求）');
  const agentTest = await concurrentRequests('/api/agent/chat', 'POST', { text: '帮我查CA1234' }, 1, 100);
  console.log(`  平均端到端延迟: ${agentTest.avgLatency}`);
  console.log(`  P95端到端延迟: ${agentTest.p95Latency}`);
  console.log(`  平均Agent处理延迟: ${agentTest.avgAgentLatency}`);
  console.log(`  成功率: ${agentTest.successRate}\n`);

  // 3. 并发测试 - 100并发
  console.log('【3】并发测试 - 100并发 / 500请求');
  const c100 = await concurrentRequests('/api/agent/chat', 'POST', { text: '充电宝能带吗' }, 100, 500);
  console.log(`  RPS: ${c100.rps}`);
  console.log(`  平均延迟: ${c100.avgLatency}`);
  console.log(`  P95延迟: ${c100.p95Latency}`);
  console.log(`  成功率: ${c100.successRate}`);
  console.log(`  失败数: ${c100.failed}\n`);

  // 4. 并发测试 - 500并发
  console.log('【4】并发测试 - 500并发 / 1000请求');
  const c500 = await concurrentRequests('/api/agent/chat', 'POST', { text: '你好' }, 500, 1000);
  console.log(`  RPS: ${c500.rps}`);
  console.log(`  平均延迟: ${c500.avgLatency}`);
  console.log(`  P95延迟: ${c500.p95Latency}`);
  console.log(`  成功率: ${c500.successRate}`);
  console.log(`  失败数: ${c500.failed}\n`);

  // 5. 并发测试 - 1000并发
  console.log('【5】并发测试 - 1000并发 / 2000请求');
  const c1000 = await concurrentRequests('/api/agent/chat', 'POST', { text: '你好' }, 1000, 2000);
  console.log(`  RPS: ${c1000.rps}`);
  console.log(`  平均延迟: ${c1000.avgLatency}`);
  console.log(`  P95延迟: ${c1000.p95Latency}`);
  console.log(`  成功率: ${c1000.successRate}`);
  console.log(`  失败数: ${c1000.failed}\n`);

  // 6. 稳定运行后内存
  console.log('【6】压测后内存占用');
  // 等待几秒让GC
  await new Promise(r => setTimeout(r, 3000));
  const health2 = await request('/api/health');
  console.log(`  压测后内存: ${health2.body.memory}`);
  console.log(`  运行时长: ${health2.body.uptime.toFixed(1)}s\n`);

  // 7. 不同意图的延迟测试
  console.log('【7】不同业务意图延迟测试（各50次）');
  const intents = [
    { name: '航班查询', text: '帮我查CA1234' },
    { name: '知识库问答', text: '充电宝能带吗' },
    { name: '地点导航', text: '洗手间在哪' },
    { name: '闲聊', text: '你好' },
    { name: '情感感知', text: '我赶不上飞机了怎么办' },
  ];
  for (const intent of intents) {
    const r = await concurrentRequests('/api/agent/chat', 'POST', { text: intent.text }, 1, 50);
    console.log(`  ${intent.name}: 端到端${r.avgLatency}, Agent处理${r.avgAgentLatency}, 成功率${r.successRate}`);
  }

  console.log('\n========================================');
  console.log('  压测完成');
  console.log('========================================');
}

main().catch(console.error);
