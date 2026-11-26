-- =============================================================================
-- Milestone 2.3: 教学绑定、成绩与四大业务台账 6 域菜单与权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000002%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND (`TARGET_ID` LIKE '/biz/teacherbinding/%'
    OR `TARGET_ID` LIKE '/biz/grade/%'
    OR `TARGET_ID` LIKE '/biz/leaverequest/%'
    OR `TARGET_ID` LIKE '/biz/makeuprequest/%'
    OR `TARGET_ID` LIKE '/biz/appeal/%'
    OR `TARGET_ID` LIKE '/biz/changerequest/%');
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000002%';

-- 2. 插入目录与 6 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000002000', '0', '教学绑定与审批台账', 'bizTeachingLedgerCatalog', 'bizTeachingLedgerCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/teaching-ledger', NULL, 'audit-outlined', 'YES', 'YES', 'YES', 17, 'NOT_DELETE', NOW()),
  ('1910000000000002100', '1910000000000002000', '教师授课绑定', 'bizTeacherBinding', 'bizTeacherBindingMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/teacherbinding', 'biz/teacherbinding/index', 'link-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002200', '1910000000000002000', '学生成绩管理', 'bizGrade', 'bizGradeMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/grade', 'biz/grade/index', 'trophy-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002300', '1910000000000002000', '请假台账管理', 'bizLeaveRequest', 'bizLeaveRequestMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/leaverequest', 'biz/leaverequest/index', 'schedule-outlined', 'YES', 'YES', 'YES', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002400', '1910000000000002000', '考勤补录台账', 'bizMakeupRequest', 'bizMakeupRequestMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/makeuprequest', 'biz/makeuprequest/index', 'form-outlined', 'YES', 'YES', 'YES', 4, 'NOT_DELETE', NOW()),
  ('1910000000000002500', '1910000000000002000', '学生申诉工单', 'bizAppeal', 'bizAppealMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/appeal', 'biz/appeal/index', 'customer-service-outlined', 'YES', 'YES', 'YES', 5, 'NOT_DELETE', NOW()),
  ('1910000000000002600', '1910000000000002000', '信息变更台账', 'bizChangeRequest', 'bizChangeRequestMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/changerequest', 'biz/changerequest/index', 'swap-outlined', 'YES', 'YES', 'YES', 6, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000002101', '1910000000000002100', '新增绑定', 'bizTeacherBindingAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002102', '1910000000000002100', '解除绑定', 'bizTeacherBindingDelete', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002103', '1910000000000002100', '批量解绑', 'bizTeacherBindingBatchDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002201', '1910000000000002200', '录入成绩', 'bizGradeAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002202', '1910000000000002200', '编辑成绩', 'bizGradeEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002203', '1910000000000002200', '删除成绩', 'bizGradeDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002204', '1910000000000002200', '批量删除', 'bizGradeBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000002205', '1910000000000002200', '批量导入', 'bizGradeImport', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  ('1910000000000002301', '1910000000000002300', '代录请假', 'bizLeaveRequestAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002302', '1910000000000002300', '审批请假', 'bizLeaveRequestApprove', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002303', '1910000000000002300', '删除请假', 'bizLeaveRequestDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002304', '1910000000000002300', '批量删除', 'bizLeaveRequestBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000002401', '1910000000000002400', '代录补录', 'bizMakeupRequestAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002402', '1910000000000002400', '审批补录', 'bizMakeupRequestApprove', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002403', '1910000000000002400', '删除补录', 'bizMakeupRequestDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002404', '1910000000000002400', '批量删除', 'bizMakeupRequestBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000002501', '1910000000000002500', '代录申诉', 'bizAppealAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002502', '1910000000000002500', '处理申诉', 'bizAppealHandle', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002503', '1910000000000002500', '删除申诉', 'bizAppealDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002504', '1910000000000002500', '批量删除', 'bizAppealBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000002601', '1910000000000002600', '提交变更', 'bizChangeRequestAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000002602', '1910000000000002600', '审批变更', 'bizChangeRequestApprove', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000002603', '1910000000000002600', '删除变更', 'bizChangeRequestDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000002604', '1910000000000002600', '批量删除', 'bizChangeRequestBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1931', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000002000' THEN '{"menuId":"1910000000000002000","buttonInfo":[]}'
           WHEN '1910000000000002100' THEN '{"menuId":"1910000000000002100","buttonInfo":["1910000000000002101","1910000000000002102","1910000000000002103"]}'
           WHEN '1910000000000002200' THEN '{"menuId":"1910000000000002200","buttonInfo":["1910000000000002201","1910000000000002202","1910000000000002203","1910000000000002204","1910000000000002205"]}'
           WHEN '1910000000000002300' THEN '{"menuId":"1910000000000002300","buttonInfo":["1910000000000002301","1910000000000002302","1910000000000002303","1910000000000002304"]}'
           WHEN '1910000000000002400' THEN '{"menuId":"1910000000000002400","buttonInfo":["1910000000000002401","1910000000000002402","1910000000000002403","1910000000000002404"]}'
           WHEN '1910000000000002500' THEN '{"menuId":"1910000000000002500","buttonInfo":["1910000000000002501","1910000000000002502","1910000000000002503","1910000000000002504"]}'
           WHEN '1910000000000002600' THEN '{"menuId":"1910000000000002600","buttonInfo":["1910000000000002601","1910000000000002602","1910000000000002603","1910000000000002604"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000003'
) role_t
WHERE r.ID IN (
    '1910000000000002000',
    '1910000000000002100','1910000000000002200','1910000000000002300',
    '1910000000000002400','1910000000000002500','1910000000000002600'
);

-- head_teacher: 请假/补录/申诉/变更处理 + 成绩只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1931100000100002000', '1909000000000000001', '1910000000000002000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002000","buttonInfo":[]}'),
  ('1931120000100002200', '1909000000000000001', '1910000000000002200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002200","buttonInfo":[]}'),
  ('1931130000100002300', '1909000000000000001', '1910000000000002300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002300","buttonInfo":["1910000000000002301","1910000000000002302","1910000000000002303"]}'),
  ('1931140000100002400', '1909000000000000001', '1910000000000002400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002400","buttonInfo":["1910000000000002401","1910000000000002402","1910000000000002403"]}'),
  ('1931150000100002500', '1909000000000000001', '1910000000000002500', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002500","buttonInfo":["1910000000000002502"]}'),
  ('1931160000100002600', '1909000000000000001', '1910000000000002600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002600","buttonInfo":["1910000000000002602"]}');

-- teaching_admin: 教师授课绑定 + 成绩全量 + 变更审批
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1931100000400002000', '1909000000000000004', '1910000000000002000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002000","buttonInfo":[]}'),
  ('1931110000400002100', '1909000000000000004', '1910000000000002100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002100","buttonInfo":["1910000000000002101","1910000000000002102","1910000000000002103"]}'),
  ('1931120000400002200', '1909000000000000004', '1910000000000002200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002200","buttonInfo":["1910000000000002201","1910000000000002202","1910000000000002203","1910000000000002204","1910000000000002205"]}'),
  ('1931160000400002600', '1909000000000000004', '1910000000000002600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002600","buttonInfo":["1910000000000002602"]}');

-- vice_dean: 本学院全部 6 域查看 + 变更审批
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1931100000500002000', '1909000000000000005', '1910000000000002000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002000","buttonInfo":[]}'),
  ('1931110000500002100', '1909000000000000005', '1910000000000002100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002100","buttonInfo":[]}'),
  ('1931120000500002200', '1909000000000000005', '1910000000000002200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002200","buttonInfo":[]}'),
  ('1931130000500002300', '1909000000000000005', '1910000000000002300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002300","buttonInfo":[]}'),
  ('1931140000500002400', '1909000000000000005', '1910000000000002400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002400","buttonInfo":[]}'),
  ('1931150000500002500', '1909000000000000005', '1910000000000002500', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002500","buttonInfo":[]}'),
  ('1931160000500002600', '1909000000000000005', '1910000000000002600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002600","buttonInfo":["1910000000000002602"]}');

-- teacher: 授课绑定与成绩只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1931100000200002000', '1909000000000000002', '1910000000000002000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002000","buttonInfo":[]}'),
  ('1931110000200002100', '1909000000000000002', '1910000000000002100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002100","buttonInfo":[]}'),
  ('1931120000200002200', '1909000000000000002', '1910000000000002200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000002200","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
CREATE TEMPORARY TABLE tmp_m23_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m23_apis VALUES
  ('01', '/biz/teacherbinding/page'), ('02', '/biz/teacherbinding/add'), ('03', '/biz/teacherbinding/delete'),
  ('04', '/biz/grade/page'), ('05', '/biz/grade/add'), ('06', '/biz/grade/edit'), ('07', '/biz/grade/delete'), ('08', '/biz/grade/detail'), ('09', '/biz/grade/importTemplate'), ('10', '/biz/grade/import'),
  ('11', '/biz/leaverequest/page'), ('12', '/biz/leaverequest/add'), ('13', '/biz/leaverequest/approve'), ('14', '/biz/leaverequest/delete'), ('15', '/biz/leaverequest/detail'),
  ('16', '/biz/makeuprequest/page'), ('17', '/biz/makeuprequest/add'), ('18', '/biz/makeuprequest/approve'), ('19', '/biz/makeuprequest/delete'), ('20', '/biz/makeuprequest/detail'),
  ('21', '/biz/appeal/page'), ('22', '/biz/appeal/add'), ('23', '/biz/appeal/handle'), ('24', '/biz/appeal/delete'), ('25', '/biz/appeal/detail'),
  ('26', '/biz/changerequest/page'), ('27', '/biz/changerequest/add'), ('28', '/biz/changerequest/approve'), ('29', '/biz/changerequest/delete'), ('30', '/biz/changerequest/detail');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1932', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
) r;

-- student_admin: 本学院作用域全量 6 域管理
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1933', a.seq, RIGHT('1909000000000000003', 13)), '1909000000000000003', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a;

-- teaching_admin: 授课绑定 + 成绩全量 + 变更审批
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1934', a.seq, RIGHT('1909000000000000004', 13)), '1909000000000000004', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a
WHERE a.seq BETWEEN '01' AND '10'
   OR a.api_url IN ('/biz/changerequest/page','/biz/changerequest/detail','/biz/changerequest/approve');

-- head_teacher: 成绩只读 + 请假/补录 CRUD 审批 + 申诉处理 + 变更审批
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1935', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a
WHERE a.api_url IN ('/biz/grade/page','/biz/grade/detail','/biz/appeal/page','/biz/appeal/detail','/biz/appeal/handle','/biz/changerequest/page','/biz/changerequest/detail','/biz/changerequest/approve')
   OR a.seq BETWEEN '11' AND '20';

-- vice_dean: 本学院 6 域查看 + 变更审批
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1936', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a
WHERE a.api_url LIKE '%/page'
   OR a.api_url LIKE '%/detail'
   OR a.api_url = '/biz/changerequest/approve';

-- teacher: 授课绑定与成绩只读 (严禁访问请假/补录/申诉/变更管理端接口)
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1937', a.seq, RIGHT('1909000000000000002', 13)), '1909000000000000002', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m23_apis a
WHERE a.api_url IN ('/biz/teacherbinding/page','/biz/grade/page','/biz/grade/detail');

DROP TEMPORARY TABLE IF EXISTS tmp_m23_apis;
