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
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.grade.entity.BizGrade;
import vip.xiaonuo.biz.modular.grade.service.BizGradeService;
import vip.xiaonuo.biz.modular.schedule.entity.BizSchedule;
import vip.xiaonuo.biz.modular.schedule.service.BizScheduleService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizMonthlySummary;
import vip.xiaonuo.biz.modular.warning.entity.BizTermSummary;
import vip.xiaonuo.biz.modular.warning.entity.BizWeeklySummary;
import vip.xiaonuo.biz.modular.warning.mapper.BizMonthlySummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizTermSummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWeeklySummaryMapper;
import vip.xiaonuo.biz.modular.warning.param.BizSummaryPageParam;
import vip.xiaonuo.biz.modular.warning.param.BizSummaryRebuildParam;
import vip.xiaonuo.biz.modular.warning.service.BizSummaryService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;
import vip.xiaonuo.dev.api.DevConfigApi;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 周/月/学期汇总计算与查询Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizSummaryServiceImpl implements BizSummaryService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Resource
    private BizWeeklySummaryMapper bizWeeklySummaryMapper;

    @Resource
    private BizMonthlySummaryMapper bizMonthlySummaryMapper;

    @Resource
    private BizTermSummaryMapper bizTermSummaryMapper;

    @Resource
    private BizDailyRecordMapper bizDailyRecordMapper;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizGradeService bizGradeService;

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizScheduleService bizScheduleService;

    @Resource
    private DevConfigApi devConfigApi;

    @Resource
    private RedissonClient redissonClient;

    @Override
    public Page<BizWeeklySummary> weeklyPage(BizSummaryPageParam param) {
        List<String> allowedIds = resolveScopedStudentIds(param);
        if (allowedIds != null && allowedIds.isEmpty()) {
            return new Page<>();
        }
        LambdaQueryWrapper<BizWeeklySummary> qw = new LambdaQueryWrapper<>();
        if (allowedIds != null) {
            CommonSqlUtil.safeIn(qw, BizWeeklySummary::getStudentId, allowedIds);
        }
        qw.orderByDesc(BizWeeklySummary::getWeekStart).orderByDesc(BizWeeklySummary::getAbsentCount);
        Page<BizWeeklySummary> page = bizWeeklySummaryMapper.selectPage(CommonPageRequest.defaultPage(), qw);
        enrichStudentFields(page.getRecords(), BizWeeklySummary::getStudentId, (r, s, clsName) -> {
            r.setStudentNo(s.getStudentNo());
            r.setClassName(clsName);
        });
        return page;
    }

    @Override
    public Page<BizMonthlySummary> monthlyPage(BizSummaryPageParam param) {
        List<String> allowedIds = resolveScopedStudentIds(param);
        if (allowedIds != null && allowedIds.isEmpty()) {
            return new Page<>();
        }
        LambdaQueryWrapper<BizMonthlySummary> qw = new LambdaQueryWrapper<>();
        if (allowedIds != null) {
            CommonSqlUtil.safeIn(qw, BizMonthlySummary::getStudentId, allowedIds);
        }
        if (param.getYear() != null) {
            qw.eq(BizMonthlySummary::getYear, param.getYear());
        }
        if (param.getMonth() != null) {
            qw.eq(BizMonthlySummary::getMonth, param.getMonth());
        }
        qw.orderByDesc(BizMonthlySummary::getYear).orderByDesc(BizMonthlySummary::getMonth)
                .orderByDesc(BizMonthlySummary::getAbsentCount);
        Page<BizMonthlySummary> page = bizMonthlySummaryMapper.selectPage(CommonPageRequest.defaultPage(), qw);
        enrichStudentFields(page.getRecords(), BizMonthlySummary::getStudentId, (r, s, clsName) -> {
            r.setStudentNo(s.getStudentNo());
            r.setClassName(clsName);
        });
        return page;
    }

    @Override
    public Page<BizTermSummary> termPage(BizSummaryPageParam param) {
        List<String> allowedIds = resolveScopedStudentIds(param);
        if (allowedIds != null && allowedIds.isEmpty()) {
            return new Page<>();
        }
        LambdaQueryWrapper<BizTermSummary> qw = new LambdaQueryWrapper<>();
        if (allowedIds != null) {
            CommonSqlUtil.safeIn(qw, BizTermSummary::getStudentId, allowedIds);
        }
        if (StrUtil.isNotBlank(param.getTermCode())) {
            qw.eq(BizTermSummary::getTermCode, StrUtil.trim(param.getTermCode()));
        }
        qw.orderByDesc(BizTermSummary::getTermCode).orderByDesc(BizTermSummary::getFailedCourseCount);
        Page<BizTermSummary> page = bizTermSummaryMapper.selectPage(CommonPageRequest.defaultPage(), qw);
        enrichStudentFields(page.getRecords(), BizTermSummary::getStudentId, (r, s, clsName) -> {
            r.setStudentNo(s.getStudentNo());
            r.setClassName(clsName);
        });
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject rebuildAll(BizSummaryRebuildParam param) {
        LocalDate ref = parseRefDate(param.getRefDate());
        String termCode = resolveActiveTermCode(param.getTermCode());

        int weekly = rebuildWeeklySummary(ref);
        int monthly = rebuildMonthlySummary(ref.getYear(), ref.getMonthValue());
        int term = StrUtil.isNotBlank(termCode) ? rebuildTermSummary(termCode) : 0;

        return new JSONObject()
                .set("refDate", ref.toString())
                .set("termCode", termCode)
                .set("weeklyUpserted", weekly)
                .set("monthlyUpserted", monthly)
                .set("termUpserted", term);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public int rebuildWeeklySummary(LocalDate referenceDate) {
        LocalDate anchor = referenceDate != null ? referenceDate : LocalDate.now(ZONE_SHANGHAI);
        LocalDate weekStart = anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate weekEnd = weekStart.plusDays(6);
        String startStr = weekStart.toString();
        String endStr = weekEnd.toString();

        RLock lock = redissonClient.getLock("lock:summary:weekly:" + startStr);
        boolean locked = false;
        try {
            locked = lock.tryLock(2, 60, TimeUnit.SECONDS);
            if (!locked) {
                return 0;
            }
            List<BizDailyRecord> records = bizDailyRecordMapper.selectList(
                    new LambdaQueryWrapper<BizDailyRecord>()
                            .ge(BizDailyRecord::getRecordDate, startStr)
                            .le(BizDailyRecord::getRecordDate, endStr));
            if (records.isEmpty()) {
                return 0;
            }
            Map<String, int[]> agg = aggregateDaily(records);
            Date wsDate = java.sql.Date.valueOf(weekStart);
            Date weDate = java.sql.Date.valueOf(weekEnd);
            Date now = new Date();
            int count = 0;
            for (Map.Entry<String, int[]> e : agg.entrySet()) {
                int[] counts = e.getValue();
                BizWeeklySummary existing = bizWeeklySummaryMapper.selectOne(new LambdaQueryWrapper<BizWeeklySummary>()
                        .eq(BizWeeklySummary::getStudentId, e.getKey())
                        .eq(BizWeeklySummary::getWeekStart, startStr));
                if (existing == null) {
                    BizWeeklySummary item = new BizWeeklySummary();
                    item.setStudentId(e.getKey());
                    item.setWeekStart(wsDate);
                    item.setWeekEnd(weDate);
                    item.setLateCount(counts[0]);
                    item.setAbsentCount(counts[1]);
                    item.setHomeworkNotSubmitCount(counts[2]);
                    item.setGeneratedAt(now);
                    bizWeeklySummaryMapper.insert(item);
                } else {
                    existing.setWeekEnd(weDate);
                    existing.setLateCount(counts[0]);
                    existing.setAbsentCount(counts[1]);
                    existing.setHomeworkNotSubmitCount(counts[2]);
                    existing.setGeneratedAt(now);
                    bizWeeklySummaryMapper.updateById(existing);
                }
                count++;
            }
            return count;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return 0;
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public int rebuildMonthlySummary(int year, int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        LocalDate end = start.withDayOfMonth(start.lengthOfMonth());
        RLock lock = redissonClient.getLock("lock:summary:monthly:" + year + "-" + month);
        boolean locked = false;
        try {
            locked = lock.tryLock(2, 60, TimeUnit.SECONDS);
            if (!locked) {
                return 0;
            }
            List<BizDailyRecord> records = bizDailyRecordMapper.selectList(
                    new LambdaQueryWrapper<BizDailyRecord>()
                            .ge(BizDailyRecord::getRecordDate, start.toString())
                            .le(BizDailyRecord::getRecordDate, end.toString()));
            if (records.isEmpty()) {
                return 0;
            }
            Map<String, int[]> agg = aggregateDaily(records);
            Date now = new Date();
            int count = 0;
            for (Map.Entry<String, int[]> e : agg.entrySet()) {
                int[] counts = e.getValue();
                BizMonthlySummary existing = bizMonthlySummaryMapper.selectOne(new LambdaQueryWrapper<BizMonthlySummary>()
                        .eq(BizMonthlySummary::getStudentId, e.getKey())
                        .eq(BizMonthlySummary::getYear, year)
                        .eq(BizMonthlySummary::getMonth, month));
                if (existing == null) {
                    BizMonthlySummary item = new BizMonthlySummary();
                    item.setStudentId(e.getKey());
                    item.setYear(year);
                    item.setMonth(month);
                    item.setLateCount(counts[0]);
                    item.setAbsentCount(counts[1]);
                    item.setHomeworkNotSubmitCount(counts[2]);
                    item.setGeneratedAt(now);
                    bizMonthlySummaryMapper.insert(item);
                } else {
                    existing.setLateCount(counts[0]);
                    existing.setAbsentCount(counts[1]);
                    existing.setHomeworkNotSubmitCount(counts[2]);
                    existing.setGeneratedAt(now);
                    bizMonthlySummaryMapper.updateById(existing);
                }
                count++;
            }
            return count;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return 0;
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public int rebuildTermSummary(String termCode) {
        if (StrUtil.isBlank(termCode)) {
            return 0;
        }
        String cleanTerm = StrUtil.trim(termCode);
        RLock lock = redissonClient.getLock("lock:summary:term:" + cleanTerm);
        boolean locked = false;
        try {
            locked = lock.tryLock(2, 60, TimeUnit.SECONDS);
            if (!locked) {
                return 0;
            }
            List<BizGrade> grades = bizGradeService.list(
                    new LambdaQueryWrapper<BizGrade>().eq(BizGrade::getTermCode, cleanTerm));
            if (grades.isEmpty()) {
                return 0;
            }
            Set<String> courseIds = grades.stream().map(BizGrade::getCourseId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
            Map<String, BigDecimal> creditMap = courseIds.isEmpty() ? Collections.emptyMap() :
                    bizCourseService.listByIds(courseIds).stream()
                            .collect(Collectors.toMap(BizCourse::getId,
                                    c -> c.getCredit() != null ? c.getCredit() : BigDecimal.ZERO, (a, b) -> a));
            BigDecimal requiredCredits = resolveRequiredCredits();
            Map<String, List<BizGrade>> byStudent = grades.stream().collect(Collectors.groupingBy(BizGrade::getStudentId));
            Date now = new Date();
            int count = 0;
            for (Map.Entry<String, List<BizGrade>> e : byStudent.entrySet()) {
                int failed = 0;
                BigDecimal earned = BigDecimal.ZERO;
                BigDecimal gpSum = BigDecimal.ZERO;
                BigDecimal gpCredits = BigDecimal.ZERO;
                for (BizGrade g : e.getValue()) {
                    BigDecimal credit = creditMap.getOrDefault(g.getCourseId(), BigDecimal.ZERO);
                    if ("fail".equals(g.getPassStatus())) {
                        failed++;
                    } else if ("pass".equals(g.getPassStatus())) {
                        earned = earned.add(credit);
                    }
                    if (g.getGradePoint() != null && credit.compareTo(BigDecimal.ZERO) > 0) {
                        gpSum = gpSum.add(g.getGradePoint().multiply(credit));
                        gpCredits = gpCredits.add(credit);
                    }
                }
                BigDecimal gpa = gpCredits.compareTo(BigDecimal.ZERO) > 0
                        ? gpSum.divide(gpCredits, 2, RoundingMode.HALF_UP)
                        : null;
                BigDecimal earnedRounded = earned.setScale(1, RoundingMode.HALF_UP);

                BizTermSummary existing = bizTermSummaryMapper.selectOne(new LambdaQueryWrapper<BizTermSummary>()
                        .eq(BizTermSummary::getStudentId, e.getKey())
                        .eq(BizTermSummary::getTermCode, cleanTerm));
                if (existing == null) {
                    BizTermSummary item = new BizTermSummary();
                    item.setStudentId(e.getKey());
                    item.setTermCode(cleanTerm);
                    item.setFailedCourseCount(failed);
                    item.setEarnedCredits(earnedRounded);
                    item.setRequiredCredits(requiredCredits);
                    item.setGpa(gpa);
                    item.setGeneratedAt(now);
                    bizTermSummaryMapper.insert(item);
                } else {
                    existing.setFailedCourseCount(failed);
                    existing.setEarnedCredits(earnedRounded);
                    existing.setRequiredCredits(requiredCredits);
                    existing.setGpa(gpa);
                    existing.setGeneratedAt(now);
                    bizTermSummaryMapper.updateById(existing);
                }
                count++;
            }
            return count;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return 0;
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Override
    public String resolveActiveTermCode(String requestedTermCode) {
        if (StrUtil.isNotBlank(requestedTermCode)) {
            return StrUtil.trim(requestedTermCode);
        }
        BizGrade latestGrade = bizGradeService.getOne(new LambdaQueryWrapper<BizGrade>()
                .select(BizGrade::getTermCode)
                .orderByDesc(BizGrade::getTermCode)
                .last("LIMIT 1"));
        if (latestGrade != null && StrUtil.isNotBlank(latestGrade.getTermCode())) {
            return latestGrade.getTermCode();
        }
        BizSchedule latestSchedule = bizScheduleService.getOne(new LambdaQueryWrapper<BizSchedule>()
                .select(BizSchedule::getTermCode)
                .orderByDesc(BizSchedule::getTermCode)
                .last("LIMIT 1"));
        return latestSchedule != null ? latestSchedule.getTermCode() : "2025-2026-1";
    }

    private Map<String, int[]> aggregateDaily(List<BizDailyRecord> records) {
        Map<String, int[]> agg = new HashMap<>();
        for (BizDailyRecord r : records) {
            int[] arr = agg.computeIfAbsent(r.getStudentId(), k -> new int[3]);
            if ("late".equals(r.getAttendanceStatus())) {
                arr[0]++;
            } else if ("absent".equals(r.getAttendanceStatus())) {
                arr[1]++;
            }
            if ("not_submit".equals(r.getHomeworkStatus())) {
                arr[2]++;
            }
        }
        return agg;
    }

    private BigDecimal resolveRequiredCredits() {
        try {
            String raw = devConfigApi.getValueByKey("WARNSYS_TEACHING");
            if (StrUtil.isNotBlank(raw) && JSONUtil.isTypeJSONObject(raw)) {
                BigDecimal val = JSONUtil.parseObj(raw).getBigDecimal("requiredCredits", BigDecimal.ZERO);
                if (val != null && val.compareTo(BigDecimal.ZERO) >= 0) {
                    return val.setScale(1, RoundingMode.HALF_UP);
                }
            }
        } catch (Exception e) {
            log.debug("读取 WARNSYS_TEACHING.requiredCredits 失败，使用0", e);
        }
        return BigDecimal.ZERO.setScale(1, RoundingMode.HALF_UP);
    }

    private LocalDate parseRefDate(String refDateStr) {
        if (StrUtil.isBlank(refDateStr)) {
            return LocalDate.now(ZONE_SHANGHAI);
        }
        try {
            return LocalDate.parse(StrUtil.trim(refDateStr));
        } catch (DateTimeParseException e) {
            throw new CommonException("refDate格式应为YYYY-MM-DD: {}", refDateStr);
        }
    }

    private List<String> resolveScopedStudentIds(BizSummaryPageParam param) {
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return Collections.emptyList();
        }
        boolean hasFilter = ObjectUtil.isNotEmpty(scope) || StrUtil.isNotBlank(param.getClassId()) || StrUtil.isNotBlank(param.getSearchKey());
        if (!hasFilter) {
            return null;
        }
        LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>().select(BizStudentProfile::getId);
        if (ObjectUtil.isNotEmpty(scope)) {
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, scope);
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            sw.eq(BizStudentProfile::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            sw.and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key));
        }
        return CollStreamUtil.toList(bizStudentProfileService.list(sw), BizStudentProfile::getId);
    }

    @FunctionalInterface
    private interface StudentSetter<T> {
        void accept(T record, BizStudentProfile student, String className);
    }

    private <T> void enrichStudentFields(List<T> records, java.util.function.Function<T, String> idFn, StudentSetter<T> setter) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(idFn).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, BizStudentProfile> stuMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));
        Set<String> cids = stuMap.values().stream().map(BizStudentProfile::getClassId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, String> classMap = cids.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(cids).stream()
                        .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));
        for (T r : records) {
            BizStudentProfile stu = stuMap.get(idFn.apply(r));
            if (stu != null) {
                setter.accept(r, stu, classMap.get(stu.getClassId()));
            }
        }
    }
}
