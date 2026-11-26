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
package vip.xiaonuo.biz.modular.warning.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.calendar.entity.BizCalendarExclusion;
import vip.xiaonuo.biz.modular.calendar.service.BizCalendarExclusionService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.notify.service.BizNotifyService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizTermSummary;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCurrentState;
import vip.xiaonuo.biz.modular.warning.mapper.BizTermSummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCurrentStateMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningMapper;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCloseParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningIdParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningPageParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningRescanParam;
import vip.xiaonuo.biz.modular.warning.service.BizSummaryService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningCaseService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningSnapshotService;
import vip.xiaonuo.biz.modular.warningrule.entity.BizWarningRule;
import vip.xiaonuo.biz.modular.warningrule.service.BizWarningRuleService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 学业预警引擎与记录管理Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizWarningEngineServiceImpl extends ServiceImpl<BizWarningMapper, BizWarning>
        implements BizWarningEngineService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final String COURSE_KEY_ALL = "ALL";
    private static final Map<String, Integer> LEVEL_RANK = Map.of(
            "yellow", 1,
            "orange", 2,
            "red", 3,
            "severe", 4
    );

    @Resource
    private BizWarningCurrentStateMapper currentStateMapper;

    @Resource
    private BizTermSummaryMapper termSummaryMapper;

    @Resource
    private BizDailyRecordMapper dailyRecordMapper;

    @Resource
    private BizWarningRuleService bizWarningRuleService;

    @Resource
    private BizCalendarExclusionService bizCalendarExclusionService;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizSummaryService bizSummaryService;

    @Resource
    private BizWarningSnapshotService bizWarningSnapshotService;

    @Resource
    private BizWarningCaseService bizWarningCaseService;

    @Resource
    private RedissonClient redissonClient;

    @Lazy
    @Resource
    private BizNotifyService bizNotifyService;

    @Override
    public Page<BizWarning> page(BizWarningPageParam param) {
        QueryWrapper<BizWarning> queryWrapper = new QueryWrapper<BizWarning>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizWarning::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizWarning::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getMetric())) {
            queryWrapper.lambda().eq(BizWarning::getMetric, param.getMetric());
        }
        if (StrUtil.isNotBlank(param.getLevel())) {
            queryWrapper.lambda().eq(BizWarning::getLevel, param.getLevel());
        }
        if (StrUtil.isNotBlank(param.getWindowType())) {
            queryWrapper.lambda().eq(BizWarning::getWindowType, param.getWindowType());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizWarning::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizWarning::getTriggerSummary, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizWarning::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizWarning::getCreateTime);
        Page<BizWarning> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillStudentNo(page.getRecords());
        return page;
    }

    @Override
    public BizWarning detail(BizWarningIdParam idParam) {
        BizWarning entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看预警详情");
        fillStudentNo(Collections.singletonList(entity));
        return entity;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void acknowledge(BizWarningIdParam idParam) {
        BizWarning entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "确认学业预警");
        if ("closed".equals(entity.getStatus())) {
            throw new CommonException("预警已关闭，无需确认");
        }
        Date now = new Date();
        String uid = StpUtil.getLoginIdAsString();
        entity.setStatus("acknowledged");
        entity.setAcknowledgedAt(now);
        entity.setAcknowledgedBy(uid);
        this.updateById(entity);

        BizWarningCurrentState state = findMatchingState(entity);
        if (state != null) {
            state.setStatus("acknowledged");
            state.setAcknowledgedAt(now);
            state.setAcknowledgedBy(uid);
            currentStateMapper.updateById(state);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void close(BizWarningCloseParam param) {
        BizWarning entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "关闭学业预警");
        if ("closed".equals(entity.getStatus())) {
            throw new CommonException("预警已处于关闭状态");
        }
        Date now = new Date();
        entity.setStatus("closed");
        entity.setClosedAt(now);
        entity.setClosedBy(StpUtil.getLoginIdAsString());
        entity.setCloseNote(StrUtil.isNotBlank(param.getCloseNote()) ? StrUtil.trim(param.getCloseNote()) : "管理员手动关闭");
        this.updateById(entity);

        BizWarningCurrentState state = findMatchingState(entity);
        if (state != null) {
            currentStateMapper.physicalDeleteById(state.getId());
        }
        bizWarningSnapshotService.refreshStudentSnapshots(Collections.singletonList(entity.getStudentId()));
        bizWarningSnapshotService.refreshClassSnapshots(Collections.singletonList(entity.getClassId()));
        bizWarningCaseService.syncStudentRiskCase(entity.getStudentId());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizWarningIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizWarningIdParam::getId);
        List<BizWarning> list = this.listByIds(ids);
        Set<String> sids = new HashSet<>();
        Set<String> cids = new HashSet<>();
        for (BizWarning item : list) {
            BizScopeUtil.assertOrgInScope(item.getOrgId(), "删除学业预警记录");
            sids.add(item.getStudentId());
            cids.add(item.getClassId());
            BizWarningCurrentState state = findMatchingState(item);
            if (state != null) {
                currentStateMapper.physicalDeleteById(state.getId());
            }
        }
        this.removeByIds(ids);
        if (!sids.isEmpty()) {
            bizWarningSnapshotService.refreshStudentSnapshots(sids);
            bizWarningSnapshotService.refreshClassSnapshots(cids);
            sids.forEach(bizWarningCaseService::syncStudentRiskCase);
        }
    }

    @Override
    public JSONObject rescan(BizWarningRescanParam param) {
        LocalDate ref = parseRefDate(param.getRefDate());
        String termCode = bizSummaryService.resolveActiveTermCode(param.getTermCode());

        if (StrUtil.isNotBlank(param.getStudentId())) {
            BizStudentProfile stu = bizStudentProfileService.queryEntity(param.getStudentId());
            BizScopeUtil.assertOrgInScope(stu.getOrgId(), "重算学生预警");
            bizSummaryService.rebuildWeeklySummary(ref);
            bizSummaryService.rebuildMonthlySummary(ref.getYear(), ref.getMonthValue());
            if (StrUtil.isNotBlank(termCode)) {
                bizSummaryService.rebuildTermSummary(termCode);
            }
            return evaluateStudent(stu.getId(), ref, termCode);
        }
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new JSONObject().set("studentsScanned", 0).set("warningsGenerated", 0);
        }
        return scanAll(ref, termCode, scope);
    }

    @Override
    public JSONObject evaluateStudent(String studentId, LocalDate refDate, String termCode) {
        LocalDate anchor = refDate != null ? refDate : LocalDate.now(ZONE_SHANGHAI);
        String resolvedTerm = bizSummaryService.resolveActiveTermCode(termCode);
        BizStudentProfile stu = bizStudentProfileService.getById(studentId);
        if (stu == null || !"active".equals(stu.getStatus())) {
            return new JSONObject().set("warningsGenerated", 0).set("warningsClosed", 0);
        }

        List<BizWarningRule> allRules = bizWarningRuleService.list(
                new LambdaQueryWrapper<BizWarningRule>().eq(BizWarningRule::getEnabled, true));
        Set<String> excludedDates = loadExcludedDates(stu.getOrgId(), anchor);

        JSONObject result = evaluateSingleStudentLocked(stu, anchor, resolvedTerm, allRules, excludedDates);
        bizWarningSnapshotService.refreshStudentSnapshots(Collections.singletonList(stu.getId()));
        bizWarningSnapshotService.refreshClassSnapshots(Collections.singletonList(stu.getClassId()));
        bizWarningCaseService.syncStudentRiskCase(stu.getId());
        return result;
    }

    @Override
    public JSONObject scanAll(LocalDate refDate, String termCode, List<String> orgScope) {
        LocalDate anchor = refDate != null ? refDate : LocalDate.now(ZONE_SHANGHAI);
        String resolvedTerm = bizSummaryService.resolveActiveTermCode(termCode);

        bizSummaryService.rebuildWeeklySummary(anchor);
        bizSummaryService.rebuildMonthlySummary(anchor.getYear(), anchor.getMonthValue());
        if (StrUtil.isNotBlank(resolvedTerm)) {
            bizSummaryService.rebuildTermSummary(resolvedTerm);
        }

        List<BizWarningRule> allRules = bizWarningRuleService.list(
                new LambdaQueryWrapper<BizWarningRule>().eq(BizWarningRule::getEnabled, true));
        LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>()
                .eq(BizStudentProfile::getStatus, "active");
        if (ObjectUtil.isNotEmpty(orgScope)) {
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, orgScope);
        }
        List<BizStudentProfile> students = bizStudentProfileService.list(sw);

        Map<String, Set<String>> exclusionCache = new HashMap<>();
        int generated = 0;
        int upgraded = 0;
        int closed = 0;
        Set<String> touchedStudentIds = new HashSet<>();
        Set<String> touchedClassIds = new HashSet<>();

        for (BizStudentProfile stu : students) {
            Set<String> excludedDates = exclusionCache.computeIfAbsent(
                    StrUtil.blankToDefault(stu.getOrgId(), "0"),
                    org -> loadExcludedDates(org, anchor));
            JSONObject res = evaluateSingleStudentLocked(stu, anchor, resolvedTerm, allRules, excludedDates);
            generated += res.getInt("warningsGenerated", 0);
            upgraded += res.getInt("warningsUpgraded", 0);
            closed += res.getInt("warningsClosed", 0);
            touchedStudentIds.add(stu.getId());
            if (StrUtil.isNotBlank(stu.getClassId())) {
                touchedClassIds.add(stu.getClassId());
            }
        }

        if (!touchedStudentIds.isEmpty()) {
            bizWarningSnapshotService.refreshStudentSnapshots(touchedStudentIds);
            bizWarningSnapshotService.refreshClassSnapshots(touchedClassIds);
            for (String sid : touchedStudentIds) {
                bizWarningCaseService.syncStudentRiskCase(sid);
            }
        }
        return new JSONObject()
                .set("refDate", anchor.toString())
                .set("termCode", resolvedTerm)
                .set("rulesCount", allRules.size())
                .set("studentsScanned", students.size())
                .set("warningsGenerated", generated)
                .set("warningsUpgraded", upgraded)
                .set("warningsClosed", closed);
    }

    @Override
    public BizWarning queryEntity(String id) {
        BizWarning entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("学业预警记录不存在，id={}", id);
        }
        return entity;
    }

    protected JSONObject evaluateSingleStudentLocked(BizStudentProfile stu, LocalDate anchor, String termCode,
                                                     List<BizWarningRule> allRules, Set<String> excludedDates) {
        RLock lock = redissonClient.getLock("lock:warning:student:" + stu.getId());
        boolean locked = false;
        int generated = 0, upgraded = 0, closed = 0;
        try {
            locked = lock.tryLock(3, 30, TimeUnit.SECONDS);
            if (!locked) {
                return new JSONObject().set("warningsGenerated", 0).set("warningsUpgraded", 0).set("warningsClosed", 0);
            }

            List<BizWarningRule> effectiveRules = resolveEffectiveRules(allRules, stu.getOrgId());
            if (effectiveRules.isEmpty()) {
                return new JSONObject().set("warningsGenerated", 0).set("warningsUpgraded", 0).set("warningsClosed", 0);
            }

            LocalDate weekStart = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            LocalDate weekEnd = weekStart.plusDays(6);
            LocalDate monthStart = anchor.withDayOfMonth(1);
            LocalDate monthEnd = anchor.withDayOfMonth(anchor.lengthOfMonth());
            LocalDate termStart = anchor.minusDays(180);

            LocalDate earliestDate = termStart;
            List<BizDailyRecord> dailyRecords = dailyRecordMapper.selectList(
                    new LambdaQueryWrapper<BizDailyRecord>()
                            .eq(BizDailyRecord::getStudentId, stu.getId())
                            .ge(BizDailyRecord::getRecordDate, earliestDate.toString())
                            .le(BizDailyRecord::getRecordDate, monthEnd.isAfter(weekEnd) ? monthEnd.toString() : weekEnd.toString()));

            Date windowEarliest = Date.from(earliestDate.atStartOfDay(ZONE_SHANGHAI).toInstant());
            Date windowLatest = Date.from(anchor.plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
            List<BizLeaveRequest> approvedLeaves = bizLeaveRequestService.list(
                    new LambdaQueryWrapper<BizLeaveRequest>()
                            .eq(BizLeaveRequest::getStudentId, stu.getId())
                            .eq(BizLeaveRequest::getStatus, "approved")
                            .le(BizLeaveRequest::getFromDate, windowLatest)
                            .ge(BizLeaveRequest::getToDate, windowEarliest));

            BizTermSummary termSummary = StrUtil.isBlank(termCode) ? null :
                    termSummaryMapper.selectOne(new LambdaQueryWrapper<BizTermSummary>()
                            .eq(BizTermSummary::getStudentId, stu.getId())
                            .eq(BizTermSummary::getTermCode, termCode)
                            .last("LIMIT 1"));

            Map<String, List<BizWarningRule>> grouped = effectiveRules.stream()
                    .collect(Collectors.groupingBy(r -> r.getMetric() + "::" + r.getWindowType()));

            Date now = new Date();
            for (Map.Entry<String, List<BizWarningRule>> entry : grouped.entrySet()) {
                List<BizWarningRule> groupRules = entry.getValue();
                String metric = groupRules.get(0).getMetric();
                String windowType = groupRules.get(0).getWindowType();

                LocalDate pStart;
                LocalDate pEnd;
                if ("day".equals(windowType)) {
                    pStart = anchor;
                    pEnd = anchor;
                } else if ("week".equals(windowType)) {
                    pStart = weekStart;
                    pEnd = weekEnd;
                } else if ("month".equals(windowType)) {
                    pStart = monthStart;
                    pEnd = monthEnd;
                } else {
                    pStart = termStart;
                    pEnd = anchor;
                }

                Integer metricVal = computeMetricValue(stu.getId(), metric, pStart, pEnd, dailyRecords, approvedLeaves, excludedDates, termSummary);
                if (metricVal == null) {
                    continue;
                }

                BizWarningRule highestHit = null;
                for (BizWarningRule r : groupRules) {
                    if (r.getThreshold() != null && isThresholdHit(metric, metricVal, r.getThreshold())) {
                        if (highestHit == null || LEVEL_RANK.getOrDefault(r.getLevel(), 0) > LEVEL_RANK.getOrDefault(highestHit.getLevel(), 0)) {
                            highestHit = r;
                        }
                    }
                }

                String psStr = pStart.toString();
                String peStr = pEnd.toString();
                BizWarningCurrentState existingState = currentStateMapper.selectOne(
                        new LambdaQueryWrapper<BizWarningCurrentState>()
                                .eq(BizWarningCurrentState::getStudentId, stu.getId())
                                .eq(BizWarningCurrentState::getMetric, metric)
                                .eq(BizWarningCurrentState::getWindowType, windowType)
                                .eq(BizWarningCurrentState::getPeriodStart, psStr)
                                .eq(BizWarningCurrentState::getPeriodEnd, peStr)
                                .eq(BizWarningCurrentState::getCourseKey, COURSE_KEY_ALL));

                List<BizWarning> existingActiveWarnings = this.list(new LambdaQueryWrapper<BizWarning>()
                        .eq(BizWarning::getStudentId, stu.getId())
                        .eq(BizWarning::getMetric, metric)
                        .eq(BizWarning::getWindowType, windowType)
                        .eq(BizWarning::getPeriodStart, psStr)
                        .eq(BizWarning::getPeriodEnd, peStr)
                        .ne(BizWarning::getStatus, "closed"));

                if (highestHit != null) {
                    String ruleSnapshot = new JSONObject()
                            .set("id", highestHit.getId())
                            .set("scope", highestHit.getScope())
                            .set("level", highestHit.getLevel())
                            .set("metric", metric)
                            .set("windowType", windowType)
                            .set("threshold", highestHit.getThreshold())
                            .set("ruleVersion", highestHit.getRuleVersion())
                            .toString();
                    String summary = buildTriggerSummary(metric, windowType, metricVal, highestHit.getThreshold());
                    String detail = new JSONObject()
                            .set("metric", metric)
                            .set("windowType", windowType)
                            .set("violation_count", metricVal)
                            .set("threshold", highestHit.getThreshold())
                            .set("periodStart", psStr)
                            .set("periodEnd", peStr)
                            .toString();

                    Date psDate = java.sql.Date.valueOf(pStart);
                    Date peDate = java.sql.Date.valueOf(pEnd);

                    if (existingState == null) {
                        BizWarningCurrentState st = new BizWarningCurrentState();
                        st.setStudentId(stu.getId());
                        st.setClassId(stu.getClassId());
                        st.setOrgId(stu.getOrgId());
                        st.setMetric(metric);
                        st.setLevel(highestHit.getLevel());
                        st.setWindowType(windowType);
                        st.setPeriodStart(psDate);
                        st.setPeriodEnd(peDate);
                        st.setCourseKey(COURSE_KEY_ALL);
                        st.setRuleId(highestHit.getId());
                        st.setRuleSnapshotJson(ruleSnapshot);
                        st.setTriggerSummary(summary);
                        st.setTriggerDetailJson(detail);
                        st.setCurrentCount(metricVal);
                        st.setStatus("open");
                        currentStateMapper.insert(st);
                    } else {
                        existingState.setLevel(highestHit.getLevel());
                        existingState.setRuleId(highestHit.getId());
                        existingState.setRuleSnapshotJson(ruleSnapshot);
                        existingState.setTriggerSummary(summary);
                        existingState.setTriggerDetailJson(detail);
                        existingState.setCurrentCount(metricVal);
                        currentStateMapper.updateById(existingState);
                    }

                    if (existingActiveWarnings.isEmpty()) {
                        BizWarning w = new BizWarning();
                        w.setStudentId(stu.getId());
                        w.setClassId(stu.getClassId());
                        w.setOrgId(stu.getOrgId());
                        w.setMetric(metric);
                        w.setLevel(highestHit.getLevel());
                        w.setWindowType(windowType);
                        w.setPeriodStart(psDate);
                        w.setPeriodEnd(peDate);
                        w.setRuleId(highestHit.getId());
                        w.setRuleSnapshotJson(ruleSnapshot);
                        w.setTriggerSummary(summary);
                        w.setTriggerDetailJson(detail);
                        w.setStatus("open");
                        this.save(w);
                        generated++;
                        try {
                            bizNotifyService.enqueueSystemWarning(stu, w, "create");
                        } catch (Exception notifyEx) {
                            log.warn("[BizWarningEngine] 预警新增触发通知失败 warningId={}, err={}", w.getId(), notifyEx.getMessage());
                        }
                    } else {
                        BizWarning active = existingActiveWarnings.get(0);
                        int curRank = LEVEL_RANK.getOrDefault(active.getLevel(), 0);
                        int newRank = LEVEL_RANK.getOrDefault(highestHit.getLevel(), 0);
                        if (newRank > curRank || !Objects.equals(summary, active.getTriggerSummary())) {
                            boolean isUpgrade = newRank > curRank;
                            if (isUpgrade) {
                                active.setLevel(highestHit.getLevel());
                                upgraded++;
                            }
                            active.setRuleId(highestHit.getId());
                            active.setRuleSnapshotJson(ruleSnapshot);
                            active.setTriggerSummary(summary);
                            active.setTriggerDetailJson(detail);
                            this.updateById(active);
                            if (isUpgrade) {
                                try {
                                    bizNotifyService.enqueueSystemWarning(stu, active, "upgrade");
                                } catch (Exception notifyEx) {
                                    log.warn("[BizWarningEngine] 预警升级触发通知失败 warningId={}, err={}", active.getId(), notifyEx.getMessage());
                                }
                            }
                        }
                    }
                } else {
                    if (existingState != null) {
                        currentStateMapper.physicalDeleteById(existingState.getId());
                    }
                    for (BizWarning active : existingActiveWarnings) {
                        active.setStatus("closed");
                        active.setClosedAt(now);
                        active.setCloseNote("条件消除自动关闭（最新统计值=" + metricVal + "）");
                        this.updateById(active);
                        closed++;
                    }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
        return new JSONObject()
                .set("warningsGenerated", generated)
                .set("warningsUpgraded", upgraded)
                .set("warningsClosed", closed);
    }

    private List<BizWarningRule> resolveEffectiveRules(List<BizWarningRule> allRules, String orgId) {
        Map<String, BizWarningRule> map = new LinkedHashMap<>();
        for (BizWarningRule r : allRules) {
            if ("school".equals(r.getScope())) {
                String k = r.getMetric() + "::" + r.getWindowType() + "::" + r.getLevel();
                map.put(k, r);
            }
        }
        if (StrUtil.isNotBlank(orgId)) {
            for (BizWarningRule r : allRules) {
                if ("college".equals(r.getScope()) && Objects.equals(orgId, r.getScopeId())) {
                    String k = r.getMetric() + "::" + r.getWindowType() + "::" + r.getLevel();
                    map.put(k, r);
                }
            }
        }
        return new ArrayList<>(map.values());
    }

    private Set<String> loadExcludedDates(String orgId, LocalDate anchor) {
        LocalDate min = anchor.minusDays(190);
        LocalDate max = anchor.plusDays(40);
        List<BizCalendarExclusion> list = bizCalendarExclusionService.list(
                new LambdaQueryWrapper<BizCalendarExclusion>()
                        .ge(BizCalendarExclusion::getExclusionDate, min.toString())
                        .le(BizCalendarExclusion::getExclusionDate, max.toString())
                        .and(w -> w.eq(BizCalendarExclusion::getScope, "school")
                                .or(sub -> sub.eq(BizCalendarExclusion::getScope, "org").eq(BizCalendarExclusion::getScopeId, orgId))));
        return list.stream().map(e -> toLocalDateStr(e.getExclusionDate())).collect(Collectors.toSet());
    }

    private Integer computeMetricValue(String studentId, String metric, LocalDate pStart, LocalDate pEnd,
                                       List<BizDailyRecord> dailyRecords, List<BizLeaveRequest> approvedLeaves,
                                       Set<String> excludedDates, BizTermSummary termSummary) {
        if ("failed_courses".equals(metric)) {
            return termSummary != null && termSummary.getFailedCourseCount() != null ? termSummary.getFailedCourseCount() : null;
        }
        if ("credits".equals(metric)) {
            if (termSummary == null || termSummary.getEarnedCredits() == null) return null;
            return termSummary.getEarnedCredits().multiply(BigDecimal.TEN).intValue();
        }
        if ("gpa".equals(metric)) {
            if (termSummary == null || termSummary.getGpa() == null) return null;
            return termSummary.getGpa().multiply(BigDecimal.valueOf(100)).intValue();
        }
        if ("unacknowledged".equals(metric)) {
            return (int) this.count(new LambdaQueryWrapper<BizWarning>()
                    .eq(BizWarning::getStudentId, studentId)
                    .eq(BizWarning::getStatus, "open")
                    .isNull(BizWarning::getAcknowledgedAt));
        }
        if ("warning_total".equals(metric)) {
            Date s = Date.from(pStart.atStartOfDay(ZONE_SHANGHAI).toInstant());
            Date e = Date.from(pEnd.plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
            return (int) this.count(new LambdaQueryWrapper<BizWarning>()
                    .eq(BizWarning::getStudentId, studentId)
                    .ge(BizWarning::getCreateTime, s)
                    .lt(BizWarning::getCreateTime, e));
        }

        int count = 0;
        for (BizDailyRecord dr : dailyRecords) {
            String recDateStr = toLocalDateStr(dr.getRecordDate());
            LocalDate recDate = LocalDate.parse(recDateStr);
            if (recDate.isBefore(pStart) || recDate.isAfter(pEnd)) {
                continue;
            }
            if (excludedDates.contains(recDateStr)) {
                continue;
            }
            boolean isAttendanceAbnormalMetric = "absent".equals(metric) || "late".equals(metric) || "early_leave".equals(metric);
            if (isAttendanceAbnormalMetric && isCoveredByApprovedLeave(recDate, approvedLeaves)) {
                continue;
            }
            if ("absent".equals(metric) && "absent".equals(dr.getAttendanceStatus())) {
                count++;
            } else if ("late".equals(metric) && "late".equals(dr.getAttendanceStatus())) {
                count++;
            } else if ("early_leave".equals(metric) && "early_leave".equals(dr.getAttendanceStatus())) {
                count++;
            } else if ("leave".equals(metric) && "leave".equals(dr.getAttendanceStatus())) {
                count++;
            } else if ("homework_not_submit".equals(metric) && "not_submit".equals(dr.getHomeworkStatus())) {
                count++;
            } else if ("homework_late_submit".equals(metric) && "late_submit".equals(dr.getHomeworkStatus())) {
                count++;
            } else if ("class_behavior".equals(metric) && "disruptive".equals(dr.getClassBehavior())) {
                count++;
            }
        }
        return count;
    }

    private boolean isCoveredByApprovedLeave(LocalDate date, List<BizLeaveRequest> leaves) {
        if (leaves.isEmpty()) return false;
        Date dayStart = Date.from(date.atStartOfDay(ZONE_SHANGHAI).toInstant());
        Date dayEnd = Date.from(date.plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
        for (BizLeaveRequest lr : leaves) {
            if (lr.getFromDate() != null && lr.getToDate() != null
                    && lr.getFromDate().before(dayEnd) && !lr.getToDate().before(dayStart)) {
                return true;
            }
        }
        return false;
    }

    private boolean isThresholdHit(String metric, int value, int threshold) {
        if ("credits".equals(metric) || "gpa".equals(metric)) {
            return value <= threshold;
        }
        return value >= threshold;
    }

    private String buildTriggerSummary(String metric, String windowType, int val, int threshold) {
        if ("gpa".equals(metric)) {
            return String.format("学期平均绩点 %.2f ≤ 阈值 %.2f", val / 100.0, threshold / 100.0);
        }
        if ("credits".equals(metric)) {
            return String.format("已获学分 %.1f ≤ 阈值 %.1f", val / 10.0, threshold / 10.0);
        }
        String winLabel = switch (StrUtil.blankToDefault(windowType, "")) {
            case "day" -> "日";
            case "week" -> "周";
            case "month" -> "月";
            case "term" -> "学期";
            default -> windowType;
        };
        String metricLabel = switch (StrUtil.blankToDefault(metric, "")) {
            case "absent" -> "缺勤";
            case "late" -> "迟到";
            case "early_leave" -> "早退";
            case "leave" -> "请假";
            case "homework_not_submit" -> "作业未交";
            case "homework_late_submit" -> "作业迟交";
            case "class_behavior" -> "课堂违纪";
            case "failed_courses" -> "挂科门数";
            case "unacknowledged" -> "未确认预警";
            case "warning_total" -> "累计预警";
            default -> metric;
        };
        return String.format("[%s/%s] 累计触发 %d 次（阈值 %d）", winLabel, metricLabel, val, threshold);
    }

    private BizWarningCurrentState findMatchingState(BizWarning warning) {
        if (warning.getPeriodStart() == null || warning.getPeriodEnd() == null) {
            return null;
        }
        return currentStateMapper.selectOne(new LambdaQueryWrapper<BizWarningCurrentState>()
                .eq(BizWarningCurrentState::getStudentId, warning.getStudentId())
                .eq(BizWarningCurrentState::getMetric, warning.getMetric())
                .eq(BizWarningCurrentState::getWindowType, warning.getWindowType())
                .eq(BizWarningCurrentState::getPeriodStart, toLocalDateStr(warning.getPeriodStart()))
                .eq(BizWarningCurrentState::getPeriodEnd, toLocalDateStr(warning.getPeriodEnd()))
                .eq(BizWarningCurrentState::getCourseKey, COURSE_KEY_ALL));
    }

    private String toLocalDateStr(Date d) {
        if (d instanceof java.sql.Date) {
            return d.toString();
        }
        return Instant.ofEpochMilli(d.getTime()).atZone(ZONE_SHANGHAI).toLocalDate().toString();
    }

    private LocalDate parseRefDate(String str) {
        if (StrUtil.isBlank(str)) {
            return LocalDate.now(ZONE_SHANGHAI);
        }
        try {
            return LocalDate.parse(StrUtil.trim(str));
        } catch (DateTimeParseException e) {
            throw new CommonException("refDate格式应为YYYY-MM-DD: {}", str);
        }
    }

    private void fillStudentNo(List<BizWarning> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizWarning::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, String> noMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, BizStudentProfile::getStudentNo, (a, b) -> a));
        for (BizWarning r : records) {
            r.setStudentNo(noMap.get(r.getStudentId()));
        }
    }
}
