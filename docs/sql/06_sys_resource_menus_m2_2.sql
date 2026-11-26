-- =============================================================================
-- Milestone 2.2: 规则、校历排除、消息模板与班级公告 4 域菜单与权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000001%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND (`TARGET_ID` LIKE '/biz/calendar/%'
    OR `TARGET_ID` LIKE '/biz/warningrule/%'
    OR `TARGET_ID` LIKE '/biz/msgtemplate/%'
    OR `TARGET_ID` LIKE '/biz/classnotice/%');
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000001%';

-- 2. 插入目录与 4 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000001000', '0', '预警规则与通知', 'bizRuleNotifyCatalog', 'bizRuleNotifyCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/rule-notify', NULL, 'bell-outlined', 'YES', 'YES', 'YES', 16, 'NOT_DELETE', NOW()),
  ('1910000000000001100', '1910000000000001000', '校历排除日', 'bizCalendar', 'bizCalendarMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/calendar', 'biz/calendar/index', 'calendar-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000001200', '1910000000000001000', '预警规则配置', 'bizWarningRule', 'bizWarningRuleMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/warningrule', 'biz/warningrule/index', 'alert-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW()),
  ('1910000000000001300', '1910000000000001000', '消息模板', 'bizMsgTemplate', 'bizMsgTemplateMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/msgtemplate', 'biz/msgtemplate/index', 'mail-outlined', 'YES', 'YES', 'YES', 3, 'NOT_DELETE', NOW()),
  ('1910000000000001400', '1910000000000001000', '班级公告', 'bizClassNotice', 'bizClassNoticeMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/classnotice', 'biz/classnotice/index', 'notification-outlined', 'YES', 'YES', 'YES', 4, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000001101', '1910000000000001100', '新增排除日', 'bizCalendarAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000001102', '1910000000000001100', '删除排除日', 'bizCalendarDelete', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000001103', '1910000000000001100', '批量删除', 'bizCalendarBatchDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000001201', '1910000000000001200', '新增规则', 'bizWarningRuleAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000001202', '1910000000000001200', '编辑规则', 'bizWarningRuleEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000001203', '1910000000000001200', '删除规则', 'bizWarningRuleDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000001204', '1910000000000001200', '批量删除', 'bizWarningRuleBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000001301', '1910000000000001300', '新增模板', 'bizMsgTemplateAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000001302', '1910000000000001300', '编辑模板', 'bizMsgTemplateEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000001303', '1910000000000001300', '删除模板', 'bizMsgTemplateDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000001304', '1910000000000001300', '批量删除', 'bizMsgTemplateBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000001305', '1910000000000001300', '调试发送', 'bizMsgTemplateTestSend', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  ('1910000000000001401', '1910000000000001400', '发布公告', 'bizClassNoticeAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000001402', '1910000000000001400', '编辑公告', 'bizClassNoticeEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000001403', '1910000000000001400', '删除公告', 'bizClassNoticeDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000001404', '1910000000000001400', '批量删除', 'bizClassNoticeBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000001405', '1910000000000001400', '已读明细', 'bizClassNoticeReadStats', 'BUTTON', 5, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1921', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000001000' THEN '{"menuId":"1910000000000001000","buttonInfo":[]}'
           WHEN '1910000000000001100' THEN '{"menuId":"1910000000000001100","buttonInfo":["1910000000000001101","1910000000000001102","1910000000000001103"]}'
           WHEN '1910000000000001200' THEN '{"menuId":"1910000000000001200","buttonInfo":["1910000000000001201","1910000000000001202","1910000000000001203","1910000000000001204"]}'
           WHEN '1910000000000001300' THEN '{"menuId":"1910000000000001300","buttonInfo":["1910000000000001301","1910000000000001302","1910000000000001303","1910000000000001304","1910000000000001305"]}'
           WHEN '1910000000000001400' THEN '{"menuId":"1910000000000001400","buttonInfo":["1910000000000001401","1910000000000001402","1910000000000001403","1910000000000001404","1910000000000001405"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000003'
) role_t
WHERE r.ID IN ('1910000000000001000','1910000000000001100','1910000000000001200','1910000000000001300','1910000000000001400');

-- head_teacher: 班级公告管理 + 校历/预警规则只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1921100000100001000', '1909000000000000001', '1910000000000001000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001000","buttonInfo":[]}'),
  ('1921110000100001100', '1909000000000000001', '1910000000000001100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001100","buttonInfo":[]}'),
  ('1921120000100001200', '1909000000000000001', '1910000000000001200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001200","buttonInfo":[]}'),
  ('1921140000100001400', '1909000000000000001', '1910000000000001400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001400","buttonInfo":["1910000000000001401","1910000000000001402","1910000000000001403","1910000000000001404","1910000000000001405"]}');

-- vice_dean & teaching_admin & teacher: 只读视角或校历配置
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1921100000400001000', '1909000000000000004', '1910000000000001000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001000","buttonInfo":[]}'),
  ('1921110000400001100', '1909000000000000004', '1910000000000001100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001100","buttonInfo":["1910000000000001101","1910000000000001102","1910000000000001103"]}'),
  ('1921120000400001200', '1909000000000000004', '1910000000000001200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001200","buttonInfo":[]}'),
  ('1921100000500001000', '1909000000000000005', '1910000000000001000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001000","buttonInfo":[]}'),
  ('1921110000500001100', '1909000000000000005', '1910000000000001100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001100","buttonInfo":[]}'),
  ('1921120000500001200', '1909000000000000005', '1910000000000001200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001200","buttonInfo":[]}'),
  ('1921140000500001400', '1909000000000000005', '1910000000000001400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001400","buttonInfo":["1910000000000001405"]}'),
  ('1921100000200001000', '1909000000000000002', '1910000000000001000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001000","buttonInfo":[]}'),
  ('1921110000200001100', '1909000000000000002', '1910000000000001100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000001100","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m22_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m22_apis VALUES
  ('01', '/biz/calendar/page'), ('02', '/biz/calendar/add'), ('03', '/biz/calendar/delete'), ('04', '/biz/calendar/orgTreeSelector'),
  ('05', '/biz/warningrule/page'), ('06', '/biz/warningrule/add'), ('07', '/biz/warningrule/edit'), ('08', '/biz/warningrule/delete'), ('09', '/biz/warningrule/detail'), ('10', '/biz/warningrule/orgTreeSelector'),
  ('11', '/biz/msgtemplate/page'), ('12', '/biz/msgtemplate/add'), ('13', '/biz/msgtemplate/edit'), ('14', '/biz/msgtemplate/delete'), ('15', '/biz/msgtemplate/detail'), ('16', '/biz/msgtemplate/testSend'),
  ('17', '/biz/classnotice/page'), ('18', '/biz/classnotice/add'), ('19', '/biz/classnotice/edit'), ('20', '/biz/classnotice/delete'), ('21', '/biz/classnotice/detail'), ('22', '/biz/classnotice/readStats');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1922', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- student_admin: 本学院作用域规则/校历/公告管理 + 模板
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1923', a.seq, RIGHT('1909000000000000003', 13)), '1909000000000000003', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a;

-- head_teacher: 班级公告 CRUD + 校历/规则只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1925', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a
WHERE a.api_url IN ('/biz/calendar/page','/biz/warningrule/page','/biz/warningrule/detail')
   OR a.seq BETWEEN '17' AND '22';

-- teaching_admin: 校历 + 规则查看
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1924', a.seq, RIGHT('1909000000000000004', 13)), '1909000000000000004', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a
WHERE a.seq BETWEEN '01' AND '05' OR a.api_url = '/biz/warningrule/detail';

-- vice_dean & teacher: 校历/公告只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1926', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a
WHERE a.api_url IN ('/biz/calendar/page','/biz/warningrule/page','/biz/warningrule/detail','/biz/classnotice/page','/biz/classnotice/detail','/biz/classnotice/readStats');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1927', a.seq, RIGHT('1909000000000000002', 13)), '1909000000000000002', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m22_apis a
WHERE a.api_url IN ('/biz/calendar/page');

DROP TEMPORARY TABLE IF EXISTS tmp_m22_apis;
