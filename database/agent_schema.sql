-- ============================================
-- 智能体系统 - 数据库扩展表
-- 基于 VeriGuard (形式化验证) + Multi-Agent Defense Pipeline
-- ============================================
-- 执行: mysql -u project_user -p airport_db < agent_schema.sql

USE airport_db;

-- 1. 智能体会话表（用户上下文隔离）
CREATE TABLE IF NOT EXISTS `agent_session` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_token` VARCHAR(64) NOT NULL UNIQUE,
  `passenger_id` INT NULL COMMENT '旅客ID',
  `terminal_id` INT NULL,
  `flight_no` VARCHAR(20) NULL COMMENT '当前关联航班',
  `state` JSON NULL COMMENT '当前会话状态快照',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_session_token (`session_token`),
  INDEX idx_passenger (`passenger_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 智能体交互日志（审计追踪）
CREATE TABLE IF NOT EXISTS `agent_interaction_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `session_token` VARCHAR(64) NOT NULL,
  `user_input` TEXT,
  `intent` VARCHAR(50),
  `emotion` VARCHAR(20),
  `entities` JSON,
  `action_chosen` VARCHAR(100),
  `tool_called` VARCHAR(100),
  `response_text` TEXT,
  `confidence` DECIMAL(3,2),
  `guardrail_flagged` TINYINT(1) DEFAULT 0,
  `guardrail_reason` VARCHAR(255),
  `latency_ms` INT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session (`session_token`),
  INDEX idx_intent (`intent`),
  INDEX idx_created (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 知识库扩展（语义检索支持）
CREATE TABLE IF NOT EXISTS `knowledge_base` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(200) NOT NULL,
  `content` TEXT NOT NULL,
  `category` VARCHAR(50) NOT NULL COMMENT '安全须知/航司规则/机场设施/行李规定/航班服务',
  `keywords` TEXT COMMENT '分词关键词，逗号分隔',
  `priority` INT DEFAULT 50 COMMENT '优先级 0-100',
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (`category`),
  FULLTEXT idx_content (`title`,`content`,`keywords`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 初始化知识库数据
INSERT INTO `knowledge_base` (`title`, `content`, `category`, `keywords`, `priority`) VALUES
('充电宝托运规定', '充电宝属于锂电池，必须随身携带，禁止托运。额定能量不超过100Wh可直接携带，100-160Wh需航司批准，超过160Wh禁止携带。每个旅客最多携带2个充电宝。', '行李规定', '充电宝,锂电池,托运,携带,额定能量,Wh,限制', 95),
('行李超重处理', '您的行李超重了。国内航班经济舱免费托运额度为20kg，超出部分按超重费用的1.5%计算。请前往C岛人工柜台办理超重行李托运手续，也可以选择在自助机上支付后继续托运。', '行李规定', '行李,超重,托运,额度,柜台,费用,支付', 90),
('液体携带规定', '随身携带液体每瓶不超过100ml，总量不超过1L，需放在透明密封袋中。超过100ml的液体必须托运。牙膏、面霜、喷雾等也属于液体。', '安检须知', '液体,携带,安检,透明袋,毫升,托运,喷雾', 85),
('打火机管制', '打火机、火柴属于易燃物品，严禁随身携带和托运。请在进入安检前丢弃或使用。', '安检须知', '打火机,火柴,易燃,携带,托运,安检,丢弃', 95),
('机场Wi-Fi使用', '机场提供免费Wi-Fi，名称为"Airport-Free-WiFi"，连接后打开浏览器自动跳转到认证页面，输入手机号获取验证码即可使用。高速区覆盖T3航站楼全区域。', '机场设施', 'Wi-Fi,网络,免费,连接,认证,手机,验证码', 60),
('机场餐厅推荐', 'T3航站楼内有多家餐厅：B区有老北京炸酱面（人均45元）、星巴克；C区有麦当劳、肯德基、真功夫（人均25-35元）；安检后有海底捞、全聚德、星巴克臻选。推荐您根据剩余时间选择。', '机场设施', '餐厅,美食,吃饭,餐饮,推荐,人均,价格', 75),
('卫生间位置', '卫生间分布：安检前B区一层/二层各有一个，安检后A区、C区均有卫生间和母婴室。最近的在您当前位置步行约2分钟。', '机场设施', '卫生间,厕所,母婴室,位置,步行', 70),
('航班延误处理', '航班延误时，航司会提供延误证明和相应补偿。延误超过4小时提供餐食，超过8小时可提供住宿。您可以通过航旅APP或自助机查看延误原因和预计起飞时间。', '航班服务', '延误,补偿,餐食,住宿,证明,起飞时间,原因', 88),
('特殊旅客服务', '老人、孕妇、残疾人等特殊旅客可申请轮椅服务、优先通道、专人协助。请在值机时提前告知工作人员，或拨打服务电话96158预约。特殊旅客优先通道在安检口旁边。', '航班服务', '特殊旅客,轮椅,优先,老人,孕妇,残疾人,协助', 82),
('航班取消处理', '航班取消后，航司会免费为您改签最近航班或办理全额退票。请前往航司柜台或自助机上办理。因天气原因取消的航班可在线退改签。', '航班服务', '取消,改签,退票,全额,天气,柜台,在线', 88),
('停车收费标准', 'T3停车场收费标准：首小时10元，之后每30分钟5元，24小时封顶80元。长期停车场（P3）每日30元。支持ETC自动扣费和扫码支付。', '机场设施', '停车,收费,标准,ETC,扫码,长期,封顶', 65),
('婴儿儿童乘机', '婴儿（2岁以下）乘机需提供出生证明，票价为成人全价票的10%，不占座位。儿童（2-12岁）票价为50%，需携带身份证或户口本。可提前预约婴儿摇篮服务。', '航司规则', '婴儿,儿童,票价,出生证明,身份证,户口本,摇篮', 78);

-- 4. 机场设施/POI数据库
CREATE TABLE IF NOT EXISTS `airport_poi` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `type` VARCHAR(30) NOT NULL COMMENT 'restaurant/shop/toilet/gate/security/checkin/baggage',
  `area` VARCHAR(20) NOT NULL COMMENT 'A区/B区/C区/安检后',
  `floor` VARCHAR(10) DEFAULT '1F',
  `walking_time_min` INT DEFAULT 5,
  `description` VARCHAR(255),
  `nearby_gates` TEXT COMMENT '附近登机口，逗号分隔',
  `is_active` TINYINT(1) DEFAULT 1,
  INDEX idx_type (`type`),
  INDEX idx_area (`area`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `airport_poi` (`name`, `type`, `area`, `floor`, `walking_time_min`, `description`, `nearby_gates`) VALUES
('老北京炸酱面', 'restaurant', 'B区', '1F', 3, '人均45元，地道北京风味', 'B20,B23,B25'),
('星巴克', 'restaurant', 'B区', '2F', 5, '精品咖啡轻食', 'B20,B23'),
('麦当劳', 'restaurant', 'C区', '1F', 6, '人均25元', 'C10,C12,C15'),
('肯德基', 'restaurant', 'C区', '1F', 6, '人均25元', 'C10,C12'),
('海底捞', 'restaurant', '安检后', '1F', 10, '人均120元，需排队', 'A01,A05,A08'),
('全聚德', 'restaurant', '安检后', '2F', 12, '人均200元，北京烤鸭', 'A10,A12'),
('星巴克臻选', 'restaurant', '安检后', '2F', 8, '精品咖啡', 'A05,A08'),
('DUTY FREE免税店', 'shop', '安检后', '2F', 7, '化妆品香水烟酒', 'A01-A15'),
('机场书店', 'shop', '安检后', '1F', 9, '书籍文具纪念品', 'A08,A10'),
('华为旗舰店', 'shop', 'C区', '2F', 8, '数码产品', 'C15,C18'),
('洗手间-B区', 'toilet', 'B区', '1F', 2, '含无障碍设施', NULL),
('洗手间-安检后A区', 'toilet', '安检后', '1F', 4, '含母婴室', 'A01-A10'),
('安检口-1号通道', 'security', 'B区', '1F', 4, '国内航班安检', NULL),
('值机柜台-C岛', 'checkin', 'C区', '1F', 3, 'C01-C20柜台', NULL),
('行李转盘-3号', 'baggage', '到达层', '1F', 0, '国内航班3号转盘', NULL);

-- 5. 安全分析日志（智能阈值调整用）
CREATE TABLE IF NOT EXISTS `security_analysis` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `analysis_time` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `total_requests` BIGINT NOT NULL,
  `attack_count` INT NOT NULL,
  `attack_ratio` DECIMAL(5,2) NOT NULL COMMENT '攻击日志占比%',
  `current_threshold` INT NOT NULL,
  `suggested_threshold` INT NOT NULL,
  `reason` TEXT,
  `confidence` DECIMAL(3,2) COMMENT '建议置信度 0-1',
  `action` ENUM('no_change','increase','decrease','alert') DEFAULT 'no_change',
  INDEX idx_time (`analysis_time`),
  INDEX idx_action (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================
-- 建表完成
-- ============================================
