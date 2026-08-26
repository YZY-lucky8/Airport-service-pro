-- ============================================================
-- 恒盾智航·信疫盾 任务一 PEP 决策层 数据库迁移脚本
-- 新增：pep_decision_log 决策审计表（MySQL 方言）
-- 执行: mysql -u project_user -p airport_db < agent_schema_v1_pep.sql
-- 说明：SQLite 模式由 db-adapter.js 自动建表，无需执行本脚本
-- ============================================================
USE airport_db;

CREATE TABLE IF NOT EXISTS `pep_decision_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_token` VARCHAR(64) NULL COMMENT '会话标识',
  `action` VARCHAR(100) NULL COMMENT '意图映射后的动作名',
  `role` VARCHAR(20) NULL DEFAULT 'passenger' COMMENT '主体角色: passenger/operator/admin',
  `allowed` TINYINT(1) DEFAULT 0 COMMENT 'PEP 是否放行',
  `reason` VARCHAR(255) NULL COMMENT '决策原因',
  `jit_token` VARCHAR(128) NULL COMMENT 'JIT 令牌摘要(执行后作废)',
  `terminal_id` VARCHAR(64) NULL COMMENT '终端ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pep_session (`session_token`),
  INDEX idx_pep_created (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PEP 授权决策审计日志';
