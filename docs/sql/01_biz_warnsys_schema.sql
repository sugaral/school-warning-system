-- =============================================================================
-- 学业预警系统 (warnsys) 融合 Snowy v3.0.0 业务表结构脚本
-- 目标库: snowy (MySQL 8.0, utf8mb4_general_ci)
-- 规范:
--   1. 表名与字段名全大写下划线，业务表统一 BIZ_ 前缀
--   2. 主键统一 ID VARCHAR(20)（雪花字符串）
--   3. 全部业务表携带 CommonEntity 通用字段（DELETE_FLAG, CREATE_TIME, CREATE_USER, UPDATE_TIME, UPDATE_USER）
--   4. 全部表与字段携带完整中文 COMMENT，直接兼容 snowy-plugin-gen 在线代码生成器
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 辅助映射表：记录 warnsys BigInt ID -> snowy VARCHAR(20) ID 的映射关系
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_MIGRATION_ID_MAP`;
CREATE TABLE `BIZ_MIGRATION_ID_MAP` (
  `ID` varchar(40) NOT NULL COMMENT '映射主键(table_code:old_id)',
  `TABLE_CODE` varchar(8) NOT NULL COMMENT '表编号(01~43)',
  `SOURCE_TABLE` varchar(64) NOT NULL COMMENT '源表名称',
  `SOURCE_ID` bigint(20) NOT NULL COMMENT '源表BigInt主键',
  `TARGET_TABLE` varchar(64) NOT NULL COMMENT '目标表名称',
  `TARGET_ID` varchar(20) NOT NULL COMMENT '目标Snowflake主键',
  `REMARK` varchar(255) DEFAULT NULL COMMENT '备注',
  `CREATE_TIME` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '迁移时间',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_MIG_SRC` (`SOURCE_TABLE`, `SOURCE_ID`),
  KEY `IDX_MIG_TARGET` (`TARGET_TABLE`, `TARGET_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='历史数据迁移ID映射表' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 05. 专业表 BIZ_MAJOR (对应 warnsys.majors)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_MAJOR`;
CREATE TABLE `BIZ_MAJOR` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `ORG_ID` varchar(20) NOT NULL COMMENT '所属学院ID',
  `NAME` varchar(128) NOT NULL COMMENT '专业名称',
  `CODE` varchar(64) DEFAULT NULL COMMENT '专业编码',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '状态(active/inactive)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_MAJOR_ORG_NAME` (`ORG_ID`, `NAME`),
  KEY `IDX_BIZ_MAJOR_ORG` (`ORG_ID`),
  KEY `IDX_BIZ_MAJOR_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='专业信息' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 06. 班级表 BIZ_CLASS (对应 warnsys.classes)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CLASS`;
CREATE TABLE `BIZ_CLASS` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `ORG_ID` varchar(20) NOT NULL COMMENT '所属学院ID',
  `MAJOR_ID` varchar(20) DEFAULT NULL COMMENT '专业ID',
  `CLASS_NAME` varchar(128) NOT NULL COMMENT '班级名称',
  `ENROLL_YEAR` int(11) NOT NULL COMMENT '入学年份',
  `MAJOR` varchar(128) DEFAULT NULL COMMENT '专业名称',
  `GRADE_LEVEL` varchar(32) DEFAULT NULL COMMENT '年级层次',
  `COUNSELOR_USER_ID` varchar(20) DEFAULT NULL COMMENT '班主任用户ID',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '状态(active/inactive)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CLASS_ORG_NAME_YEAR` (`ORG_ID`, `CLASS_NAME`, `ENROLL_YEAR`),
  KEY `IDX_BIZ_CLASS_ORG` (`ORG_ID`),
  KEY `IDX_BIZ_CLASS_MAJOR` (`MAJOR_ID`),
  KEY `IDX_BIZ_CLASS_COUNSELOR` (`COUNSELOR_USER_ID`),
  KEY `IDX_BIZ_CLASS_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='班级信息' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 07. 学生档案表 BIZ_STUDENT_PROFILE (对应 warnsys.student_profiles)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_STUDENT_PROFILE`;
CREATE TABLE `BIZ_STUDENT_PROFILE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CLIENT_USER_ID` varchar(20) NOT NULL COMMENT 'C端用户ID',
  `STUDENT_NO` varchar(64) NOT NULL COMMENT '学号',
  `NAME` varchar(64) DEFAULT NULL COMMENT '学生姓名',
  `GENDER` varchar(8) DEFAULT NULL COMMENT '性别',
  `PHOTO_FILE_ID` varchar(20) DEFAULT NULL COMMENT '证件照文件ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '所属班级ID',
  `ORG_ID` varchar(20) DEFAULT NULL COMMENT '所属学院ID',
  `MAJOR_ID` varchar(20) DEFAULT NULL COMMENT '专业ID',
  `MAJOR` varchar(128) DEFAULT NULL COMMENT '专业名称',
  `ENROLL_YEAR` int(11) DEFAULT NULL COMMENT '入学年份',
  `MOBILE` varchar(255) DEFAULT NULL COMMENT '手机号(SM4加密)',
  `EMAIL` varchar(128) DEFAULT NULL COMMENT '邮箱',
  `EMERGENCY_CONTACT_NAME` varchar(64) DEFAULT NULL COMMENT '紧急联系人姓名',
  `EMERGENCY_CONTACT_MOBILE` varchar(255) DEFAULT NULL COMMENT '紧急联系人手机(SM4加密)',
  `NOTIFY_PREFS_JSON` longtext COMMENT '通知偏好配置JSON',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '学籍状态(active/inactive/graduated)',
  `INITIAL_PASSWORD` varchar(255) DEFAULT NULL COMMENT '初始密码密文',
  `STUDENT_POSITION` varchar(32) DEFAULT NULL COMMENT '学生职务',
  `WX_OPENID` varchar(64) DEFAULT NULL COMMENT '微信OpenID',
  `WX_UNIONID` varchar(64) DEFAULT NULL COMMENT '微信UnionID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_SP_CLIENT_USER` (`CLIENT_USER_ID`),
  UNIQUE KEY `UK_BIZ_SP_STUDENT_NO` (`STUDENT_NO`),
  KEY `IDX_BIZ_SP_CLASS_STATUS_NO` (`CLASS_ID`, `STATUS`, `STUDENT_NO`),
  KEY `IDX_BIZ_SP_ORG` (`ORG_ID`),
  KEY `IDX_BIZ_SP_MAJOR` (`MAJOR_ID`),
  KEY `IDX_BIZ_SP_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生档案' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 08. 课程表 BIZ_COURSE (对应 warnsys.courses)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_COURSE`;
CREATE TABLE `BIZ_COURSE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `ORG_ID` varchar(20) NOT NULL COMMENT '开课学院ID',
  `COURSE_CODE` varchar(64) DEFAULT NULL COMMENT '课程代码',
  `COURSE_NAME` varchar(256) NOT NULL COMMENT '课程名称',
  `CREDIT` decimal(4,1) DEFAULT NULL COMMENT '学分',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '状态(active/inactive)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_COURSE_ORG_CODE` (`ORG_ID`, `COURSE_CODE`),
  KEY `IDX_BIZ_COURSE_ORG` (`ORG_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='课程信息' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 09. 开课班表 BIZ_COURSE_CLASS (对应 warnsys.course_classes)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_COURSE_CLASS`;
CREATE TABLE `BIZ_COURSE_CLASS` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `TEACHER_USER_ID` varchar(20) NOT NULL COMMENT '任课教师ID',
  `TERM_CODE` varchar(32) NOT NULL COMMENT '学期编码',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CC_COURSE_CLASS_TERM` (`COURSE_ID`, `CLASS_ID`, `TERM_CODE`),
  KEY `IDX_BIZ_CC_CLASS_TERM` (`CLASS_ID`, `TERM_CODE`),
  KEY `IDX_BIZ_CC_TEACHER_TERM` (`TEACHER_USER_ID`, `TERM_CODE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='开课班信息' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 10. 排课课表 BIZ_SCHEDULE (对应 warnsys.schedules)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_SCHEDULE`;
CREATE TABLE `BIZ_SCHEDULE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `TERM_CODE` varchar(32) NOT NULL COMMENT '学期编码',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `TEACHER_USER_ID` varchar(20) NOT NULL COMMENT '任课教师ID',
  `SESSION_START` datetime NOT NULL COMMENT '上课开始时间',
  `SESSION_END` datetime NOT NULL COMMENT '上课结束时间',
  `EXPIRE_MINUTES` int(11) NOT NULL DEFAULT 15 COMMENT '签到有效分钟数',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '状态(active/inactive)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_SCHED_CLASS_START` (`CLASS_ID`, `SESSION_START`),
  KEY `IDX_BIZ_SCHED_TERM` (`TERM_CODE`),
  KEY `IDX_BIZ_SCHED_STATUS` (`STATUS`),
  KEY `IDX_BIZ_SCHED_COURSE` (`COURSE_ID`),
  KEY `IDX_BIZ_SCHED_TEACHER` (`TEACHER_USER_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='排课课表' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 11. 教师授课绑定表 BIZ_TEACHER_COURSE_BINDING (对应 teacher_course_bindings)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_TEACHER_COURSE_BINDING`;
CREATE TABLE `BIZ_TEACHER_COURSE_BINDING` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `TEACHER_ID` varchar(20) NOT NULL COMMENT '教师用户ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '所属学院ID',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_TCB` (`TEACHER_ID`, `COURSE_ID`, `CLASS_ID`),
  KEY `IDX_BIZ_TCB_TEACHER` (`TEACHER_ID`),
  KEY `IDX_BIZ_TCB_ORG` (`ORG_ID`),
  KEY `IDX_BIZ_TCB_COURSE` (`COURSE_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='教师授课绑定' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 12. 校历排除日表 BIZ_CALENDAR_EXCLUSION (对应 calendar_exclusions)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CALENDAR_EXCLUSION`;
CREATE TABLE `BIZ_CALENDAR_EXCLUSION` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `SCOPE` varchar(16) NOT NULL DEFAULT 'school' COMMENT '作用域(school/org)',
  `SCOPE_ID` varchar(20) DEFAULT NULL COMMENT '作用域对象ID',
  `EXCLUSION_DATE` date NOT NULL COMMENT '排除日期',
  `REASON` varchar(255) DEFAULT NULL COMMENT '排除原因',
  `CREATED_BY` varchar(20) NOT NULL COMMENT '创建人ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CAL_EXCL` (`SCOPE`, `SCOPE_ID`, `EXCLUSION_DATE`),
  KEY `IDX_BIZ_CAL_DATE` (`EXCLUSION_DATE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='校历排除日期' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 13. 预警规则表 BIZ_WARNING_RULE (对应 warning_rules)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WARNING_RULE`;
CREATE TABLE `BIZ_WARNING_RULE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `SCOPE` varchar(16) NOT NULL DEFAULT 'school' COMMENT '规则范围(school/college)',
  `SCOPE_ID` varchar(20) DEFAULT NULL COMMENT '范围对象ID',
  `RULE_VERSION` int(11) NOT NULL DEFAULT 1 COMMENT '规则版本号',
  `LEVEL` varchar(16) NOT NULL COMMENT '预警等级(yellow/orange/red/severe)',
  `WINDOW_TYPE` varchar(16) NOT NULL COMMENT '统计窗口(daily/weekly/monthly/term)',
  `METRIC` varchar(32) NOT NULL COMMENT '统计指标',
  `THRESHOLD` int(11) NOT NULL COMMENT '触发阈值',
  `ENABLED` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用(1启用/0停用)',
  `EXCLUSIONS_JSON` longtext COMMENT '排除条件JSON',
  `NOTIFY_STRATEGY_JSON` longtext COMMENT '通知策略JSON',
  `CREATED_BY` varchar(20) NOT NULL COMMENT '创建人ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_WR_SCOPE` (`SCOPE`, `SCOPE_ID`),
  KEY `IDX_BIZ_WR_LEVEL` (`LEVEL`),
  KEY `IDX_BIZ_WR_ENABLED` (`ENABLED`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学业预警规则' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 14. 消息模板表 BIZ_MESSAGE_TEMPLATE (对应 message_templates)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_MESSAGE_TEMPLATE`;
CREATE TABLE `BIZ_MESSAGE_TEMPLATE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CHANNEL` varchar(16) NOT NULL COMMENT '通知渠道(email/sms/inbox)',
  `TEMPLATE_CODE` varchar(64) NOT NULL COMMENT '模板编码',
  `TITLE` varchar(128) DEFAULT NULL COMMENT '模板标题',
  `CONTENT` longtext NOT NULL COMMENT '模板内容',
  `STATUS` varchar(16) NOT NULL DEFAULT 'active' COMMENT '状态(active/inactive)',
  `CREATED_BY` varchar(20) NOT NULL COMMENT '创建人ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_MT_CH_CODE` (`CHANNEL`, `TEMPLATE_CODE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='消息模板' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 15. 班级公告表 BIZ_CLASS_NOTIFICATION (对应 class_notifications)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CLASS_NOTIFICATION`;
CREATE TABLE `BIZ_CLASS_NOTIFICATION` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `TITLE` varchar(256) NOT NULL COMMENT '公告标题',
  `CONTENT` longtext NOT NULL COMMENT '公告内容',
  `PUBLISHER_ID` varchar(20) NOT NULL COMMENT '发布人ID',
  `PUBLISHER_NAME` varchar(64) NOT NULL COMMENT '发布人姓名',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_CN_CLASS_TIME` (`CLASS_ID`, `CREATE_TIME`),
  KEY `IDX_BIZ_CN_ORG` (`ORG_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='班级公告' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 16. 学生公告已读记录表 BIZ_STUDENT_NOTIFICATION_READ (对应 student_notification_reads)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_STUDENT_NOTIFICATION_READ`;
CREATE TABLE `BIZ_STUDENT_NOTIFICATION_READ` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `NOTIFICATION_ID` varchar(20) NOT NULL COMMENT '班级公告ID',
  `READ_AT` datetime DEFAULT NULL COMMENT '阅读时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_SNR_STU_NOTIF` (`STUDENT_ID`, `NOTIFICATION_ID`),
  KEY `IDX_BIZ_SNR_STU` (`STUDENT_ID`),
  KEY `IDX_BIZ_SNR_NOTIF` (`NOTIFICATION_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生公告已读记录' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 17. 成绩表 BIZ_GRADE (对应 grades)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_GRADE`;
CREATE TABLE `BIZ_GRADE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `TERM_CODE` varchar(32) NOT NULL COMMENT '学期编码',
  `SCORE` decimal(6,2) DEFAULT NULL COMMENT '成绩分数',
  `GRADE_POINT` decimal(4,2) DEFAULT NULL COMMENT '绩点',
  `PASS_STATUS` varchar(16) NOT NULL DEFAULT 'unknown' COMMENT '及格状态(pass/fail/unknown)',
  `SOURCE` varchar(16) NOT NULL DEFAULT 'import' COMMENT '数据来源',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_GRADE_STU_COURSE_TERM` (`STUDENT_ID`, `COURSE_ID`, `TERM_CODE`),
  KEY `IDX_BIZ_GRADE_TERM` (`TERM_CODE`),
  KEY `IDX_BIZ_GRADE_STU` (`STUDENT_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生成绩' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 18. 请假申请表 BIZ_LEAVE_REQUEST (对应 leave_requests)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_LEAVE_REQUEST`;
CREATE TABLE `BIZ_LEAVE_REQUEST` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `FROM_DATE` datetime NOT NULL COMMENT '请假开始时间',
  `TO_DATE` datetime NOT NULL COMMENT '请假结束时间',
  `REASON` varchar(255) NOT NULL COMMENT '请假原因',
  `PROOF_FILE_ID` varchar(20) DEFAULT NULL COMMENT '主凭证文件ID',
  `PROOF_FILE_IDS_JSON` longtext COMMENT '多凭证文件ID列表JSON',
  `STATUS` varchar(16) NOT NULL DEFAULT 'submitted' COMMENT '审批状态(submitted/approved/rejected)',
  `APPROVER_USER_ID` varchar(20) DEFAULT NULL COMMENT '审批人ID',
  `APPROVED_AT` datetime DEFAULT NULL COMMENT '通过时间',
  `REJECTED_AT` datetime DEFAULT NULL COMMENT '驳回时间',
  `REJECT_REASON` varchar(255) DEFAULT NULL COMMENT '驳回原因',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_LR_STU_TIME` (`STUDENT_ID`, `CREATE_TIME`),
  KEY `IDX_BIZ_LR_STU_STATUS_DT` (`STUDENT_ID`, `STATUS`, `FROM_DATE`, `TO_DATE`),
  KEY `IDX_BIZ_LR_CLASS_STATUS` (`CLASS_ID`, `STATUS`),
  KEY `IDX_BIZ_LR_CLASS_ST_DT` (`CLASS_ID`, `STATUS`, `FROM_DATE`, `TO_DATE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='请假申请' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 19. 考勤补录申请表 BIZ_MAKEUP_REQUEST (对应 makeup_requests)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_MAKEUP_REQUEST`;
CREATE TABLE `BIZ_MAKEUP_REQUEST` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `RECORD_DATE` date NOT NULL COMMENT '补录日期',
  `COURSE_ID` varchar(20) DEFAULT NULL COMMENT '课程ID',
  `CHANGE_JSON` longtext NOT NULL COMMENT '变更内容JSON',
  `REASON` varchar(255) NOT NULL COMMENT '申请原因',
  `STATUS` varchar(16) NOT NULL DEFAULT 'submitted' COMMENT '审批状态(submitted/approved/rejected)',
  `APPROVER_USER_ID` varchar(20) DEFAULT NULL COMMENT '审批人ID',
  `APPROVED_AT` datetime DEFAULT NULL COMMENT '通过时间',
  `REJECTED_AT` datetime DEFAULT NULL COMMENT '驳回时间',
  `REJECT_REASON` varchar(255) DEFAULT NULL COMMENT '驳回原因',
  `APPLIED_DAILY_RECORD_ID` varchar(20) DEFAULT NULL COMMENT '关联日记录ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_MR_STU_DATE` (`STUDENT_ID`, `RECORD_DATE`),
  KEY `IDX_BIZ_MR_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='考勤补录申请' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 20. 申诉工单表 BIZ_APPEAL (对应 appeals)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_APPEAL`;
CREATE TABLE `BIZ_APPEAL` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `APPEAL_TYPE` varchar(32) NOT NULL COMMENT '申诉类型',
  `RELATED_TYPE` varchar(32) DEFAULT NULL COMMENT '关联业务类型',
  `RELATED_ID` varchar(20) DEFAULT NULL COMMENT '关联业务ID',
  `CONTENT` varchar(1000) NOT NULL COMMENT '申诉内容',
  `EVIDENCE_FILE_ID` varchar(20) DEFAULT NULL COMMENT '主证据文件ID',
  `EVIDENCE_FILE_IDS_JSON` longtext COMMENT '多证据文件ID列表JSON',
  `STATUS` varchar(16) NOT NULL DEFAULT 'submitted' COMMENT '处理状态(submitted/approved/rejected)',
  `HANDLER_USER_ID` varchar(20) DEFAULT NULL COMMENT '处理人ID',
  `RESULT_NOTE` varchar(1000) DEFAULT NULL COMMENT '处理意见',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_APPEAL_STU_TIME` (`STUDENT_ID`, `CREATE_TIME`),
  KEY `IDX_BIZ_APPEAL_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生申诉工单' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 21. 变更申请表 BIZ_CHANGE_REQUEST (对应 change_requests)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CHANGE_REQUEST`;
CREATE TABLE `BIZ_CHANGE_REQUEST` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `REQUESTER_USER_ID` varchar(20) NOT NULL COMMENT '申请人用户ID',
  `TARGET_TYPE` varchar(32) NOT NULL COMMENT '变更目标类型(class/org/course_binding等)',
  `TARGET_ID` varchar(20) NOT NULL COMMENT '目标ID',
  `CHANGE_JSON` longtext NOT NULL COMMENT '变更内容JSON',
  `REASON` varchar(255) DEFAULT NULL COMMENT '申请理由',
  `STATUS` varchar(16) NOT NULL DEFAULT 'submitted' COMMENT '审批状态(submitted/approved/rejected)',
  `APPROVER_USER_ID` varchar(20) DEFAULT NULL COMMENT '审批人ID',
  `APPROVED_AT` datetime DEFAULT NULL COMMENT '通过时间',
  `REJECTED_AT` datetime DEFAULT NULL COMMENT '驳回时间',
  `REJECT_REASON` varchar(255) DEFAULT NULL COMMENT '驳回原因',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_CR_TARGET` (`TARGET_TYPE`, `TARGET_ID`),
  KEY `IDX_BIZ_CR_STATUS` (`STATUS`),
  KEY `IDX_BIZ_CR_REQ_TIME` (`REQUESTER_USER_ID`, `CREATE_TIME`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='绑定与换班变更申请' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 22. 签到课次表 BIZ_CLASS_SESSION (对应 class_sessions)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CLASS_SESSION`;
CREATE TABLE `BIZ_CLASS_SESSION` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `TEACHER_USER_ID` varchar(20) NOT NULL COMMENT '任课教师ID',
  `SESSION_START` datetime NOT NULL COMMENT '签到开始时间',
  `SESSION_END` datetime DEFAULT NULL COMMENT '签到结束时间',
  `QR_TOKEN_HASH` char(64) NOT NULL COMMENT '二维码令牌哈希',
  `QR_EXPIRE_AT` datetime NOT NULL COMMENT '二维码过期时间',
  `STATUS` varchar(16) NOT NULL COMMENT '课次状态(open/closed/cancelled)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CS_QR_HASH` (`QR_TOKEN_HASH`),
  KEY `IDX_BIZ_CS_CLASS_START` (`CLASS_ID`, `SESSION_START`),
  KEY `IDX_BIZ_CS_STATUS_END` (`STATUS`, `SESSION_END`),
  KEY `IDX_BIZ_CS_STATUS_QR` (`STATUS`, `QR_EXPIRE_AT`),
  KEY `IDX_BIZ_CS_COURSE` (`COURSE_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='课堂签到课次' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 23. 课次签到快照表 BIZ_CLASS_SESSION_SNAPSHOT (对应 class_session_snapshots)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CLASS_SESSION_SNAPSHOT`;
CREATE TABLE `BIZ_CLASS_SESSION_SNAPSHOT` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `SESSION_ID` varchar(20) NOT NULL COMMENT '课次ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `COURSE_ID` varchar(20) NOT NULL COMMENT '课程ID',
  `TOTAL_STUDENTS` int(11) NOT NULL DEFAULT 0 COMMENT '应到人数',
  `CHECKED_IN_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '实到人数',
  `ON_TIME_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '准时人数',
  `LATE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '迟到人数',
  `LEAVE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '请假人数',
  `ABSENT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '缺勤人数',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CSS_SESSION` (`SESSION_ID`),
  KEY `IDX_BIZ_CSS_CLASS` (`CLASS_ID`),
  KEY `IDX_BIZ_CSS_ORG` (`ORG_ID`),
  KEY `IDX_BIZ_CSS_COURSE` (`COURSE_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='课次签到统计快照' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 24. 课堂签到记录表 BIZ_ATTENDANCE_RECORD (对应 attendance_records)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_ATTENDANCE_RECORD`;
CREATE TABLE `BIZ_ATTENDANCE_RECORD` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `SESSION_ID` varchar(20) NOT NULL COMMENT '课次ID',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CHECKIN_TIME` datetime NOT NULL COMMENT '签到时间',
  `ATTENDANCE_STATUS` varchar(16) NOT NULL COMMENT '出勤状态(on_time/late/absent/leave/early_leave)',
  `SOURCE` varchar(16) NOT NULL COMMENT '记录来源(qr/manual/leave_sync/auto_close)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_AR_SESS_STU` (`SESSION_ID`, `STUDENT_ID`),
  KEY `IDX_BIZ_AR_STU_TIME` (`STUDENT_ID`, `CHECKIN_TIME`),
  KEY `IDX_BIZ_AR_SESS_STATUS` (`SESSION_ID`, `ATTENDANCE_STATUS`),
  KEY `IDX_BIZ_AR_STU_ST_SESS` (`STUDENT_ID`, `ATTENDANCE_STATUS`, `SESSION_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='课堂签到记录' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 25. 学生每日综合记录表 BIZ_DAILY_RECORD (对应 daily_records)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_DAILY_RECORD`;
CREATE TABLE `BIZ_DAILY_RECORD` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `RECORD_DATE` date NOT NULL COMMENT '记录日期',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `COURSE_ID` varchar(20) DEFAULT NULL COMMENT '课程ID',
  `ATTENDANCE_STATUS` varchar(16) NOT NULL COMMENT '出勤状态',
  `HOMEWORK_STATUS` varchar(16) NOT NULL COMMENT '作业状态',
  `CLASS_BEHAVIOR` varchar(16) DEFAULT NULL COMMENT '课堂表现',
  `REMARKS` varchar(500) DEFAULT NULL COMMENT '备注',
  `SOURCE` varchar(16) NOT NULL COMMENT '记录来源',
  `APPROVED_STATUS` varchar(16) NOT NULL COMMENT '审核状态',
  `APPROVED_BY` varchar(20) DEFAULT NULL COMMENT '审核人ID',
  `APPROVED_AT` datetime DEFAULT NULL COMMENT '审核时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_DR_STU_DATE_COURSE` (`STUDENT_ID`, `RECORD_DATE`, `COURSE_ID`),
  KEY `IDX_BIZ_DR_CLASS_DATE` (`CLASS_ID`, `RECORD_DATE`),
  KEY `IDX_BIZ_DR_ORG_DATE` (`ORG_ID`, `RECORD_DATE`),
  KEY `IDX_BIZ_DR_STU_DATE` (`STUDENT_ID`, `RECORD_DATE`),
  KEY `IDX_BIZ_DR_COMP` (`STUDENT_ID`, `ATTENDANCE_STATUS`, `RECORD_DATE`, `COURSE_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生每日考勤与表现记录' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 26. 学业预警历史表 BIZ_WARNING (对应 warnings)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WARNING`;
CREATE TABLE `BIZ_WARNING` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `METRIC` varchar(32) NOT NULL DEFAULT 'absent' COMMENT '预警指标',
  `LEVEL` varchar(16) NOT NULL COMMENT '预警等级(yellow/orange/red/severe)',
  `WINDOW_TYPE` varchar(16) NOT NULL COMMENT '统计窗口(daily/weekly/monthly/term)',
  `PERIOD_START` date NOT NULL COMMENT '周期开始日期',
  `PERIOD_END` date NOT NULL COMMENT '周期结束日期',
  `RULE_ID` varchar(20) NOT NULL COMMENT '规则ID',
  `RULE_SNAPSHOT_JSON` longtext NOT NULL COMMENT '规则快照JSON',
  `TRIGGER_SUMMARY` varchar(255) NOT NULL COMMENT '触发摘要',
  `TRIGGER_DETAIL_JSON` longtext COMMENT '触发明细JSON',
  `COURSE_ID` varchar(20) DEFAULT NULL COMMENT '课程ID',
  `STATUS` varchar(16) NOT NULL COMMENT '预警状态(open/acknowledged/closed)',
  `ACKNOWLEDGED_AT` datetime DEFAULT NULL COMMENT '学生确认时间',
  `ACKNOWLEDGED_BY` varchar(20) DEFAULT NULL COMMENT '确认人ID',
  `CLOSED_AT` datetime DEFAULT NULL COMMENT '关闭时间',
  `CLOSED_BY` varchar(20) DEFAULT NULL COMMENT '关闭人ID',
  `CLOSE_NOTE` varchar(500) DEFAULT NULL COMMENT '关闭说明',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_WARN_STU_TIME` (`STUDENT_ID`, `CREATE_TIME`),
  KEY `IDX_BIZ_WARN_STU_STATUS` (`STUDENT_ID`, `STATUS`),
  KEY `IDX_BIZ_WARN_STU_LEVEL` (`STUDENT_ID`, `LEVEL`),
  KEY `IDX_BIZ_WARN_CLASS_STATUS` (`CLASS_ID`, `STATUS`),
  KEY `IDX_BIZ_WARN_ORG_LEVEL` (`ORG_ID`, `LEVEL`),
  KEY `IDX_BIZ_WARN_STATUS` (`STATUS`),
  KEY `IDX_BIZ_WARN_STATUS_COURSE` (`STATUS`, `COURSE_ID`, `CREATE_TIME`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学业预警历史记录' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 27. 当前实时预警状态表 BIZ_WARNING_CURRENT_STATE (对应 warning_current_states)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WARNING_CURRENT_STATE`;
CREATE TABLE `BIZ_WARNING_CURRENT_STATE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `METRIC` varchar(32) NOT NULL COMMENT '预警指标',
  `LEVEL` varchar(16) NOT NULL COMMENT '预警等级',
  `WINDOW_TYPE` varchar(16) NOT NULL COMMENT '统计窗口',
  `PERIOD_START` date NOT NULL COMMENT '周期开始日期',
  `PERIOD_END` date NOT NULL COMMENT '周期结束日期',
  `COURSE_KEY` varchar(32) NOT NULL COMMENT '课程唯一键',
  `COURSE_ID` varchar(20) DEFAULT NULL COMMENT '课程ID',
  `RULE_ID` varchar(20) NOT NULL COMMENT '规则ID',
  `RULE_SNAPSHOT_JSON` longtext NOT NULL COMMENT '规则快照JSON',
  `TRIGGER_SUMMARY` varchar(255) NOT NULL COMMENT '触发摘要',
  `TRIGGER_DETAIL_JSON` longtext COMMENT '触发明细JSON',
  `CURRENT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '当前累计次数',
  `STATUS` varchar(16) NOT NULL COMMENT '状态(open/acknowledged)',
  `ACKNOWLEDGED_AT` datetime DEFAULT NULL COMMENT '确认时间',
  `ACKNOWLEDGED_BY` varchar(20) DEFAULT NULL COMMENT '确认人ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_WCS_COURSE` (`STUDENT_ID`, `METRIC`, `WINDOW_TYPE`, `PERIOD_START`, `PERIOD_END`, `COURSE_KEY`),
  KEY `IDX_BIZ_WCS_STU_STATUS` (`STUDENT_ID`, `STATUS`),
  KEY `IDX_BIZ_WCS_CLASS_STATUS` (`CLASS_ID`, `STATUS`),
  KEY `IDX_BIZ_WCS_ORG_STATUS` (`ORG_ID`, `STATUS`),
  KEY `IDX_BIZ_WCS_ORG_LEVEL` (`ORG_ID`, `LEVEL`),
  KEY `IDX_BIZ_WCS_COURSE_STATUS` (`COURSE_ID`, `STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生当前实时预警状态' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 28. 学生预警汇总快照表 BIZ_STUDENT_WARNING_SNAPSHOT (对应 student_warning_snapshots)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_STUDENT_WARNING_SNAPSHOT`;
CREATE TABLE `BIZ_STUDENT_WARNING_SNAPSHOT` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `TODAY_WARNING_TOTAL` int(11) NOT NULL DEFAULT 0 COMMENT '今日预警数',
  `WEEK_WARNING_TOTAL` int(11) NOT NULL DEFAULT 0 COMMENT '本周预警数',
  `MONTH_WARNING_TOTAL` int(11) NOT NULL DEFAULT 0 COMMENT '本月预警数',
  `ACTIVE_WARNING_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '活跃预警数',
  `CLOSED_WARNING_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '已关闭预警数',
  `ALL_WARNING_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '累计预警总数',
  `ACTIVE_HIGHEST_LEVEL` varchar(16) DEFAULT NULL COMMENT '当前最高等级',
  `CLOSED_HIGHEST_LEVEL` varchar(16) DEFAULT NULL COMMENT '历史最高等级',
  `ALL_HIGHEST_LEVEL` varchar(16) DEFAULT NULL COMMENT '全部最高等级',
  `ACTIVE_LAST_WARNING_AT` datetime DEFAULT NULL COMMENT '最近活跃预警时间',
  `CLOSED_LAST_WARNING_AT` datetime DEFAULT NULL COMMENT '最近关闭预警时间',
  `ALL_LAST_WARNING_AT` datetime DEFAULT NULL COMMENT '最近预警时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_SWS_STUDENT` (`STUDENT_ID`),
  KEY `IDX_BIZ_SWS_CLASS` (`CLASS_ID`),
  KEY `IDX_BIZ_SWS_ORG` (`ORG_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生预警统计快照' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 29. 班级看板监控快照表 BIZ_CLASS_MONITOR_SNAPSHOT (对应 class_monitor_snapshots)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_CLASS_MONITOR_SNAPSHOT`;
CREATE TABLE `BIZ_CLASS_MONITOR_SNAPSHOT` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `TOTAL_STUDENTS` int(11) NOT NULL DEFAULT 0 COMMENT '班级总人数',
  `WARNING_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '预警人次',
  `RED_WARNING_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '红色以上预警人次',
  `LEAVE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '请假人次',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_CMS_CLASS` (`CLASS_ID`),
  KEY `IDX_BIZ_CMS_ORG` (`ORG_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='班级监控统计快照' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 30. 高风险干预工单表 BIZ_WARNING_CASE (对应 warning_cases)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WARNING_CASE`;
CREATE TABLE `BIZ_WARNING_CASE` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `CLASS_ID` varchar(20) NOT NULL COMMENT '班级ID',
  `ORG_ID` varchar(20) NOT NULL COMMENT '学院ID',
  `PRIMARY_WARNING_ID` varchar(20) DEFAULT NULL COMMENT '主预警ID',
  `SOURCE_WARNING_IDS_JSON` longtext COMMENT '关联预警ID列表JSON',
  `RISK_SCORE` int(11) NOT NULL DEFAULT 0 COMMENT '综合风险分',
  `RISK_BREAKDOWN_JSON` longtext COMMENT '风险构成明细JSON',
  `WARNING_SUMMARY_JSON` longtext COMMENT '预警摘要JSON',
  `HANDLING_PRIORITY` int(11) NOT NULL DEFAULT 0 COMMENT '处置优先级',
  `STATUS` varchar(32) NOT NULL DEFAULT 'pending_assignment' COMMENT '工单状态',
  `HANDLER_USER_ID` varchar(20) DEFAULT NULL COMMENT '当前处置人ID',
  `ASSIGNED_BY` varchar(20) DEFAULT NULL COMMENT '指派人ID',
  `ASSIGNED_AT` datetime DEFAULT NULL COMMENT '指派时间',
  `ACCEPTED_AT` datetime DEFAULT NULL COMMENT '接单时间',
  `COMPLETED_AT` datetime DEFAULT NULL COMMENT '完成时间',
  `RESOLVED_AT` datetime DEFAULT NULL COMMENT '结案时间',
  `COMPLETION_SUMMARY` varchar(255) DEFAULT NULL COMMENT '处置结案摘要',
  `COMPLETION_DETAIL_JSON` longtext COMMENT '处置详情JSON',
  `LATEST_WARNING_AT` datetime DEFAULT NULL COMMENT '最新预警时间',
  `LAST_RISK_AT` datetime DEFAULT NULL COMMENT '最近风险计算时间',
  `IS_ACTIVE` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否活跃(1是/0否)',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_WC_STU_ACTIVE` (`STUDENT_ID`, `IS_ACTIVE`),
  KEY `IDX_BIZ_WC_STATUS_ACTIVE` (`STATUS`, `IS_ACTIVE`),
  KEY `IDX_BIZ_WC_HANDLER_STATUS` (`HANDLER_USER_ID`, `STATUS`),
  KEY `IDX_BIZ_WC_CLASS_STATUS` (`CLASS_ID`, `STATUS`),
  KEY `IDX_BIZ_WC_ORG_STATUS` (`ORG_ID`, `STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='高风险学生干预工单' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 31. 高风险干预工单日志表 BIZ_WARNING_CASE_LOG (对应 warning_case_logs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WARNING_CASE_LOG`;
CREATE TABLE `BIZ_WARNING_CASE_LOG` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CASE_ID` varchar(20) NOT NULL COMMENT '干预工单ID',
  `ACTION` varchar(32) NOT NULL COMMENT '动作编码',
  `ACTOR_USER_ID` varchar(20) DEFAULT NULL COMMENT '操作人ID',
  `NOTE` varchar(255) DEFAULT NULL COMMENT '处理备注',
  `DETAIL_JSON` longtext COMMENT '动作明细JSON',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_WCL_CASE_TIME` (`CASE_ID`, `CREATE_TIME`),
  KEY `IDX_BIZ_WCL_ACTOR_TIME` (`ACTOR_USER_ID`, `CREATE_TIME`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='高风险干预工单流转日志' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 32. 周度考勤汇总表 BIZ_WEEKLY_SUMMARY (对应 weekly_summaries)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_WEEKLY_SUMMARY`;
CREATE TABLE `BIZ_WEEKLY_SUMMARY` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `WEEK_START` date NOT NULL COMMENT '周开始日期',
  `WEEK_END` date NOT NULL COMMENT '周结束日期',
  `LATE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '迟到次数',
  `ABSENT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '缺勤次数',
  `HOMEWORK_NOT_SUBMIT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '作业未交次数',
  `GENERATED_AT` datetime NOT NULL COMMENT '生成时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_WS_STU_WEEK` (`STUDENT_ID`, `WEEK_START`),
  KEY `IDX_BIZ_WS_RANGE` (`WEEK_START`, `WEEK_END`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生周度考勤作业汇总' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 33. 月度考勤汇总表 BIZ_MONTHLY_SUMMARY (对应 monthly_summaries)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_MONTHLY_SUMMARY`;
CREATE TABLE `BIZ_MONTHLY_SUMMARY` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `YEAR` int(11) NOT NULL COMMENT '年份',
  `MONTH` int(11) NOT NULL COMMENT '月份',
  `LATE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '迟到次数',
  `ABSENT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '缺勤次数',
  `HOMEWORK_NOT_SUBMIT_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '作业未交次数',
  `GENERATED_AT` datetime NOT NULL COMMENT '生成时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_MS_STU_YM` (`STUDENT_ID`, `YEAR`, `MONTH`),
  KEY `IDX_BIZ_MS_YM` (`YEAR`, `MONTH`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生月度考勤作业汇总' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 34. 学期学业汇总表 BIZ_TERM_SUMMARY (对应 term_summaries)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_TERM_SUMMARY`;
CREATE TABLE `BIZ_TERM_SUMMARY` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `STUDENT_ID` varchar(20) NOT NULL COMMENT '学生档案ID',
  `TERM_CODE` varchar(32) NOT NULL COMMENT '学期编码',
  `FAILED_COURSE_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '挂科门数',
  `EARNED_CREDITS` decimal(6,1) NOT NULL DEFAULT 0.0 COMMENT '已获学分',
  `REQUIRED_CREDITS` decimal(6,1) NOT NULL DEFAULT 0.0 COMMENT '应修学分',
  `GPA` decimal(4,2) DEFAULT NULL COMMENT '平均学分绩点',
  `GENERATED_AT` datetime NOT NULL COMMENT '生成时间',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  UNIQUE KEY `UK_BIZ_TS_STU_TERM` (`STUDENT_ID`, `TERM_CODE`),
  KEY `IDX_BIZ_TS_TERM` (`TERM_CODE`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='学生学期学业汇总' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 35. 异步通知任务表 BIZ_NOTIFICATION_JOB (对应 notification_jobs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_NOTIFICATION_JOB`;
CREATE TABLE `BIZ_NOTIFICATION_JOB` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `TRIGGER_TYPE` varchar(16) NOT NULL COMMENT '触发方式(auto/manual)',
  `WARNING_ID` varchar(20) DEFAULT NULL COMMENT '关联预警ID',
  `SENDER_USER_ID` varchar(20) DEFAULT NULL COMMENT '发送人ID',
  `CHANNEL` varchar(16) NOT NULL COMMENT '发送渠道(email/sms/inbox)',
  `TEMPLATE_CODE` varchar(64) DEFAULT NULL COMMENT '模板编码',
  `RECEIVERS_JSON` longtext NOT NULL COMMENT '接收者列表JSON',
  `PARAMS_JSON` longtext COMMENT '模板参数JSON',
  `SCHEDULE_AT` datetime DEFAULT NULL COMMENT '计划发送时间',
  `COOLDOWN_KEY` varchar(128) DEFAULT NULL COMMENT '冷却去重键',
  `STATUS` varchar(16) NOT NULL COMMENT '任务状态(queued/sent/failed/cancelled)',
  `TRY_COUNT` int(11) NOT NULL DEFAULT 0 COMMENT '重试次数',
  `LAST_ERROR` varchar(255) DEFAULT NULL COMMENT '最近错误信息',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_NJ_STATUS_TIME` (`STATUS`, `CREATE_TIME`),
  KEY `IDX_BIZ_NJ_STATUS_SCHED` (`STATUS`, `SCHEDULE_AT`),
  KEY `IDX_BIZ_NJ_WARN_CH` (`WARNING_ID`, `CHANNEL`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='异步通知发送任务' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 36. 通知发送日志表 BIZ_NOTIFICATION_LOG (对应 notification_logs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_NOTIFICATION_LOG`;
CREATE TABLE `BIZ_NOTIFICATION_LOG` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `JOB_ID` varchar(20) NOT NULL COMMENT '通知任务ID',
  `CHANNEL` varchar(16) NOT NULL COMMENT '发送渠道',
  `RECEIVER` varchar(128) NOT NULL COMMENT '接收地址',
  `CONTENT_SNAPSHOT` longtext COMMENT '发送内容快照',
  `SEND_STATUS` varchar(16) NOT NULL COMMENT '发送状态',
  `PROVIDER` varchar(32) DEFAULT NULL COMMENT '通道服务商',
  `PROVIDER_MSG_ID` varchar(128) DEFAULT NULL COMMENT '服务商回执ID',
  `ERROR_MSG` varchar(255) DEFAULT NULL COMMENT '失败原因',
  `SENT_AT` datetime NOT NULL COMMENT '发送时间',
  `ACKNOWLEDGED` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否已确认(1是/0否)',
  `ACKNOWLEDGED_AT` datetime DEFAULT NULL COMMENT '确认时间',
  `ACKNOWLEDGED_BY` varchar(20) DEFAULT NULL COMMENT '确认人ID',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_NL_JOB` (`JOB_ID`),
  KEY `IDX_BIZ_NL_SENT` (`SENT_AT`),
  KEY `IDX_BIZ_NL_STATUS_SENT` (`SEND_STATUS`, `SENT_AT`),
  KEY `IDX_BIZ_NL_CH_SENT` (`CHANNEL`, `SENT_AT`),
  KEY `IDX_BIZ_NL_RCV_SENT` (`RECEIVER`(64), `SENT_AT`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='通知发送明细日志' ROW_FORMAT=Dynamic;

-- -----------------------------------------------------------------------------
-- 37. 异步报表导出任务表 BIZ_EXPORT_JOB (对应 export_jobs)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `BIZ_EXPORT_JOB`;
CREATE TABLE `BIZ_EXPORT_JOB` (
  `ID` varchar(20) NOT NULL COMMENT '主键',
  `CREATOR_USER_ID` varchar(20) NOT NULL COMMENT '创建人ID',
  `SCOPE_TYPE` varchar(16) NOT NULL COMMENT '导出范围类型',
  `SCOPE_ID` varchar(20) DEFAULT NULL COMMENT '导出范围ID',
  `REPORT_TYPE` varchar(32) NOT NULL COMMENT '报表类型',
  `PARAMS_JSON` longtext COMMENT '查询参数JSON',
  `STATUS` varchar(16) NOT NULL DEFAULT 'queued' COMMENT '任务状态(queued/processing/completed/failed)',
  `FILE_ID` varchar(20) DEFAULT NULL COMMENT '生成文件ID(关联DEV_FILE)',
  `ERROR_MSG` varchar(255) DEFAULT NULL COMMENT '错误信息',
  `EXT_JSON` longtext COMMENT '扩展信息',
  `DELETE_FLAG` varchar(255) DEFAULT 'NOT_DELETE' COMMENT '删除标志',
  `CREATE_TIME` datetime DEFAULT NULL COMMENT '创建时间',
  `CREATE_USER` varchar(20) DEFAULT NULL COMMENT '创建用户',
  `UPDATE_TIME` datetime DEFAULT NULL COMMENT '修改时间',
  `UPDATE_USER` varchar(20) DEFAULT NULL COMMENT '修改用户',
  PRIMARY KEY (`ID`) USING BTREE,
  KEY `IDX_BIZ_EJ_STATUS_TIME` (`STATUS`, `CREATE_TIME`),
  KEY `IDX_BIZ_EJ_SCOPE` (`SCOPE_TYPE`, `SCOPE_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='异步报表导出任务' ROW_FORMAT=Dynamic;

SET FOREIGN_KEY_CHECKS = 1;
