-- =============================================================================
-- 学业预警系统商业化落地综合修复脚本
-- 目标库: snowy
-- 覆盖修复:
--   1. 超管(superAdmin)及业务管理员(bizAdmin)对 C端用户管理(/client/user/**)的 API 权限补齐
--   2. 新增课次签到配置更新接口(/biz/attendance/session/updateConfig)全角色权限授权
--   3. MinIO 端点调整为容器内网地址 http://warnsys-minio:9000（保障缩略图生成与流式读取）
--   4. 同步 WARNSYS_EMAIL 真实 SMTP 配置到 Snowy 原生 EMAIL_LOCAL（465+SSL，关闭STARTTLS）
--   5. 清洗 BIZ_WARNING / BIZ_WARNING_CURRENT_STATE 中历史英文指标/窗口摘要为纯中文
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. C端用户管理接口授权给 superAdmin(1570687866138206208) 与 bizAdmin(1570687866138206209)
-- -----------------------------------------------------------------------------
DELETE FROM `SYS_RELATION`
WHERE `OBJECT_ID` IN ('1570687866138206208', '1570687866138206209')
  AND `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND `TARGET_ID` IN (
    '/client/user/page',
    '/client/user/add',
    '/client/user/edit',
    '/client/user/delete',
    '/client/user/detail',
    '/client/user/disableUser',
    '/client/user/enableUser',
    '/client/user/resetPassword'
  );

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
VALUES
  ('1909500000000000101', '1570687866138206208', '/client/user/page',          'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/page","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000102', '1570687866138206208', '/client/user/add',           'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/add","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000103', '1570687866138206208', '/client/user/edit',          'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/edit","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000104', '1570687866138206208', '/client/user/delete',        'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/delete","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000105', '1570687866138206208', '/client/user/detail',        'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/detail","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000106', '1570687866138206208', '/client/user/disableUser',   'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/disableUser","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000107', '1570687866138206208', '/client/user/enableUser',    'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/enableUser","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000108', '1570687866138206208', '/client/user/resetPassword', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/resetPassword","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),

  ('1909500000000000111', '1570687866138206209', '/client/user/page',          'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/page","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000112', '1570687866138206209', '/client/user/add',           'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/add","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000113', '1570687866138206209', '/client/user/edit',          'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/edit","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000114', '1570687866138206209', '/client/user/delete',        'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/delete","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000115', '1570687866138206209', '/client/user/detail',        'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/detail","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000116', '1570687866138206209', '/client/user/disableUser',   'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/disableUser","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000117', '1570687866138206209', '/client/user/enableUser',    'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/enableUser","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000118', '1570687866138206209', '/client/user/resetPassword', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/client/user/resetPassword","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}');

-- -----------------------------------------------------------------------------
-- 2. 新增课次动态签到配置接口权限 (/biz/attendance/session/updateConfig)
-- -----------------------------------------------------------------------------
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND `TARGET_ID` = '/biz/attendance/session/updateConfig';

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
VALUES
  ('1909500000000000201', '1570687866138206208', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000202', '1570687866138206209', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}'),
  ('1909500000000000203', '1909000000000000001', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}'),
  ('1909500000000000204', '1909000000000000002', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}'),
  ('1909500000000000205', '1909000000000000003', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}'),
  ('1909500000000000206', '1909000000000000004', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}'),
  ('1909500000000000207', '1909000000000000005', '/biz/attendance/session/updateConfig', 'SYS_ROLE_HAS_PERMISSION', '{"apiUrl":"/biz/attendance/session/updateConfig","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}');

-- -----------------------------------------------------------------------------
-- 3. MinIO 内网地址修正（容器间直接访问 warnsys-minio:9000）
-- -----------------------------------------------------------------------------
UPDATE `DEV_CONFIG`
SET `CONFIG_VALUE` = 'http://warnsys-minio:9000', `UPDATE_TIME` = NOW()
WHERE `CONFIG_KEY` = 'SNOWY_FILE_MINIO_END_POINT';

UPDATE `DEV_CONFIG`
SET `CONFIG_VALUE` = 'MINIO', `UPDATE_TIME` = NOW()
WHERE `CONFIG_KEY` = 'SNOWY_SYS_DEFAULT_FILE_ENGINE';

-- -----------------------------------------------------------------------------
-- 4. 同步真实邮件服务器配置到 EMAIL_LOCAL（QQ邮箱 465 SSL）
-- -----------------------------------------------------------------------------
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = '3382683787@qq.com', `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_FROM';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = 'hlcaafdblaumcibh',   `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_PASSWORD';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = 'smtp.qq.com',       `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_SMTP_HOST';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = '465',               `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_SMTP_PORT';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = 'true',              `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_AUTH';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = 'true',              `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_SSL_ENABLE';
UPDATE `DEV_CONFIG` SET `CONFIG_VALUE` = 'false',             `UPDATE_TIME` = NOW() WHERE `CONFIG_KEY` = 'SNOWY_EMAIL_LOCAL_STARTTLS_ENABLE';

-- -----------------------------------------------------------------------------
-- 5. 清洗历史预警摘要中可能残留的英文指标/窗口词
-- -----------------------------------------------------------------------------
UPDATE `BIZ_WARNING`
SET `TRIGGER_SUMMARY` =
  REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      `TRIGGER_SUMMARY`,
      'homework_not_submit', '作业未交'),
      'homework_late_submit', '作业迟交'),
      'class_behavior', '课堂违纪'),
      'failed_courses', '挂科门数'),
      'unacknowledged', '未确认预警'),
      'warning_total', '累计预警'),
      'early_leave', '早退'),
      'absent', '缺勤'),
      'late', '迟到'),
      'leave', '请假'),
    '[day/', '[日/'),
    '[week/', '[周/'),
    '[month/', '[月/'),
    '[term/', '[学期/');

UPDATE `BIZ_WARNING_CURRENT_STATE`
SET `TRIGGER_SUMMARY` =
  REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      `TRIGGER_SUMMARY`,
      'homework_not_submit', '作业未交'),
      'homework_late_submit', '作业迟交'),
      'class_behavior', '课堂违纪'),
      'failed_courses', '挂科门数'),
      'unacknowledged', '未确认预警'),
      'warning_total', '累计预警'),
      'early_leave', '早退'),
      'absent', '缺勤'),
      'late', '迟到'),
      'leave', '请假'),
    '[day/', '[日/'),
    '[week/', '[周/'),
    '[month/', '[月/'),
    '[term/', '[学期/');
