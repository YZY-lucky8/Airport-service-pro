---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 3936f21f25e6ba96070df29586ae9321_3460b982a15011f1a238525400e6dd8f
    ReservedCode1: 10f6jWz2dXeq7jkhUzXXCP8OiGEyw2BuesXuQoELklCFvoqEKVWuBUNTKNVdMrXOuXiCogc0oxHAQbVl0oHaPtZMAgN/lUCBM1+QVeNnZreUbRXS8FJHOsJtIlVSMhEsirRQLprKoFOFeWLIZKyv0KbSQaF0LFVL1kCUQQYH5KB3DuSfbi1MpEQnuMg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 3936f21f25e6ba96070df29586ae9321_3460b982a15011f1a238525400e6dd8f
    ReservedCode2: 10f6jWz2dXeq7jkhUzXXCP8OiGEyw2BuesXuQoELklCFvoqEKVWuBUNTKNVdMrXOuXiCogc0oxHAQbVl0oHaPtZMAgN/lUCBM1+QVeNnZreUbRXS8FJHOsJtIlVSMhEsirRQLprKoFOFeWLIZKyv0KbSQaF0LFVL1kCUQQYH5KB3DuSfbi1MpEQnuMg=
---

# 恒盾智航·信疫盾（TrustVax）任务一 API 契约文档

- 版本：V1
- 日期：2026-08-26
- 状态：已落地（pep-guard.js + dispatcher 三处接入 + routes 三信任接口 + 建表迁移）
- 关联模块：`backend/agent/pep-guard.js`、`backend/agent/dispatcher.js`、`backend/routes/agent.js`、`database/agent_schema_v1_pep.sql`

---

## 1. 背景与目标

机场自助终端智能体在开放场景面对**指令劫持（Prompt Hijacking）**风险：攻击者通过构造输入让智能体无授权地执行数据读取、配置变更、外部传输等高危动作。本任务采用**确定性信任免疫**方案（非 LLM 语义抗体），在动作执行点（PEP - Policy Enforcement Point）落地三层确定性防线：

1. **RBAC 角色-动作授权矩阵**：角色无权动作一律拒绝；
2. **敏感操作正则规则**：命中敏感模式且角色权限不足一律拒绝；
3. **JIT 一次性令牌（Just-In-Time Token）**：放行动作绑定单动作 + 7 秒 TTL，执行后作废，防止令牌复用/重放。

量化评测基线（回归测试目标）：攻击成功率 ASR < 5%、PEP 决策延迟 < 10ms、正常请求误拦 0。

---

## 2. 接口总览

| 方法 | 路径 | 鉴权 | 说明 | 新增/沿用 |
|------|------|------|------|-----------|
| POST | `/api/auth/login` | 无 | 登录，签发 JWT（含 `role`） | 沿用 |
| POST | `/api/agent/chat` | 无（会话级） | 智能体对话，响应含 `pep` 决策与可选 `jitToken` | 沿用（响应扩展） |
| GET | `/api/agent/trust/status` | 需登录 | 信任引擎状态总览 | 新增 |
| GET | `/api/agent/trust/sources` | 需登录 | 信任来源清单（RBAC + 敏感正则 + JIT） | 新增 |
| GET | `/api/agent/trust/trace` | 需登录 | PEP 决策审计跟踪（分页/过滤） | 新增 |

三信任接口均为**只读**，不产生任何副作用；鉴权使用既有 `authMiddleware`（JWT，当前体系角色为 `admin`）。

---

## 3. 新增接口详细契约

### 3.1 GET /api/agent/trust/status

信任引擎状态总览，用于运维/前端信任免疫评估页展示引擎健康与决策统计。

请求：

```
GET /api/agent/trust/status
Authorization: Bearer <JWT>
```

响应 200：

```json
{
  "success": true,
  "data": {
    "engine": "PepGuardV1",
    "mode": "deterministic",
    "rbacRoles": ["passenger", "operator", "admin"],
    "sensitiveRuleCount": 4,
    "jit": { "ttlSeconds": 7, "issuedTokens": 0 },
    "decisionStats": { "allow": 0, "deny": 0, "total": 0 }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `engine` | string | 信任引擎标识 |
| `mode` | string | `deterministic` 表示确定性决策，非 LLM 语义 |
| `rbacRoles` | string[] | 已配置角色集 |
| `sensitiveRuleCount` | number | 敏感正则规则条数 |
| `jit.ttlSeconds` | number | JIT 令牌有效期（秒） |
| `jit.issuedTokens` | number | 当前在册未过期令牌数（诊断用） |
| `decisionStats` | object/null | 决策统计；`pep_decision_log` 表不可用时为 `null` |

### 3.2 GET /api/agent/trust/sources

信任来源清单，向用户/审计方说明"信任从哪来"。

请求：

```
GET /api/agent/trust/sources
Authorization: Bearer <JWT>
```

响应 200：

```json
{
  "success": true,
  "data": [
    {
      "id": "rbac_matrix",
      "name": "角色-动作授权矩阵",
      "type": "RBAC",
      "detail": {
        "passenger": ["query_flight", "query_gate", "query_baggage", "search_knowledge", "navigate_location", "query_weather", "emotion_soothe", "small_talk_reply"],
        "operator": [ "passenger 全集 + check_in, generate_itinerary" ],
        "admin": [ "operator 全集 + security_analyze" ]
      }
    },
    {
      "id": "sensitive_rules",
      "name": "敏感操作正则规则",
      "type": "REGEX",
      "detail": [
        { "id": "data_mutation", "desc": "数据删改（订单/航班/用户记录）", "requiredRole": "admin" },
        { "id": "pii_read", "desc": "读取个人隐私(PII)", "requiredRole": "admin" },
        { "id": "data_exfiltration", "desc": "数据外发（外部远程传输）", "requiredRole": "admin" },
        { "id": "config_mutation", "desc": "安全配置变更（阈值/黑白名单/防护开关）", "requiredRole": "admin" }
      ]
    },
    {
      "id": "jit_token",
      "name": "JIT 一次性令牌",
      "type": "HMAC",
      "detail": { "ttlSeconds": 7, "bind": ["action", "sessionId"], "revoke": "执行后作废" }
    }
  ]
}
```

> 说明：接口只返回敏感规则的 `id / desc / requiredRole` 元信息，**不返回正则原文**，避免为攻击者提供绕过信息。

### 3.3 GET /api/agent/trust/trace

PEP 决策审计跟踪。查询条件与分页参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session` | string | 否 | 按会话标识精确过滤 |
| `action` | string | 否 | 按动作名精确过滤 |
| `allowed` | string | 否 | `0`=拒绝，`1`=放行 |
| `limit` | int | 否 | 每页条数，默认 50，上限 200 |
| `offset` | int | 否 | 偏移量，默认 0 |

请求：

```
GET /api/agent/trust/trace?allowed=0&limit=10
Authorization: Bearer <JWT>
```

响应 200：

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "session_token": "anonymous",
      "action": "check_in",
      "role": "passenger",
      "allowed": 0,
      "reason": "角色 passenger 无权执行动作 check_in（可用角色: operator/admin）",
      "jit_token": null,
      "terminal_id": null,
      "created_at": "2026-08-26 15:00:00"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

异常响应（表未迁移/数据库不可用）：

```json
{ "success": false, "message": "查询审计失败: ...", "data": [], "total": 0 }
```

---

## 4. 沿用接口说明

### 4.1 POST /api/auth/login

沿用既有登录接口，token 中保留 `role` 字段（当前体系管理员为 `admin`）。

请求：

```json
{ "username": "admin", "password": "***" }
```

响应（示意，字段以既有实现为准）：

```json
{ "success": true, "token": "<JWT>", "user": { "username": "admin", "role": "admin" } }
```

用法：`Authorization: Bearer <JWT>`，三信任接口凭此鉴权。

### 4.2 POST /api/agent/chat

沿用既有对话接口，任务一在响应中**追加** PEP 决策信息（对正常请求无破坏；拒绝时 `pep.allowed=false` 且返回拒绝原因）。

响应扩展字段（示意）：

```json
{
  "success": true,
  "reply": "...",
  "pep": {
    "allowed": true,
    "decision": "allow",
    "role": "passenger",
    "action": "query_flight",
    "reason": "PEP 授权通过"
  },
  "jitToken": "<HMAC 一次性令牌，仅高权限执行类动作返回，7s 有效>"
}
```

| 字段 | 说明 |
|------|------|
| `pep.decision` | `allow` / `deny_rbac` / `deny_sensitive` / `deny_unknown_action` / `allow_sensitive_privileged` |
| `jitToken` | 一次性令牌：绑定 `action`+`sessionId`，TTL 7s，动作执行后由服务端作废 |

---

## 5. 角色-动作矩阵（RBAC）

| 动作 | passenger | operator | admin |
|------|:---:|:---:|:---:|
| query_flight / query_gate / query_baggage / search_knowledge / navigate_location / query_weather / emotion_soothe / small_talk_reply | ✅ | ✅ | ✅ |
| check_in / generate_itinerary | ❌ | ✅ | ✅ |
| security_analyze | ❌ | ❌ | ✅ |

规则：动作不存在 → `deny_unknown_action`；敏感正则命中且角色不足 → `deny_sensitive`；矩阵权限不足 → `deny_rbac`。

---

## 6. 数据库变更

新增表 `pep_decision_log`（决策审计，MySQL 迁移脚本见 `database/agent_schema_v1_pep.sql`；SQLite 模式由 `db-adapter.js` 自动建表）：

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | INT PK AUTO_INCREMENT | 主键 |
| `session_token` | VARCHAR(64) | 会话标识 |
| `action` | VARCHAR(100) | 动作名 |
| `role` | VARCHAR(20) | 主体角色 |
| `allowed` | TINYINT(1) | 是否放行 |
| `reason` | VARCHAR(255) | 决策原因 |
| `jit_token` | VARCHAR(128) | JIT 令牌摘要（执行后作废） |
| `terminal_id` | VARCHAR(64) | 终端标识 |
| `created_at` | DATETIME | 记录时间 |

索引：`idx_pep_session`、`idx_pep_created`。

---

## 7. 配置项

| 配置 | 来源 | 默认值 | 说明 |
|------|------|--------|------|
| `PEP_HMAC_SECRET` | 环境变量 | 派生密钥 | JIT 令牌 HMAC 密钥，**生产环境必须显式注入** |
| JIT TTL | 代码常量 `JIT_TOKEN_TTL_MS` | 7000ms | 令牌有效期 |

---

## 8. 安全设计说明

1. **确定性优先**：全部决策基于 RBAC 矩阵 + 正则 + 令牌校验，无 LLM 随机性，满足可回归量化评测；
2. **双保险**：dispatcher 原有白名单 `ALLOWED_ACTIONS` + `pepGuard.evaluate` 双重校验，任一命中即拦截；
3. **JIT 防重放**：令牌绑定单动作与会话，7s 过期、执行后 `revokeToken` 作废，日志落 `pep_decision_log`；
4. **敏感规则不返原**：`/sources` 仅返回规则元信息，不泄漏正则原文；
5. **审计闭环**：每次交互的 PEP 决策均写 `pep_decision_log`，供 `/trust/trace` 回溯与违规证明。

---

## 9. 验收清单

- [x] `backend/agent/pep-guard.js`：RBAC 矩阵 + 4 条敏感正则 + JIT 令牌全链路
- [x] `backend/agent/dispatcher.js`：require 注入、构造器初始化、RUNTIME_CHECK 接入 `evaluate + issueToken`、JIT 执行后作废、`_logInteraction` 追加 `pep_decision_log` 写入
- [x] `backend/routes/agent.js`：三信任只读接口（status/sources/trace）+ `authMiddleware`
- [x] `backend/db-adapter.js`：SQLite 模式自动建 `pep_decision_log` 表
- [x] `database/agent_schema_v1_pep.sql`：MySQL 迁移脚本
- [x] 语法校验：routes/dispatcher/pep-guard/app/db-adapter 全部通过 `node --check`
- [x] 单元测试：pep-guard 16 项用例（RBAC/敏感/未知动作/JIT 全生命周期）全部通过

> 待办：在具备 `npm install` 的完整环境中启动服务，对三信任接口做端到端 HTTP 冒烟与量化评测（ASR/延迟/误拦）脚本。
*（内容由AI生成，仅供参考）*
