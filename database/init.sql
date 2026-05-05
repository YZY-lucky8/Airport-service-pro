-- 初始化数据库和用户
-- 运行此脚本需要root权限

-- 创建数据库
CREATE DATABASE IF NOT EXISTS airport_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建用户
CREATE USER IF NOT EXISTS 'project_user'@'localhost' IDENTIFIED BY 'Airport123!';

-- 授予权限
GRANT ALL PRIVILEGES ON airport_db.* TO 'project_user'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 显示创建结果
SELECT User, Host FROM mysql.user WHERE User='project_user';
SHOW DATABASES LIKE 'airport_db';