-- =============================================================================
-- Milestone 3.2: 学业预警计算、高风险干预工单与汇总快照菜单权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000004%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND `TARGET_ID` LIKE '/biz/warning/%';
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000004%';

-- 2. 插入目录与 3 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000004000', '0', '预警中心与干预', 'bizWarningCenterCatalog', 'bizWarningCenterCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/warning-center', NULL, 'warning-outlined', 'YES', 'YES', 'YES', 19, 'NOT_DELETE', NOW()),
  ('1910000000000004100', '1910000000000004000', '学业预警台账', 'bizWarningLedger', 'bizWarningLedgerMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/warning', 'biz/warning/index', 'alert-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000004200', '1910000000000004000', '高风险干预工单', 'bizWarningCase', 'bizWarningCaseMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/warning-case', 'biz/warning/case', 'medicine-box-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW()),
  ('1910000000000004300', '1910000000000004000', '学业汇总与快照', 'bizWarningSummary', 'bizWarningSummaryMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/warning-summary', 'biz/warning/summary', 'fund-outlined', 'YES', 'YES', 'YES', 3, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000004101', '1910000000000004100', '触发全量扫描', 'bizWarningRescan', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000004102', '1910000000000004100', '确认预警', 'bizWarningAck', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000004103', '1910000000000004100', '关闭预警', 'bizWarningClose', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000004104', '1910000000000004100', '删除预警', 'bizWarningDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000004201', '1910000000000004200', '指派处置人', 'bizWarningCaseAssign', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000004202', '1910000000000004200', '接单处理', 'bizWarningCaseAccept', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000004203', '1910000000000004200', '提交处置总结', 'bizWarningCaseComplete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000004204', '1910000000000004200', '核验结案', 'bizWarningCaseResolve', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000004301', '1910000000000004300', '重算周月学期汇总', 'bizWarningSummaryRebuild', 'BUTTON', 1, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1951', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000004000' THEN '{"menuId":"1910000000000004000","buttonInfo":[]}'
           WHEN '1910000000000004100' THEN '{"menuId":"1910000000000004100","buttonInfo":["1910000000000004101","1910000000000004102","1910000000000004103","1910000000000004104"]}'
           WHEN '1910000000000004200' THEN '{"menuId":"1910000000000004200","buttonInfo":["1910000000000004201","1910000000000004202","1910000000000004203","1910000000000004204"]}'
           WHEN '1910000000000004300' THEN '{"menuId":"1910000000000004300","buttonInfo":["1910000000000004301"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000003'
) role_t
WHERE r.ID IN ('1910000000000004000','1910000000000004100','1910000000000004200','1910000000000004300');

-- head_teacher & vice_dean: 本学院预警/工单处置/汇总查看（不含删除）
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1951100000100004000', '1909000000000000001', '1910000000000004000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004000","buttonInfo":[]}'),
  ('1951110000100004100', '1909000000000000001', '1910000000000004100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004100","buttonInfo":["1910000000000004102","1910000000000004103"]}'),
  ('1951120000100004200', '1909000000000000001', '1910000000000004200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004200","buttonInfo":["1910000000000004202","1910000000000004203"]}'),
  ('1951130000100004300', '1909000000000000001', '1910000000000004300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004300","buttonInfo":[]}'),
  ('1951100000500004000', '1909000000000000005', '1910000000000004000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004000","buttonInfo":[]}'),
  ('1951110000500004100', '1909000000000000005', '1910000000000004100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004100","buttonInfo":[]}'),
  ('1951120000500004200', '1909000000000000005', '1910000000000004200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004200","buttonInfo":["1910000000000004201","1910000000000004204"]}'),
  ('1951130000500004300', '1909000000000000005', '1910000000000004300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000004300","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m32_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m32_apis VALUES
  ('01', '/biz/warning/page'),
  ('02', '/biz/warning/detail'),
  ('03', '/biz/warning/acknowledge'),
  ('04', '/biz/warning/close'),
  ('05', '/biz/warning/delete'),
  ('06', '/biz/warning/rescan'),
  ('07', '/biz/warning/case/page'),
  ('08', '/biz/warning/case/detail'),
  ('09', '/biz/warning/case/assign'),
  ('10', '/biz/warning/case/accept'),
  ('11', '/biz/warning/case/complete'),
  ('12', '/biz/warning/case/resolve'),
  ('13', '/biz/warning/summary/weekly'),
  ('14', '/biz/warning/summary/monthly'),
  ('15', '/biz/warning/summary/term'),
  ('16', '/biz/warning/summary/rebuild'),
  ('17', '/biz/warning/snapshot/students'),
  ('18', '/biz/warning/snapshot/classes');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1952', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m32_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- student_admin: 本学院作用域全量预警与干预权限
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1953', a.seq, RIGHT('1909000000000000003', 13)), '1909000000000000003', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m32_apis a;

-- head_teacher: 本学院作用域查看 + 确认/关闭 + 接单/提交处置（不可删除或全量扫描）
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1954', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m32_apis a
WHERE a.api_url NOT IN ('/biz/warning/delete','/biz/warning/rescan','/biz/warning/summary/rebuild','/biz/warning/case/assign','/biz/warning/case/resolve');

-- vice_dean: 本学院作用域查看 + 工单指派与核验结案
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1955', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m32_apis a
WHERE a.api_url IN ('/biz/warning/page','/biz/warning/detail','/biz/warning/case/page','/biz/warning/case/detail','/biz/warning/case/assign','/biz/warning/case/resolve','/biz/warning/summary/weekly','/biz/warning/summary/monthly','/biz/warning/summary/term','/biz/warning/snapshot/students','/biz/warning/snapshot/classes');

DROP TEMPORARY TABLE IF EXISTS tmp_m32_apis;
