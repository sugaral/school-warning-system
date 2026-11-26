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

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizClassMonitorSnapshot;
import vip.xiaonuo.biz.modular.warning.entity.BizStudentWarningSnapshot;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.mapper.BizClassMonitorSnapshotMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizStudentWarningSnapshotMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningMapper;
import vip.xiaonuo.biz.modular.warning.param.BizSummaryPageParam;
import vip.xiaonuo.biz.modular.warning.service.BizWarningSnapshotService;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 学生与班级预警快照Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizWarningSnapshotServiceImpl implements BizWarningSnapshotService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final Map<String, Integer> LEVEL_RANK = Map.of(
            "yellow", 1,
            "orange", 2,
            "red", 3,
            "severe", 4
    );

    @Resource
    private BizStudentWarningSnapshotMapper studentSnapshotMapper;

    @Resource
    private BizClassMonitorSnapshotMapper classSnapshotMapper;

    @Resource
    private BizWarningMapper bizWarningMapper;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Override
    public Page<BizStudentWarningSnapshot> studentSnapshotPage(BizSummaryPageParam param) {
        LambdaQueryWrapper<BizStudentWarningSnapshot> qw = new LambdaQueryWrapper<>();
        if (!BizScopeUtil.applyOrgScope(qw, BizStudentWarningSnapshot::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            qw.eq(BizStudentWarningSnapshot::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matched = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            if (matched.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(qw, BizStudentWarningSnapshot::getStudentId, matched);
        }
        qw.orderByDesc(BizStudentWarningSnapshot::getActiveWarningCount).orderByDesc(BizStudentWarningSnapshot::getAllWarningCount);
        Page<BizStudentWarningSnapshot> page = studentSnapshotMapper.selectPage(CommonPageRequest.defaultPage(), qw);
        if (!page.getRecords().isEmpty()) {
            Set<String> sids = page.getRecords().stream().map(BizStudentWarningSnapshot::getStudentId).collect(Collectors.toSet());
            Map<String, String> noMap = bizStudentProfileService.listByIds(sids).stream()
                    .collect(Collectors.toMap(BizStudentProfile::getId, BizStudentProfile::getStudentNo, (a, b) -> a));
            page.getRecords().forEach(r -> r.setStudentNo(noMap.get(r.getStudentId())));
        }
        return page;
    }

    @Override
    public Page<BizClassMonitorSnapshot> classSnapshotPage(BizSummaryPageParam param) {
        LambdaQueryWrapper<BizClassMonitorSnapshot> qw = new LambdaQueryWrapper<>();
        if (!BizScopeUtil.applyOrgScope(qw, BizClassMonitorSnapshot::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            qw.eq(BizClassMonitorSnapshot::getClassId, param.getClassId());
        }
        qw.orderByDesc(BizClassMonitorSnapshot::getRedWarningCount).orderByDesc(BizClassMonitorSnapshot::getWarningCount);
        return classSnapshotMapper.selectPage(CommonPageRequest.defaultPage(), qw);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void refreshStudentSnapshots(Collection<String> studentIds) {
        if (ObjectUtil.isEmpty(studentIds)) {
            return;
        }
        Set<String> cleanIds = studentIds.stream().filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (cleanIds.isEmpty()) {
            return;
        }
        List<BizStudentProfile> students = bizStudentProfileService.listByIds(cleanIds);
        if (students.isEmpty()) {
            return;
        }

        LambdaQueryWrapper<BizWarning> ww = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(ww, BizWarning::getStudentId, cleanIds);
        Map<String, List<BizWarning>> warningsByStu = bizWarningMapper.selectList(ww).stream()
                .collect(Collectors.groupingBy(BizWarning::getStudentId));

        LambdaQueryWrapper<BizStudentWarningSnapshot> sw = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(sw, BizStudentWarningSnapshot::getStudentId, cleanIds);
        Map<String, BizStudentWarningSnapshot> existingMap = studentSnapshotMapper.selectList(sw).stream()
                .collect(Collectors.toMap(BizStudentWarningSnapshot::getStudentId, s -> s, (a, b) -> a));

        LocalDate today = LocalDate.now(ZONE_SHANGHAI);
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate monthStart = today.withDayOfMonth(1);
        Date todayStart = Date.from(today.atStartOfDay(ZONE_SHANGHAI).toInstant());
        Date weekStartDate = Date.from(weekStart.atStartOfDay(ZONE_SHANGHAI).toInstant());
        Date monthStartDate = Date.from(monthStart.atStartOfDay(ZONE_SHANGHAI).toInstant());

        for (BizStudentProfile stu : students) {
            List<BizWarning> list = warningsByStu.getOrDefault(stu.getId(), Collections.emptyList());
            int todayTot = 0, weekTot = 0, monthTot = 0;
            int activeCnt = 0, closedCnt = 0;
            String activeHigh = null, closedHigh = null, allHigh = null;
            Date activeLast = null, closedLast = null, allLast = null;

            for (BizWarning w : list) {
                Date ct = w.getCreateTime();
                if (ct != null) {
                    if (!ct.before(todayStart)) todayTot++;
                    if (!ct.before(weekStartDate)) weekTot++;
                    if (!ct.before(monthStartDate)) monthTot++;
                    if (allLast == null || ct.after(allLast)) allLast = ct;
                }
                allHigh = maxLevel(allHigh, w.getLevel());
                if ("closed".equals(w.getStatus())) {
                    closedCnt++;
                    closedHigh = maxLevel(closedHigh, w.getLevel());
                    if (ct != null && (closedLast == null || ct.after(closedLast))) closedLast = ct;
                } else {
                    activeCnt++;
                    activeHigh = maxLevel(activeHigh, w.getLevel());
                    if (ct != null && (activeLast == null || ct.after(activeLast))) activeLast = ct;
                }
            }

            BizStudentWarningSnapshot snap = existingMap.get(stu.getId());
            boolean isNew = snap == null;
            if (isNew) {
                snap = new BizStudentWarningSnapshot();
                snap.setStudentId(stu.getId());
            }
            snap.setClassId(stu.getClassId());
            snap.setOrgId(stu.getOrgId());
            snap.setTodayWarningTotal(todayTot);
            snap.setWeekWarningTotal(weekTot);
            snap.setMonthWarningTotal(monthTot);
            snap.setActiveWarningCount(activeCnt);
            snap.setClosedWarningCount(closedCnt);
            snap.setAllWarningCount(list.size());
            snap.setActiveHighestLevel(activeHigh);
            snap.setClosedHighestLevel(closedHigh);
            snap.setAllHighestLevel(allHigh);
            snap.setActiveLastWarningAt(activeLast);
            snap.setClosedLastWarningAt(closedLast);
            snap.setAllLastWarningAt(allLast);
            if (isNew) {
                studentSnapshotMapper.insert(snap);
            } else {
                studentSnapshotMapper.updateById(snap);
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void refreshClassSnapshots(Collection<String> classIds) {
        if (ObjectUtil.isEmpty(classIds)) {
            return;
        }
        Set<String> cleanIds = classIds.stream().filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (cleanIds.isEmpty()) {
            return;
        }
        List<BizClass> classes = bizClassService.listByIds(cleanIds);
        if (classes.isEmpty()) {
            return;
        }

        Map<String, Integer> stuCounts = new HashMap<>();
        LambdaQueryWrapper<BizStudentProfile> spw = new LambdaQueryWrapper<BizStudentProfile>()
                .select(BizStudentProfile::getId, BizStudentProfile::getClassId)
                .eq(BizStudentProfile::getStatus, "active");
        CommonSqlUtil.safeIn(spw, BizStudentProfile::getClassId, cleanIds);
        for (BizStudentProfile sp : bizStudentProfileService.list(spw)) {
            stuCounts.merge(sp.getClassId(), 1, Integer::sum);
        }

        LambdaQueryWrapper<BizWarning> ww = new LambdaQueryWrapper<BizWarning>()
                .ne(BizWarning::getStatus, "closed");
        CommonSqlUtil.safeIn(ww, BizWarning::getClassId, cleanIds);
        Map<String, List<BizWarning>> warningsByClass = bizWarningMapper.selectList(ww).stream()
                .collect(Collectors.groupingBy(BizWarning::getClassId));

        Date now = new Date();
        LambdaQueryWrapper<BizLeaveRequest> lw = new LambdaQueryWrapper<BizLeaveRequest>()
                .eq(BizLeaveRequest::getStatus, "approved")
                .le(BizLeaveRequest::getFromDate, now)
                .ge(BizLeaveRequest::getToDate, now);
        CommonSqlUtil.safeIn(lw, BizLeaveRequest::getClassId, cleanIds);
        Map<String, Long> leaveCounts = bizLeaveRequestService.list(lw).stream()
                .collect(Collectors.groupingBy(BizLeaveRequest::getClassId, Collectors.counting()));

        LambdaQueryWrapper<BizClassMonitorSnapshot> cw = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(cw, BizClassMonitorSnapshot::getClassId, cleanIds);
        Map<String, BizClassMonitorSnapshot> existingMap = classSnapshotMapper.selectList(cw).stream()
                .collect(Collectors.toMap(BizClassMonitorSnapshot::getClassId, s -> s, (a, b) -> a));

        for (BizClass cls : classes) {
            List<BizWarning> activeWarns = warningsByClass.getOrDefault(cls.getId(), Collections.emptyList());
            int redCount = (int) activeWarns.stream()
                    .filter(w -> "red".equals(w.getLevel()) || "severe".equals(w.getLevel()))
                    .count();

            BizClassMonitorSnapshot snap = existingMap.get(cls.getId());
            boolean isNew = snap == null;
            if (isNew) {
                snap = new BizClassMonitorSnapshot();
                snap.setClassId(cls.getId());
            }
            snap.setOrgId(cls.getOrgId());
            snap.setTotalStudents(stuCounts.getOrDefault(cls.getId(), 0));
            snap.setWarningCount(activeWarns.size());
            snap.setRedWarningCount(redCount);
            snap.setLeaveCount(leaveCounts.getOrDefault(cls.getId(), 0L).intValue());
            if (isNew) {
                classSnapshotMapper.insert(snap);
            } else {
                classSnapshotMapper.updateById(snap);
            }
        }
    }

    private String maxLevel(String a, String b) {
        if (StrUtil.isBlank(b)) return a;
        if (StrUtil.isBlank(a)) return b;
        return LEVEL_RANK.getOrDefault(b, 0) > LEVEL_RANK.getOrDefault(a, 0) ? b : a;
    }
}
