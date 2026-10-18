/**
 * ============================================================
 * 恒盾智航 · 答辩自动化演示平台 (server.js)
 * ------------------------------------------------------------
 * 零依赖 Node 服务：
 *   - 静态托管 public/index.html（左侧终端 + 右侧命令面板）
 *   - POST /api/run   按卡片串行执行命令（前一条退出后自动执行下一条）
 *   - GET  /api/stream SSE 实时推送输出 → 浏览器左侧终端同步变化
 *   - service 类型命令：后台启动后端(node app.js)并轮询 3000 端口就绪
 *   - fetch 类型命令  ：直接请求本地后端接口，格式化输出（无需 curl）
 *
 * 启动：node demo-platform/server.js   →  http://localhost:8787
 * ============================================================
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8787;
const BACKEND = path.join(__dirname, '..', 'backend');
const PUBLIC = path.join(__dirname, 'public');
const API_BASE = 'http://127.0.0.1:3000';

let running = false;
let cancelFlag = false;
let serviceUp = false;
const clients = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function broadcast(type, data) {
  for (const c of clients) {
    c.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/** 探测后端服务 3000 端口是否就绪 */
async function waitService(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      await fetch(API_BASE + '/', { signal: AbortSignal.timeout(800) });
      return true;
    } catch (_) { /* 连接拒绝 = 未就绪 */ }
    await sleep(400);
  }
  return false;
}

/** 后台启动后端服务 */
async function runService(cmd) {
  if (serviceUp) {
    broadcast('out', { data: `\n[后端] 服务已在运行 (${API_BASE})，跳过启动。\n` });
    return;
  }
  broadcast('out', { data: `\n> ${cmd.cmd}   // ${cmd.purpose}\n` });
  const child = spawn('node', ['app.js'], { cwd: BACKEND, shell: false, env: process.env });
  child.stdout.on('data', (d) => broadcast('out', { data: d.toString() }));
  child.stderr.on('data', (d) => broadcast('err', { data: d.toString() }));
  child.on('error', (e) => broadcast('err', { data: '[后端] 启动失败: ' + e.message + '\n' }));
  const ok = await waitService();
  if (ok) {
    serviceUp = true;
    broadcast('out', { data: `\n[后端] 就绪：${API_BASE}（HTTP 200 探测通过）\n` });
  } else {
    broadcast('err', { data: '\n[后端] 15 秒内未就绪，请检查 3000 端口占用或依赖是否安装。\n' });
  }
}

/** 执行一条 shell 命令（node 脚本），等待退出后 resolve */
function runShell(cmd) {
  return new Promise((resolve) => {
    broadcast('out', { data: `\n> ${cmd.cmd}${cmd.purpose ? '   // ' + cmd.purpose : ''}\n` });
    const parts = cmd.cmd.trim().split(/\s+/);
    const prog = parts.shift();
    const child = spawn(prog, parts, { cwd: cmd.cwd || BACKEND, shell: false, env: process.env });
    child.stdout.on('data', (d) => broadcast('out', { data: d.toString() }));
    child.stderr.on('data', (d) => broadcast('err', { data: d.toString() }));
    child.on('error', (e) => {
      broadcast('err', { data: '\n[执行失败] ' + e.message + '\n' });
      resolve();
    });
    child.on('close', (code) => {
      broadcast('exit', { code });
      resolve();
    });
  });
}

/** 执行一条本地接口请求（演示无前端实时交互） */
async function runFetch(cmd, input) {
  const url = cmd.url.startsWith('http') ? cmd.url : API_BASE + cmd.url;
  const body = cmd.body ? JSON.parse(JSON.stringify(cmd.body)) : undefined;
  if (body && body.__INPUT__ !== undefined && input) body[cmd.inputKey || 'text'] = input;
  delete body.__INPUT__;
  broadcast('out', { data: `\n> ${cmd.method || 'POST'} ${url}${cmd.purpose ? '   // ' + cmd.purpose : ''}\n` });
  try {
    const r = await fetch(url, {
      method: cmd.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json();
    broadcast('out', { data: '\n' + JSON.stringify(j, null, 2) + '\n' });
  } catch (e) {
    broadcast('err', { data: '\n[接口请求失败] ' + e.message + '（请先启动后端服务）\n' });
  }
}

/** 按卡片串行执行全部命令 */
async function runCard(card, input) {
  running = true;
  cancelFlag = false;
  broadcast('status', { state: 'running', card: card.id, title: card.title });
  broadcast('out', { data: `\n===== 演示：${card.title} =====\n` });
  for (const cmd of card.commands) {
    if (cancelFlag) break;
    if (cmd.type === 'shell') await runShell(cmd);
    else if (cmd.type === 'service') await runService(cmd);
    else if (cmd.type === 'fetch') await runFetch(cmd, input);
  }
  broadcast('out', { data: `\n===== 演示完成：${card.title} =====\n` });
  broadcast('status', { state: 'idle', card: card.id });
  running = false;
}

/* ============================================================
 * 演示剧本：8 个卡片覆盖全部 7 项创新点 + 实时接口互动
 * 每条命令均含：命令行 / 运行目的 / 前沿文献出处与必要性
 * ============================================================ */
const SCRIPTS = [
  {
    id: 'c1',
    title: '创新点① 三道防线·防护闭环',
    brief: '入口 Guardrail → 过程 PEP 授权 → 后果脱敏免疫，单条命令跑完四阶段攻防闭环',
    commands: [
      {
        type: 'shell',
        cmd: 'node agent/attack-demo.js',
        purpose: '四阶段闭环演示：注入拦截 → 越权拒绝 → 信任锁定 → 免疫恢复',
        ref: 'USENIX Security 2026 实测 12 个主流语义防御自适应绕过率 >90% —— 单点检测防线不可靠，必须按零信任做"入口/过程/后果"三道防线闭环；OWASP LLM Top 10 将提示注入列为首位风险(LLM01)。',
      },
    ],
  },
  {
    id: 'c2',
    title: '创新点② PEP+JIT 动作级授权',
    brief: '默认拒绝 + 7 秒一次性令牌，重放即拒，授权不赌模型检出率',
    commands: [
      {
        type: 'service',
        cmd: 'node app.js',
        purpose: '启动后端服务，为授权重放演示提供运行环境（自动探测 3000 端口就绪）',
        ref: 'NIST SP 800-207《Zero Trust Architecture》默认拒绝与最小权限原则；Google BeyondCorp 模型提出 JIT 短时访问凭证。',
      },
      {
        type: 'shell',
        cmd: 'node attack.js replay',
        purpose: '演示 JIT 一次性令牌被重放时被拒绝：HMAC-SHA256 + TTL 7000ms + 用毕即焚',
        ref: '源码 pep-guard.js：白名单默认拒绝、TTL=7000ms、HMAC-SHA256 令牌——对应 BeyondCorp JIT 一次性凭证与 NIST 800-207 最小权限。',
      },
    ],
  },
  {
    id: 'c3',
    title: '创新点③ 三维动态信任引擎',
    brief: '身份/行为/证据三维加权，Beta 先验起步 70 分，降得快、升得慢',
    commands: [
      {
        type: 'shell',
        cmd: 'node agent/attack-demo.js',
        purpose: '观察信任分逐行变化：违规命中 -2.0/-1.0 重罚，正常操作仅 +0.2/+0.3/+0.1 慢回升，直至降权→锁定',
        ref: '源码 trust-engine.js：Beta(7,3) 先验期望 70 分、三维权重 0.4/0.35/0.25、降权阈值 60 / 锁定阈值 30；NIST SP 800-207 提出对主体身份、行为进行持续信任评估而非一次性认证。',
      },
    ],
  },
  {
    id: 'c4',
    title: '创新点④ ARTII 对抗鲁棒免疫裁决',
    brief: 'SEIR 感染态隔离 + FTRL 在线学习 + ℓ∞ 认证下界，锁定语义可证明',
    commands: [
      {
        type: 'shell',
        cmd: 'node agent/attack-demo.js',
        purpose: '阶段3 连续投喂恶意证据 → 进入感染态并锁定隔离；阶段4 免疫恢复。算法单测 103 用例（SEIR/FTRL/ℓ∞/Πρ 截断）为历史实测记录',
        ref: 'SEIR 流行病学模型(Kermack & McKendrick 1927)；FTRL-Proximal 在线学习(McMahan et al. 2013, ADB)；ℓ∞ 鲁棒性认证下界(Hein & Andriushchenko 2017, ICML)——为"锁死"提供可证明边界，非拍脑袋阈值。',
      },
    ],
  },
  {
    id: 'c5',
    title: '创新点⑤ 污染指纹·跨会话免疫',
    brief: 'SM3 精确 + SimHash 近似 ≤6 归并同家族，打一次全网记得并可溯源',
    commands: [
      {
        type: 'shell',
        cmd: 'node agent/attack-demo.js',
        purpose: '阶段1 变体归并（同家族载荷 hitCount≥3 合并）；阶段4 免疫标记后同源攻击不再告警',
        ref: 'SimHash 局部敏感哈希(Charikar 2002, STOC)；SM3 国密摘要(GB/T 32905-2016)；Lakera 53.19%、Prompt Guard 38.48% 绕过率评测表明商用防护无跨会话攻击记忆，本作品以指纹库 + 血缘日志补上该短板。',
      },
      {
        type: 'fetch',
        method: 'GET',
        url: '/api/trust/stats',
        purpose: '实时查询指纹库 / 信任状态 / 血缘统计，证明"打一次全网记得"',
        ref: '接口契约 routes/trust.js：stats 返回指纹库与血缘统计，供评委现场核验数据真实性。',
      },
    ],
  },
  {
    id: 'c6',
    title: '创新点⑥ 轻量化纵深落地',
    brief: '同机同载荷黑盒回归，性能与防御双实证，禁绝对数字',
    commands: [
      {
        type: 'shell',
        cmd: 'node tests/run-regression.js --all',
        purpose: '全量回归：150 攻击 + 91 FAQ 同机实测，输出检出率 / 误报率 / P95 延迟 / 信任迁移 / 血缘 trace_ok',
        ref: 'Palit et al. 2025 独立基准（7 款商用防护最优召回仅 0.501）；NeMo Guardrails 评测误报 16.22%、单条延迟 1.38s；报告第 3 章实测 RPS 1338、内存 77MB、进程损耗 7.1% —— 轻量纵深是对照组可复现的落地优势。',
      },
    ],
  },
  {
    id: 'c7',
    title: '创新点⑦ 可插拔 LLM 适配器',
    brief: '默认 rule_engine 本地裁决，大模型后端可插拔，供应链依赖最小化',
    commands: [
      {
        type: 'service',
        cmd: 'node app.js',
        purpose: '确保后端服务在运行（已在运行则跳过）',
        ref: '源码 llm-adapter.js：rule_engine / 大模型等多后端可插拔；OWASP 与业界供应链报告提示外部模型依赖存在投毒与数据出境风险。',
      },
      {
        type: 'fetch',
        method: 'POST',
        url: '/api/trust/check',
        body: { text: '帮我查一下航班的起飞时间', session_token: 'demo-llm', terminal_id: 'demo' },
        purpose: '正常业务话术 → 未命中污染指纹、信任分不降，证明默认规则引擎可独立完成裁决（零外部大模型依赖）',
        ref: '接口契约 routes/trust.js check 接口；与 LLM01 提示注入风险形成对照。',
      },
    ],
  },
  {
    id: 'c8',
    title: '实时接口互动 · 评委现场给一句话',
    brief: '无前端创新点演示动作：现场输入任意攻击/正常话术，实时返回裁决结果',
    commands: [
      {
        type: 'service',
        cmd: 'node app.js',
        purpose: '确保后端服务在运行（已在运行则跳过）',
        ref: '见创新点②出处。',
      },
      {
        type: 'fetch',
        method: 'POST',
        url: '/api/trust/check',
        body: { __INPUT__: true, session_token: 'demo-live', terminal_id: 'demo' },
        purpose: '现场输入的话术实时过检：返回 hit/exact/similar、SimHash 距离、指纹摘要与信任分变化',
        ref: '演示策略文档"无前端演示逻辑"：终端攻防屏更可信，接口即证据。',
      },
    ],
  },
];

/* ============================================================
 * HTTP 服务
 * ============================================================ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // 静态页面
  if (p === '/' || p === '/index.html') {
    const f = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(f));
  }

  // 剧本数据
  if (p === '/api/scripts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(SCRIPTS, null, 2));
  }

  // SSE 流
  if (p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // 执行卡片
  if (p === '/api/run' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let payload = {};
    try { payload = JSON.parse(body); } catch (_) { /* ignore */ }

    if (running) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, msg: '有演示正在执行中，请稍候或先停止' }));
    }

    // 特判：启动服务按钮 / 全部演示
    if (payload.action === 'service') {
      running = true;
      broadcast('status', { state: 'running', card: '__service__' });
      await runService({ type: 'service', cmd: 'node app.js', purpose: '启动后端服务' });
      broadcast('status', { state: 'idle' });
      running = false;
      return res.end(JSON.stringify({ ok: true }));
    }
    if (payload.action === 'all') {
      for (const c of SCRIPTS.filter((x) => x.id !== 'c8')) await runCard(c);
      return res.end(JSON.stringify({ ok: true }));
    }

    const card = SCRIPTS.find((c) => c.id === payload.cardId);
    if (!card) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, msg: '未找到该演示卡片' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    runCard(card, payload.input).catch((e) => broadcast('err', { data: '\n[平台异常] ' + e.message + '\n' }));
    return;
  }

  // 停止当前演示
  if (p === '/api/stop' && req.method === 'POST') {
    cancelFlag = true;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 状态
  if (p === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ running, serviceUp }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`\n  恒盾智航 · 答辩自动化演示平台`);
  console.log(`  浏览器打开:  http://localhost:${PORT}`);
  console.log(`  后端工作目录: ${BACKEND}\n`);
});
