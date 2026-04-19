/*
 Navicat Premium Data Transfer

 Source Server         : 本地MySQL
 Source Server Type    : MySQL
 Source Server Version : 80044 (8.0.44)
 Source Host           : localhost:3306
 Source Schema         : airport_terminal

 Target Server Type    : MySQL
 Target Server Version : 80044 (8.0.44)
 File Encoding         : 65001

 Date: 02/03/2026 14:55:26
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for attack_log
-- ----------------------------
DROP TABLE IF EXISTS `attack_log`;
CREATE TABLE `attack_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `terminal_id` int NULL DEFAULT NULL COMMENT '受攻击终端ID',
  `attack_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '攻击类型',
  `src_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '源IP',
  `dst_ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '目标IP',
  `protocol` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '协议',
  `packet_size` int NULL DEFAULT NULL COMMENT '包大小',
  `request_rate` int NULL DEFAULT NULL COMMENT '请求速率',
  `detection_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '检测方法',
  `action_taken` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '处置动作',
  `create_time` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '攻击时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `terminal_id`(`terminal_id` ASC) USING BTREE,
  CONSTRAINT `attack_log_ibfk_1` FOREIGN KEY (`terminal_id`) REFERENCES `terminal` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'DDoS攻击日志' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of attack_log
-- ----------------------------
INSERT INTO `attack_log` VALUES (1, 1, 'SYN Flood', '203.0.113.45', '192.168.1.101', 'TCP', 64, 10000, '流量阈值', '阻断', '2026-02-27 14:52:43');
INSERT INTO `attack_log` VALUES (2, 1, 'UDP Flood', '198.51.100.78', '192.168.1.101', 'UDP', 128, 20000, '流量阈值', '限流', '2026-02-28 14:52:43');
INSERT INTO `attack_log` VALUES (3, 2, 'ICMP Flood', '192.0.2.99', '192.168.1.102', 'ICMP', 56, 5000, '流量阈值', '告警', '2026-03-01 14:52:43');
INSERT INTO `attack_log` VALUES (4, 2, 'HTTP Flood', '203.0.113.123', '192.168.1.102', 'TCP', 256, 15000, '行为分析', '阻断', '2026-03-02 02:52:43');
INSERT INTO `attack_log` VALUES (5, 3, 'Slowloris', '198.51.100.200', '192.168.1.103', 'TCP', 128, 100, '连接数异常', '告警', '2026-03-02 08:52:43');

-- ----------------------------
-- Table structure for flight
-- ----------------------------
DROP TABLE IF EXISTS `flight`;
CREATE TABLE `flight`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `flight_no` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '航班号',
  `airline` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '航空公司',
  `departure_city` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '出发城市',
  `arrival_city` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '到达城市',
  `scheduled_departure` datetime NULL DEFAULT NULL COMMENT '计划起飞时间',
  `scheduled_arrival` datetime NULL DEFAULT NULL COMMENT '计划到达时间',
  `gate` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '登机口',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '正常' COMMENT '航班状态',
  `update_time` datetime NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `flight_no`(`flight_no` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '航班信息表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of flight
-- ----------------------------
INSERT INTO `flight` VALUES (1, 'CA1234', '中国国航', '北京', '上海', '2026-03-01 08:00:00', '2026-03-01 10:00:00', 'B23', '正常', NULL);
INSERT INTO `flight` VALUES (2, 'MU5678', '东方航空', '上海', '广州', '2026-03-01 09:30:00', '2026-03-01 11:30:00', 'C12', '正常', NULL);
INSERT INTO `flight` VALUES (3, 'CZ9876', '南方航空', '广州', '北京', '2026-03-01 10:15:00', '2026-03-01 12:45:00', 'A08', '延误', NULL);

-- ----------------------------
-- Table structure for passenger
-- ----------------------------
DROP TABLE IF EXISTS `passenger`;
CREATE TABLE `passenger`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '旅客ID',
  `id_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '身份证' COMMENT '证件类型',
  `id_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '证件号码',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '姓名',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '手机号',
  `create_time` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `id_number`(`id_number` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '旅客信息表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of passenger
-- ----------------------------
INSERT INTO `passenger` VALUES (1, '身份证', '110101199001011234', '张三', '13800138000', '2026-03-02 14:52:43');
INSERT INTO `passenger` VALUES (2, '身份证', '110101199002021235', '李四', '13800138001', '2026-03-02 14:52:43');
INSERT INTO `passenger` VALUES (3, '身份证', '110101198503151236', '王五', '13800138002', '2026-03-02 14:52:43');
INSERT INTO `passenger` VALUES (4, '护照', 'E12345678', '陈七', '13800138004', '2026-03-02 14:52:43');

-- ----------------------------
-- Table structure for passenger_flight
-- ----------------------------
DROP TABLE IF EXISTS `passenger_flight`;
CREATE TABLE `passenger_flight`  (
  `passenger_id` int NOT NULL,
  `flight_id` int NOT NULL,
  `check_in_status` tinyint(1) NULL DEFAULT 0 COMMENT '是否已值机',
  `seat_number` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '座位号',
  `baggage_count` int NULL DEFAULT 0 COMMENT '行李件数',
  `check_in_time` datetime NULL DEFAULT NULL COMMENT '值机时间',
  PRIMARY KEY (`passenger_id`, `flight_id`) USING BTREE,
  INDEX `flight_id`(`flight_id` ASC) USING BTREE,
  CONSTRAINT `passenger_flight_ibfk_1` FOREIGN KEY (`passenger_id`) REFERENCES `passenger` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `passenger_flight_ibfk_2` FOREIGN KEY (`flight_id`) REFERENCES `flight` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '旅客航班关联表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of passenger_flight
-- ----------------------------
INSERT INTO `passenger_flight` VALUES (1, 1, 1, '12A', 1, '2026-02-28 20:15:00');
INSERT INTO `passenger_flight` VALUES (2, 2, 1, '08C', 2, '2026-02-28 21:30:00');
INSERT INTO `passenger_flight` VALUES (3, 3, 0, NULL, 0, NULL);
INSERT INTO `passenger_flight` VALUES (4, 1, 1, '14B', 1, '2026-02-28 22:00:00');

-- ----------------------------
-- Table structure for passenger_flow
-- ----------------------------
DROP TABLE IF EXISTS `passenger_flow`;
CREATE TABLE `passenger_flow`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `terminal_id` int NULL DEFAULT NULL COMMENT '终端ID（代表采集点）',
  `area_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '区域编码',
  `start_time` datetime NULL DEFAULT NULL COMMENT '开始时间',
  `end_time` datetime NULL DEFAULT NULL COMMENT '结束时间',
  `passenger_count` int NULL DEFAULT NULL COMMENT '人数',
  `avg_dwell_time` int NULL DEFAULT NULL COMMENT '平均停留时间（秒）',
  `peak_time` datetime NULL DEFAULT NULL COMMENT '高峰时刻',
  `data_json` json NULL COMMENT '详细数据',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `terminal_id`(`terminal_id` ASC) USING BTREE,
  CONSTRAINT `passenger_flow_ibfk_1` FOREIGN KEY (`terminal_id`) REFERENCES `terminal` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '客流统计表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of passenger_flow
-- ----------------------------
INSERT INTO `passenger_flow` VALUES (1, 1, 'T2-3A', '2026-02-28 08:00:00', '2026-02-28 09:00:00', 120, 180, '2026-02-28 08:30:00', NULL);
INSERT INTO `passenger_flow` VALUES (2, 1, 'T2-3A', '2026-02-28 09:00:00', '2026-02-28 10:00:00', 250, 210, '2026-02-28 09:45:00', NULL);
INSERT INTO `passenger_flow` VALUES (3, 1, 'T2-3A', '2026-02-28 10:00:00', '2026-02-28 11:00:00', 380, 195, '2026-02-28 10:30:00', NULL);
INSERT INTO `passenger_flow` VALUES (4, 2, 'T2-2B', '2026-02-28 08:00:00', '2026-02-28 09:00:00', 80, 120, '2026-02-28 08:20:00', NULL);
INSERT INTO `passenger_flow` VALUES (5, 2, 'T2-2B', '2026-02-28 09:00:00', '2026-02-28 10:00:00', 150, 140, '2026-02-28 09:30:00', NULL);
INSERT INTO `passenger_flow` VALUES (6, 2, 'T2-2B', '2026-02-28 10:00:00', '2026-02-28 11:00:00', 200, 155, '2026-02-28 10:45:00', NULL);

-- ----------------------------
-- Table structure for qa_knowledge
-- ----------------------------
DROP TABLE IF EXISTS `qa_knowledge`;
CREATE TABLE `qa_knowledge`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `category` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '分类',
  `keywords` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '关键词',
  `question_pattern` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '问题模式',
  `answer` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标准答案',
  `redirect_action` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '重定向动作',
  `need_authentication` tinyint(1) NULL DEFAULT 0 COMMENT '是否需要验证',
  `visit_count` int NULL DEFAULT 0 COMMENT '访问次数',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '问答知识库' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of qa_knowledge
-- ----------------------------
INSERT INTO `qa_knowledge` VALUES (1, '导航', '安检', NULL, '安检处位于本机前方50米左转，T2航站楼三层中央。', 'show_map', 0, 0);
INSERT INTO `qa_knowledge` VALUES (2, '导航', '托运', NULL, '您的航班托运行李处在B区12-18号柜台。', 'show_map', 1, 0);
INSERT INTO `qa_knowledge` VALUES (3, '行李', '充电宝 锂电池', NULL, '充电宝属于锂电池，必须随身携带，禁止托运。', NULL, 0, 0);
INSERT INTO `qa_knowledge` VALUES (4, '行李', '轮椅 儿童车', NULL, '轮椅和儿童车可以托运，请在值机时告知工作人员。', NULL, 0, 0);
INSERT INTO `qa_knowledge` VALUES (5, '业务', '选座', NULL, '请告诉我您想选靠窗还是过道？', 'show_seat_map', 1, 0);
INSERT INTO `qa_knowledge` VALUES (6, '证件', '身份证丢了', NULL, '请前往T2航站楼2层公安办证处办理临时乘机证明。', 'show_map', 0, 0);
INSERT INTO `qa_knowledge` VALUES (7, '航班', '航班时间 状态', NULL, '您乘坐的航班当前状态正常，登机口未变更。', NULL, 1, 0);
INSERT INTO `qa_knowledge` VALUES (8, '特殊', '老人 小孩 军人', NULL, '特殊旅客请前往T2航站楼3层特殊旅客柜台办理。', 'show_map', 0, 0);

-- ----------------------------
-- Table structure for terminal
-- ----------------------------
DROP TABLE IF EXISTS `terminal`;
CREATE TABLE `terminal`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '设备编号',
  `location` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '安装位置',
  `ip_address` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'IP地址',
  `status` enum('online','offline','fault') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'online' COMMENT '状态',
  `last_heartbeat` datetime NULL DEFAULT NULL COMMENT '最后心跳时间',
  `software_version` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '软件版本',
  `install_date` date NULL DEFAULT NULL COMMENT '安装日期',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `device_id`(`device_id` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '自助终端设备表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of terminal
-- ----------------------------
INSERT INTO `terminal` VALUES (1, 'T001', 'T2航站楼3层A区', '192.168.1.101', 'online', '2026-03-02 14:52:43', 'v1.0.0', '2026-01-15');
INSERT INTO `terminal` VALUES (2, 'T002', 'T2航站楼2层B区', '192.168.1.102', 'online', '2026-03-02 14:52:43', 'v1.0.0', '2026-01-15');
INSERT INTO `terminal` VALUES (3, 'T003', 'T2航站楼1层C区', '192.168.1.103', 'offline', '2026-03-02 12:52:43', 'v1.0.0', '2026-01-20');

-- ----------------------------
-- Table structure for voice_log
-- ----------------------------
DROP TABLE IF EXISTS `voice_log`;
CREATE TABLE `voice_log`  (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `terminal_id` int NULL DEFAULT NULL COMMENT '终端ID',
  `passenger_id` int NULL DEFAULT NULL COMMENT '旅客ID（可为空）',
  `command_text` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '用户指令原文',
  `intent_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '意图分类',
  `recognition_result` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '识别结果',
  `response_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '系统回复',
  `is_success` tinyint(1) NULL DEFAULT 1 COMMENT '是否成功',
  `noise_level` decimal(5, 2) NULL DEFAULT NULL COMMENT '环境噪音水平',
  `create_time` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '交互时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `terminal_id`(`terminal_id` ASC) USING BTREE,
  INDEX `passenger_id`(`passenger_id` ASC) USING BTREE,
  CONSTRAINT `voice_log_ibfk_1` FOREIGN KEY (`terminal_id`) REFERENCES `terminal` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `voice_log_ibfk_2` FOREIGN KEY (`passenger_id`) REFERENCES `passenger` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 11 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '语音交互日志表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of voice_log
-- ----------------------------
INSERT INTO `voice_log` VALUES (1, 1, 1, '在哪里安检', '导航', '在哪里安检', '安检处位于本机前方50米左转', 1, 45.50, '2026-02-28 14:52:43');
INSERT INTO `voice_log` VALUES (2, 1, 2, '充电宝能托运吗', '行李', '充电宝能托运吗', '充电宝属于锂电池，必须随身携带', 1, 52.30, '2026-02-28 14:52:43');
INSERT INTO `voice_log` VALUES (3, 2, NULL, '餐厅在哪里', '导航', '餐厅在哪里', '最近的是老北京炸酱面', 1, 48.00, '2026-03-01 14:52:43');
INSERT INTO `voice_log` VALUES (4, 2, 3, '选座', '业务', '选座', '请告诉我您想选靠窗还是过道', 1, 55.10, '2026-03-01 14:52:43');
INSERT INTO `voice_log` VALUES (5, 3, 4, '身份证丢了怎么办', '证件', '身份证丢了怎么办', '请前往T2航站楼2层公安办证处', 1, 62.70, '2026-03-02 02:52:43');
INSERT INTO `voice_log` VALUES (6, 1, 1, '航班时间', '航班', '航班时间', '您乘坐的航班当前状态正常', 1, 41.20, '2026-03-02 04:52:43');
INSERT INTO `voice_log` VALUES (7, 2, 2, '想换座怎么办', '特殊', '想换座怎么办', '请直走50米前往人工柜台处理', 1, 53.80, '2026-03-02 06:52:43');
INSERT INTO `voice_log` VALUES (8, 3, NULL, '行李车位置', '导航', '行李车位置', '行李车在C区12号门附近', 1, 49.50, '2026-03-02 08:52:43');
INSERT INTO `voice_log` VALUES (9, 1, 3, '残疾人轮椅能带上飞机吗', '行李', '残疾人轮椅能带上飞机吗', '可以托运，请在值机时告知', 1, 58.00, '2026-03-02 10:52:43');
INSERT INTO `voice_log` VALUES (10, 2, 4, '航班延误怎么办', '航班', '航班延误怎么办', '您的航班CA1234延误，请关注大屏', 1, 44.30, '2026-03-02 12:52:43');


-- ----------------------------
-- Table structure for system_logs
-- ----------------------------
DROP TABLE IF EXISTS `system_logs`;
CREATE TABLE `system_logs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `module` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块名',
  `level` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'info' COMMENT '日志级别',
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '日志内容',
  `create_time` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '系统操作日志表' ROW_FORMAT = Dynamic;

SET FOREIGN_KEY_CHECKS = 1;

-- 在 airport_db 数据库中执行（xin）
CREATE TABLE IF NOT EXISTS `token_usage` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `user_id` VARCHAR(100) DEFAULT 'guest',
  `used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_token` (`token`),
  INDEX `idx_used_at` (`used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 1. 创建令牌使用记录表
CREATE TABLE IF NOT EXISTS `token_usage` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `token` VARCHAR(255) NOT NULL UNIQUE,
  `user_id` VARCHAR(100) DEFAULT 'guest',
  `used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_token` (`token`),
  INDEX `idx_used_at` (`used_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 创建审计日志表
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
