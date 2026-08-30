-- 创建机场数据库
CREATE DATABASE IF NOT EXISTS airport_terminal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建专用用户
CREATE USER 'project_user'@'localhost' IDENTIFIED BY 'Airport123!';

-- 授予权限给新数据库
GRANT ALL PRIVILEGES ON airport_terminal.* TO 'project_user'@'localhost';
FLUSH PRIVILEGES;

-- 验证创建成功
SHOW DATABASES LIKE 'airport_terminal';
SELECT user, host FROM mysql.user WHERE user LIKE 'project%';


-- 使用新数据库
USE airport_terminal;

-- 创建系统日志表
CREATE TABLE IF NOT EXISTS `system_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `module` varchar(50) NOT NULL COMMENT '模块名',
  `level` varchar(20) DEFAULT 'info' COMMENT '日志级别',
  `message` text COMMENT '日志内容',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 创建令牌使用记录表
CREATE TABLE IF NOT EXISTS `token_usage` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `user_id` VARCHAR(100) DEFAULT 'guest',
  `used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_token` (`token`),
  INDEX `idx_used_at` (`used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 创建审计日志表（可选，但建议）
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `action` VARCHAR(100) NOT NULL,
  `user_id` VARCHAR(100) DEFAULT 'guest',
  `details` JSON,
  `ip_address` VARCHAR(45),
  `user_agent` VARCHAR(500),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_action` (`action`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 验证表创建成功
SHOW TABLES;


-- 查看令牌使用记录
SELECT * FROM token_usage ORDER BY created_at DESC LIMIT 5;

-- 查看安全日志
SELECT module, level, message, create_time
FROM system_logs
WHERE module = 'security'
ORDER BY create_time DESC
LIMIT 10;
