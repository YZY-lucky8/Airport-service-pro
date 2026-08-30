-- ============================================================
-- 智能体劫持信任免疫与量化评测系统 · 记忆层两表 (纯 SQL)
-- 设计：段琼馨（后端·记忆层 + 测试）
-- 版本：v1.0（2026-08-26，D1 交付）
-- 兼容性：MySQL 8.x / SQLite 3（better-sqlite3）
-- 说明：trust_session 为信任引擎持久化底座（对接 trust-engine 三维信任，
--       0.4/0.35/0.25 权重，<60 降权 / <30 锁定）；
--       pollution_source 为攻击载荷污染指纹表（SM3 精确 + SimHash 近似，
--       支撑跨会话免疫与事件溯源血缘日志）。
-- ============================================================

-- ------------------------------------------------------------
-- 表 1：trust_session · 智能体会话信任状态表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `trust_session`;
CREATE TABLE `trust_session` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `session_token`     VARCHAR(64)  NOT NULL COMMENT '会话令牌（关联 agent_session.session_token）',
  `passenger_id`      BIGINT       NULL     COMMENT '旅客ID（可空：未登录会话）',
  `terminal_id`       BIGINT       NULL     COMMENT '终端设备ID',
  -- 三维信任分项（权重 0.4 / 0.35 / 0.25）
  `dim_prompt_trust`  DECIMAL(5,4) NOT NULL DEFAULT 0.4000 COMMENT '维度A：指令来源可信度（权重0.4）',
  `dim_behavior_trust` DECIMAL(5,4) NOT NULL DEFAULT 0.3500 COMMENT '维度B：行为一致性（权重0.35）',
  `dim_immune_trust`  DECIMAL(5,4) NOT NULL DEFAULT 0.2500 COMMENT '维度C：免疫记忆相符度（权重0.25）',
  -- 信任总分（0~100）
  `trust_score`       DECIMAL(6,2) NOT NULL DEFAULT 100.00 COMMENT '加权信任总分（0~100）',
  `trust_state`       VARCHAR(16)  NOT NULL DEFAULT 'normal' COMMENT '状态：normal正常 / downgraded降权 / locked锁定',
  `threshold_downgrade` DECIMAL(6,2) NOT NULL DEFAULT 60.00 COMMENT '降权阈值',
  `threshold_lock`    DECIMAL(6,2) NOT NULL DEFAULT 30.00 COMMENT '锁定阈值',
  -- 污染统计
  `pollution_hit_count` INT        NOT NULL DEFAULT 0 COMMENT '累计命中污染指纹次数',
  `last_pollution_at` DATETIME     NULL     COMMENT '最近命中时间',
  -- 跨会话免疫
  `immune_until`      DATETIME     NULL     COMMENT '免疫截止时间（NULL=未免疫）',
  `immune_reason`     VARCHAR(255) NULL     COMMENT '免疫原因（命中指纹 source_uid / 人工隔离）',
  -- 锁定信息
  `lock_reason`       VARCHAR(255) NULL     COMMENT '锁定原因',
  `locked_at`         DATETIME     NULL     COMMENT '锁定时间',
  `unlocked_at`       DATETIME     NULL     COMMENT '解锁时间',
  -- 审计时间
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_token` (`session_token`),
  KEY `idx_trust_state` (`trust_state`),
  KEY `idx_trust_score` (`trust_score`),
  KEY `idx_terminal` (`terminal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='智能体会话信任状态表';

-- ------------------------------------------------------------
-- 表 2：pollution_source · 攻击载荷污染指纹表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `pollution_source`;
CREATE TABLE `pollution_source` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  `source_uid`        VARCHAR(64)  NOT NULL COMMENT '污染源唯一ID（POLL-<8hex>）',
  `finger_sm3`        CHAR(64)     NOT NULL COMMENT 'SM3 精确指纹（64位hex，国密）',
  `finger_simhash`    CHAR(16)     NOT NULL COMMENT 'SimHash 近似指纹（64bit 存储为 16 hex）',
  `payload_type`      VARCHAR(16)  NOT NULL COMMENT '载荷类型：direct / indirect / obfuscated',
  `intent_tag`        VARCHAR(64)  NULL     COMMENT '恶意意图标签（prompt_injection / exfil / escalation / hijack / jailbreak / data_poison）',
  `payload_len`       INT          NULL     COMMENT '载荷长度',
  `payload_sample`    TEXT         NULL     COMMENT '脱敏载荷样本（原文摘要，避免明文风险）',
  `origin_session_token` VARCHAR(64) NULL   COMMENT '首次发现会话',
  `origin_terminal_id` BIGINT      NULL     COMMENT '首次发现终端',
  `parent_id`         BIGINT       NULL     COMMENT '父污染源ID（NULL=首源，递归构成血缘链）',
  `first_seen`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次发现时间',
  `last_seen`         DATETIME     NULL     COMMENT '最近命中时间',
  `hit_count`         INT          NOT NULL DEFAULT 1 COMMENT '累计命中次数',
  `status`            VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT '状态：active活跃 / immunized已免疫 / suppressed已压制',
  `immune_global_until` DATETIME   NULL     COMMENT '全局免疫截止时间',
  `detail_json`       TEXT         NULL     COMMENT '扩展详情（探测路径/变体族/风险等级）',
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_uid` (`source_uid`),
  KEY `idx_finger_sm3` (`finger_sm3`),
  KEY `idx_finger_simhash` (`finger_simhash`),
  KEY `idx_payload_type` (`payload_type`),
  KEY `idx_parent` (`parent_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='攻击载荷污染指纹表';

-- ------------------------------------------------------------
-- 表 3：lineage_log · 事件溯源血缘日志（D3 交付）
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `lineage_log`;
CREATE TABLE `lineage_log` (
  `id`            BIGINT      NOT NULL AUTO_INCREMENT COMMENT '主键',
  `event_type`    VARCHAR(32) NOT NULL COMMENT '事件类型：source_registered / trust_update / pollution_hit / immune_set / immune_expired',
  `session_token` VARCHAR(64) NULL     COMMENT '关联会话',
  `source_uid`    VARCHAR(64) NULL     COMMENT '关联污染源',
  `parent_uid`    VARCHAR(64) NULL     COMMENT '父污染源（血缘上游）',
  `detail_json`   TEXT        NULL     COMMENT '事件详情',
  `created_at`    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件时间',
  PRIMARY KEY (`id`),
  KEY `idx_lineage_session` (`session_token`),
  KEY `idx_lineage_source` (`source_uid`),
  KEY `idx_lineage_parent` (`parent_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='事件溯源血缘日志表';

-- ============================================================
-- 事件溯源血缘日志视图（血缘链查询辅助）
-- ============================================================
CREATE OR REPLACE VIEW `v_pollution_lineage` AS
SELECT
  p.id, p.source_uid, p.finger_sm3, p.finger_simhash,
  p.payload_type, p.intent_tag, p.parent_id,
  parent.source_uid AS parent_uid,
  p.first_seen, p.last_seen, p.hit_count, p.status,
  p.immune_global_until
FROM pollution_source p
LEFT JOIN pollution_source parent ON p.parent_id = parent.id;

-- ============================================================
-- SQLite 兼容建表（better-sqlite3 使用，db-adapter.js 自动调用）
-- ============================================================
CREATE TABLE IF NOT EXISTS trust_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT NOT NULL UNIQUE,
  passenger_id INTEGER,
  terminal_id INTEGER,
  dim_prompt_trust REAL DEFAULT 0.40,
  dim_behavior_trust REAL DEFAULT 0.35,
  dim_immune_trust REAL DEFAULT 0.25,
  trust_score REAL DEFAULT 100,
  trust_state TEXT DEFAULT 'normal',
  threshold_downgrade REAL DEFAULT 60,
  threshold_lock REAL DEFAULT 30,
  pollution_hit_count INTEGER DEFAULT 0,
  last_pollution_at DATETIME,
  immune_until DATETIME,
  immune_reason TEXT,
  lock_reason TEXT,
  locked_at DATETIME,
  unlocked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pollution_source (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_uid TEXT NOT NULL UNIQUE,
  finger_sm3 TEXT NOT NULL,
  finger_simhash TEXT NOT NULL,
  payload_type TEXT NOT NULL,
  intent_tag TEXT,
  payload_len INTEGER,
  payload_sample TEXT,
  origin_session_token TEXT,
  origin_terminal_id INTEGER,
  parent_id INTEGER,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME,
  hit_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  immune_global_until DATETIME,
  detail_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trust_state ON trust_session (trust_state);
CREATE INDEX IF NOT EXISTS idx_trust_score ON trust_session (trust_score);
CREATE INDEX IF NOT EXISTS idx_trust_terminal ON trust_session (terminal_id);
CREATE INDEX IF NOT EXISTS idx_pollution_sm3 ON pollution_source (finger_sm3);
CREATE INDEX IF NOT EXISTS idx_pollution_simhash ON pollution_source (finger_simhash);
CREATE INDEX IF NOT EXISTS idx_pollution_type ON pollution_source (payload_type);
CREATE INDEX IF NOT EXISTS idx_pollution_parent ON pollution_source (parent_id);
CREATE INDEX IF NOT EXISTS idx_pollution_status ON pollution_source (status);

CREATE TABLE IF NOT EXISTS lineage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  session_token TEXT,
  source_uid TEXT,
  parent_uid TEXT,
  detail_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lineage_session ON lineage_log (session_token);
CREATE INDEX IF NOT EXISTS idx_lineage_source ON lineage_log (source_uid);
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage_log (parent_uid);
