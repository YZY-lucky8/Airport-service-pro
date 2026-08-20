/**
 * 补充测试：管理端接口 + 修正后的公开接口
 */
const http = require('http');

function request(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json', ...headers }
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 补充测试：管理端接口 ===\n');
  
  // 登录
  console.log('1. 管理员登录 (admin/admin)');
  const login = await request('/api/auth/login', 'POST', { username: 'admin', password: 'admin' });
  console.log(`   结果: HTTP ${login.status}, token: ${login.body?.token ? '已获取' : '失败'}`);
  console.log(`   响应: ${JSON.stringify(login.body).substring(0, 100)}\n`);
  
  if (!login.body?.token) {
    console.log('登录失败，退出');
    return;
  }
  
  const token = login.body.token;
  const auth = { 'Authorization': `Bearer ${token}` };
  
  // 管理端接口测试
  const adminApis = [
    { path: '/api/auth/verify', method: 'POST', name: 'Token验证' },
    { path: '/api/auth/admins', name: '管理员列表' },
    { path: '/api/admin/dashboard', name: '管理仪表盘' },
    { path: '/api/terminals', name: '终端列表' },
    { path: '/api/alerts', name: '告警列表' },
    { path: '/api/usage-stats', name: '使用统计' },
    { path: '/api/faq-stats', name: 'FAQ统计' },
    { path: '/api/call-records', name: '通话记录' },
    { path: '/api/attack-status', name: '攻击状态' },
    { path: '/api/whitelist', name: '白名单列表' },
    { path: '/api/blacklist', name: '黑名单列表' },
    { path: '/api/defense-logs', name: '防护日志' },
    { path: '/api/audit-logs', name: '审计日志' },
    { path: '/api/audit/logs', name: '审计日志v2' },
    { path: '/api/audit/report', name: '审计报告' },
  ];
  
  console.log('2. 管理端接口测试');
  let passed = 0, failed = 0;
  for (const api of adminApis) {
    await sleep(200);
    try {
      const r = await request(api.path, api.method || 'GET', null, auth);
      if (r.status === 200) {
        passed++;
        console.log(`   ✅ ${api.name}: HTTP 200`);
      } else {
        failed++;
        console.log(`   ❌ ${api.name}: HTTP ${r.status} - ${JSON.stringify(r.body).substring(0,60)}`);
      }
    } catch(e) {
      failed++;
      console.log(`   ❌ ${api.name}: ${e.message}`);
    }
  }
  console.log(`   管理端: ${passed}/${adminApis.length} 通过\n`);
  
  // 修正后的公开接口
  console.log('3. 修正后的公开接口测试');
  const fixedApis = [
    { path: '/api/weather?city=' + encodeURIComponent('北京'), name: '天气查询(URL编码)' },
    { path: '/api/agent/stats/overview', name: 'Agent运行统计' },
    { path: '/api/agent/stats/emotion', name: '情感分析统计' },
    { path: '/api/hourly-stats', name: '小时统计' },
  ];
  
  let p2 = 0, f2 = 0;
  for (const api of fixedApis) {
    await sleep(200);
    try {
      const r = await request(api.path);
      if (r.status === 200) {
        p2++;
        console.log(`   ✅ ${api.name}: HTTP 200 - ${JSON.stringify(r.body).substring(0,60)}`);
      } else {
        f2++;
        console.log(`   ❌ ${api.name}: HTTP ${r.status} - ${JSON.stringify(r.body).substring(0,80)}`);
      }
    } catch(e) {
      f2++;
      console.log(`   ❌ ${api.name}: ${e.message}`);
    }
  }
  console.log(`   修正接口: ${p2}/${fixedApis.length} 通过\n`);
  
  // 汇总
  console.log('=== 汇总 ===');
  console.log(`管理端接口: ${passed}/${adminApis.length} 通过`);
  console.log(`修正公开接口: ${p2}/${fixedApis.length} 通过`);
  console.log(`加上之前通过的19个公开接口，总计: ${19 + passed + p2} 个接口通过`);
}

main().catch(console.error);
