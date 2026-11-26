/*
 * Copyright [2022] [https://www.xiaonuo.vip]
 *
 * Snowy采用APACHE LICENSE 2.0开源协议，您在使用过程中，需要注意以下几点：
 *
 * 1.请不要删除和修改根目录下的LICENSE文件。
 * 2.请不要删除和修改Snowy源码头部的版权声明。
 * 3.本项目代码可免费商业使用，商业使用请保留源码和相关描述文件的项目出处，作者声明等。
 * 4.分发源码时候，请注明软件出处 https://www.xiaonuo.vip
 * 5.不可二次分发开源参与同类竞品，如有想法可联系团队xiaonuobase@qq.com商议合作。
 * 6.若您的项目无法满足以上几点，需要更多功能代码，获取Snowy商业授权许可，请在官网购买授权，地址为 https://www.xiaonuo.vip
 */
package vip.xiaonuo.biz.modular.workbench.service.impl;

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.annotation.Resource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.auth.core.pojo.SaBaseLoginUser;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.appeal.entity.BizAppeal;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealPageParam;
import vip.xiaonuo.biz.modular.appeal.service.BizAppealService;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.calendar.entity.BizCalendarExclusion;
import vip.xiaonuo.biz.modular.calendar.service.BizCalendarExclusionService;
import vip.xiaonuo.biz.modular.changerequest.entity.BizChangeRequest;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestApproveParam;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestPageParam;
import vip.xiaonuo.biz.modular.changerequest.service.BizChangeRequestService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.courseclass.entity.BizCourseClass;
import vip.xiaonuo.biz.modular.courseclass.service.BizCourseClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestPageParam;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.makeuprequest.entity.BizMakeupRequest;
import vip.xiaonuo.biz.modular.makeuprequest.param.BizMakeupRequestPageParam;
import vip.xiaonuo.biz.modular.makeuprequest.service.BizMakeupRequestService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.teacherbinding.entity.BizTeacherCourseBinding;
import vip.xiaonuo.biz.modular.teacherbinding.service.BizTeacherCourseBindingService;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCase;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCurrentState;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCurrentStateMapper;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCasePageParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningPageParam;
import vip.xiaonuo.biz.modular.warning.service.BizWarningCaseService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchNoticeStrategyParam;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchParam;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchSpecialApproveParam;
import vip.xiaonuo.biz.modular.workbench.service.BizWorkbenchService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.util.CommonSqlUtil;
import vip.xiaonuo.dev.api.DevConfigApi;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * 多角色工作台服务实现
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizWorkbenchServiceImpl implements BizWorkbenchService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final List<String> WORKBENCH_VIEWS = List.of(
            "vice_dean", "teaching_admin", "student_admin", "head_teacher", "teacher");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizCourseClassService bizCourseClassService;

    @Resource
    private BizTeacherCourseBindingService bizTeacherCourseBindingService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizClassSessionMapper bizClassSessionMapper;

    @Resource
    private BizDailyRecordMapper bizDailyRecordMapper;

    @Resource
    private BizWarningCurrentStateMapper bizWarningCurrentStateMapper;

    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Resource
    private BizWarningCaseService bizWarningCaseService;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Resource
    private BizMakeupRequestService bizMakeupRequestService;

    @Resource
    private BizAppealService bizAppealService;

    @Resource
    private BizChangeRequestService bizChangeRequestService;

    @Resource
    private BizCalendarExclusionService bizCalendarExclusionService;

    @Resource
    private DevConfigApi devConfigApi;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Override
    public JSONObject overview(BizWorkbenchParam param) {
        SaBaseLoginUser loginUser = StpLoginUserUtil.getLoginUser();
        List<String> roleCodes = loginUser != null && loginUser.getRoleCodeList() != null
                ? loginUser.getRoleCodeList() : Collections.emptyList();
        boolean isSuper = roleCodes.contains("superAdmin") || roleCodes.contains("bizAdmin");

        List<String> availableViews = new ArrayList<>();
        for (String v : WORKBENCH_VIEWS) {
            if (isSuper || roleCodes.contains(v)) {
                availableViews.add(v);
            }
        }
        if (availableViews.isEmpty()) {
            availableViews.add("teacher");
        }

        String requestedView = param != null ? StrUtil.trim(param.getViewRole()) : null;
        String activeView;
        if (StrUtil.isNotBlank(requestedView)) {
            if (!WORKBENCH_VIEWS.contains(requestedView)) {
                throw new CommonException("不支持的工作台视角: {}", requestedView);
            }
            if (!availableViews.contains(requestedView)) {
                throw new CommonException("当前账号无权切换至视角: {}", requestedView);
            }
            activeView = requestedView;
        } else {
            activeView = availableViews.get(0);
        }

        List<String> scope = BizScopeUtil.getDataScope();
        String requestedOrgId = param != null ? StrUtil.trim(param.getOrgId()) : null;
        if (StrUtil.isNotBlank(requestedOrgId)) {
            BizScopeUtil.assertOrgInScope(requestedOrgId, "查看指定学院工作台");
            scope = Collections.singletonList(requestedOrgId);
        }

        JSONObject stats = computeCoreStats(scope);
        JSONObject rolePanel = buildRolePanel(activeView, loginUser != null ? loginUser.getId() : null, scope);
        String strategyOrgId = StrUtil.isNotBlank(requestedOrgId)
                ? requestedOrgId
                : resolveDefaultStrategyOrg(loginUser != null ? loginUser.getOrgId() : null, scope);
        JSONObject strategy = StrUtil.isNotBlank(strategyOrgId) ? getNotificationStrategy(strategyOrgId) : new JSONObject();

        return new JSONObject()
                .set("activeView", activeView)
                .set("availableViews", availableViews)
                .set("userInfo", loginUser == null ? new JSONObject() : new JSONObject()
                        .set("id", loginUser.getId())
                        .set("name", loginUser.getName())
                        .set("orgId", loginUser.getOrgId())
                        .set("roleCodeList", roleCodes))
                .set("stats", stats)
                .set("rolePanel", rolePanel)
                .set("notificationStrategy", strategy);
    }

    private JSONObject computeCoreStats(List<String> scope) {
        if (BizScopeUtil.isEmptyScope(scope)) {
            return emptyStats();
        }
        LambdaQueryWrapper<BizStudentProfile> stuWrap = new LambdaQueryWrapper<>();
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(stuWrap, BizStudentProfile::getOrgId, scope);
        long totalStudents = bizStudentProfileService.count(stuWrap);

        LambdaQueryWrapper<BizWarningCurrentState> wcsWrap = new LambdaQueryWrapper<>();
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(wcsWrap, BizWarningCurrentState::getOrgId, scope);
        long activeWarnings = bizWarningCurrentStateMapper.selectCount(wcsWrap);

        LambdaQueryWrapper<BizWarningCurrentState> severeWrap = new LambdaQueryWrapper<BizWarningCurrentState>()
                .in(BizWarningCurrentState::getLevel, Arrays.asList("red", "severe"));
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(severeWrap, BizWarningCurrentState::getOrgId, scope);
        long severeRedWarnings = bizWarningCurrentStateMapper.selectCount(severeWrap);

        LambdaQueryWrapper<BizWarningCase> pendingCaseWrap = new LambdaQueryWrapper<BizWarningCase>()
                .eq(BizWarningCase::getStatus, "pending_assignment");
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(pendingCaseWrap, BizWarningCase::getOrgId, scope);
        long pendingCases = bizWarningCaseService.count(pendingCaseWrap);

        LambdaQueryWrapper<BizWarningCase> activeCaseWrap = new LambdaQueryWrapper<BizWarningCase>()
                .in(BizWarningCase::getStatus, Arrays.asList("assigned", "in_progress", "completed"));
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(activeCaseWrap, BizWarningCase::getOrgId, scope);
        long inProgressCases = bizWarningCaseService.count(activeCaseWrap);

        BizLeaveRequestPageParam leaveParam = new BizLeaveRequestPageParam();
        leaveParam.setStatus("submitted");
        long pendingLeaves = bizLeaveRequestService.page(leaveParam).getTotal();

        BizMakeupRequestPageParam makeupParam = new BizMakeupRequestPageParam();
        makeupParam.setStatus("submitted");
        long pendingMakeups = bizMakeupRequestService.page(makeupParam).getTotal();

        BizAppealPageParam appealParam = new BizAppealPageParam();
        appealParam.setStatus("submitted");
        long pendingAppeals = bizAppealService.page(appealParam).getTotal();

        BizChangeRequestPageParam chgParam = new BizChangeRequestPageParam();
        chgParam.setStatus("pending_head");
        long pendingHead = bizChangeRequestService.page(chgParam).getTotal();
        chgParam.setStatus("submitted");
        long pendingSubmitted = bizChangeRequestService.page(chgParam).getTotal();
        chgParam.setStatus("pending_dean");
        long pendingDean = bizChangeRequestService.page(chgParam).getTotal();

        String todayStr = LocalDate.now(ZONE_SHANGHAI).toString();
        Date dayStart = Date.from(LocalDate.now(ZONE_SHANGHAI).atStartOfDay(ZONE_SHANGHAI).toInstant());
        Date dayEnd = Date.from(LocalDate.now(ZONE_SHANGHAI).plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
        List<String> allowedClassIds = resolveScopedClassIds(scope);
        long todaySessions = 0L;
        long activeSessions = 0L;
        if (allowedClassIds == null || !allowedClassIds.isEmpty()) {
            LambdaQueryWrapper<BizClassSession> todaySessWrap = new LambdaQueryWrapper<BizClassSession>()
                    .ge(BizClassSession::getSessionStart, dayStart)
                    .lt(BizClassSession::getSessionStart, dayEnd);
            if (allowedClassIds != null) CommonSqlUtil.safeIn(todaySessWrap, BizClassSession::getClassId, allowedClassIds);
            todaySessions = bizClassSessionMapper.selectCount(todaySessWrap);

            LambdaQueryWrapper<BizClassSession> activeSessWrap = new LambdaQueryWrapper<BizClassSession>()
                    .eq(BizClassSession::getStatus, "active");
            if (allowedClassIds != null) CommonSqlUtil.safeIn(activeSessWrap, BizClassSession::getClassId, allowedClassIds);
            activeSessions = bizClassSessionMapper.selectCount(activeSessWrap);
        }

        LambdaQueryWrapper<BizDailyRecord> issueWrap = new LambdaQueryWrapper<BizDailyRecord>()
                .eq(BizDailyRecord::getRecordDate, todayStr)
                .in(BizDailyRecord::getAttendanceStatus, Arrays.asList("absent", "late"));
        if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(issueWrap, BizDailyRecord::getOrgId, scope);
        long todayIssues = bizDailyRecordMapper.selectCount(issueWrap);

        return new JSONObject()
                .set("totalStudents", totalStudents)
                .set("activeWarnings", activeWarnings)
                .set("severeRedWarnings", severeRedWarnings)
                .set("pendingCases", pendingCases)
                .set("inProgressCases", inProgressCases)
                .set("pendingLeaves", pendingLeaves)
                .set("pendingMakeups", pendingMakeups)
                .set("pendingAppeals", pendingAppeals)
                .set("pendingChanges", pendingHead + pendingSubmitted + pendingDean)
                .set("pendingHeadChanges", pendingHead + pendingSubmitted)
                .set("pendingDeanChanges", pendingDean)
                .set("todaySessions", todaySessions)
                .set("activeSessions", activeSessions)
                .set("todayAttendanceIssues", todayIssues);
    }

    private JSONObject emptyStats() {
        return new JSONObject()
                .set("totalStudents", 0).set("activeWarnings", 0).set("severeRedWarnings", 0)
                .set("pendingCases", 0).set("inProgressCases", 0).set("pendingLeaves", 0)
                .set("pendingMakeups", 0).set("pendingAppeals", 0).set("pendingChanges", 0)
                .set("pendingHeadChanges", 0).set("pendingDeanChanges", 0)
                .set("todaySessions", 0).set("activeSessions", 0).set("todayAttendanceIssues", 0);
    }

    private JSONObject buildRolePanel(String activeView, String userId, List<String> scope) {
        JSONObject panel = new JSONObject();
        switch (activeView) {
            case "head_teacher" -> {
                LambdaQueryWrapper<BizClass> myClsWrap = new LambdaQueryWrapper<>();
                if (StrUtil.isNotBlank(userId)) {
                    myClsWrap.eq(BizClass::getCounselorUserId, userId);
                }
                List<BizClass> managedClasses = bizClassService.list(myClsWrap);
                if (managedClasses.isEmpty() && !BizScopeUtil.isEmptyScope(scope)) {
                    LambdaQueryWrapper<BizClass> scopeWrap = new LambdaQueryWrapper<>();
                    if (ObjectUtil.isNotEmpty(scope)) CommonSqlUtil.safeIn(scopeWrap, BizClass::getOrgId, scope);
                    managedClasses = bizClassService.list(scopeWrap.last("LIMIT 20"));
                }
                BizLeaveRequestPageParam lp = new BizLeaveRequestPageParam();
                lp.setStatus("submitted");
                lp.setSize(8);
                List<BizLeaveRequest> pendingLeaves = bizLeaveRequestService.page(lp).getRecords();

                BizChangeRequestPageParam cp = new BizChangeRequestPageParam();
                cp.setTargetType("student_profile_class_change");
                cp.setStatus("pending_head");
                cp.setSize(8);
                List<BizChangeRequest> pendingClassChanges = bizChangeRequestService.page(cp).getRecords();

                List<BizWarningCase> myCases = StrUtil.isBlank(userId) ? Collections.emptyList()
                        : bizWarningCaseService.list(new LambdaQueryWrapper<BizWarningCase>()
                                .eq(BizWarningCase::getHandlerUserId, userId)
                                .eq(BizWarningCase::getIsActive, 1)
                                .orderByDesc(BizWarningCase::getHandlingPriority)
                                .last("LIMIT 8"));
                if (myCases.isEmpty()) {
                    BizWarningCasePageParam wp = new BizWarningCasePageParam();
                    wp.setIsActive(1);
                    wp.setSize(8);
                    myCases = bizWarningCaseService.page(wp).getRecords();
                }

                panel.set("managedClassesCount", managedClasses.size())
                        .set("managedClasses", managedClasses)
                        .set("pendingLeaves", pendingLeaves)
                        .set("pendingClassChanges", pendingClassChanges)
                        .set("myCases", myCases);
            }
            case "teacher" -> {
                List<BizTeacherCourseBinding> bindings = StrUtil.isBlank(userId) ? Collections.emptyList()
                        : bizTeacherCourseBindingService.list(new LambdaQueryWrapper<BizTeacherCourseBinding>()
                                .eq(BizTeacherCourseBinding::getTeacherId, userId));
                List<BizClassSession> sessions = bizClassSessionMapper.selectList(
                        new LambdaQueryWrapper<BizClassSession>()
                                .eq(StrUtil.isNotBlank(userId) && !bindings.isEmpty(), BizClassSession::getTeacherUserId, userId)
                                .orderByDesc(BizClassSession::getSessionStart)
                                .last("LIMIT 10"));
                BizMakeupRequestPageParam mp = new BizMakeupRequestPageParam();
                mp.setStatus("submitted");
                mp.setSize(8);
                List<BizMakeupRequest> pendingMakeups = bizMakeupRequestService.page(mp).getRecords();
                panel.set("bindingsCount", bindings.size())
                        .set("bindings", bindings)
                        .set("recentSessions", sessions)
                        .set("pendingMakeups", pendingMakeups);
            }
            case "student_admin" -> {
                BizWarningPageParam wp = new BizWarningPageParam();
                wp.setStatus("open");
                wp.setSize(8);
                List<BizWarning> openWarnings = bizWarningEngineService.page(wp).getRecords();

                BizWarningCasePageParam wcp = new BizWarningCasePageParam();
                wcp.setStatus("pending_assignment");
                wcp.setSize(8);
                List<BizWarningCase> unassignedCases = bizWarningCaseService.page(wcp).getRecords();

                BizAppealPageParam ap = new BizAppealPageParam();
                ap.setStatus("submitted");
                ap.setSize(8);
                List<BizAppeal> pendingAppeals = bizAppealService.page(ap).getRecords();

                panel.set("openWarnings", openWarnings)
                        .set("unassignedCases", unassignedCases)
                        .set("pendingAppeals", pendingAppeals);
            }
            case "teaching_admin" -> {
                long courseCount = bizCourseService.count();
                long courseClassCount = bizCourseClassService.count();
                long exclusionCount = bizCalendarExclusionService.count();

                BizChangeRequestPageParam bindingCp = new BizChangeRequestPageParam();
                bindingCp.setTargetType("teacher_course_binding_change");
                bindingCp.setSize(8);
                List<BizChangeRequest> bindingChanges = bizChangeRequestService.page(bindingCp).getRecords();

                BizChangeRequestPageParam gradeCp = new BizChangeRequestPageParam();
                gradeCp.setTargetType("grade");
                gradeCp.setSize(8);
                List<BizChangeRequest> gradeChanges = bizChangeRequestService.page(gradeCp).getRecords();

                panel.set("courseCount", courseCount)
                        .set("courseClassCount", courseClassCount)
                        .set("exclusionCount", exclusionCount)
                        .set("bindingChanges", bindingChanges)
                        .set("gradeChanges", gradeChanges);
            }
            case "vice_dean" -> {
                BizChangeRequestPageParam deanCp = new BizChangeRequestPageParam();
                deanCp.setStatus("pending_dean");
                deanCp.setSize(10);
                List<BizChangeRequest> pendingDeanChanges = bizChangeRequestService.page(deanCp).getRecords();

                BizWarningCasePageParam highRiskWp = new BizWarningCasePageParam();
                highRiskWp.setSize(10);
                List<BizWarningCase> highRiskCases = bizWarningCaseService.page(highRiskWp).getRecords();

                panel.set("pendingDeanChanges", pendingDeanChanges)
                        .set("highRiskCases", highRiskCases);
            }
            default -> {
            }
        }
        return panel;
    }

    @Override
    public JSONObject getNotificationStrategy(String orgId) {
        String resolvedOrgId = StrUtil.isNotBlank(orgId) ? StrUtil.trim(orgId)
                : resolveDefaultStrategyOrg(null, BizScopeUtil.getDataScope());
        if (StrUtil.isBlank(resolvedOrgId)) {
            return defaultStrategy("0", "WARNSYS_NOTIFICATION_STRATEGY");
        }
        BizScopeUtil.assertOrgInScope(resolvedOrgId, "查看学院防骚扰通知策略");
        String configKey = resolveStrategyConfigKey(resolvedOrgId);
        String raw = devConfigApi.getValueByKey(configKey);
        if (StrUtil.isBlank(raw)) {
            return defaultStrategy(resolvedOrgId, configKey);
        }
        try {
            JSONObject obj = JSONUtil.parseObj(raw);
            obj.set("orgId", resolvedOrgId);
            obj.set("configKey", configKey);
            return obj;
        } catch (Exception e) {
            return defaultStrategy(resolvedOrgId, configKey);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject saveNotificationStrategy(BizWorkbenchNoticeStrategyParam param) {
        SaBaseLoginUser loginUser = StpLoginUserUtil.getLoginUser();
        List<String> roles = loginUser != null && loginUser.getRoleCodeList() != null
                ? loginUser.getRoleCodeList() : Collections.emptyList();
        if (!roles.contains("superAdmin") && !roles.contains("bizAdmin")
                && !roles.contains("vice_dean") && !roles.contains("student_admin")) {
            throw new CommonException("仅系统管理员、教学副院长或学工管理员可修改学院防骚扰策略");
        }
        String orgId = StrUtil.trim(param.getOrgId());
        BizScopeUtil.assertOrgInScope(orgId, "修改学院防骚扰通知策略");
        BizOrg org = bizOrgService.getById(orgId);
        if (org == null) {
            throw new CommonException("学院组织不存在，orgId={}", orgId);
        }
        String configKey = resolveStrategyConfigKey(orgId);
        JSONObject payload = new JSONObject()
                .set("enabled", param.getEnabled() != null ? param.getEnabled() : true)
                .set("notifyOnCreate", param.getNotifyOnCreate() != null ? param.getNotifyOnCreate() : true)
                .set("notifyOnUpgrade", param.getNotifyOnUpgrade() != null ? param.getNotifyOnUpgrade() : true)
                .set("notifyOnClose", param.getNotifyOnClose() != null ? param.getNotifyOnClose() : true)
                .set("notifyStudent", param.getNotifyStudent() != null ? param.getNotifyStudent() : true)
                .set("notifyHeadTeacher", param.getNotifyHeadTeacher() != null ? param.getNotifyHeadTeacher() : true)
                .set("notifyCounselor", param.getNotifyCounselor() != null ? param.getNotifyCounselor() : true)
                .set("notifyParents", param.getNotifyParents() != null ? param.getNotifyParents() : false)
                .set("channels", param.getChannels() != null && !param.getChannels().isEmpty()
                        ? new JSONArray(param.getChannels())
                        : new JSONArray(List.of("wechat", "email")));

        Integer exists = jdbcTemplate.queryForObject(
                "SELECT COUNT(1) FROM DEV_CONFIG WHERE CONFIG_KEY = ? AND DELETE_FLAG = 'NOT_DELETE'",
                Integer.class, configKey);
        if (exists == null || exists == 0) {
            jdbcTemplate.update(
                    "INSERT INTO DEV_CONFIG (ID, CONFIG_KEY, CONFIG_VALUE, CATEGORY, REMARK, SORT_CODE, DELETE_FLAG, CREATE_TIME) " +
                            "VALUES (?, ?, ?, 'BIZ_DEFINE', ?, 99, 'NOT_DELETE', NOW())",
                    IdUtil.getSnowflakeNextIdStr(), configKey, payload.toString(),
                    org.getName() + "防骚扰通知策略");
        } else {
            devConfigApi.setValueByKey(configKey, payload.toString());
        }
        payload.set("orgId", orgId);
        payload.set("configKey", configKey);
        return payload;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void specialApproveChange(BizWorkbenchSpecialApproveParam param) {
        SaBaseLoginUser loginUser = StpLoginUserUtil.getLoginUser();
        List<String> roles = loginUser != null && loginUser.getRoleCodeList() != null
                ? loginUser.getRoleCodeList() : Collections.emptyList();
        if (!roles.contains("superAdmin") && !roles.contains("bizAdmin")
                && !roles.contains("vice_dean") && !roles.contains("teaching_admin")) {
            throw new CommonException("仅教学副院长、教务管理员或系统管理员可执行特批终审");
        }
        BizChangeRequest req = bizChangeRequestService.queryEntity(param.getId());
        BizChangeRequestApproveParam approveParam = new BizChangeRequestApproveParam();
        approveParam.setId(req.getId());
        approveParam.setApprove(param.getApprove());
        approveParam.setRejectReason(param.getNote());
        bizChangeRequestService.approve(approveParam);

        if (StrUtil.isNotBlank(param.getNote())) {
            BizChangeRequest updated = bizChangeRequestService.queryEntity(req.getId());
            JSONObject ext = StrUtil.isNotBlank(updated.getExtJson()) && JSONUtil.isTypeJSONObject(updated.getExtJson())
                    ? JSONUtil.parseObj(updated.getExtJson()) : new JSONObject();
            ext.set("specialApproved", true);
            ext.set("specialNote", StrUtil.trim(param.getNote()));
            ext.set("specialOperatorId", loginUser.getId());
            updated.setExtJson(ext.toString());
            bizChangeRequestService.updateById(updated);
        }
    }

    private List<String> resolveScopedClassIds(List<String> scope) {
        if (scope == null) {
            return null;
        }
        if (scope.isEmpty()) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<BizClass> cw = new LambdaQueryWrapper<BizClass>().select(BizClass::getId);
        CommonSqlUtil.safeIn(cw, BizClass::getOrgId, scope);
        return CollStreamUtil.toList(bizClassService.list(cw), BizClass::getId);
    }

    private String resolveDefaultStrategyOrg(String userOrgId, List<String> scope) {
        if (StrUtil.isNotBlank(userOrgId) && !"0".equals(userOrgId) && !"1900100000000000000".equals(userOrgId)) {
            if (scope == null || scope.contains(userOrgId)) {
                return userOrgId;
            }
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            return scope.get(0);
        }
        List<BizOrg> orgs = bizOrgService.list(new LambdaQueryWrapper<BizOrg>()
                .ne(BizOrg::getParentId, "0")
                .orderByAsc(BizOrg::getId)
                .last("LIMIT 1"));
        return orgs.isEmpty() ? null : orgs.get(0).getId();
    }

    private String resolveStrategyConfigKey(String orgId) {
        List<String> sourceIds = jdbcTemplate.queryForList(
                "SELECT SOURCE_ID FROM BIZ_MIGRATION_ID_MAP WHERE SOURCE_TABLE = 'orgs' AND TARGET_ID = ? LIMIT 1",
                String.class, orgId);
        String suffix = sourceIds.isEmpty() ? orgId : sourceIds.get(0);
        return "WARNSYS_NOTIFICATION_STRATEGY_" + suffix;
    }

    private JSONObject defaultStrategy(String orgId, String configKey) {
        return new JSONObject()
                .set("orgId", orgId)
                .set("configKey", configKey)
                .set("enabled", true)
                .set("notifyOnCreate", true)
                .set("notifyOnUpgrade", true)
                .set("notifyOnClose", true)
                .set("notifyStudent", true)
                .set("notifyHeadTeacher", true)
                .set("notifyCounselor", true)
                .set("notifyParents", false)
                .set("channels", List.of("wechat", "email"));
    }
}
