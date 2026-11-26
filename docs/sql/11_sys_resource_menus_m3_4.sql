-- =============================================================================
-- Milestone 3.4: 异步通知分发、EasyExcel 报表导出与 ECharts 大屏菜单权限 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000006%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND (`TARGET_ID` LIKE '/biz/notify/%' OR `TARGET_ID` LIKE '/biz/report/%' OR `TARGET_ID` LIKE '/biz/stats/%');
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000006%';

-- 2. 插入目录与 3 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000006000', '0', '统计通知与报表', 'bizAnalyticsCatalog', 'bizAnalyticsCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/analytics-center', NULL, 'bar-chart-outlined', 'YES', 'YES', 'YES', 20, 'NOT_DELETE', NOW()),
  ('1910000000000006100', '1910000000000006000', '学业统计大屏', 'bizStats', 'bizStatsMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/stats', 'biz/stats/index', 'pie-chart-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000006200', '1910000000000006000', '通知队列与回执', 'bizNotify', 'bizNotifyMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/notify', 'biz/notify/index', 'bell-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW()),
  ('1910000000000006300', '1910000000000006000', '报表导出中心', 'bizReport', 'bizReportMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/report', 'biz/report/index', 'file-excel-outlined', 'YES', 'YES', 'YES', 3, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000006201', '1910000000000006200', '入队与立即分发通知', 'bizNotifyDispatch', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000006202', '1910000000000006200', '取消或删除通知任务', 'bizNotifyManage', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000006301', '1910000000000006300', '生成并导出Excel报表', 'bizReportExport', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000006302', '1910000000000006300', '删除导出任务', 'bizReportDelete', 'BUTTON', 2, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1971', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000006000' THEN '{"menuId":"1910000000000006000","buttonInfo":[]}'
           WHEN '1910000000000006100' THEN '{"menuId":"1910000000000006100","buttonInfo":[]}'
           WHEN '1910000000000006200' THEN '{"menuId":"1910000000000006200","buttonInfo":["1910000000000006201","1910000000000006202"]}'
           WHEN '1910000000000006300' THEN '{"menuId":"1910000000000006300","buttonInfo":["1910000000000006301","1910000000000006302"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000003'
    UNION ALL SELECT '1909000000000000005'
) role_t
WHERE r.ID IN ('1910000000000006000','1910000000000006100','1910000000000006200','1910000000000006300');

-- teaching_admin: 大屏 + 报表
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1971100000400006000', '1909000000000000004', '1910000000000006000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006000","buttonInfo":[]}'),
  ('1971110000400006100', '1909000000000000004', '1910000000000006100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006100","buttonInfo":[]}'),
  ('1971130000400006300', '1909000000000000004', '1910000000000006300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006300","buttonInfo":["1910000000000006301"]}');

-- head_teacher: 大屏 + 通知入队 + 报表导出(无删除/全局分发)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1971100000100006000', '1909000000000000001', '1910000000000006000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006000","buttonInfo":[]}'),
  ('1971110000100006100', '1909000000000000001', '1910000000000006100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006100","buttonInfo":[]}'),
  ('1971120000100006200', '1909000000000000001', '1910000000000006200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006200","buttonInfo":[]}'),
  ('1971130000100006300', '1909000000000000001', '1910000000000006300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006300","buttonInfo":["1910000000000006301"]}');

-- teacher: 仅大屏查看
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1971100000200006000', '1909000000000000002', '1910000000000006000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006000","buttonInfo":[]}'),
  ('1971110000200006100', '1909000000000000002', '1910000000000006100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000006100","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m34_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m34_apis VALUES
  ('01', '/biz/stats/dashboard'),
  ('02', '/biz/notify/job/page'),
  ('03', '/biz/notify/log/page'),
  ('04', '/biz/notify/job/enqueue'),
  ('05', '/biz/notify/job/dispatchNow'),
  ('06', '/biz/notify/job/cancel'),
  ('07', '/biz/notify/log/ack'),
  ('08', '/biz/notify/job/delete'),
  ('09', '/biz/report/page'),
  ('10', '/biz/report/export'),
  ('11', '/biz/report/download'),
  ('12', '/biz/report/delete');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1972', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m34_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- student_admin & vice_dean: SCOPE_ORG_CHILD 全量
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1973', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m34_apis a
CROSS JOIN (
    SELECT '1909000000000000003' AS ROLE_ID
    UNION ALL SELECT '1909000000000000005'
) r;

-- teaching_admin: stats + report(no delete)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1974', a.seq, RIGHT('1909000000000000004', 13)), '1909000000000000004', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m34_apis a
WHERE a.api_url IN ('/biz/stats/dashboard','/biz/report/page','/biz/report/export','/biz/report/download');

-- head_teacher: stats + notify(view/enqueue/ack) + report(view/export/download)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1975', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m34_apis a
WHERE a.api_url IN ('/biz/stats/dashboard','/biz/notify/job/page','/biz/notify/log/page','/biz/notify/job/enqueue','/biz/notify/log/ack','/biz/report/page','/biz/report/export','/biz/report/download');

-- teacher: 仅 /biz/stats/dashboard (通知与导出严格 403)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
VALUES ('1976010000000000002', '1909000000000000002', '/biz/stats/dashboard', 'SYS_ROLE_HAS_PERMISSION',
        '{"apiUrl":"/biz/stats/dashboard","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}');

DROP TEMPORARY TABLE IF EXISTS tmp_m34_apis;
