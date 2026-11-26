-- =============================================================================
-- Milestone 2.1: 基础组织与教务档案 6 域菜单、按钮与角色权限初始化 (幂等可重跑)
-- 目标库: snowy
-- =============================================================================
USE `snowy`;
SET NAMES utf8mb4;

-- 1. 清理本脚本管辖 ID 范围 (1910000000000000000 ~ 1910000000000000999)
DELETE FROM `SYS_RELATION` WHERE `TARGET_ID` LIKE '1910000000000000%' AND `CATEGORY` = 'SYS_ROLE_HAS_RESOURCE';
DELETE FROM `SYS_RELATION`
WHERE `CATEGORY` = 'SYS_ROLE_HAS_PERMISSION'
  AND (`TARGET_ID` LIKE '/biz/major/%'
    OR `TARGET_ID` LIKE '/biz/clazz/%'
    OR `TARGET_ID` LIKE '/biz/student/%'
    OR `TARGET_ID` LIKE '/biz/course/%'
    OR `TARGET_ID` LIKE '/biz/courseclass/%'
    OR `TARGET_ID` LIKE '/biz/schedule/%');
DELETE FROM `SYS_RESOURCE` WHERE `ID` LIKE '1910000000000000%';

-- 2. 插入目录与 6 个菜单 ('1548901111999773976' = 业务模块)
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `NAME`, `CODE`, `CATEGORY`, `MODULE`, `MENU_TYPE`, `PATH`, `COMPONENT`, `ICON`, `VISIBLE`, `DISPLAY_LAYOUT`, `KEEP_LIVE`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  ('1910000000000000000', '0', '教务与学籍基础', 'bizAcademicCatalog', 'bizAcademicCatalog', 'MENU', '1548901111999773976', 'CATALOG', '/biz/academic', NULL, 'book-outlined', 'YES', 'YES', 'YES', 15, 'NOT_DELETE', NOW()),
  ('1910000000000000100', '1910000000000000000', '专业管理', 'bizMajor', 'bizMajorMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/major', 'biz/major/index', 'read-outlined', 'YES', 'YES', 'YES', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000200', '1910000000000000000', '班级管理', 'bizClazz', 'bizClazzMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/clazz', 'biz/clazz/index', 'team-outlined', 'YES', 'YES', 'YES', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000300', '1910000000000000000', '学生档案', 'bizStudent', 'bizStudentMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/student', 'biz/student/index', 'idcard-outlined', 'YES', 'YES', 'YES', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000400', '1910000000000000000', '课程管理', 'bizCourse', 'bizCourseMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/course', 'biz/course/index', 'profile-outlined', 'YES', 'YES', 'YES', 4, 'NOT_DELETE', NOW()),
  ('1910000000000000500', '1910000000000000000', '开课班管理', 'bizCourseClass', 'bizCourseClassMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/courseclass', 'biz/courseclass/index', 'solution-outlined', 'YES', 'YES', 'YES', 5, 'NOT_DELETE', NOW()),
  ('1910000000000000600', '1910000000000000000', '排课课表', 'bizSchedule', 'bizScheduleMenu', 'MENU', '1548901111999773976', 'MENU', '/biz/schedule', 'biz/schedule/index', 'calendar-outlined', 'YES', 'YES', 'YES', 6, 'NOT_DELETE', NOW());

-- 3. 插入按钮权限 (CATEGORY='BUTTON')
INSERT INTO `SYS_RESOURCE` (`ID`, `PARENT_ID`, `TITLE`, `CODE`, `CATEGORY`, `SORT_CODE`, `DELETE_FLAG`, `CREATE_TIME`)
VALUES
  -- 专业管理按钮
  ('1910000000000000101', '1910000000000000100', '新增专业', 'bizMajorAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000102', '1910000000000000100', '编辑专业', 'bizMajorEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000103', '1910000000000000100', '删除专业', 'bizMajorDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000104', '1910000000000000100', '批量删除', 'bizMajorBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  -- 班级管理按钮
  ('1910000000000000201', '1910000000000000200', '新增班级', 'bizClassAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000202', '1910000000000000200', '编辑班级', 'bizClassEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000203', '1910000000000000200', '删除班级', 'bizClassDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000204', '1910000000000000200', '批量删除', 'bizClassBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  -- 学生档案按钮
  ('1910000000000000301', '1910000000000000300', '新增学生', 'bizStudentAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000302', '1910000000000000300', '编辑学生', 'bizStudentEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000303', '1910000000000000300', '删除学生', 'bizStudentDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000304', '1910000000000000300', '批量删除', 'bizStudentBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000000305', '1910000000000000300', '重置密码', 'bizStudentResetPwd', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  ('1910000000000000306', '1910000000000000300', '解绑微信', 'bizStudentUnbindWechat', 'BUTTON', 6, 'NOT_DELETE', NOW()),
  ('1910000000000000307', '1910000000000000300', '导出账号', 'bizStudentExport', 'BUTTON', 7, 'NOT_DELETE', NOW()),
  ('1910000000000000308', '1910000000000000300', '批量导入', 'bizStudentImport', 'BUTTON', 8, 'NOT_DELETE', NOW()),
  -- 课程管理按钮
  ('1910000000000000401', '1910000000000000400', '新增课程', 'bizCourseAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000402', '1910000000000000400', '编辑课程', 'bizCourseEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000403', '1910000000000000400', '删除课程', 'bizCourseDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000404', '1910000000000000400', '批量删除', 'bizCourseBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000000405', '1910000000000000400', '批量导入', 'bizCourseImport', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  -- 开课班管理按钮
  ('1910000000000000501', '1910000000000000500', '新增开课班', 'bizCourseClassAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000502', '1910000000000000500', '编辑开课班', 'bizCourseClassEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000503', '1910000000000000500', '删除开课班', 'bizCourseClassDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000504', '1910000000000000500', '批量删除', 'bizCourseClassBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000000505', '1910000000000000500', '批量导入', 'bizCourseClassImport', 'BUTTON', 5, 'NOT_DELETE', NOW()),
  -- 排课课表按钮
  ('1910000000000000601', '1910000000000000600', '新增排课', 'bizScheduleAdd', 'BUTTON', 1, 'NOT_DELETE', NOW()),
  ('1910000000000000602', '1910000000000000600', '编辑排课', 'bizScheduleEdit', 'BUTTON', 2, 'NOT_DELETE', NOW()),
  ('1910000000000000603', '1910000000000000600', '删除排课', 'bizScheduleDelete', 'BUTTON', 3, 'NOT_DELETE', NOW()),
  ('1910000000000000604', '1910000000000000600', '批量删除', 'bizScheduleBatchDelete', 'BUTTON', 4, 'NOT_DELETE', NOW()),
  ('1910000000000000605', '1910000000000000600', '批量导入', 'bizScheduleImport', 'BUTTON', 5, 'NOT_DELETE', NOW());

-- 4. 菜单与按钮授权 (SYS_ROLE_HAS_RESOURCE)
-- superAdmin (1570687866138206208) & bizAdmin (1570687866138206209) & teaching_admin (1909000000000000004) 全量菜单+按钮
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1911', RIGHT(r.ID, 4), RIGHT(role_t.ROLE_ID, 11)), role_t.ROLE_ID, r.ID, 'SYS_ROLE_HAS_RESOURCE',
       CASE r.ID
           WHEN '1910000000000000000' THEN '{"menuId":"1910000000000000000","buttonInfo":[]}'
           WHEN '1910000000000000100' THEN '{"menuId":"1910000000000000100","buttonInfo":["1910000000000000101","1910000000000000102","1910000000000000103","1910000000000000104"]}'
           WHEN '1910000000000000200' THEN '{"menuId":"1910000000000000200","buttonInfo":["1910000000000000201","1910000000000000202","1910000000000000203","1910000000000000204"]}'
           WHEN '1910000000000000300' THEN '{"menuId":"1910000000000000300","buttonInfo":["1910000000000000301","1910000000000000302","1910000000000000303","1910000000000000304","1910000000000000305","1910000000000000306","1910000000000000307","1910000000000000308"]}'
           WHEN '1910000000000000400' THEN '{"menuId":"1910000000000000400","buttonInfo":["1910000000000000401","1910000000000000402","1910000000000000403","1910000000000000404","1910000000000000405"]}'
           WHEN '1910000000000000500' THEN '{"menuId":"1910000000000000500","buttonInfo":["1910000000000000501","1910000000000000502","1910000000000000503","1910000000000000504","1910000000000000505"]}'
           WHEN '1910000000000000600' THEN '{"menuId":"1910000000000000600","buttonInfo":["1910000000000000601","1910000000000000602","1910000000000000603","1910000000000000604","1910000000000000605"]}'
       END
FROM `SYS_RESOURCE` r
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000004'
) role_t
WHERE r.ID IN ('1910000000000000000','1910000000000000100','1910000000000000200','1910000000000000300','1910000000000000400','1910000000000000500','1910000000000000600');

-- student_admin (1909000000000000003): 专业+班级+学生CRUD，课程/开课班/课表只读
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1911000003000000000', '1909000000000000003', '1910000000000000000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000000","buttonInfo":[]}'),
  ('1911010003000000100', '1909000000000000003', '1910000000000000100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000100","buttonInfo":["1910000000000000101","1910000000000000102","1910000000000000103"]}'),
  ('1911020003000000200', '1909000000000000003', '1910000000000000200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000200","buttonInfo":["1910000000000000201","1910000000000000202","1910000000000000203"]}'),
  ('1911030003000000300', '1909000000000000003', '1910000000000000300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000300","buttonInfo":["1910000000000000301","1910000000000000302","1910000000000000303","1910000000000000304","1910000000000000305","1910000000000000306","1910000000000000307","1910000000000000308"]}'),
  ('1911040003000000400', '1909000000000000003', '1910000000000000400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000400","buttonInfo":[]}'),
  ('1911050003000000500', '1909000000000000003', '1910000000000000500', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000500","buttonInfo":[]}'),
  ('1911060003000000600', '1909000000000000003', '1910000000000000600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000600","buttonInfo":[]}');

-- vice_dean (1909000000000000005): 全览只读 + 开课班/课表调整
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1911000005000000000', '1909000000000000005', '1910000000000000000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000000","buttonInfo":[]}'),
  ('1911010005000000100', '1909000000000000005', '1910000000000000100', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000100","buttonInfo":[]}'),
  ('1911020005000000200', '1909000000000000005', '1910000000000000200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000200","buttonInfo":[]}'),
  ('1911030005000000300', '1909000000000000005', '1910000000000000300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000300","buttonInfo":["1910000000000000307"]}'),
  ('1911040005000000400', '1909000000000000005', '1910000000000000400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000400","buttonInfo":[]}'),
  ('1911050005000000500', '1909000000000000005', '1910000000000000500', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000500","buttonInfo":["1910000000000000502"]}'),
  ('1911060005000000600', '1909000000000000005', '1910000000000000600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000600","buttonInfo":["1910000000000000602"]}');

-- head_teacher (1909000000000000001): 班级/学生/课表查看与学生账号导出
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1911000001000000000', '1909000000000000001', '1910000000000000000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000000","buttonInfo":[]}'),
  ('1911020001000000200', '1909000000000000001', '1910000000000000200', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000200","buttonInfo":[]}'),
  ('1911030001000000300', '1909000000000000001', '1910000000000000300', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000300","buttonInfo":["1910000000000000307"]}'),
  ('1911060001000000600', '1909000000000000001', '1910000000000000600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000600","buttonInfo":[]}');

-- teacher (1909000000000000002): 课程/开课班/排课只读查看
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`) VALUES
  ('1911000002000000000', '1909000000000000002', '1910000000000000000', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000000","buttonInfo":[]}'),
  ('1911040002000000400', '1909000000000000002', '1910000000000000400', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000400","buttonInfo":[]}'),
  ('1911050002000000500', '1909000000000000002', '1910000000000000500', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000500","buttonInfo":[]}'),
  ('1911060002000000600', '1909000000000000002', '1910000000000000600', 'SYS_ROLE_HAS_RESOURCE', '{"menuId":"1910000000000000600","buttonInfo":[]}');

-- 5. API 权限授予 (SYS_ROLE_HAS_PERMISSION)
-- 辅助临时表枚举 6 域全部 API URL
CREATE TEMPORARY TABLE tmp_m21_apis (
    seq VARCHAR(4),
    api_url VARCHAR(128)
);
INSERT INTO tmp_m21_apis VALUES
  ('01', '/biz/major/page'), ('02', '/biz/major/list'), ('03', '/biz/major/add'), ('04', '/biz/major/edit'), ('05', '/biz/major/delete'), ('06', '/biz/major/detail'), ('07', '/biz/major/orgTreeSelector'),
  ('08', '/biz/clazz/page'), ('09', '/biz/clazz/list'), ('10', '/biz/clazz/add'), ('11', '/biz/clazz/edit'), ('12', '/biz/clazz/delete'), ('13', '/biz/clazz/detail'), ('14', '/biz/clazz/orgTreeSelector'), ('15', '/biz/clazz/userSelector'),
  ('16', '/biz/student/page'), ('17', '/biz/student/add'), ('18', '/biz/student/edit'), ('19', '/biz/student/delete'), ('20', '/biz/student/detail'), ('21', '/biz/student/resetPassword'), ('22', '/biz/student/unbindWechat'), ('23', '/biz/student/exportAccounts'), ('24', '/biz/student/import'), ('25', '/biz/student/orgTreeSelector'),
  ('26', '/biz/course/page'), ('27', '/biz/course/list'), ('28', '/biz/course/add'), ('29', '/biz/course/edit'), ('30', '/biz/course/delete'), ('31', '/biz/course/detail'), ('32', '/biz/course/import'), ('33', '/biz/course/orgTreeSelector'),
  ('34', '/biz/courseclass/page'), ('35', '/biz/courseclass/add'), ('36', '/biz/courseclass/edit'), ('37', '/biz/courseclass/delete'), ('38', '/biz/courseclass/detail'), ('39', '/biz/courseclass/import'),
  ('40', '/biz/schedule/page'), ('41', '/biz/schedule/add'), ('42', '/biz/schedule/edit'), ('43', '/biz/schedule/delete'), ('44', '/biz/schedule/detail'), ('45', '/biz/schedule/import');

-- 全量作用域授权给 superAdmin / bizAdmin / teaching_admin
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1912', a.seq, RIGHT(r.ROLE_ID, 13)), r.ROLE_ID, a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ALL","scopeDefineOrgIdList":[]}')
FROM tmp_m21_apis a
CROSS JOIN (
    SELECT '1570687866138206208' AS ROLE_ID
    UNION ALL SELECT '1570687866138206209'
    UNION ALL SELECT '1909000000000000004'
) r;

-- 院系及以下作用域 (SCOPE_ORG_CHILD) 按角色职责精确授予
INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1913', a.seq, RIGHT('1909000000000000003', 13)), '1909000000000000003', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m21_apis a
WHERE a.seq BETWEEN '01' AND '25'
   OR a.api_url IN ('/biz/course/page','/biz/course/list','/biz/course/detail','/biz/course/orgTreeSelector',
                    '/biz/courseclass/page','/biz/courseclass/detail','/biz/schedule/page','/biz/schedule/detail');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1914', a.seq, RIGHT('1909000000000000005', 13)), '1909000000000000005', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m21_apis a
WHERE a.api_url IN ('/biz/major/page','/biz/major/list','/biz/major/detail','/biz/major/orgTreeSelector',
                    '/biz/clazz/page','/biz/clazz/list','/biz/clazz/detail','/biz/clazz/orgTreeSelector','/biz/clazz/userSelector',
                    '/biz/student/page','/biz/student/detail','/biz/student/exportAccounts','/biz/student/orgTreeSelector',
                    '/biz/course/page','/biz/course/list','/biz/course/detail','/biz/course/orgTreeSelector',
                    '/biz/courseclass/page','/biz/courseclass/detail','/biz/courseclass/edit',
                    '/biz/schedule/page','/biz/schedule/detail','/biz/schedule/edit');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1915', a.seq, RIGHT('1909000000000000001', 13)), '1909000000000000001', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m21_apis a
WHERE a.api_url IN ('/biz/clazz/page','/biz/clazz/list','/biz/clazz/detail','/biz/clazz/orgTreeSelector',
                    '/biz/student/page','/biz/student/detail','/biz/student/exportAccounts','/biz/student/orgTreeSelector',
                    '/biz/schedule/page','/biz/schedule/detail');

INSERT INTO `SYS_RELATION` (`ID`, `OBJECT_ID`, `TARGET_ID`, `CATEGORY`, `EXT_JSON`)
SELECT CONCAT('1916', a.seq, RIGHT('1909000000000000002', 13)), '1909000000000000002', a.api_url, 'SYS_ROLE_HAS_PERMISSION',
       CONCAT('{"apiUrl":"', a.api_url, '","scopeCategory":"SCOPE_ORG_CHILD","scopeDefineOrgIdList":[]}')
FROM tmp_m21_apis a
WHERE a.api_url IN ('/biz/clazz/list','/biz/course/page','/biz/course/list','/biz/course/detail','/biz/course/orgTreeSelector',
                    '/biz/courseclass/page','/biz/courseclass/detail',
                    '/biz/schedule/page','/biz/schedule/detail');

DROP TEMPORARY TABLE IF EXISTS tmp_m21_apis;
