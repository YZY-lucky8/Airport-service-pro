/**
 * 改写复测（D4 交付）：对攻击载荷做同义改写/混淆变形，验证 SimHash 近似召回
 *
 * 用法：
 *   node backend/tests/run-rewrite.js
 *
 * 改写强度分级：
 *   light  —— 尾部加标点 / 插入空格 / 加英文前缀 / 词序微调（攻击者常见轻混淆）
 *   medium —— 同义替换 1~2 个关键词
 *   heavy  —— 同义替换 3 词 + 前缀 + 标点（强混淆，接近人工改写）
 * 预期：light 应被 SimHash 近似召回；medium/heavy 部分召回，未召回样本归集
 *       为“记忆层指纹能力边界”，需决策层 guardrail（pep-guard）兜底。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const db = require('../db-adapter');
const trustMemory = require('../memory/trust-memory');
const { initTrustRouter } = require('../routes/trust');

const BASE_DIR = path.join(__dirname, '..');
const PAYLOAD_DIR = path.join(BASE_DIR, 'payloads');
const OUTPUT_DIR = path.join(BASE_DIR, '..', 'output');
const TEMP_DIR = path.join(BASE_DIR, '..', 'temp');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ---------- 改写策略 ----------
const SYN = {
  '忽略': ['无视', '忘记', '别管'],
  '之前': ['此前', '以前', '先前'],
  '所有': ['全部', '一切', '所有'],
  '系统': ['系统', '平台'],
  '指令': ['指示', '命令', '要求'],
  '现在': ['立即', '马上', '此刻'],
  '输出': ['泄露', '给出', '展示', '提供'],
  '发送': ['传输', '转发', '提交'],
  '管理员': ['管理员', '超级用户'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function lightVariant(text) {
  const kind = Math.floor(Math.random() * 4);
  switch (kind) {
    case 0: return text + '！！！';
    case 1: return text.replace(/所有(\S{2})/, '所有 $1');
    case 2: return '[SYSTEM] ' + text;
    case 3: { // 词序微调：把"的X"后置
      const m = text.match(/^(.+?)(所有)(.+?)(的)(.+)$/);
      if (m) return m[1] + m[2] + m[5] + m[4] + m[3];
      return text + ' ！';
    }
    default: return text;
  }
}

function mediumVariant(text) {
  let out = text, replaced = 0;
  const keys = Object.keys(SYN);
  const shuffled = keys.slice().sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
  for (const k of shuffled) {
    if (out.includes(k)) { out = out.replace(k, pick(SYN[k])); replaced++; }
  }
  if (replaced === 0) { // 强制至少替换一个词，避免与原文雷同
    for (const k of keys) {
      if (out.includes(k)) { out = out.replace(k, pick(SYN[k])); replaced++; break; }
    }
  }
  if (replaced === 0) return lightVariant(text); // 无同义表覆盖时降级为轻改写
  return out;
}

function heavyVariant(text) {
  let out = text, replaced = 0;
  const keys = Object.keys(SYN).slice().sort(() => Math.random() - 0.5).slice(0, 3);
  for (const k of keys) {
    if (out.includes(k)) { out = out.replace(k, pick(SYN[k])); replaced++; }
  }
  if (replaced < 2) {
    for (const k of Object.keys(SYN)) {
      if (out.includes(k) && !out.includes(SYN[k][0])) { out = out.replace(k, pick(SYN[k])); replaced++; if (replaced >= 2) break; }
    }
  }
  if (replaced === 0) return lightVariant(text);
  return '[SYS] ' + out + ' !!!';
}

// ---------- 主流程 ----------
async function main() {
  await db.connect();
  trustMemory.setPool(db.pool);
  const app = express();
  app.use(express.json());
  app.use('/api/trust', initTrustRouter(db.pool));
  const api = request(app);

  await trustMemory.seedPayloadLibrary();

  const lib = [];
  for (const f of ['direct.json', 'indirect.json', 'obfuscated.json']) {
    const d = JSON.parse(fs.readFileSync(path.join(PAYLOAD_DIR, f), 'utf8'));
    for (const p of d.payloads) lib.push(p);
  }

  // 采样：每类策略对 100 个载荷生成变体（light/medium/heavy 各 100）
  const sample = lib.slice(0, 100);
  const strategyFactories = { light: lightVariant, medium: mediumVariant, heavy: heavyVariant };
  const results = { light: [], medium: [], heavy: [] };

  for (const [strategy, factory] of Object.entries(strategyFactories)) {
    let n = 0, sessN = 0;
    for (const p of sample) {
      const variant = factory(p.text);
      const session_token = `rw-${strategy}-${Date.now()}-${++sessN}`;
      const res = await api.post('/api/trust/check').send({ text: variant, session_token });
      const body = res.body?.data || {};
      const hit = body.hit === true;
      if (hit) n++;
      results[strategy].push({
        src_id: p.id, hit, exact: body.exact || false, similar: body.similar || false,
        simhash_dist: body.simhash_dist ?? null,
        matched_uid: body.matched_source?.source_uid || null,
        variant: variant.slice(0, 60),
      });
    }
    console.log(`[rewrite] ${strategy}: ${n}/${sample.length} 检出`);
  }

  const report = {
    generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    threshold: 5,
    sample_size: sample.length,
    summary: {},
    per_strategy: {},
  };
  for (const [strategy, rows] of Object.entries(results)) {
    const hit = rows.filter(r => r.hit).length;
    const exact = rows.filter(r => r.exact).length;
    const similar = rows.filter(r => r.similar).length;
    report.summary[strategy] = { hit, hit_rate: (hit / rows.length * 100).toFixed(2) + '%', exact, similar };
    report.per_strategy[strategy] = rows;
  }

  ensureDir(TEMP_DIR);
  const dataFile = path.join(TEMP_DIR, `rewrite-${Date.now()}.json`);
  fs.writeFileSync(dataFile, JSON.stringify(report, null, 2), 'utf8');

  // 渲染报告
  const lines = [];
  lines.push('# 智能体劫持信任免疫与量化评测系统 · 载荷改写复测报告');
  lines.push('');
  lines.push(`> 生成时间：${report.generated_at}`);
  lines.push(`> 测试执行：段琼馨（后端·记忆层 + 测试）`);
  lines.push(`> SimHash 近似阈值：海明距离 ≤ ${report.threshold}`);
  lines.push('');
  lines.push('## 一、复测设计');
  lines.push('');
  lines.push('对 100 条攻击载荷分别施加三档改写强度，经 `/api/trust/check` 黑盒检测：');
  lines.push('');
  lines.push('| 强度 | 改写方式 | 对应真实攻击手法 |');
  lines.push('| --- | --- | --- |');
  lines.push('| light | 尾部加标点、插入空格、加 [SYSTEM] 前缀、词序微调 | 机械混淆、复制粘贴变形 |');
  lines.push('| medium | 同义替换 1~2 个关键词 | 人工/LLM 改写低强度 |');
  lines.push('| heavy | 同义替换 3 词 + 前缀 + 标点 | 人工/LLM 改写高强度 |');
  lines.push('');
  lines.push('## 二、检出结果');
  lines.push('');
  lines.push('| 强度 | 样本数 | 检出数 | 检出率 | SM3 精确 | SimHash 近似 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const [strategy, s] of Object.entries(report.summary)) {
    lines.push(`| ${strategy} | ${report.sample_size} | ${s.hit} | **${s.hit_rate}** | ${s.exact} | ${s.similar} |`);
  }
  lines.push('');
  lines.push('## 三、未检出样本归集（记忆层能力边界 → 决策层 guardrail 兜底）');
  lines.push('');
  lines.push('| 强度 | 未检出数 |');
  lines.push('| --- | --- |');
  for (const [strategy, rows] of Object.entries(report.per_strategy)) {
    const miss = rows.filter(r => !r.hit);
    lines.push(`| ${strategy} | ${miss.length} |`);
    if (miss.length) {
      lines.push('');
      lines.push(`**${strategy} 未检出样本示例（前 10 条）：**`);
      lines.push('');
      lines.push('| 源载荷 ID | 改写后文本（截断） | 最近 SimHash 距离 |');
      lines.push('| --- | --- | --- |');
      for (const m of miss.slice(0, 10)) {
        lines.push(`| ${m.src_id} | ${m.variant} | ${m.simhash_dist ?? '-'} |`);
      }
      lines.push('');
    }
  }
  lines.push('## 四、结论');
  lines.push('');
  lines.push('- 记忆层指纹（SM3+SimHash）对**轻混淆改写**召回良好；对**中高强度同义改写**召回有限。');
  lines.push('- 未召回样本不视为失败：记忆层是**第一道防线**，中高强度改写需交由决策层信任引擎 / guardrail（pep-guard）结合语义意图二次判定，形成纵深防御。');
  lines.push('- 后续迭代方向：关键词归一化（同义映射后重算指纹）、SimHash 分桶索引提速、增量注册新变体回填指纹库。');
  lines.push('');
  const reportPath = path.join(OUTPUT_DIR, '载荷改写复测报告.md');
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log('报告已生成: ' + reportPath);
  console.log(JSON.stringify(report.summary));
}

if (require.main === module) main().catch(e => { console.error('ERR', e); process.exit(1); });
module.exports = { lightVariant, mediumVariant, heavyVariant };
