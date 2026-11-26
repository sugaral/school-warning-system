-- =============================================================================
-- Milestone 3.3: 多角色工作台与审批联动引擎菜单权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000005%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND `TARGET_ID` LIKE '/biz/workbench/%';
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000005%';

-- 2. 插入目录与菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000005000', '0', '协同工作台', 'bizWorkbenchCatalog', 'bizWorkbenchCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/workbench-center', NULL, 'dashboard-outlined', 'YES', 'YES', 'YES', 5, 'NOT_DELETE', NOW()),
  ('1910000000000005100', '1910000000000005000', '多角色工作台', 'bizWorkbench', 'bizWorkbenchMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/workbench', 'biz/workbench/index', 'appstore-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000005101', '1910000000000005100', '修改学院防骚扰策略', 'bizWorkbenchStrategySave', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000005102', '1910000000000005100', '特批终审变更', 'bizWorkbenchSpecialApprove', 'BUTTON', 2, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1961', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000005000' THEN '{"menuId":"1910000000000005000","buttonInfo":[]}'
           WHEN '1910000000000005100' THEN '{"menuId":"1910000000000005100","buttonInfo":["1910000000000005101","1910000000000005102"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000005'
) role_t
WHERE r.ID IN ('1910000000000005000','1910000000000005100');

-- student_admin: 工作台 + 学院防骚扰策略保存
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1961100000300005000', '1909000000000000003', '1910000000000005000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005000","buttonInfo":[]}'),
  ('1961110000300005100', '1909000000000000003', '1910000000000005100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005100","buttonInfo":["1910000000000005101"]}');

-- teaching_admin: 工作台 + 特批终审
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1961100000400005000', '1909000000000000004', '1910000000000005000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005000","buttonInfo":[]}'),
  ('1961110000400005100', '1909000000000000004', '1910000000000005100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005100","buttonInfo":["1910000000000005102"]}');

-- head_teacher & teacher: 工作台只读与快捷办件
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1961100000100005000', '1909000000000000001', '1910000000000005000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005000","buttonInfo":[]}'),
  ('1961110000100005100', '1909000000000000001', '1910000000000005100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005100","buttonInfo":[]}'),
  ('1961100000200005000', '1909000000000000002', '1910000000000005000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005000","buttonInfo":[]}'),
  ('1961110000200005100', '1909000000000000002', '1910000000000005100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000005100","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m33_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m33_apis VALUES
  ('01', '/biz/workbench/overview'),
  ('02', '/biz/workbench/notificationStrategy'),
  ('03', '/biz/workbench/notificationStrategy/save'),
  ('04', '/biz/workbench/specialApproveChange');

-- superAdmin & bizAdmin: SCOPE_ALL 全量接口
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1962', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- vice_dean: SCOPE_ORG_CHILD 全量接口
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1963', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a;

-- student_admin: overview + notificationStrategy(read/save)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1964', a.seq, RIGHT('1909000000000000003', 13)), '1909000000000000003', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a
WHERE a.api_url <> '/biz/workbench/specialApproveChange';

-- teaching_admin: overview + notificationStrategy(read) + specialApproveChange
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1965', a.seq, RIGHT('1909000000000000004', 13)), '1909000000000000004', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a
WHERE a.api_url <> '/biz/workbench/notificationStrategy/save';

-- head_teacher & teacher: 仅 overview + 读取通知策略
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1966', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a
WHERE a.api_url IN ('/biz/workbench/overview','/biz/workbench/notificationStrategy');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1967', a.seq, RIGHT('1909000000000000002', 13)), '1909000000000000002', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m33_apis a
WHERE a.api_url IN ('/biz/workbench/overview','/biz/workbench/notificationStrategy');

DROP TEMPORARY TABLE IF EXISTS tmp_m33_apis;
