---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 3936f21f25e6ba96070df29586ae9321_c368fc10caab11f1acd7525400cd780f
    ReservedCode1: jMeeDSlnfvrihQ+QnsNbOa2mwfvGpgWLiFmLavq8KUJvwwwwDRB0aS3SiQKugghUfLCciU+UpPalo20t8l/4NNGeMPFqm+aTtK+FIzhmnq8LsHDDb6nL0vR47uGwxJel1hmVnZywV37XnWUAkaVKxetc75pDBazZrutKcMwpUFknfC+1rCalQIG3/Jw=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 3936f21f25e6ba96070df29586ae9321_c368fc10caab11f1acd7525400cd780f
    ReservedCode2: jMeeDSlnfvrihQ+QnsNbOa2mwfvGpgWLiFmLavq8KUJvwwwwDRB0aS3SiQKugghUfLCciU+UpPalo20t8l/4NNGeMPFqm+aTtK+FIzhmnq8LsHDDb6nL0vR47uGwxJel1hmVnZywV37XnWUAkaVKxetc75pDBazZrutKcMwpUFknfC+1rCalQIG3/Jw=
---

# 恒盾智航 · 答辩自动化演示平台

将《答辩现场演示策略》中"无前端创新点"部分落地为 **Webview + 终端集成** 的自动化演示工具：
右侧按创新点点击命令按钮，命令在左侧终端区实时执行，前一条退出后**自动执行下一条**，直到该演示完成。

## 快速部署（VS Code）

1. 用 VS Code 打开工作区：`E:\Airport-service-pro`
2. 运行后端依赖（首次）：`npm install`（位于 backend 目录，已有则跳过）
3. 启动平台：
   - 方式 A（推荐）：VS Code 内按 `Ctrl+Shift+P` → 运行任务 →「启动答辩自动化演示平台」；
   - 方式 B：VS Code 终端执行 `node demo-platform/server.js`。
4. 浏览器打开 `http://localhost:8787`（或使用 VS Code Simple Browser / Live Preview）。

> 平台零第三方依赖（仅用 Node 18+ 内置 http / child_process / fetch），不修改任何业务代码，不影响原项目运行。

## 使用说明

- **左侧终端同步区**：接收所有命令输出流，随右侧按钮点击实时变化，自动滚动。
- **右侧演示面板**：8 个卡片覆盖全部 7 项创新点 + 实时接口互动，每卡片含：
  - 功能类型（创新点标题与一句话）
  - 演示动作（命令行 + 运行目的 + 参考出处）
  - 运行按钮（点击后自动串行执行该卡片全部命令）
- **顶部按钮**：启动后端服务 / 停止当前演示 / 清屏 / 全部演示（依次跑①~⑦）。

## 演示卡片与命令矩阵

| 卡片 | 功能类型（创新点） | 演示命令 | 运行目的 | 参考出处 |
|---|---|---|---|---|
| ① | 三道防线·防护闭环 | `node agent/attack-demo.js` | 四阶段闭环：注入拦截→越权拒绝→信任锁定→免疫恢复 | USENIX Security 2026（12 个语义防御自适应绕过>90%）；OWASP LLM Top 10 LLM01 |
| ② | PEP+JIT 动作级授权 | `node app.js` → `node attack.js replay` | JIT 一次性令牌重放被拒（TTL 7000ms / HMAC-SHA256 / 用毕即焚） | NIST SP 800-207 零信任；Google BeyondCorp JIT 凭证 |
| ③ | 三维动态信任引擎 | `node agent/attack-demo.js` | 信任分 70 起步，违规重罚慢回升，直至降权→锁定 | Beta(7,3) 先验；NIST SP 800-207 持续评估 |
| ④ | ARTII 对抗鲁棒免疫裁决 | `node agent/attack-demo.js` | SEIR 感染态锁定 / FTRL 在线学习 / ℓ∞ 认证下界（单测 103 用例为历史实测） | Kermack & McKendrick 1927；McMahan 2013；Hein & Andriushchenko 2017 |
| ⑤ | 污染指纹·跨会话免疫 | `node agent/attack-demo.js` + `GET /api/trust/stats` | 变体归并（≤6）与免疫标记；实时核验指纹库/血缘统计 | Charikar 2002；GB/T 32905-2016；Lakera/Prompt Guard 评测 |
| ⑥ | 轻量化纵深落地 | `node tests/run-regression.js --all` | 150 攻击+91 FAQ 同机回归：检出/误报/P95/信任迁移/血缘 | Palit 2025（七工具召回 0.501）；NeMo 误报 16.22% |
| ⑦ | 可插拔 LLM 适配器 | `node app.js` + `POST /api/trust/check` | 默认 rule_engine 本地裁决，正常业务放行（零外部依赖） | 源码 llm-adapter.js；供应链投毒报告 |
| ⑧ | 实时接口互动 | `node app.js` + `POST /api/trust/check`（现场输入） | 评委给一句话，实时返回 hit/指纹/信任分 | 演示策略"无前端演示逻辑" |

## 现场演示话术（对应策略文档）

- 开场定调：**"前端创新点我们按可复现的终端攻防屏演示，数据全部来自刚才黑盒回归的真实输出。"**
- 无前端部分：点 ⑧ 现场给一句攻击话术，左侧终端直接返回命中结果与指纹摘要，再补一句：**"这就是为什么我们说'即使漏检也打不动'——入口 Guardrail、过程 PEP、后果免疫三层兜底，单个模型误判不影响系统安全边界。"**
- 翻车预案：若命令报错，优先检查后端服务是否已启动（顶部按钮），再检查 3000 端口占用（`netstat -ano | findstr 3000`）。

## 目录结构

```
demo-platform/
├─ server.js            # 零依赖 Node 服务：命令编排 + SSE 推送 + 接口调用
├─ public/index.html    # 左侧终端 + 右侧命令面板（Webview UI）
└─ README.md
.vscode/tasks.json      # VS Code 一键启动任务
```

## 备注

- 平台只读执行业务脚本与接口，不做任何删除/覆盖/配置变更。
- 单测（artii.test.js 等）为 jest 语法，当前环境未装 jest，故以历史实测记录呈现，不纳入平台命令。
- 所有前沿数据均沿用答辩材料已标注来源（USENIX 2026 / Palit 2025 / Lakera / Prompt Guard / NeMo），避免现场无出处硬答。
*（内容由AI生成，仅供参考）*
