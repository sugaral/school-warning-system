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
package vip.xiaonuo.biz.modular.stats.service.impl;

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import vip.xiaonuo.auth.core.pojo.SaBaseLoginUser;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationJob;
import vip.xiaonuo.biz.modular.notify.mapper.BizNotificationJobMapper;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizClassMonitorSnapshot;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCase;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCurrentState;
import vip.xiaonuo.biz.modular.warning.entity.BizWeeklySummary;
import vip.xiaonuo.biz.modular.warning.mapper.BizClassMonitorSnapshotMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCaseMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCurrentStateMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWeeklySummaryMapper;
import vip.xiaonuo.biz.modular.stats.param.BizStatsOverviewParam;
import vip.xiaonuo.biz.modular.stats.service.BizStatsService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.text.SimpleDateFormat;
import java.util.*;
import java.util.stream.Collectors;

/**
 * ECharts 校/院/班三视角统计大屏服务实现
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizStatsServiceImpl implements BizStatsService {

    private static final Map<String, String> LEVEL_LABEL = Map.of(
            "yellow", "黄色预警",
            "orange", "橙色预警",
            "red", "红色预警",
            "severe", "严重预警");

    private static final Map<String, String> METRIC_LABEL = Map.of(
            "absent", "缺勤",
            "late", "迟到",
            "homework", "作业未交",
            "class_behavior", "课堂违纪",
            "credits", "学分不足",
            "gpa", "绩点偏低");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizWarningCurrentStateMapper currentStateMapper;

    @Resource
    private BizWarningCaseMapper warningCaseMapper;

    @Resource
    private BizWeeklySummaryMapper weeklySummaryMapper;

    @Resource
    private BizClassMonitorSnapshotMapper classMonitorSnapshotMapper;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Resource
    private BizNotificationJobMapper notificationJobMapper;

    @Override
    public JSONObject dashboard(BizStatsOverviewParam param) {
        List<String> dataScope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(dataScope)) {
            throw new CommonException("当前账号无统计看板数据访问范围");
        }
        SaBaseLoginUser loginUser = StpLoginUserUtil.getLoginUser();
        List<String> roles = loginUser != null && loginUser.getRoleCodeList() != null
                ? loginUser.getRoleCodeList() : Collections.emptyList();

        String viewType = param != null ? StrUtil.trim(param.getViewType()) : null;
        if (StrUtil.isBlank(viewType)) {
            if (dataScope == null) {
                viewType = "school";
            } else if (roles.contains("head_teacher") && !roles.contains("student_admin") && !roles.contains("vice_dean")) {
                viewType = "class";
            } else {
                viewType = "org";
            }
        }

        List<String> availableViews = new ArrayList<>();
        if (dataScope == null) {
            availableViews.add("school");
        }
        availableViews.add("org");
        availableViews.add("class");

        String filterOrgId = param != null ? StrUtil.trim(param.getOrgId()) : null;
        String filterClassId = param != null ? StrUtil.trim(param.getClassId()) : null;

        if ("school".equals(viewType)) {
            if (dataScope != null) {
                throw new CommonException("越权访问拒绝：当前账号仅具备院/班数据权限，不可查看全校统计大屏");
            }
        } else if ("org".equals(viewType)) {
            if (StrUtil.isNotBlank(filterOrgId)) {
                BizScopeUtil.assertOrgInScope(filterOrgId, "查看指定学院统计大屏");
            } else if (ObjectUtil.isNotEmpty(dataScope)) {
                filterOrgId = dataScope.get(0);
            }
        } else if ("class".equals(viewType)) {
            if (StrUtil.isNotBlank(filterClassId)) {
                BizClass cls = bizClassService.queryEntity(filterClassId);
                BizScopeUtil.assertOrgInScope(cls.getOrgId(), "查看指定班级统计大屏");
                filterOrgId = cls.getOrgId();
            } else {
                LambdaQueryWrapper<BizClass> cw = new LambdaQueryWrapper<>();
                if (ObjectUtil.isNotEmpty(dataScope)) CommonSqlUtil.safeIn(cw, BizClass::getOrgId, dataScope);
                if (loginUser != null && roles.contains("head_teacher")) {
                    List<BizClass> mine = bizClassService.list(new LambdaQueryWrapper<BizClass>()
                            .eq(BizClass::getCounselorUserId, loginUser.getId()));
                    if (!mine.isEmpty()) {
                        filterClassId = mine.get(0).getId();
                        filterOrgId = mine.get(0).getOrgId();
                    }
                }
                if (StrUtil.isBlank(filterClassId)) {
                    List<BizClass> anyCls = bizClassService.list(cw.last("LIMIT 1"));
                    if (!anyCls.isEmpty()) {
                        filterClassId = anyCls.get(0).getId();
                        filterOrgId = anyCls.get(0).getOrgId();
                    }
                }
            }
        } else {
            throw new CommonException("不支持的大屏视角: {}", viewType);
        }

        // 加载受限范围学生与当前预警
        LambdaQueryWrapper<BizStudentProfile> stuWrap = new LambdaQueryWrapper<>();
        if (StrUtil.isNotBlank(filterClassId) && "class".equals(viewType)) {
            stuWrap.eq(BizStudentProfile::getClassId, filterClassId);
        } else if (StrUtil.isNotBlank(filterOrgId) && !"school".equals(viewType)) {
            stuWrap.eq(BizStudentProfile::getOrgId, filterOrgId);
        } else if (ObjectUtil.isNotEmpty(dataScope)) {
            CommonSqlUtil.safeIn(stuWrap, BizStudentProfile::getOrgId, dataScope);
        }
        List<BizStudentProfile> scopedStudents = bizStudentProfileService.list(stuWrap);
        Set<String> scopedStudentIds = CollStreamUtil.toSet(scopedStudents, BizStudentProfile::getId);

        LambdaQueryWrapper<BizWarningCurrentState> wcsWrap = new LambdaQueryWrapper<>();
        if (StrUtil.isNotBlank(filterClassId) && "class".equals(viewType)) {
            wcsWrap.eq(BizWarningCurrentState::getClassId, filterClassId);
        } else if (StrUtil.isNotBlank(filterOrgId) && !"school".equals(viewType)) {
            wcsWrap.eq(BizWarningCurrentState::getOrgId, filterOrgId);
        } else if (ObjectUtil.isNotEmpty(dataScope)) {
            CommonSqlUtil.safeIn(wcsWrap, BizWarningCurrentState::getOrgId, dataScope);
        }
        List<BizWarningCurrentState> activeStates = currentStateMapper.selectList(wcsWrap);

        long redSevereCount = activeStates.stream()
                .filter(s -> "red".equals(s.getLevel()) || "severe".equals(s.getLevel())).count();

        LambdaQueryWrapper<BizWarningCase> caseWrap = new LambdaQueryWrapper<BizWarningCase>()
                .eq(BizWarningCase::getIsActive, 1);
        if (StrUtil.isNotBlank(filterClassId) && "class".equals(viewType)) {
            caseWrap.eq(BizWarningCase::getClassId, filterClassId);
        } else if (StrUtil.isNotBlank(filterOrgId) && !"school".equals(viewType)) {
            caseWrap.eq(BizWarningCase::getOrgId, filterOrgId);
        } else if (ObjectUtil.isNotEmpty(dataScope)) {
            CommonSqlUtil.safeIn(caseWrap, BizWarningCase::getOrgId, dataScope);
        }
        List<BizWarningCase> activeCases = warningCaseMapper.selectList(caseWrap);

        long approvedLeaves = scopedStudentIds.isEmpty() ? 0 :
                bizLeaveRequestService.count(new LambdaQueryWrapper<BizLeaveRequest>()
                        .in(BizLeaveRequest::getStudentId, scopedStudentIds)
                        .eq(BizLeaveRequest::getStatus, "approved"));

        long queuedNotifyJobs = notificationJobMapper.selectCount(
                new LambdaQueryWrapper<BizNotificationJob>().eq(BizNotificationJob::getStatus, "queued"));

        // 1. 等级分布
        Map<String, Long> byLevel = activeStates.stream()
                .collect(Collectors.groupingBy(BizWarningCurrentState::getLevel, Collectors.counting()));
        List<JSONObject> levelDistribution = List.of("yellow", "orange", "red", "severe").stream()
                .map(lv -> new JSONObject()
                        .set("level", lv)
                        .set("name", LEVEL_LABEL.getOrDefault(lv, lv))
                        .set("value", byLevel.getOrDefault(lv, 0L)))
                .toList();

        // 2. 指标分布
        Map<String, Long> byMetric = activeStates.stream()
                .collect(Collectors.groupingBy(BizWarningCurrentState::getMetric, Collectors.counting()));
        List<JSONObject> metricDistribution = byMetric.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                .map(e -> new JSONObject()
                        .set("metric", e.getKey())
                        .set("name", METRIC_LABEL.getOrDefault(e.getKey(), e.getKey()))
                        .set("value", e.getValue()))
                .toList();

        // 3. 学院对比（仅展示可见范围内的二级学院）
        LambdaQueryWrapper<BizOrg> orgWrap = new LambdaQueryWrapper<BizOrg>().ne(BizOrg::getParentId, "0");
        if (ObjectUtil.isNotEmpty(dataScope)) CommonSqlUtil.safeIn(orgWrap, BizOrg::getId, dataScope);
        List<BizOrg> visibleOrgs = bizOrgService.list(orgWrap);
        Map<String, Long> stuByOrg = scopedStudents.stream()
                .filter(s -> StrUtil.isNotBlank(s.getOrgId()))
                .collect(Collectors.groupingBy(BizStudentProfile::getOrgId, Collectors.counting()));
        Map<String, Long> warnByOrg = activeStates.stream()
                .filter(s -> StrUtil.isNotBlank(s.getOrgId()))
                .collect(Collectors.groupingBy(BizWarningCurrentState::getOrgId, Collectors.counting()));
        List<JSONObject> orgComparison = visibleOrgs.stream().map(o -> new JSONObject()
                .set("orgId", o.getId())
                .set("orgName", o.getName())
                .set("studentCount", stuByOrg.getOrDefault(o.getId(), 0L))
                .set("warningCount", warnByOrg.getOrDefault(o.getId(), 0L))).toList();

        // 4. 周趋势折线图 (最近8周)
        List<JSONObject> weeklyTrend = Collections.emptyList();
        if (!scopedStudentIds.isEmpty()) {
            List<BizWeeklySummary> wsList = weeklySummaryMapper.selectList(
                    new LambdaQueryWrapper<BizWeeklySummary>()
                            .in(BizWeeklySummary::getStudentId, scopedStudentIds)
                            .orderByAsc(BizWeeklySummary::getWeekStart));
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
            Map<String, int[]> agg = new TreeMap<>();
            for (BizWeeklySummary ws : wsList) {
                if (ws.getWeekStart() == null) continue;
                String wk = sdf.format(ws.getWeekStart());
                int[] nums = agg.computeIfAbsent(wk, k -> new int[3]);
                nums[0] += ws.getAbsentCount() != null ? ws.getAbsentCount() : 0;
                nums[1] += ws.getLateCount() != null ? ws.getLateCount() : 0;
                nums[2] += ws.getHomeworkNotSubmitCount() != null ? ws.getHomeworkNotSubmitCount() : 0;
            }
            List<String> keys = new ArrayList<>(agg.keySet());
            if (keys.size() > 8) {
                keys = keys.subList(keys.size() - 8, keys.size());
            }
            weeklyTrend = keys.stream().map(k -> {
                int[] nums = agg.get(k);
                return new JSONObject()
                        .set("weekStart", k)
                        .set("absentCount", nums[0])
                        .set("lateCount", nums[1])
                        .set("homeworkNotSubmitCount", nums[2]);
            }).toList();
        }

        // 5. 班级高风险排行
        LambdaQueryWrapper<BizClassMonitorSnapshot> cmsWrap = new LambdaQueryWrapper<>();
        if (StrUtil.isNotBlank(filterClassId) && "class".equals(viewType)) {
            cmsWrap.eq(BizClassMonitorSnapshot::getClassId, filterClassId);
        } else if (StrUtil.isNotBlank(filterOrgId) && !"school".equals(viewType)) {
            cmsWrap.eq(BizClassMonitorSnapshot::getOrgId, filterOrgId);
        } else if (ObjectUtil.isNotEmpty(dataScope)) {
            CommonSqlUtil.safeIn(cmsWrap, BizClassMonitorSnapshot::getOrgId, dataScope);
        }
        cmsWrap.orderByDesc(BizClassMonitorSnapshot::getRedWarningCount)
                .orderByDesc(BizClassMonitorSnapshot::getWarningCount)
                .last("LIMIT 10");
        List<BizClassMonitorSnapshot> classSnapshots = classMonitorSnapshotMapper.selectList(cmsWrap);
        Map<String, String> clsNameMap = bizClassService.list().stream()
                .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));
        classSnapshots.forEach(c -> c.setClassName(clsNameMap.getOrDefault(c.getClassId(), c.getClassId())));

        return new JSONObject()
                .set("viewType", viewType)
                .set("availableViews", availableViews)
                .set("orgId", filterOrgId)
                .set("classId", filterClassId)
                .set("kpi", new JSONObject()
                        .set("totalStudents", scopedStudents.size())
                        .set("activeWarnings", activeStates.size())
                        .set("redSevereWarnings", redSevereCount)
                        .set("activeCases", activeCases.size())
                        .set("approvedLeaves", approvedLeaves)
                        .set("queuedNotifyJobs", queuedNotifyJobs))
                .set("levelDistribution", levelDistribution)
                .set("metricDistribution", metricDistribution)
                .set("orgComparison", orgComparison)
                .set("weeklyTrend", weeklyTrend)
                .set("classTopWarnings", classSnapshots);
    }
}
