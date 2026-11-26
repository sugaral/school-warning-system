-- =============================================================================
-- 学业预警系统 (warnsys) -> Snowy v3.0.0 全量数据迁移脚本
-- 源库: warnsys (只读)
-- 目标库: snowy (可重复幂等执行)
-- 确定性 ID 规则: CONCAT('190', LPAD(table_code, 2, '0'), LPAD(old_id, 14, '0'))
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_SAFE_UPDATES = 0;

USE `snowy`;

-- -----------------------------------------------------------------------------
-- 0. 幂等清理历史迁移数据（保留 Snowy 原生表记录与 M1.4 初始化字典/角色/根节点）
-- -----------------------------------------------------------------------------
DELETE FROM `SYS_ORG` WHERE `ID` LIKE '19001%' AND `ID` != '1900100000000000000';
DELETE FROM `SYS_USER` WHERE `ID` LIKE '19002%';
DELETE FROM `SYS_USER_EXT` WHERE `ID` LIKE '19002%';
DELETE FROM `CLIENT_USER` WHERE `ID` LIKE '19003%';
DELETE FROM `CLIENT_USER_EXT` WHERE `ID` LIKE '19003%';
DELETE FROM `AUTH_THIRD_USER` WHERE `ID` LIKE '19043%';
DELETE FROM `SYS_RELATION` WHERE `ID` LIKE '19004%';
DELETE FROM `SYS_USER_DATA_SCOPE` WHERE `USER_ID` LIKE '19002%';
DELETE FROM `DEV_FILE` WHERE `ID` LIKE '19038%';
DELETE FROM `DEV_MESSAGE` WHERE `ID` LIKE '19039%';
DELETE FROM `DEV_RELATION` WHERE `ID` LIKE '19039%';
DELETE FROM `DEV_LOG` WHERE `ID` LIKE '19040%' OR `ID` LIKE '19041%';
DELETE FROM `DEV_CONFIG` WHERE `ID` LIKE '19042%';

TRUNCATE TABLE `BIZ_MIGRATION_ID_MAP`;
TRUNCATE TABLE `BIZ_MAJOR`;
TRUNCATE TABLE `BIZ_CLASS`;
TRUNCATE TABLE `BIZ_STUDENT_PROFILE`;
TRUNCATE TABLE `BIZ_COURSE`;
TRUNCATE TABLE `BIZ_COURSE_CLASS`;
TRUNCATE TABLE `BIZ_SCHEDULE`;
TRUNCATE TABLE `BIZ_TEACHER_COURSE_BINDING`;
TRUNCATE TABLE `BIZ_CALENDAR_EXCLUSION`;
TRUNCATE TABLE `BIZ_WARNING_RULE`;
TRUNCATE TABLE `BIZ_MESSAGE_TEMPLATE`;
TRUNCATE TABLE `BIZ_CLASS_NOTIFICATION`;
TRUNCATE TABLE `BIZ_STUDENT_NOTIFICATION_READ`;
TRUNCATE TABLE `BIZ_GRADE`;
TRUNCATE TABLE `BIZ_LEAVE_REQUEST`;
TRUNCATE TABLE `BIZ_MAKEUP_REQUEST`;
TRUNCATE TABLE `BIZ_APPEAL`;
TRUNCATE TABLE `BIZ_CHANGE_REQUEST`;
TRUNCATE TABLE `BIZ_CLASS_SESSION`;
TRUNCATE TABLE `BIZ_CLASS_SESSION_SNAPSHOT`;
TRUNCATE TABLE `BIZ_ATTENDANCE_RECORD`;
TRUNCATE TABLE `BIZ_DAILY_RECORD`;
TRUNCATE TABLE `BIZ_WARNING`;
TRUNCATE TABLE `BIZ_WARNING_CURRENT_STATE`;
TRUNCATE TABLE `BIZ_STUDENT_WARNING_SNAPSHOT`;
TRUNCATE TABLE `BIZ_CLASS_MONITOR_SNAPSHOT`;
TRUNCATE TABLE `BIZ_WARNING_CASE`;
TRUNCATE TABLE `BIZ_WARNING_CASE_LOG`;
TRUNCATE TABLE `BIZ_WEEKLY_SUMMARY`;
TRUNCATE TABLE `BIZ_MONTHLY_SUMMARY`;
TRUNCATE TABLE `BIZ_TERM_SUMMARY`;
TRUNCATE TABLE `BIZ_NOTIFICATION_JOB`;
TRUNCATE TABLE `BIZ_NOTIFICATION_LOG`;
TRUNCATE TABLE `BIZ_EXPORT_JOB`;

-- -----------------------------------------------------------------------------
-- 01. orgs -> SYS_ORG (table_code = 01)
-- -----------------------------------------------------------------------------
INSERT INTO `SYS_ORG` (
  `ID`, `PARENT_ID`, `DIRECTOR_ID`, `NAME`, `CODE`, `CATEGORY`, `SORT_CODE`,
  `EXT_JSON`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19001', LPAD(o.id, 14, '0')),
  CASE
    WHEN o.parent_org_id IS NOT NULL AND EXISTS (SELECT 1 FROM `warnsys`.`orgs` p WHERE p.id = o.parent_org_id)
      THEN CONCAT('19001', LPAD(o.parent_org_id, 14, '0'))
    ELSE '1900100000000000000'
  END,
  NULL,
  o.name,
  CASE
    WHEN o.org_kind IS NOT NULL AND TRIM(o.org_kind) != '' AND LOWER(TRIM(o.org_kind)) != 'college'
      THEN TRIM(o.org_kind)
    ELSE CONCAT('ORG_', o.id)
  END,
  'DEPT',
  o.id,
  JSON_OBJECT(
    'legacy_id', o.id,
    'org_kind', o.org_kind,
    'org_level', o.org_level,
    'status', o.status,
    'meta_json', o.meta_json
  ),
  'NOT_DELETE',
  o.created_at,
  '1543837863788879871',
  o.updated_at,
  '1543837863788879871'
FROM `warnsys`.`orgs` o;

-- -----------------------------------------------------------------------------
-- 02. users (非学生) -> SYS_USER + SYS_USER_EXT (table_code = 02)
--     注：PASSWORD 先写入占位符，由 M1.6 国密脚本通过 CommonCryptogramUtil 写入 SM3；
--         PHONE 先保留原文，由 M1.6 脚本加密为 SM4-CBC。
-- -----------------------------------------------------------------------------
INSERT INTO `SYS_USER` (
  `ID`, `ACCOUNT`, `PASSWORD`, `NAME`, `PHONE`, `EMAIL`, `ORG_ID`,
  `POSITION_LEVEL`, `LAST_LOGIN_TIME`, `LATEST_LOGIN_TIME`, `USER_STATUS`,
  `SORT_CODE`, `EXT_JSON`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19002', LPAD(u.id, 14, '0')),
  COALESCE(NULLIF(TRIM(u.mobile), ''), NULLIF(TRIM(u.email), ''), CONCAT('staff_', u.id)),
  'PENDING_SM3',
  u.name,
  NULLIF(TRIM(u.mobile), ''),
  NULLIF(TRIM(u.email), ''),
  CASE
    WHEN u.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM `warnsys`.`orgs` o WHERE o.id = u.org_id)
      THEN CONCAT('19001', LPAD(u.org_id, 14, '0'))
    ELSE '1900100000000000000'
  END,
  NULLIF(TRIM(u.teacher_position), ''),
  u.last_login_at,
  u.last_login_at,
  IF(u.status = 'active', 'ENABLE', 'DISABLED'),
  u.id,
  JSON_OBJECT(
    'legacy_id', u.id,
    'user_type', u.user_type,
    'teacher_position', u.teacher_position,
    'legacy_bcrypt_hash', u.password_hash,
    'wx_openid', u.wx_openid,
    'wx_unionid', u.wx_unionid
  ),
  'NOT_DELETE',
  u.created_at,
  '1543837863788879871',
  u.updated_at,
  '1543837863788879871'
FROM `warnsys`.`users` u
WHERE u.user_type != 'student';

INSERT INTO `SYS_USER_EXT` (
  `ID`, `USER_ID`, `SOURCE_FROM_TYPE`, `PASSWORD_UPDATE_TIME`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19002', LPAD(u.id, 14, '0')),
  CONCAT('19002', LPAD(u.id, 14, '0')),
  'SYSTEM_ADD',
  NOW(),
  'NOT_DELETE',
  u.created_at,
  '1543837863788879871',
  u.updated_at,
  '1543837863788879871'
FROM `warnsys`.`users` u
WHERE u.user_type != 'student';

-- -----------------------------------------------------------------------------
-- 03. users (学生) -> CLIENT_USER + CLIENT_USER_EXT + AUTH_THIRD_USER (table_code = 03 / 43)
-- -----------------------------------------------------------------------------
INSERT INTO `CLIENT_USER` (
  `ID`, `ACCOUNT`, `PASSWORD`, `NAME`, `GENDER`, `PHONE`, `EMAIL`,
  `EMERGENCY_CONTACT`, `EMERGENCY_PHONE`, `LAST_LOGIN_TIME`, `LATEST_LOGIN_TIME`,
  `USER_STATUS`, `SORT_CODE`, `EXT_JSON`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19003', LPAD(u.id, 14, '0')),
  COALESCE(NULLIF(TRIM(sp.student_no), ''), NULLIF(TRIM(u.mobile), ''), CONCAT('stu_', u.id)),
  'PENDING_SM3',
  u.name,
  CASE
    WHEN LOWER(TRIM(sp.gender)) IN ('male', 'm', '1', '男') THEN '男'
    WHEN LOWER(TRIM(sp.gender)) IN ('female', 'f', '2', '女') THEN '女'
    ELSE NULL
  END,
  COALESCE(NULLIF(TRIM(sp.mobile), ''), NULLIF(TRIM(u.mobile), '')),
  COALESCE(NULLIF(TRIM(sp.email), ''), NULLIF(TRIM(u.email), '')),
  NULLIF(TRIM(sp.emergency_contact_name), ''),
  NULLIF(TRIM(sp.emergency_contact_mobile), ''),
  u.last_login_at,
  u.last_login_at,
  IF(u.status = 'active', 'ENABLE', 'DISABLED'),
  u.id,
  JSON_OBJECT(
    'legacy_id', u.id,
    'student_profile_id', sp.id,
    'student_no', sp.student_no,
    'legacy_bcrypt_hash', u.password_hash,
    'initial_password_plain', sp.initial_password,
    'wx_openid', COALESCE(NULLIF(TRIM(sp.wx_openid), ''), NULLIF(TRIM(u.wx_openid), '')),
    'wx_unionid', COALESCE(NULLIF(TRIM(sp.wx_unionid), ''), NULLIF(TRIM(u.wx_unionid), ''))
  ),
  'NOT_DELETE',
  u.created_at,
  '1543837863788879871',
  u.updated_at,
  '1543837863788879871'
FROM `warnsys`.`users` u
LEFT JOIN `warnsys`.`student_profiles` sp ON sp.user_id = u.id
WHERE u.user_type = 'student';

INSERT INTO `CLIENT_USER_EXT` (
  `ID`, `USER_ID`, `SOURCE_FROM_TYPE`, `PASSWORD_UPDATE_TIME`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19003', LPAD(u.id, 14, '0')),
  CONCAT('19003', LPAD(u.id, 14, '0')),
  'SYSTEM_ADD',
  NOW(),
  'NOT_DELETE',
  u.created_at,
  '1543837863788879871',
  u.updated_at,
  '1543837863788879871'
FROM `warnsys`.`users` u
WHERE u.user_type = 'student';

INSERT INTO `AUTH_THIRD_USER` (
  `ID`, `THIRD_ID`, `USER_ID`, `NAME`, `NICKNAME`, `GENDER`, `CATEGORY`, `EXT_JSON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19043', LPAD(u.id, 14, '0')),
  COALESCE(NULLIF(TRIM(sp.wx_openid), ''), NULLIF(TRIM(u.wx_openid), '')),
  CONCAT('19003', LPAD(u.id, 14, '0')),
  u.name,
  u.name,
  CASE
    WHEN LOWER(TRIM(sp.gender)) IN ('male', 'm', '1', '男') THEN '男'
    WHEN LOWER(TRIM(sp.gender)) IN ('female', 'f', '2', '女') THEN '女'
    ELSE NULL
  END,
  'WECHAT_MINIAPP',
  JSON_OBJECT(
    'student_no', sp.student_no,
    'wx_unionid', COALESCE(NULLIF(TRIM(sp.wx_unionid), ''), NULLIF(TRIM(u.wx_unionid), ''))
  ),
  'NOT_DELETE',
  u.created_at,
  '1543837863788879871',
  u.updated_at,
  '1543837863788879871'
FROM `warnsys`.`users` u
LEFT JOIN `warnsys`.`student_profiles` sp ON sp.user_id = u.id
WHERE u.user_type = 'student'
  AND COALESCE(NULLIF(TRIM(sp.wx_openid), ''), NULLIF(TRIM(u.wx_openid), '')) IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 04. user_roles -> SYS_RELATION + SYS_USER_DATA_SCOPE (table_code = 04)
-- -----------------------------------------------------------------------------
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT
  CONCAT('19004', LPAD(ur.id, 14, '0')),
  CONCAT('19002', LPAD(ur.user_id, 14, '0')),
  CASE ur.role
    WHEN 'sys_admin'      THEN '1570687866138206208'
    WHEN 'head_teacher'   THEN '1909000000000000001'
    WHEN 'teacher'        THEN '1909000000000000002'
    WHEN 'student_admin'  THEN '1909000000000000003'
    WHEN 'teaching_admin' THEN '1909000000000000004'
    WHEN 'vice_dean'      THEN '1909000000000000005'
    ELSE '1909000000000000002'
  END,
  'SYS_USER_HAS_ROLE',
  JSON_OBJECT('scope_type', ur.scope_type, 'scope_id', ur.scope_id, 'legacy_role', ur.role)
FROM `warnsys`.`user_roles` ur
JOIN `warnsys`.`users` u ON ur.user_id = u.id
WHERE u.user_type != 'student';

INSERT IGNORE INTO `SYS_USER_DATA_SCOPE` (`USER_ID`, `SCOPE_KEY`, `ORG_ID`)
SELECT
  CONCAT('19002', LPAD(ur.user_id, 14, '0')),
  MD5(CONCAT('19001', LPAD(ur.scope_id, 14, '0'))),
  CONCAT('19001', LPAD(ur.scope_id, 14, '0'))
FROM `warnsys`.`user_roles` ur
JOIN `warnsys`.`users` u ON ur.user_id = u.id
WHERE u.user_type != 'student'
  AND ur.scope_type IN ('college', 'org')
  AND ur.scope_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 05. majors -> BIZ_MAJOR (table_code = 05)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_MAJOR` (
  `ID`, `ORG_ID`, `NAME`, `CODE`, `STATUS`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19005', LPAD(m.id, 14, '0')),
  CONCAT('19001', LPAD(m.org_id, 14, '0')),
  m.name,
  m.code,
  m.status,
  'NOT_DELETE',
  m.created_at,
  '1543837863788879871',
  m.updated_at,
  '1543837863788879871'
FROM `warnsys`.`majors` m;

-- -----------------------------------------------------------------------------
-- 06. classes -> BIZ_CLASS (table_code = 06)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CLASS` (
  `ID`, `ORG_ID`, `MAJOR_ID`, `CLASS_NAME`, `ENROLL_YEAR`, `MAJOR`, `GRADE_LEVEL`,
  `COUNSELOR_USER_ID`, `STATUS`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19006', LPAD(c.id, 14, '0')),
  CONCAT('19001', LPAD(c.org_id, 14, '0')),
  IF(c.major_id IS NOT NULL, CONCAT('19005', LPAD(c.major_id, 14, '0')), NULL),
  c.class_name,
  c.enroll_year,
  c.major,
  c.grade_level,
  IF(c.counselor_user_id IS NOT NULL, CONCAT('19002', LPAD(c.counselor_user_id, 14, '0')), NULL),
  c.status,
  'NOT_DELETE',
  c.created_at,
  '1543837863788879871',
  c.updated_at,
  '1543837863788879871'
FROM `warnsys`.`classes` c;

-- -----------------------------------------------------------------------------
-- 07. student_profiles -> BIZ_STUDENT_PROFILE (table_code = 07)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_STUDENT_PROFILE` (
  `ID`, `CLIENT_USER_ID`, `STUDENT_NO`, `NAME`, `GENDER`, `PHOTO_FILE_ID`,
  `CLASS_ID`, `ORG_ID`, `MAJOR_ID`, `MAJOR`, `ENROLL_YEAR`,
  `MOBILE`, `EMAIL`, `EMERGENCY_CONTACT_NAME`, `EMERGENCY_CONTACT_MOBILE`,
  `NOTIFY_PREFS_JSON`, `STATUS`, `INITIAL_PASSWORD`, `STUDENT_POSITION`, `WX_OPENID`, `WX_UNIONID`,
  `EXT_JSON`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19007', LPAD(sp.id, 14, '0')),
  CONCAT('19003', LPAD(sp.user_id, 14, '0')),
  sp.student_no,
  u.name,
  sp.gender,
  IF(sp.photo_file_id IS NOT NULL, CONCAT('19038', LPAD(sp.photo_file_id, 14, '0')), NULL),
  CONCAT('19006', LPAD(sp.class_id, 14, '0')),
  IF(sp.org_id IS NOT NULL, CONCAT('19001', LPAD(sp.org_id, 14, '0')), CONCAT('19001', LPAD(c.org_id, 14, '0'))),
  IF(sp.major_id IS NOT NULL, CONCAT('19005', LPAD(sp.major_id, 14, '0')), NULL),
  sp.major,
  sp.enroll_year,
  NULLIF(TRIM(sp.mobile), ''),
  NULLIF(TRIM(sp.email), ''),
  NULLIF(TRIM(sp.emergency_contact_name), ''),
  NULLIF(TRIM(sp.emergency_contact_mobile), ''),
  CAST(sp.notify_prefs_json AS CHAR),
  sp.status,
  sp.initial_password,
  sp.student_position,
  sp.wx_openid,
  sp.wx_unionid,
  JSON_OBJECT('legacy_id', sp.id, 'legacy_user_id', sp.user_id),
  'NOT_DELETE',
  sp.created_at,
  '1543837863788879871',
  sp.updated_at,
  '1543837863788879871'
FROM `warnsys`.`student_profiles` sp
JOIN `warnsys`.`users` u ON sp.user_id = u.id
LEFT JOIN `warnsys`.`classes` c ON sp.class_id = c.id;

-- -----------------------------------------------------------------------------
-- 08. courses -> BIZ_COURSE (table_code = 08)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_COURSE` (
  `ID`, `ORG_ID`, `COURSE_CODE`, `COURSE_NAME`, `CREDIT`, `STATUS`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19008', LPAD(co.id, 14, '0')),
  CONCAT('19001', LPAD(co.org_id, 14, '0')),
  co.course_code,
  co.course_name,
  co.credit,
  co.status,
  'NOT_DELETE',
  co.created_at,
  '1543837863788879871',
  co.updated_at,
  '1543837863788879871'
FROM `warnsys`.`courses` co;

-- -----------------------------------------------------------------------------
-- 09. course_classes -> BIZ_COURSE_CLASS (table_code = 09)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_COURSE_CLASS` (
  `ID`, `COURSE_ID`, `CLASS_ID`, `TEACHER_USER_ID`, `TERM_CODE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19009', LPAD(cc.id, 14, '0')),
  CONCAT('19008', LPAD(cc.course_id, 14, '0')),
  CONCAT('19006', LPAD(cc.class_id, 14, '0')),
  CONCAT('19002', LPAD(cc.teacher_user_id, 14, '0')),
  cc.term_code,
  'NOT_DELETE',
  cc.created_at,
  '1543837863788879871',
  cc.created_at,
  '1543837863788879871'
FROM `warnsys`.`course_classes` cc;

-- -----------------------------------------------------------------------------
-- 10. schedules -> BIZ_SCHEDULE (table_code = 10)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_SCHEDULE` (
  `ID`, `TERM_CODE`, `COURSE_ID`, `CLASS_ID`, `TEACHER_USER_ID`,
  `SESSION_START`, `SESSION_END`, `EXPIRE_MINUTES`, `STATUS`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19010', LPAD(s.id, 14, '0')),
  s.term_code,
  CONCAT('19008', LPAD(s.course_id, 14, '0')),
  CONCAT('19006', LPAD(s.class_id, 14, '0')),
  CONCAT('19002', LPAD(s.teacher_user_id, 14, '0')),
  s.session_start,
  s.session_end,
  s.expire_minutes,
  s.status,
  'NOT_DELETE',
  s.created_at,
  '1543837863788879871',
  s.updated_at,
  '1543837863788879871'
FROM `warnsys`.`schedules` s;

-- -----------------------------------------------------------------------------
-- 11. teacher_course_bindings -> BIZ_TEACHER_COURSE_BINDING (table_code = 11)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_TEACHER_COURSE_BINDING` (
  `ID`, `TEACHER_ID`, `ORG_ID`, `COURSE_ID`, `CLASS_ID`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19011', LPAD(tcb.id, 14, '0')),
  CONCAT('19002', LPAD(tcb.teacher_id, 14, '0')),
  CONCAT('19001', LPAD(tcb.org_id, 14, '0')),
  CONCAT('19008', LPAD(tcb.course_id, 14, '0')),
  CONCAT('19006', LPAD(tcb.class_id, 14, '0')),
  'NOT_DELETE',
  tcb.created_at,
  '1543837863788879871',
  tcb.created_at,
  '1543837863788879871'
FROM `warnsys`.`teacher_course_bindings` tcb;

-- -----------------------------------------------------------------------------
-- 12. calendar_exclusions -> BIZ_CALENDAR_EXCLUSION (table_code = 12)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CALENDAR_EXCLUSION` (
  `ID`, `SCOPE`, `SCOPE_ID`, `EXCLUSION_DATE`, `REASON`, `CREATED_BY`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19012', LPAD(ce.id, 14, '0')),
  ce.scope,
  IF(ce.scope_id IS NOT NULL, CONCAT('19001', LPAD(ce.scope_id, 14, '0')), NULL),
  ce.exclusion_date,
  ce.reason,
  CONCAT('19002', LPAD(ce.created_by, 14, '0')),
  'NOT_DELETE',
  ce.created_at,
  CONCAT('19002', LPAD(ce.created_by, 14, '0')),
  ce.created_at,
  CONCAT('19002', LPAD(ce.created_by, 14, '0'))
FROM `warnsys`.`calendar_exclusions` ce;

-- -----------------------------------------------------------------------------
-- 13. warning_rules -> BIZ_WARNING_RULE (table_code = 13)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WARNING_RULE` (
  `ID`, `SCOPE`, `SCOPE_ID`, `RULE_VERSION`, `LEVEL`, `WINDOW_TYPE`, `METRIC`, `THRESHOLD`,
  `ENABLED`, `EXCLUSIONS_JSON`, `NOTIFY_STRATEGY_JSON`, `CREATED_BY`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19013', LPAD(wr.id, 14, '0')),
  wr.scope,
  IF(wr.scope_id IS NOT NULL, CONCAT('19001', LPAD(wr.scope_id, 14, '0')), NULL),
  wr.rule_version,
  wr.level,
  wr.`window`,
  wr.metric,
  wr.threshold,
  wr.enabled,
  CAST(wr.exclusions_json AS CHAR),
  CAST(wr.notify_strategy_json AS CHAR),
  CONCAT('19002', LPAD(wr.created_by, 14, '0')),
  'NOT_DELETE',
  wr.created_at,
  CONCAT('19002', LPAD(wr.created_by, 14, '0')),
  wr.updated_at,
  CONCAT('19002', LPAD(wr.created_by, 14, '0'))
FROM `warnsys`.`warning_rules` wr;

-- -----------------------------------------------------------------------------
-- 14. message_templates -> BIZ_MESSAGE_TEMPLATE (table_code = 14)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_MESSAGE_TEMPLATE` (
  `ID`, `CHANNEL`, `TEMPLATE_CODE`, `TITLE`, `CONTENT`, `STATUS`, `CREATED_BY`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19014', LPAD(mt.id, 14, '0')),
  mt.channel,
  mt.template_code,
  mt.title,
  mt.content,
  mt.status,
  CONCAT('19002', LPAD(mt.created_by, 14, '0')),
  'NOT_DELETE',
  mt.created_at,
  CONCAT('19002', LPAD(mt.created_by, 14, '0')),
  mt.updated_at,
  CONCAT('19002', LPAD(mt.created_by, 14, '0'))
FROM `warnsys`.`message_templates` mt;

-- -----------------------------------------------------------------------------
-- 15. class_notifications -> BIZ_CLASS_NOTIFICATION (table_code = 15)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CLASS_NOTIFICATION` (
  `ID`, `CLASS_ID`, `ORG_ID`, `TITLE`, `CONTENT`, `PUBLISHER_ID`, `PUBLISHER_NAME`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19015', LPAD(cn.id, 14, '0')),
  CONCAT('19006', LPAD(cn.class_id, 14, '0')),
  CONCAT('19001', LPAD(cn.org_id, 14, '0')),
  cn.title,
  cn.content,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(cn.publisher_id, 14, '0')), CONCAT('19002', LPAD(cn.publisher_id, 14, '0'))),
  cn.publisher_name,
  'NOT_DELETE',
  cn.created_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(cn.publisher_id, 14, '0')), CONCAT('19002', LPAD(cn.publisher_id, 14, '0'))),
  cn.updated_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(cn.publisher_id, 14, '0')), CONCAT('19002', LPAD(cn.publisher_id, 14, '0')))
FROM `warnsys`.`class_notifications` cn
LEFT JOIN `warnsys`.`users` u ON cn.publisher_id = u.id;

-- -----------------------------------------------------------------------------
-- 16. student_notification_reads -> BIZ_STUDENT_NOTIFICATION_READ (table_code = 16)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_STUDENT_NOTIFICATION_READ` (
  `ID`, `STUDENT_ID`, `NOTIFICATION_ID`, `READ_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19016', LPAD(snr.id, 14, '0')),
  CONCAT('19007', LPAD(snr.student_id, 14, '0')),
  CONCAT('19015', LPAD(snr.notification_id, 14, '0')),
  snr.read_at,
  'NOT_DELETE',
  COALESCE(snr.read_at, NOW()),
  '1543837863788879871',
  COALESCE(snr.read_at, NOW()),
  '1543837863788879871'
FROM `warnsys`.`student_notification_reads` snr;

-- -----------------------------------------------------------------------------
-- 17. grades -> BIZ_GRADE (table_code = 17)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_GRADE` (
  `ID`, `STUDENT_ID`, `COURSE_ID`, `TERM_CODE`, `SCORE`, `GRADE_POINT`, `PASS_STATUS`, `SOURCE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19017', LPAD(g.id, 14, '0')),
  CONCAT('19007', LPAD(g.student_id, 14, '0')),
  CONCAT('19008', LPAD(g.course_id, 14, '0')),
  g.term_code,
  g.score,
  g.grade_point,
  g.pass_status,
  g.source,
  'NOT_DELETE',
  g.created_at,
  '1543837863788879871',
  g.updated_at,
  '1543837863788879871'
FROM `warnsys`.`grades` g;

-- -----------------------------------------------------------------------------
-- 18. leave_requests -> BIZ_LEAVE_REQUEST (table_code = 18)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_LEAVE_REQUEST` (
  `ID`, `STUDENT_ID`, `CLASS_ID`, `FROM_DATE`, `TO_DATE`, `REASON`,
  `PROOF_FILE_ID`, `PROOF_FILE_IDS_JSON`, `STATUS`, `APPROVER_USER_ID`,
  `APPROVED_AT`, `REJECTED_AT`, `REJECT_REASON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19018', LPAD(lr.id, 14, '0')),
  CONCAT('19007', LPAD(lr.student_id, 14, '0')),
  CONCAT('19006', LPAD(lr.class_id, 14, '0')),
  lr.from_date,
  lr.to_date,
  lr.reason,
  IF(lr.proof_file_id IS NOT NULL, CONCAT('19038', LPAD(lr.proof_file_id, 14, '0')), NULL),
  CAST(lr.proof_file_ids_json AS CHAR),
  lr.status,
  IF(lr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(lr.approver_user_id, 14, '0')), NULL),
  lr.approved_at,
  lr.rejected_at,
  lr.reject_reason,
  'NOT_DELETE',
  lr.created_at,
  CONCAT('19007', LPAD(lr.student_id, 14, '0')),
  lr.updated_at,
  IF(lr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(lr.approver_user_id, 14, '0')), NULL)
FROM `warnsys`.`leave_requests` lr;

-- -----------------------------------------------------------------------------
-- 19. makeup_requests -> BIZ_MAKEUP_REQUEST (table_code = 19)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_MAKEUP_REQUEST` (
  `ID`, `STUDENT_ID`, `RECORD_DATE`, `COURSE_ID`, `CHANGE_JSON`, `REASON`,
  `STATUS`, `APPROVER_USER_ID`, `APPROVED_AT`, `REJECTED_AT`, `REJECT_REASON`, `APPLIED_DAILY_RECORD_ID`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19019', LPAD(mr.id, 14, '0')),
  CONCAT('19007', LPAD(mr.student_id, 14, '0')),
  mr.record_date,
  IF(mr.course_id IS NOT NULL, CONCAT('19008', LPAD(mr.course_id, 14, '0')), NULL),
  CAST(mr.change_json AS CHAR),
  mr.reason,
  mr.status,
  IF(mr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(mr.approver_user_id, 14, '0')), NULL),
  mr.approved_at,
  mr.rejected_at,
  mr.reject_reason,
  IF(mr.applied_daily_record_id IS NOT NULL, CONCAT('19025', LPAD(mr.applied_daily_record_id, 14, '0')), NULL),
  'NOT_DELETE',
  mr.created_at,
  CONCAT('19007', LPAD(mr.student_id, 14, '0')),
  mr.updated_at,
  IF(mr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(mr.approver_user_id, 14, '0')), NULL)
FROM `warnsys`.`makeup_requests` mr;

-- -----------------------------------------------------------------------------
-- 20. appeals -> BIZ_APPEAL (table_code = 20)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_APPEAL` (
  `ID`, `STUDENT_ID`, `APPEAL_TYPE`, `RELATED_TYPE`, `RELATED_ID`, `CONTENT`,
  `EVIDENCE_FILE_ID`, `EVIDENCE_FILE_IDS_JSON`, `STATUS`, `HANDLER_USER_ID`, `RESULT_NOTE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19020', LPAD(a.id, 14, '0')),
  CONCAT('19007', LPAD(a.student_id, 14, '0')),
  a.appeal_type,
  a.related_type,
  IF(a.related_id IS NOT NULL, CONCAT('19026', LPAD(a.related_id, 14, '0')), NULL),
  a.content,
  IF(a.evidence_file_id IS NOT NULL, CONCAT('19038', LPAD(a.evidence_file_id, 14, '0')), NULL),
  CAST(a.evidence_file_ids_json AS CHAR),
  a.status,
  IF(a.handler_user_id IS NOT NULL, CONCAT('19002', LPAD(a.handler_user_id, 14, '0')), NULL),
  a.result_note,
  'NOT_DELETE',
  a.created_at,
  CONCAT('19007', LPAD(a.student_id, 14, '0')),
  a.updated_at,
  IF(a.handler_user_id IS NOT NULL, CONCAT('19002', LPAD(a.handler_user_id, 14, '0')), NULL)
FROM `warnsys`.`appeals` a;

-- -----------------------------------------------------------------------------
-- 21. change_requests -> BIZ_CHANGE_REQUEST (table_code = 21)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CHANGE_REQUEST` (
  `ID`, `REQUESTER_USER_ID`, `TARGET_TYPE`, `TARGET_ID`, `CHANGE_JSON`, `REASON`,
  `STATUS`, `APPROVER_USER_ID`, `APPROVED_AT`, `REJECTED_AT`, `REJECT_REASON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19021', LPAD(cr.id, 14, '0')),
  IF(u.user_type = 'student', CONCAT('19003', LPAD(cr.requester_user_id, 14, '0')), CONCAT('19002', LPAD(cr.requester_user_id, 14, '0'))),
  cr.target_type,
  CASE
    WHEN cr.target_type IN ('student_profile', 'student_profile_class_change')
      THEN CONCAT('19007', LPAD(cr.target_id, 14, '0'))
    WHEN cr.target_type = 'grade'
      THEN CONCAT('19017', LPAD(cr.target_id, 14, '0'))
    WHEN cr.target_type IN ('teacher_course_binding_change', 'teacher_org_change')
      THEN CONCAT('19002', LPAD(cr.target_id, 14, '0'))
    ELSE CAST(cr.target_id AS CHAR)
  END,
  CAST(cr.change_json AS CHAR),
  cr.reason,
  cr.status,
  IF(cr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(cr.approver_user_id, 14, '0')), NULL),
  cr.approved_at,
  cr.rejected_at,
  cr.reject_reason,
  'NOT_DELETE',
  cr.created_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(cr.requester_user_id, 14, '0')), CONCAT('19002', LPAD(cr.requester_user_id, 14, '0'))),
  cr.updated_at,
  IF(cr.approver_user_id IS NOT NULL, CONCAT('19002', LPAD(cr.approver_user_id, 14, '0')), NULL)
FROM `warnsys`.`change_requests` cr
LEFT JOIN `warnsys`.`users` u ON cr.requester_user_id = u.id;

-- -----------------------------------------------------------------------------
-- 22. class_sessions -> BIZ_CLASS_SESSION (table_code = 22)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CLASS_SESSION` (
  `ID`, `COURSE_ID`, `CLASS_ID`, `TEACHER_USER_ID`, `SESSION_START`, `SESSION_END`,
  `QR_TOKEN_HASH`, `QR_EXPIRE_AT`, `STATUS`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19022', LPAD(cs.id, 14, '0')),
  CONCAT('19008', LPAD(cs.course_id, 14, '0')),
  CONCAT('19006', LPAD(cs.class_id, 14, '0')),
  CONCAT('19002', LPAD(cs.teacher_user_id, 14, '0')),
  cs.session_start,
  cs.session_end,
  cs.qr_token_hash,
  cs.qr_expire_at,
  cs.status,
  'NOT_DELETE',
  cs.created_at,
  CONCAT('19002', LPAD(cs.teacher_user_id, 14, '0')),
  cs.created_at,
  CONCAT('19002', LPAD(cs.teacher_user_id, 14, '0'))
FROM `warnsys`.`class_sessions` cs;

-- -----------------------------------------------------------------------------
-- 23. class_session_snapshots -> BIZ_CLASS_SESSION_SNAPSHOT (table_code = 23)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CLASS_SESSION_SNAPSHOT` (
  `ID`, `SESSION_ID`, `CLASS_ID`, `ORG_ID`, `COURSE_ID`,
  `TOTAL_STUDENTS`, `CHECKED_IN_COUNT`, `ON_TIME_COUNT`, `LATE_COUNT`, `LEAVE_COUNT`, `ABSENT_COUNT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19023', LPAD(css.session_id, 14, '0')),
  CONCAT('19022', LPAD(css.session_id, 14, '0')),
  CONCAT('19006', LPAD(css.class_id, 14, '0')),
  CONCAT('19001', LPAD(css.org_id, 14, '0')),
  CONCAT('19008', LPAD(css.course_id, 14, '0')),
  css.total_students,
  css.checked_in_count,
  css.on_time_count,
  css.late_count,
  css.leave_count,
  css.absent_count,
  'NOT_DELETE',
  css.updated_at,
  '1543837863788879871',
  css.updated_at,
  '1543837863788879871'
FROM `warnsys`.`class_session_snapshots` css;

-- -----------------------------------------------------------------------------
-- 24. attendance_records -> BIZ_ATTENDANCE_RECORD (table_code = 24)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_ATTENDANCE_RECORD` (
  `ID`, `SESSION_ID`, `STUDENT_ID`, `CHECKIN_TIME`, `ATTENDANCE_STATUS`, `SOURCE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19024', LPAD(ar.id, 14, '0')),
  CONCAT('19022', LPAD(ar.session_id, 14, '0')),
  CONCAT('19007', LPAD(ar.student_id, 14, '0')),
  ar.checkin_time,
  ar.attendance_status,
  ar.source,
  'NOT_DELETE',
  ar.created_at,
  '1543837863788879871',
  ar.created_at,
  '1543837863788879871'
FROM `warnsys`.`attendance_records` ar;

-- -----------------------------------------------------------------------------
-- 25. daily_records -> BIZ_DAILY_RECORD (table_code = 25)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_DAILY_RECORD` (
  `ID`, `STUDENT_ID`, `RECORD_DATE`, `CLASS_ID`, `ORG_ID`, `COURSE_ID`,
  `ATTENDANCE_STATUS`, `HOMEWORK_STATUS`, `CLASS_BEHAVIOR`, `REMARKS`, `SOURCE`,
  `APPROVED_STATUS`, `APPROVED_BY`, `APPROVED_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19025', LPAD(dr.id, 14, '0')),
  CONCAT('19007', LPAD(dr.student_id, 14, '0')),
  dr.record_date,
  CONCAT('19006', LPAD(dr.class_id, 14, '0')),
  CONCAT('19001', LPAD(dr.org_id, 14, '0')),
  IF(dr.course_id IS NOT NULL, CONCAT('19008', LPAD(dr.course_id, 14, '0')), NULL),
  dr.attendance_status,
  dr.homework_status,
  dr.class_behavior,
  dr.remarks,
  dr.source,
  dr.approved_status,
  IF(dr.approved_by IS NOT NULL, CONCAT('19002', LPAD(dr.approved_by, 14, '0')), NULL),
  dr.approved_at,
  'NOT_DELETE',
  dr.created_at,
  '1543837863788879871',
  dr.updated_at,
  '1543837863788879871'
FROM `warnsys`.`daily_records` dr;

-- -----------------------------------------------------------------------------
-- 26. warnings -> BIZ_WARNING (table_code = 26)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WARNING` (
  `ID`, `STUDENT_ID`, `CLASS_ID`, `ORG_ID`, `METRIC`, `LEVEL`, `WINDOW_TYPE`,
  `PERIOD_START`, `PERIOD_END`, `RULE_ID`, `RULE_SNAPSHOT_JSON`, `TRIGGER_SUMMARY`,
  `TRIGGER_DETAIL_JSON`, `COURSE_ID`, `STATUS`,
  `ACKNOWLEDGED_AT`, `ACKNOWLEDGED_BY`, `CLOSED_AT`, `CLOSED_BY`, `CLOSE_NOTE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19026', LPAD(w.id, 14, '0')),
  CONCAT('19007', LPAD(w.student_id, 14, '0')),
  CONCAT('19006', LPAD(w.class_id, 14, '0')),
  CONCAT('19001', LPAD(w.org_id, 14, '0')),
  w.metric,
  w.level,
  w.`window`,
  w.period_start,
  w.period_end,
  CONCAT('19013', LPAD(w.rule_id, 14, '0')),
  CAST(w.rule_snapshot_json AS CHAR),
  w.trigger_summary,
  CAST(w.trigger_detail_json AS CHAR),
  IF(w.course_id IS NOT NULL, CONCAT('19008', LPAD(w.course_id, 14, '0')), NULL),
  w.status,
  w.acknowledged_at,
  IF(w.acknowledged_by IS NOT NULL, IF(uack.user_type = 'student', CONCAT('19003', LPAD(w.acknowledged_by, 14, '0')), CONCAT('19002', LPAD(w.acknowledged_by, 14, '0'))), NULL),
  w.closed_at,
  IF(w.closed_by IS NOT NULL, CONCAT('19002', LPAD(w.closed_by, 14, '0')), NULL),
  w.close_note,
  'NOT_DELETE',
  w.created_at,
  '1543837863788879871',
  w.updated_at,
  '1543837863788879871'
FROM `warnsys`.`warnings` w
LEFT JOIN `warnsys`.`users` uack ON w.acknowledged_by = uack.id;

-- -----------------------------------------------------------------------------
-- 27. warning_current_states -> BIZ_WARNING_CURRENT_STATE (table_code = 27)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WARNING_CURRENT_STATE` (
  `ID`, `STUDENT_ID`, `CLASS_ID`, `ORG_ID`, `METRIC`, `LEVEL`, `WINDOW_TYPE`,
  `PERIOD_START`, `PERIOD_END`, `COURSE_KEY`, `COURSE_ID`, `RULE_ID`, `RULE_SNAPSHOT_JSON`,
  `TRIGGER_SUMMARY`, `TRIGGER_DETAIL_JSON`, `CURRENT_COUNT`, `STATUS`,
  `ACKNOWLEDGED_AT`, `ACKNOWLEDGED_BY`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19027', LPAD(wcs.id, 14, '0')),
  CONCAT('19007', LPAD(wcs.student_id, 14, '0')),
  CONCAT('19006', LPAD(wcs.class_id, 14, '0')),
  CONCAT('19001', LPAD(wcs.org_id, 14, '0')),
  wcs.metric,
  wcs.level,
  wcs.`window`,
  wcs.period_start,
  wcs.period_end,
  wcs.course_key,
  IF(wcs.course_id IS NOT NULL, CONCAT('19008', LPAD(wcs.course_id, 14, '0')), NULL),
  CONCAT('19013', LPAD(wcs.rule_id, 14, '0')),
  CAST(wcs.rule_snapshot_json AS CHAR),
  wcs.trigger_summary,
  CAST(wcs.trigger_detail_json AS CHAR),
  wcs.current_count,
  wcs.status,
  wcs.acknowledged_at,
  IF(wcs.acknowledged_by IS NOT NULL, IF(uack.user_type = 'student', CONCAT('19003', LPAD(wcs.acknowledged_by, 14, '0')), CONCAT('19002', LPAD(wcs.acknowledged_by, 14, '0'))), NULL),
  'NOT_DELETE',
  wcs.created_at,
  '1543837863788879871',
  wcs.updated_at,
  '1543837863788879871'
FROM `warnsys`.`warning_current_states` wcs
LEFT JOIN `warnsys`.`users` uack ON wcs.acknowledged_by = uack.id;

-- -----------------------------------------------------------------------------
-- 28. student_warning_snapshots -> BIZ_STUDENT_WARNING_SNAPSHOT (table_code = 28)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_STUDENT_WARNING_SNAPSHOT` (
  `ID`, `STUDENT_ID`, `CLASS_ID`, `ORG_ID`,
  `TODAY_WARNING_TOTAL`, `WEEK_WARNING_TOTAL`, `MONTH_WARNING_TOTAL`,
  `ACTIVE_WARNING_COUNT`, `CLOSED_WARNING_COUNT`, `ALL_WARNING_COUNT`,
  `ACTIVE_HIGHEST_LEVEL`, `CLOSED_HIGHEST_LEVEL`, `ALL_HIGHEST_LEVEL`,
  `ACTIVE_LAST_WARNING_AT`, `CLOSED_LAST_WARNING_AT`, `ALL_LAST_WARNING_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19028', LPAD(sws.student_id, 14, '0')),
  CONCAT('19007', LPAD(sws.student_id, 14, '0')),
  CONCAT('19006', LPAD(sws.class_id, 14, '0')),
  CONCAT('19001', LPAD(sws.org_id, 14, '0')),
  sws.today_warning_total,
  sws.week_warning_total,
  sws.month_warning_total,
  sws.active_warning_count,
  sws.closed_warning_count,
  sws.all_warning_count,
  sws.active_highest_level,
  sws.closed_highest_level,
  sws.all_highest_level,
  sws.active_last_warning_at,
  sws.closed_last_warning_at,
  sws.all_last_warning_at,
  'NOT_DELETE',
  sws.updated_at,
  '1543837863788879871',
  sws.updated_at,
  '1543837863788879871'
FROM `warnsys`.`student_warning_snapshots` sws;

-- -----------------------------------------------------------------------------
-- 29. class_monitor_snapshots -> BIZ_CLASS_MONITOR_SNAPSHOT (table_code = 29)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_CLASS_MONITOR_SNAPSHOT` (
  `ID`, `CLASS_ID`, `ORG_ID`, `TOTAL_STUDENTS`, `WARNING_COUNT`, `RED_WARNING_COUNT`, `LEAVE_COUNT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19029', LPAD(cms.class_id, 14, '0')),
  CONCAT('19006', LPAD(cms.class_id, 14, '0')),
  CONCAT('19001', LPAD(cms.org_id, 14, '0')),
  cms.total_students,
  cms.warning_count,
  cms.red_warning_count,
  cms.leave_count,
  'NOT_DELETE',
  cms.updated_at,
  '1543837863788879871',
  cms.updated_at,
  '1543837863788879871'
FROM `warnsys`.`class_monitor_snapshots` cms;

-- -----------------------------------------------------------------------------
-- 30. warning_cases -> BIZ_WARNING_CASE (table_code = 30)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WARNING_CASE` (
  `ID`, `STUDENT_ID`, `CLASS_ID`, `ORG_ID`, `PRIMARY_WARNING_ID`, `SOURCE_WARNING_IDS_JSON`,
  `RISK_SCORE`, `RISK_BREAKDOWN_JSON`, `WARNING_SUMMARY_JSON`, `HANDLING_PRIORITY`, `STATUS`,
  `HANDLER_USER_ID`, `ASSIGNED_BY`, `ASSIGNED_AT`, `ACCEPTED_AT`, `COMPLETED_AT`, `RESOLVED_AT`,
  `COMPLETION_SUMMARY`, `COMPLETION_DETAIL_JSON`, `LATEST_WARNING_AT`, `LAST_RISK_AT`, `IS_ACTIVE`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19030', LPAD(wc.id, 14, '0')),
  CONCAT('19007', LPAD(wc.student_id, 14, '0')),
  CONCAT('19006', LPAD(wc.class_id, 14, '0')),
  CONCAT('19001', LPAD(wc.org_id, 14, '0')),
  IF(wc.primary_warning_id IS NOT NULL, CONCAT('19026', LPAD(wc.primary_warning_id, 14, '0')), NULL),
  CAST(wc.source_warning_ids_json AS CHAR),
  wc.risk_score,
  CAST(wc.risk_breakdown_json AS CHAR),
  CAST(wc.warning_summary_json AS CHAR),
  wc.handling_priority,
  wc.status,
  IF(wc.handler_user_id IS NOT NULL, CONCAT('19002', LPAD(wc.handler_user_id, 14, '0')), NULL),
  IF(wc.assigned_by IS NOT NULL, CONCAT('19002', LPAD(wc.assigned_by, 14, '0')), NULL),
  wc.assigned_at,
  wc.accepted_at,
  wc.completed_at,
  wc.resolved_at,
  wc.completion_summary,
  CAST(wc.completion_detail_json AS CHAR),
  wc.latest_warning_at,
  wc.last_risk_at,
  wc.is_active,
  'NOT_DELETE',
  wc.created_at,
  '1543837863788879871',
  wc.updated_at,
  '1543837863788879871'
FROM `warnsys`.`warning_cases` wc;

-- -----------------------------------------------------------------------------
-- 31. warning_case_logs -> BIZ_WARNING_CASE_LOG (table_code = 31)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WARNING_CASE_LOG` (
  `ID`, `CASE_ID`, `ACTION`, `ACTOR_USER_ID`, `NOTE`, `DETAIL_JSON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19031', LPAD(wcl.id, 14, '0')),
  CONCAT('19030', LPAD(wcl.case_id, 14, '0')),
  wcl.action,
  IF(wcl.actor_user_id IS NOT NULL, IF(u.user_type = 'student', CONCAT('19003', LPAD(wcl.actor_user_id, 14, '0')), CONCAT('19002', LPAD(wcl.actor_user_id, 14, '0'))), NULL),
  wcl.note,
  CAST(wcl.detail_json AS CHAR),
  'NOT_DELETE',
  wcl.created_at,
  IF(wcl.actor_user_id IS NOT NULL, IF(u.user_type = 'student', CONCAT('19003', LPAD(wcl.actor_user_id, 14, '0')), CONCAT('19002', LPAD(wcl.actor_user_id, 14, '0'))), '1543837863788879871'),
  wcl.created_at,
  '1543837863788879871'
FROM `warnsys`.`warning_case_logs` wcl
LEFT JOIN `warnsys`.`users` u ON wcl.actor_user_id = u.id;

-- -----------------------------------------------------------------------------
-- 32~34. weekly / monthly / term summaries
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_WEEKLY_SUMMARY` (
  `ID`, `STUDENT_ID`, `WEEK_START`, `WEEK_END`, `LATE_COUNT`, `ABSENT_COUNT`, `HOMEWORK_NOT_SUBMIT_COUNT`, `GENERATED_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19032', LPAD(ws.id, 14, '0')),
  CONCAT('19007', LPAD(ws.student_id, 14, '0')),
  ws.week_start, ws.week_end, ws.late_count, ws.absent_count, ws.homework_not_submit_count, ws.generated_at,
  'NOT_DELETE', ws.generated_at, '1543837863788879871', ws.generated_at, '1543837863788879871'
FROM `warnsys`.`weekly_summaries` ws;

INSERT INTO `BIZ_MONTHLY_SUMMARY` (
  `ID`, `STUDENT_ID`, `YEAR`, `MONTH`, `LATE_COUNT`, `ABSENT_COUNT`, `HOMEWORK_NOT_SUBMIT_COUNT`, `GENERATED_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19033', LPAD(ms.id, 14, '0')),
  CONCAT('19007', LPAD(ms.student_id, 14, '0')),
  ms.year, ms.month, ms.late_count, ms.absent_count, ms.homework_not_submit_count, ms.generated_at,
  'NOT_DELETE', ms.generated_at, '1543837863788879871', ms.generated_at, '1543837863788879871'
FROM `warnsys`.`monthly_summaries` ms;

INSERT INTO `BIZ_TERM_SUMMARY` (
  `ID`, `STUDENT_ID`, `TERM_CODE`, `FAILED_COURSE_COUNT`, `EARNED_CREDITS`, `REQUIRED_CREDITS`, `GPA`, `GENERATED_AT`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19034', LPAD(ts.id, 14, '0')),
  CONCAT('19007', LPAD(ts.student_id, 14, '0')),
  ts.term_code, ts.failed_course_count, ts.earned_credits, ts.required_credits, ts.gpa, ts.generated_at,
  'NOT_DELETE', ts.generated_at, '1543837863788879871', ts.generated_at, '1543837863788879871'
FROM `warnsys`.`term_summaries` ts;

-- -----------------------------------------------------------------------------
-- 35. notification_jobs -> BIZ_NOTIFICATION_JOB (table_code = 35)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_NOTIFICATION_JOB` (
  `ID`, `TRIGGER_TYPE`, `WARNING_ID`, `SENDER_USER_ID`, `CHANNEL`, `TEMPLATE_CODE`,
  `RECEIVERS_JSON`, `PARAMS_JSON`, `SCHEDULE_AT`, `COOLDOWN_KEY`, `STATUS`, `TRY_COUNT`, `LAST_ERROR`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19035', LPAD(nj.id, 14, '0')),
  nj.trigger_type,
  IF(nj.warning_id IS NOT NULL, CONCAT('19026', LPAD(nj.warning_id, 14, '0')), NULL),
  IF(nj.sender_user_id IS NOT NULL, CONCAT('19002', LPAD(nj.sender_user_id, 14, '0')), NULL),
  nj.channel,
  nj.template_code,
  CAST(nj.receivers_json AS CHAR),
  CAST(nj.params_json AS CHAR),
  nj.schedule_at,
  nj.cooldown_key,
  nj.status,
  nj.try_count,
  nj.last_error,
  'NOT_DELETE',
  nj.created_at,
  '1543837863788879871',
  nj.updated_at,
  '1543837863788879871'
FROM `warnsys`.`notification_jobs` nj;

-- -----------------------------------------------------------------------------
-- 36. notification_logs -> BIZ_NOTIFICATION_LOG (table_code = 36)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_NOTIFICATION_LOG` (
  `ID`, `JOB_ID`, `CHANNEL`, `RECEIVER`, `CONTENT_SNAPSHOT`, `SEND_STATUS`,
  `PROVIDER`, `PROVIDER_MSG_ID`, `ERROR_MSG`, `SENT_AT`,
  `ACKNOWLEDGED`, `ACKNOWLEDGED_AT`, `ACKNOWLEDGED_BY`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19036', LPAD(nl.id, 14, '0')),
  CONCAT('19035', LPAD(nl.job_id, 14, '0')),
  nl.channel,
  nl.receiver,
  nl.content_snapshot,
  nl.send_status,
  nl.provider,
  nl.provider_msg_id,
  nl.error_msg,
  nl.sent_at,
  nl.acknowledged,
  nl.acknowledged_at,
  IF(nl.acknowledged_by IS NOT NULL, IF(u.user_type = 'student', CONCAT('19003', LPAD(nl.acknowledged_by, 14, '0')), CONCAT('19002', LPAD(nl.acknowledged_by, 14, '0'))), NULL),
  'NOT_DELETE',
  nl.sent_at,
  '1543837863788879871',
  COALESCE(nl.acknowledged_at, nl.sent_at),
  '1543837863788879871'
FROM `warnsys`.`notification_logs` nl
LEFT JOIN `warnsys`.`users` u ON nl.acknowledged_by = u.id;

-- -----------------------------------------------------------------------------
-- 37. export_jobs -> BIZ_EXPORT_JOB (table_code = 37)
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_EXPORT_JOB` (
  `ID`, `CREATOR_USER_ID`, `SCOPE_TYPE`, `SCOPE_ID`, `REPORT_TYPE`, `PARAMS_JSON`,
  `STATUS`, `FILE_ID`, `ERROR_MSG`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19037', LPAD(ej.id, 14, '0')),
  IF(u.user_type = 'student', CONCAT('19003', LPAD(ej.creator_user_id, 14, '0')), CONCAT('19002', LPAD(ej.creator_user_id, 14, '0'))),
  ej.scope_type,
  CASE
    WHEN ej.scope_id IS NULL THEN NULL
    WHEN ej.scope_type IN ('org', 'college') THEN CONCAT('19001', LPAD(ej.scope_id, 14, '0'))
    WHEN ej.scope_type = 'class' THEN CONCAT('19006', LPAD(ej.scope_id, 14, '0'))
    WHEN ej.scope_type = 'self' THEN CONCAT('19007', LPAD(ej.scope_id, 14, '0'))
    ELSE CAST(ej.scope_id AS CHAR)
  END,
  ej.report_type,
  CAST(ej.params_json AS CHAR),
  ej.status,
  IF(ej.file_id IS NOT NULL, CONCAT('19038', LPAD(ej.file_id, 14, '0')), NULL),
  ej.error_msg,
  'NOT_DELETE',
  ej.created_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(ej.creator_user_id, 14, '0')), CONCAT('19002', LPAD(ej.creator_user_id, 14, '0'))),
  ej.updated_at,
  '1543837863788879871'
FROM `warnsys`.`export_jobs` ej
LEFT JOIN `warnsys`.`users` u ON ej.creator_user_id = u.id;

-- -----------------------------------------------------------------------------
-- 38. files -> DEV_FILE (table_code = 38, 开启 IS_DOWNLOAD_AUTH=1)
-- -----------------------------------------------------------------------------
INSERT INTO `DEV_FILE` (
  `ID`, `ENGINE`, `BUCKET`, `FILE_KEY`, `NAME`, `SUFFIX`, `SIZE_KB`, `SIZE_INFO`,
  `OBJ_NAME`, `STORAGE_PATH`, `DOWNLOAD_PATH`, `IS_DOWNLOAD_AUTH`, `EXT_JSON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19038', LPAD(f.id, 14, '0')),
  'MINIO',
  'warnsys-files',
  f.file_key,
  f.file_name,
  IF(LOCATE('.', f.file_name) > 0, LOWER(SUBSTRING_INDEX(f.file_name, '.', -1)), ''),
  GREATEST(1, ROUND(COALESCE(f.file_size, 0) / 1024)),
  CONCAT(ROUND(COALESCE(f.file_size, 0) / 1024, 1), ' KB'),
  f.file_key,
  f.file_key,
  CONCAT('/dev/file/download?id=', CONCAT('19038', LPAD(f.id, 14, '0'))),
  1,
  JSON_OBJECT('legacy_id', f.id, 'mime_type', f.mime_type, 'sha256', f.sha256, 'source', f.source, 'file_size_bytes', f.file_size),
  'NOT_DELETE',
  f.created_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(f.uploader_user_id, 14, '0')), CONCAT('19002', LPAD(f.uploader_user_id, 14, '0'))),
  f.created_at,
  '1543837863788879871'
FROM `warnsys`.`files` f
LEFT JOIN `warnsys`.`users` u ON f.uploader_user_id = u.id;

-- -----------------------------------------------------------------------------
-- 39. notification -> DEV_MESSAGE + DEV_RELATION (table_code = 39)
-- -----------------------------------------------------------------------------
INSERT INTO `DEV_MESSAGE` (
  `ID`, `CATEGORY`, `SUBJECT`, `CONTENT`, `EXT_JSON`,
  `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19039', LPAD(n.id, 14, '0')),
  'BIZ',
  n.type,
  n.content,
  JSON_OBJECT('legacy_id', n.id, 'legacy_type', n.type, 'legacy_status', n.status),
  'NOT_DELETE',
  n.created_at,
  '1543837863788879871',
  n.updated_at,
  '1543837863788879871'
FROM `warnsys`.`notification` n;

INSERT INTO `DEV_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT
  CONCAT('19039', LPAD(n.id, 14, '0')),
  CONCAT('19039', LPAD(n.id, 14, '0')),
  IF(u.user_type = 'student', CONCAT('19003', LPAD(n.user_id, 14, '0')), CONCAT('19002', LPAD(n.user_id, 14, '0'))),
  'MSG_TO_USER',
  IF(n.status = 'read', '{"read":true}', '{"read":false}')
FROM `warnsys`.`notification` n
LEFT JOIN `warnsys`.`users` u ON n.user_id = u.id;

-- -----------------------------------------------------------------------------
-- 40. audit_logs -> DEV_LOG (CATEGORY='OPERATE', table_code = 40)
-- -----------------------------------------------------------------------------
INSERT INTO `DEV_LOG` (
  `ID`, `CATEGORY`, `NAME`, `EXE_STATUS`, `EXE_MESSAGE`, `OP_IP`, `REQ_URL`,
  `PARAM_JSON`, `RESULT_JSON`, `OP_TIME`, `OP_USER`,
  `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19040', LPAD(al.id, 14, '0')),
  'OPERATE',
  LEFT(COALESCE(NULLIF(TRIM(al.action_desc), ''), al.action), 255),
  'SUCCESS',
  CONCAT(al.entity_type, ':', al.entity_id, IFNULL(CONCAT(' | ', al.entity_desc), '')),
  al.ip,
  LEFT(COALESCE(al.user_agent, ''), 255),
  CAST(al.before_json AS CHAR),
  CAST(al.after_json AS CHAR),
  al.created_at,
  COALESCE(u.name, CONCAT('user_', al.actor_user_id)),
  al.created_at,
  IF(u.user_type = 'student', CONCAT('19003', LPAD(al.actor_user_id, 14, '0')), CONCAT('19002', LPAD(al.actor_user_id, 14, '0'))),
  al.created_at,
  '1543837863788879871'
FROM `warnsys`.`audit_logs` al
LEFT JOIN `warnsys`.`users` u ON al.actor_user_id = u.id;

-- -----------------------------------------------------------------------------
-- 41. security_events -> DEV_LOG (LOGIN/LOGOUT/EXCEPTION, table_code = 41)
-- -----------------------------------------------------------------------------
INSERT INTO `DEV_LOG` (
  `ID`, `CATEGORY`, `NAME`, `EXE_STATUS`, `EXE_MESSAGE`, `OP_IP`,
  `PARAM_JSON`, `OP_TIME`, `OP_USER`,
  `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19041', LPAD(se.id, 14, '0')),
  CASE
    WHEN se.event_type IN ('login_success', 'login_failed', 'mfa_failed', 'register_success') THEN 'LOGIN'
    WHEN se.event_type = 'logout' THEN 'LOGOUT'
    ELSE 'EXCEPTION'
  END,
  se.event_type,
  IF(se.event_type IN ('login_failed', 'mfa_failed', 'password_reset_failed', 'password_reset_lookup_failed'), 'FAIL', 'SUCCESS'),
  LEFT(COALESCE(se.user_agent, se.event_type), 255),
  se.ip,
  CAST(se.detail_json AS CHAR),
  se.created_at,
  COALESCE(u.name, 'anonymous'),
  se.created_at,
  IF(se.user_id IS NOT NULL, IF(u.user_type = 'student', CONCAT('19003', LPAD(se.user_id, 14, '0')), CONCAT('19002', LPAD(se.user_id, 14, '0'))), NULL),
  se.created_at,
  '1543837863788879871'
FROM `warnsys`.`security_events` se
LEFT JOIN `warnsys`.`users` u ON se.user_id = u.id;

-- -----------------------------------------------------------------------------
-- 42. system_settings -> DEV_CONFIG (CATEGORY='BIZ_DEFINE', table_code = 42)
-- -----------------------------------------------------------------------------
INSERT INTO `DEV_CONFIG` (
  `ID`, `CONFIG_KEY`, `CONFIG_VALUE`, `CATEGORY`, `REMARK`, `SORT_CODE`,
  `EXT_JSON`, `DELETE_FLAG`, `CREATE_TIME`, `CREATE_USER`, `UPDATE_TIME`, `UPDATE_USER`
)
SELECT
  CONCAT('19042', LPAD(ss.id, 14, '0')),
  CONCAT('WARNSYS_', UPPER(ss.setting_key)),
  ss.setting_val,
  'BIZ_DEFINE',
  CONCAT('迁移自 warnsys.system_settings.', ss.setting_key),
  1000 + ss.id,
  JSON_OBJECT('legacy_id', ss.id, 'legacy_key', ss.setting_key),
  'NOT_DELETE',
  ss.created_at,
  '1543837863788879871',
  ss.updated_at,
  '1543837863788879871'
FROM `warnsys`.`system_settings` ss;

-- -----------------------------------------------------------------------------
-- 43. 写入全量 ID 映射审计表 BIZ_MIGRATION_ID_MAP
-- -----------------------------------------------------------------------------
INSERT INTO `BIZ_MIGRATION_ID_MAP` (`ID`, `TABLE_CODE`, `SOURCE_TABLE`, `SOURCE_ID`, `TARGET_TABLE`, `TARGET_ID`)
SELECT CONCAT('01:', id), '01', 'orgs', id, 'SYS_ORG', CONCAT('19001', LPAD(id, 14, '0')) FROM `warnsys`.`orgs`
UNION ALL
SELECT CONCAT('02:', id), '02', 'users_staff', id, 'SYS_USER', CONCAT('19002', LPAD(id, 14, '0')) FROM `warnsys`.`users` WHERE user_type != 'student'
UNION ALL
SELECT CONCAT('03:', id), '03', 'users_student', id, 'CLIENT_USER', CONCAT('19003', LPAD(id, 14, '0')) FROM `warnsys`.`users` WHERE user_type = 'student'
UNION ALL
SELECT CONCAT('05:', id), '05', 'majors', id, 'BIZ_MAJOR', CONCAT('19005', LPAD(id, 14, '0')) FROM `warnsys`.`majors`
UNION ALL
SELECT CONCAT('06:', id), '06', 'classes', id, 'BIZ_CLASS', CONCAT('19006', LPAD(id, 14, '0')) FROM `warnsys`.`classes`
UNION ALL
SELECT CONCAT('07:', id), '07', 'student_profiles', id, 'BIZ_STUDENT_PROFILE', CONCAT('19007', LPAD(id, 14, '0')) FROM `warnsys`.`student_profiles`
UNION ALL
SELECT CONCAT('08:', id), '08', 'courses', id, 'BIZ_COURSE', CONCAT('19008', LPAD(id, 14, '0')) FROM `warnsys`.`courses`
UNION ALL
SELECT CONCAT('09:', id), '09', 'course_classes', id, 'BIZ_COURSE_CLASS', CONCAT('19009', LPAD(id, 14, '0')) FROM `warnsys`.`course_classes`
UNION ALL
SELECT CONCAT('10:', id), '10', 'schedules', id, 'BIZ_SCHEDULE', CONCAT('19010', LPAD(id, 14, '0')) FROM `warnsys`.`schedules`
UNION ALL
SELECT CONCAT('11:', id), '11', 'teacher_course_bindings', id, 'BIZ_TEACHER_COURSE_BINDING', CONCAT('19011', LPAD(id, 14, '0')) FROM `warnsys`.`teacher_course_bindings`
UNION ALL
SELECT CONCAT('13:', id), '13', 'warning_rules', id, 'BIZ_WARNING_RULE', CONCAT('19013', LPAD(id, 14, '0')) FROM `warnsys`.`warning_rules`
UNION ALL
SELECT CONCAT('14:', id), '14', 'message_templates', id, 'BIZ_MESSAGE_TEMPLATE', CONCAT('19014', LPAD(id, 14, '0')) FROM `warnsys`.`message_templates`
UNION ALL
SELECT CONCAT('15:', id), '15', 'class_notifications', id, 'BIZ_CLASS_NOTIFICATION', CONCAT('19015', LPAD(id, 14, '0')) FROM `warnsys`.`class_notifications`
UNION ALL
SELECT CONCAT('18:', id), '18', 'leave_requests', id, 'BIZ_LEAVE_REQUEST', CONCAT('19018', LPAD(id, 14, '0')) FROM `warnsys`.`leave_requests`
UNION ALL
SELECT CONCAT('20:', id), '20', 'appeals', id, 'BIZ_APPEAL', CONCAT('19020', LPAD(id, 14, '0')) FROM `warnsys`.`appeals`
UNION ALL
SELECT CONCAT('21:', id), '21', 'change_requests', id, 'BIZ_CHANGE_REQUEST', CONCAT('19021', LPAD(id, 14, '0')) FROM `warnsys`.`change_requests`
UNION ALL
SELECT CONCAT('22:', id), '22', 'class_sessions', id, 'BIZ_CLASS_SESSION', CONCAT('19022', LPAD(id, 14, '0')) FROM `warnsys`.`class_sessions`
UNION ALL
SELECT CONCAT('24:', id), '24', 'attendance_records', id, 'BIZ_ATTENDANCE_RECORD', CONCAT('19024', LPAD(id, 14, '0')) FROM `warnsys`.`attendance_records`
UNION ALL
SELECT CONCAT('25:', id), '25', 'daily_records', id, 'BIZ_DAILY_RECORD', CONCAT('19025', LPAD(id, 14, '0')) FROM `warnsys`.`daily_records`
UNION ALL
SELECT CONCAT('26:', id), '26', 'warnings', id, 'BIZ_WARNING', CONCAT('19026', LPAD(id, 14, '0')) FROM `warnsys`.`warnings`
UNION ALL
SELECT CONCAT('27:', id), '27', 'warning_current_states', id, 'BIZ_WARNING_CURRENT_STATE', CONCAT('19027', LPAD(id, 14, '0')) FROM `warnsys`.`warning_current_states`
UNION ALL
SELECT CONCAT('30:', id), '30', 'warning_cases', id, 'BIZ_WARNING_CASE', CONCAT('19030', LPAD(id, 14, '0')) FROM `warnsys`.`warning_cases`
UNION ALL
SELECT CONCAT('35:', id), '35', 'notification_jobs', id, 'BIZ_NOTIFICATION_JOB', CONCAT('19035', LPAD(id, 14, '0')) FROM `warnsys`.`notification_jobs`
UNION ALL
SELECT CONCAT('36:', id), '36', 'notification_logs', id, 'BIZ_NOTIFICATION_LOG', CONCAT('19036', LPAD(id, 14, '0')) FROM `warnsys`.`notification_logs`
UNION ALL
SELECT CONCAT('37:', id), '37', 'export_jobs', id, 'BIZ_EXPORT_JOB', CONCAT('19037', LPAD(id, 14, '0')) FROM `warnsys`.`export_jobs`
UNION ALL
SELECT CONCAT('38:', id), '38', 'files', id, 'DEV_FILE', CONCAT('19038', LPAD(id, 14, '0')) FROM `warnsys`.`files`
UNION ALL
SELECT CONCAT('39:', id), '39', 'notification', id, 'DEV_MESSAGE', CONCAT('19039', LPAD(id, 14, '0')) FROM `warnsys`.`notification`
UNION ALL
SELECT CONCAT('40:', id), '40', 'audit_logs', id, 'DEV_LOG', CONCAT('19040', LPAD(id, 14, '0')) FROM `warnsys`.`audit_logs`
UNION ALL
SELECT CONCAT('41:', id), '41', 'security_events', id, 'DEV_LOG', CONCAT('19041', LPAD(id, 14, '0')) FROM `warnsys`.`security_events`
UNION ALL
SELECT CONCAT('42:', id), '42', 'system_settings', id, 'DEV_CONFIG', CONCAT('19042', LPAD(id, 14, '0')) FROM `warnsys`.`system_settings`;

SET FOREIGN_KEY_CHECKS = 1;
SET SQL_SAFE_UPDATES = 1;
