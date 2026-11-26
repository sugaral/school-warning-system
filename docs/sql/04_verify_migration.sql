-- =============================================================================
-- 全量数据迁移完整性校验脚本 (04_verify_migration.sql)
-- 校验维度:
--   1. 源库 warnsys vs 目标库 snowy 逐表精确行数对比（DIFF 必须全部为 0）
--   2. 核心业务外键孤儿检查（必须全部为 0）
--   3. 国密 SM3 / SM4 标准化完成度检查（PENDING_SM3 必须为 0）
--   4. 中文编码与数据抽检
-- =============================================================================

SET NAMES utf8mb4;

-- 1. 逐表精确行数比对
SELECT table_pair, src_cnt, dst_cnt, (dst_cnt - src_cnt) AS diff
FROM (
  SELECT '01.orgs -> SYS_ORG (19001%,excl root)' AS table_pair,
    (SELECT COUNT(*) FROM `warnsys`.`orgs`) AS src_cnt,
    (SELECT COUNT(*) FROM `snowy`.`SYS_ORG` WHERE ID LIKE '19001%' AND ID != '1900100000000000000') AS dst_cnt
  UNION ALL SELECT '02.users(non-stu) -> SYS_USER',
    (SELECT COUNT(*) FROM `warnsys`.`users` WHERE user_type != 'student'),
    (SELECT COUNT(*) FROM `snowy`.`SYS_USER` WHERE ID LIKE '19002%')
  UNION ALL SELECT '03.users(stu) -> CLIENT_USER',
    (SELECT COUNT(*) FROM `warnsys`.`users` WHERE user_type = 'student'),
    (SELECT COUNT(*) FROM `snowy`.`CLIENT_USER` WHERE ID LIKE '19003%')
  UNION ALL SELECT '04.user_roles(non-stu) -> SYS_RELATION',
    (SELECT COUNT(*) FROM `warnsys`.`user_roles` ur JOIN `warnsys`.`users` u ON ur.user_id=u.id WHERE u.user_type != 'student'),
    (SELECT COUNT(*) FROM `snowy`.`SYS_RELATION` WHERE ID LIKE '19004%')
  UNION ALL SELECT '05.majors -> BIZ_MAJOR',
    (SELECT COUNT(*) FROM `warnsys`.`majors`), (SELECT COUNT(*) FROM `snowy`.`BIZ_MAJOR`)
  UNION ALL SELECT '06.classes -> BIZ_CLASS',
    (SELECT COUNT(*) FROM `warnsys`.`classes`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS`)
  UNION ALL SELECT '07.student_profiles -> BIZ_STUDENT_PROFILE',
    (SELECT COUNT(*) FROM `warnsys`.`student_profiles`), (SELECT COUNT(*) FROM `snowy`.`BIZ_STUDENT_PROFILE`)
  UNION ALL SELECT '08.courses -> BIZ_COURSE',
    (SELECT COUNT(*) FROM `warnsys`.`courses`), (SELECT COUNT(*) FROM `snowy`.`BIZ_COURSE`)
  UNION ALL SELECT '09.course_classes -> BIZ_COURSE_CLASS',
    (SELECT COUNT(*) FROM `warnsys`.`course_classes`), (SELECT COUNT(*) FROM `snowy`.`BIZ_COURSE_CLASS`)
  UNION ALL SELECT '10.schedules -> BIZ_SCHEDULE',
    (SELECT COUNT(*) FROM `warnsys`.`schedules`), (SELECT COUNT(*) FROM `snowy`.`BIZ_SCHEDULE`)
  UNION ALL SELECT '11.teacher_course_bindings -> BIZ_TEACHER_COURSE_BINDING',
    (SELECT COUNT(*) FROM `warnsys`.`teacher_course_bindings`), (SELECT COUNT(*) FROM `snowy`.`BIZ_TEACHER_COURSE_BINDING`)
  UNION ALL SELECT '12.calendar_exclusions -> BIZ_CALENDAR_EXCLUSION',
    (SELECT COUNT(*) FROM `warnsys`.`calendar_exclusions`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CALENDAR_EXCLUSION`)
  UNION ALL SELECT '13.warning_rules -> BIZ_WARNING_RULE',
    (SELECT COUNT(*) FROM `warnsys`.`warning_rules`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING_RULE`)
  UNION ALL SELECT '14.message_templates -> BIZ_MESSAGE_TEMPLATE',
    (SELECT COUNT(*) FROM `warnsys`.`message_templates`), (SELECT COUNT(*) FROM `snowy`.`BIZ_MESSAGE_TEMPLATE`)
  UNION ALL SELECT '15.class_notifications -> BIZ_CLASS_NOTIFICATION',
    (SELECT COUNT(*) FROM `warnsys`.`class_notifications`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS_NOTIFICATION`)
  UNION ALL SELECT '16.student_notification_reads -> BIZ_STUDENT_NOTIFICATION_READ',
    (SELECT COUNT(*) FROM `warnsys`.`student_notification_reads`), (SELECT COUNT(*) FROM `snowy`.`BIZ_STUDENT_NOTIFICATION_READ`)
  UNION ALL SELECT '17.grades -> BIZ_GRADE',
    (SELECT COUNT(*) FROM `warnsys`.`grades`), (SELECT COUNT(*) FROM `snowy`.`BIZ_GRADE`)
  UNION ALL SELECT '18.leave_requests -> BIZ_LEAVE_REQUEST',
    (SELECT COUNT(*) FROM `warnsys`.`leave_requests`), (SELECT COUNT(*) FROM `snowy`.`BIZ_LEAVE_REQUEST`)
  UNION ALL SELECT '19.makeup_requests -> BIZ_MAKEUP_REQUEST',
    (SELECT COUNT(*) FROM `warnsys`.`makeup_requests`), (SELECT COUNT(*) FROM `snowy`.`BIZ_MAKEUP_REQUEST`)
  UNION ALL SELECT '20.appeals -> BIZ_APPEAL',
    (SELECT COUNT(*) FROM `warnsys`.`appeals`), (SELECT COUNT(*) FROM `snowy`.`BIZ_APPEAL`)
  UNION ALL SELECT '21.change_requests -> BIZ_CHANGE_REQUEST',
    (SELECT COUNT(*) FROM `warnsys`.`change_requests`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CHANGE_REQUEST`)
  UNION ALL SELECT '22.class_sessions -> BIZ_CLASS_SESSION',
    (SELECT COUNT(*) FROM `warnsys`.`class_sessions`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS_SESSION`)
  UNION ALL SELECT '23.class_session_snapshots -> BIZ_CLASS_SESSION_SNAPSHOT',
    (SELECT COUNT(*) FROM `warnsys`.`class_session_snapshots`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS_SESSION_SNAPSHOT`)
  UNION ALL SELECT '24.attendance_records -> BIZ_ATTENDANCE_RECORD',
    (SELECT COUNT(*) FROM `warnsys`.`attendance_records`), (SELECT COUNT(*) FROM `snowy`.`BIZ_ATTENDANCE_RECORD`)
  UNION ALL SELECT '25.daily_records -> BIZ_DAILY_RECORD',
    (SELECT COUNT(*) FROM `warnsys`.`daily_records`), (SELECT COUNT(*) FROM `snowy`.`BIZ_DAILY_RECORD`)
  UNION ALL SELECT '26.warnings -> BIZ_WARNING',
    (SELECT COUNT(*) FROM `warnsys`.`warnings`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING`)
  UNION ALL SELECT '27.warning_current_states -> BIZ_WARNING_CURRENT_STATE',
    (SELECT COUNT(*) FROM `warnsys`.`warning_current_states`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING_CURRENT_STATE`)
  UNION ALL SELECT '28.student_warning_snapshots -> BIZ_STUDENT_WARNING_SNAPSHOT',
    (SELECT COUNT(*) FROM `warnsys`.`student_warning_snapshots`), (SELECT COUNT(*) FROM `snowy`.`BIZ_STUDENT_WARNING_SNAPSHOT`)
  UNION ALL SELECT '29.class_monitor_snapshots -> BIZ_CLASS_MONITOR_SNAPSHOT',
    (SELECT COUNT(*) FROM `warnsys`.`class_monitor_snapshots`), (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS_MONITOR_SNAPSHOT`)
  UNION ALL SELECT '30.warning_cases -> BIZ_WARNING_CASE',
    (SELECT COUNT(*) FROM `warnsys`.`warning_cases`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING_CASE`)
  UNION ALL SELECT '31.warning_case_logs -> BIZ_WARNING_CASE_LOG',
    (SELECT COUNT(*) FROM `warnsys`.`warning_case_logs`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING_CASE_LOG`)
  UNION ALL SELECT '32.weekly_summaries -> BIZ_WEEKLY_SUMMARY',
    (SELECT COUNT(*) FROM `warnsys`.`weekly_summaries`), (SELECT COUNT(*) FROM `snowy`.`BIZ_WEEKLY_SUMMARY`)
  UNION ALL SELECT '33.monthly_summaries -> BIZ_MONTHLY_SUMMARY',
    (SELECT COUNT(*) FROM `warnsys`.`monthly_summaries`), (SELECT COUNT(*) FROM `snowy`.`BIZ_MONTHLY_SUMMARY`)
  UNION ALL SELECT '34.term_summaries -> BIZ_TERM_SUMMARY',
    (SELECT COUNT(*) FROM `warnsys`.`term_summaries`), (SELECT COUNT(*) FROM `snowy`.`BIZ_TERM_SUMMARY`)
  UNION ALL SELECT '35.notification_jobs -> BIZ_NOTIFICATION_JOB',
    (SELECT COUNT(*) FROM `warnsys`.`notification_jobs`), (SELECT COUNT(*) FROM `snowy`.`BIZ_NOTIFICATION_JOB`)
  UNION ALL SELECT '36.notification_logs -> BIZ_NOTIFICATION_LOG',
    (SELECT COUNT(*) FROM `warnsys`.`notification_logs`), (SELECT COUNT(*) FROM `snowy`.`BIZ_NOTIFICATION_LOG`)
  UNION ALL SELECT '37.export_jobs -> BIZ_EXPORT_JOB',
    (SELECT COUNT(*) FROM `warnsys`.`export_jobs`), (SELECT COUNT(*) FROM `snowy`.`BIZ_EXPORT_JOB`)
  UNION ALL SELECT '38.files -> DEV_FILE',
    (SELECT COUNT(*) FROM `warnsys`.`files`), (SELECT COUNT(*) FROM `snowy`.`DEV_FILE` WHERE ID LIKE '19038%')
  UNION ALL SELECT '39.notification -> DEV_MESSAGE',
    (SELECT COUNT(*) FROM `warnsys`.`notification`), (SELECT COUNT(*) FROM `snowy`.`DEV_MESSAGE` WHERE ID LIKE '19039%')
  UNION ALL SELECT '40.audit_logs -> DEV_LOG(OPERATE)',
    (SELECT COUNT(*) FROM `warnsys`.`audit_logs`), (SELECT COUNT(*) FROM `snowy`.`DEV_LOG` WHERE ID LIKE '19040%')
  UNION ALL SELECT '41.security_events -> DEV_LOG(SEC)',
    (SELECT COUNT(*) FROM `warnsys`.`security_events`), (SELECT COUNT(*) FROM `snowy`.`DEV_LOG` WHERE ID LIKE '19041%')
  UNION ALL SELECT '42.system_settings -> DEV_CONFIG',
    (SELECT COUNT(*) FROM `warnsys`.`system_settings`), (SELECT COUNT(*) FROM `snowy`.`DEV_CONFIG` WHERE ID LIKE '19042%')
) t;

-- 2. 外键孤儿检查（全部应为 0）
SELECT orphan_check, orphan_count FROM (
  SELECT 'SYS_ORG.PARENT_ID missing' AS orphan_check,
    (SELECT COUNT(*) FROM `snowy`.`SYS_ORG` o WHERE o.PARENT_ID != '0' AND NOT EXISTS (SELECT 1 FROM `snowy`.`SYS_ORG` p WHERE p.ID = o.PARENT_ID)) AS orphan_count
  UNION ALL SELECT 'BIZ_CLASS.ORG_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_CLASS` c LEFT JOIN `snowy`.`SYS_ORG` o ON c.ORG_ID=o.ID WHERE o.ID IS NULL)
  UNION ALL SELECT 'BIZ_STUDENT_PROFILE.CLIENT_USER_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_STUDENT_PROFILE` sp LEFT JOIN `snowy`.`CLIENT_USER` cu ON sp.CLIENT_USER_ID=cu.ID WHERE cu.ID IS NULL)
  UNION ALL SELECT 'BIZ_STUDENT_PROFILE.CLASS_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_STUDENT_PROFILE` sp LEFT JOIN `snowy`.`BIZ_CLASS` c ON sp.CLASS_ID=c.ID WHERE c.ID IS NULL)
  UNION ALL SELECT 'BIZ_ATTENDANCE_RECORD.SESSION_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_ATTENDANCE_RECORD` ar LEFT JOIN `snowy`.`BIZ_CLASS_SESSION` cs ON ar.SESSION_ID=cs.ID WHERE cs.ID IS NULL)
  UNION ALL SELECT 'BIZ_ATTENDANCE_RECORD.STUDENT_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_ATTENDANCE_RECORD` ar LEFT JOIN `snowy`.`BIZ_STUDENT_PROFILE` sp ON ar.STUDENT_ID=sp.ID WHERE sp.ID IS NULL)
  UNION ALL SELECT 'BIZ_WARNING.STUDENT_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING` w LEFT JOIN `snowy`.`BIZ_STUDENT_PROFILE` sp ON w.STUDENT_ID=sp.ID WHERE sp.ID IS NULL)
  UNION ALL SELECT 'BIZ_WARNING_CURRENT_STATE.STUDENT_ID missing',
    (SELECT COUNT(*) FROM `snowy`.`BIZ_WARNING_CURRENT_STATE` w LEFT JOIN `snowy`.`BIZ_STUDENT_PROFILE` sp ON w.STUDENT_ID=sp.ID WHERE sp.ID IS NULL)
  UNION ALL SELECT 'PENDING_SM3 in SYS_USER/CLIENT_USER',
    (SELECT (SELECT COUNT(*) FROM `snowy`.`SYS_USER` WHERE PASSWORD='PENDING_SM3') + (SELECT COUNT(*) FROM `snowy`.`CLIENT_USER` WHERE PASSWORD='PENDING_SM3'))
) fk;

-- 3. 中文抽检
SELECT ID, NAME, CATEGORY FROM `snowy`.`SYS_ORG` WHERE ID LIKE '19001%' LIMIT 10;
SELECT ID, CLASS_NAME, MAJOR FROM `snowy`.`BIZ_CLASS` LIMIT 5;
SELECT ID, LEVEL, TRIGGER_SUMMARY FROM `snowy`.`BIZ_WARNING` LIMIT 5;
