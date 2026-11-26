-- =============================================================================
-- Milestone 3.1: 课堂考勤签到与日记录模块菜单与权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000003%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND `TARGET_ID` LIKE '/biz/attendance/%';
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000003%';

-- 2. 插入目录与 2 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000003000', '0', '课堂考勤与签到', 'bizAttendanceCatalog', 'bizAttendanceCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/attendance-center', NULL, 'qrcode-outlined', 'YES', 'YES', 'YES', 18, 'NOT_DELETE', NOW()),
  ('1910000000000003100', '1910000000000003000', '课堂签到管理', 'bizAttendanceSession', 'bizAttendanceSessionMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/attendance', 'biz/attendance/index', 'scan-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000003200', '1910000000000003000', '日考勤与表现', 'bizAttendanceDaily', 'bizAttendanceDailyMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/attendance-daily', 'biz/attendance/daily', 'edit-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000003101', '1910000000000003100', '发起签到', 'bizAttendanceAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000003102', '1910000000000003100', '动态码看板与换码', 'bizAttendanceQr', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000003103', '1910000000000003100', '花名册微调', 'bizAttendanceRoster', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000003104', '1910000000000003100', '结束课次', 'bizAttendanceEnd', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000003105', '1910000000000003100', '删除课次', 'bizAttendanceDelete', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  ('1910000000000003201', '1910000000000003200', '录入表现与作业', 'bizDailyRecordUpsert', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000003202', '1910000000000003200', '删除日记录', 'bizDailyRecordDelete', 'BUTTON', 2, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1941', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000003000' THEN '{"menuId":"1910000000000003000","buttonInfo":[]}'
           WHEN '1910000000000003100' THEN '{"menuId":"1910000000000003100","buttonInfo":["1910000000000003101","1910000000000003102","1910000000000003103","1910000000000003104","1910000000000003105"]}'
           WHEN '1910000000000003200' THEN '{"menuId":"1910000000000003200","buttonInfo":["1910000000000003201","1910000000000003202"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000003'
    UNION ALL SELECT '1909000000000000001'
    UNION ALL SELECT '1909000000000000002'
) role_t
WHERE r.ID IN ('1910000000000003000','1910000000000003100','1910000000000003200');

-- teaching_admin & vice_dean: 查看课次/花名册/日记录（不可删除课次）
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1941100000400003000', '1909000000000000004', '1910000000000003000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003000","buttonInfo":[]}'),
  ('1941110000400003100', '1909000000000000004', '1910000000000003100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003100","buttonInfo":["1910000000000003102"]}'),
  ('1941120000400003200', '1909000000000000004', '1910000000000003200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003200","buttonInfo":[]}'),
  ('1941100000500003000', '1909000000000000005', '1910000000000003000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003000","buttonInfo":[]}'),
  ('1941110000500003100', '1909000000000000005', '1910000000000003100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003100","buttonInfo":["1910000000000003102"]}'),
  ('1941120000500003200', '1909000000000000005', '1910000000000003200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000003200","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m31_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m31_apis VALUES
  ('01', '/biz/attendance/session/page'),
  ('02', '/biz/attendance/session/add'),
  ('03', '/biz/attendance/session/batchCreate'),
  ('04', '/biz/attendance/session/end'),
  ('05', '/biz/attendance/session/batchEnd'),
  ('06', '/biz/attendance/session/delete'),
  ('07', '/biz/attendance/session/detail'),
  ('08', '/biz/attendance/session/qrState'),
  ('09', '/biz/attendance/session/rotateQr'),
  ('10', '/biz/attendance/session/roster'),
  ('11', '/biz/attendance/session/rosterStatus'),
  ('12', '/biz/attendance/daily/page'),
  ('13', '/biz/attendance/daily/batchUpsert'),
  ('14', '/biz/attendance/daily/delete');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1942', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m31_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- student_admin, head_teacher, teacher: 本学院作用域考勤签到管理
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1943', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m31_apis a
CROSS JOIN (
    SELECT '1909000000000000003' AS ROLE_ID
    UNION ALL SELECT '1909000000000000001'
    UNION ALL SELECT '1909000000000000002'
) r;

-- teaching_admin (SCOPE_ALL) & vice_dean (SCOPE_ORG_CHILD): 只读视角 (不含 delete/end/add)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1944', a.seq, RIGHT('1909000000000000004', 13)), '1909000000000000004', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m31_apis a
WHERE a.api_url IN ('/biz/attendance/session/page','/biz/attendance/session/detail','/biz/attendance/session/qrState','/biz/attendance/session/roster','/biz/attendance/daily/page');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1945', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m31_apis a
WHERE a.api_url IN ('/biz/attendance/session/page','/biz/attendance/session/detail','/biz/attendance/session/qrState','/biz/attendance/session/roster','/biz/attendance/daily/page');

DROP TEMPORARY TABLE IF EXISTS tmp_m31_apis;
