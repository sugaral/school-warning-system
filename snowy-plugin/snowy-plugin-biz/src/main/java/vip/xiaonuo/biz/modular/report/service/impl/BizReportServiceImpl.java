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
package vip.xiaonuo.biz.modular.report.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.write.style.column.LongestMatchColumnWidthStyleStrategy;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.auth.core.pojo.SaBaseLoginUser;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.report.entity.BizExportJob;
import vip.xiaonuo.biz.modular.report.excel.ReportExcelRows;
import vip.xiaonuo.biz.modular.report.mapper.BizExportJobMapper;
import vip.xiaonuo.biz.modular.report.param.BizExportCreateParam;
import vip.xiaonuo.biz.modular.report.param.BizExportIdParam;
import vip.xiaonuo.biz.modular.report.param.BizExportJobPageParam;
import vip.xiaonuo.biz.modular.report.service.BizReportService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizMonthlySummary;
import vip.xiaonuo.biz.modular.warning.entity.BizTermSummary;
import vip.xiaonuo.biz.modular.warning.entity.BizWeeklySummary;
import vip.xiaonuo.biz.modular.warning.mapper.BizMonthlySummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizTermSummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWeeklySummaryMapper;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.common.util.CommonSqlUtil;
import vip.xiaonuo.dev.api.DevConfigApi;
import vip.xiaonuo.dev.api.DevFileApi;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * EasyExcel 报表导出服务实现
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizReportServiceImpl extends ServiceImpl<BizExportJobMapper, BizExportJob>
        implements BizReportService {

    private static final Set<String> VALID_REPORT_TYPES = Set.of(
            "daily", "weekly", "monthly", "semester", "student_accounts");
    private static final Set<String> VALID_SCOPE_TYPES = Set.of("school", "org", "class");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizDailyRecordMapper dailyRecordMapper;

    @Resource
    private BizWeeklySummaryMapper weeklySummaryMapper;

    @Resource
    private BizMonthlySummaryMapper monthlySummaryMapper;

    @Resource
    private BizTermSummaryMapper termSummaryMapper;

    @Resource
    private DevFileApi devFileApi;

    @Resource
    private DevConfigApi devConfigApi;

    @Override
    public Page<BizExportJob> page(BizExportJobPageParam param) {
        LambdaQueryWrapper<BizExportJob> qw = new LambdaQueryWrapper<>();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizClass> cw = new LambdaQueryWrapper<BizClass>().select(BizClass::getId);
            CommonSqlUtil.safeIn(cw, BizClass::getOrgId, scope);
            List<String> allowedClassIds = CollStreamUtil.toList(bizClassService.list(cw), BizClass::getId);
            String uid = StpUtil.getLoginIdAsString();
            qw.and(w -> {
                w.eq(BizExportJob::getCreatorUserId, uid)
                        .or(sub -> sub.eq(BizExportJob::getScopeType, "org").in(BizExportJob::getScopeId, scope));
                if (!allowedClassIds.isEmpty()) {
                    w.or(sub -> sub.eq(BizExportJob::getScopeType, "class").in(BizExportJob::getScopeId, allowedClassIds));
                }
            });
        }
        if (StrUtil.isNotBlank(param.getReportType())) {
            qw.eq(BizExportJob::getReportType, param.getReportType());
        }
        if (StrUtil.isNotBlank(param.getScopeType())) {
            qw.eq(BizExportJob::getScopeType, param.getScopeType());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            qw.eq(BizExportJob::getStatus, param.getStatus());
        }
        qw.orderByDesc(BizExportJob::getCreateTime);
        Page<BizExportJob> page = this.page(CommonPageRequest.defaultPage(), qw);
        for (BizExportJob job : page.getRecords()) {
            if (StrUtil.isNotBlank(job.getFileId())) {
                JSONObject fi = devFileApi.getFileInfoById(job.getFileId());
                if (fi != null && StrUtil.isNotBlank(fi.getStr("name"))) {
                    job.setFileName(fi.getStr("name"));
                }
            }
        }
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject createAndRun(BizExportCreateParam param) {
        String reportType = StrUtil.trim(param.getReportType());
        if (!VALID_REPORT_TYPES.contains(reportType)) {
            throw new CommonException("不支持的报表类型: {}", reportType);
        }
        List<String> dataScope = BizScopeUtil.getDataScope();
        String scopeType = StrUtil.isNotBlank(param.getScopeType())
                ? StrUtil.trim(param.getScopeType())
                : (dataScope == null ? "school" : "org");
        if (!VALID_SCOPE_TYPES.contains(scopeType)) {
            throw new CommonException("不支持的范围类型: {}", scopeType);
        }

        String scopeId = StrUtil.trim(param.getScopeId());
        if ("school".equals(scopeType)) {
            if (dataScope != null) {
                throw new CommonException("仅全校权限角色可发起全校范围报表导出");
            }
            scopeId = null;
        } else if ("org".equals(scopeType)) {
            if (StrUtil.isBlank(scopeId)) {
                SaBaseLoginUser u = StpLoginUserUtil.getLoginUser();
                String candidateOrgId = ObjectUtil.isNotEmpty(dataScope) ? dataScope.get(0) : (u != null ? u.getOrgId() : null);
                if (StrUtil.isNotBlank(candidateOrgId)) {
                    BizOrg orgEntity = bizOrgService.getById(candidateOrgId);
                    if (orgEntity != null && !"0".equals(orgEntity.getParentId())) {
                        scopeId = candidateOrgId;
                    }
                }
                if (StrUtil.isBlank(scopeId)) {
                    List<BizOrg> colleges = bizOrgService.list(new LambdaQueryWrapper<BizOrg>()
                            .ne(BizOrg::getParentId, "0")
                            .orderByAsc(BizOrg::getSortCode, BizOrg::getId)
                            .last("LIMIT 1"));
                    if (!colleges.isEmpty()) {
                        scopeId = colleges.get(0).getId();
                    }
                }
            }
            if (StrUtil.isBlank(scopeId)) {
                throw new CommonException("学院范围导出必须指定 scopeId");
            }
            BizScopeUtil.assertOrgInScope(scopeId, "导出指定学院报表");
        } else {
            if (StrUtil.isBlank(scopeId)) {
                throw new CommonException("班级范围导出必须指定 classId");
            }
            BizClass cls = bizClassService.queryEntity(scopeId);
            BizScopeUtil.assertOrgInScope(cls.getOrgId(), "导出指定班级报表");
        }

        JSONObject paramsJson = param.getParams() != null ? new JSONObject(param.getParams()) : new JSONObject();
        BizExportJob job = new BizExportJob();
        job.setCreatorUserId(StpUtil.getLoginIdAsString());
        job.setScopeType(scopeType);
        job.setScopeId(scopeId);
        job.setReportType(reportType);
        job.setParamsJson(paramsJson.toString());
        job.setStatus("processing");
        this.save(job);

        try {
            List<BizStudentProfile> students = loadScopedStudents(scopeType, scopeId, dataScope);
            Map<String, BizStudentProfile> stuMap = students.stream()
                    .collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));
            Map<String, String> classNames = bizClassService.list().stream()
                    .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));
            Map<String, String> orgNames = bizOrgService.list().stream()
                    .collect(Collectors.toMap(BizOrg::getId, BizOrg::getName, (a, b) -> a));

            String ts = LocalDateTime.now(ZoneId.of("Asia/Shanghai")).format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
            String fileName = "warnsys_" + reportType + "_" + ts + ".xlsx";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int rowCount;

            if ("daily".equals(reportType)) {
                rowCount = writeDailyExcel(out, students, stuMap, classNames, paramsJson);
            } else if ("weekly".equals(reportType)) {
                rowCount = writeWeeklyExcel(out, students, stuMap, classNames);
            } else if ("monthly".equals(reportType)) {
                rowCount = writeMonthlyExcel(out, students, stuMap, classNames);
            } else if ("semester".equals(reportType)) {
                rowCount = writeSemesterExcel(out, students, stuMap, classNames, paramsJson.getStr("termCode"));
            } else {
                rowCount = writeStudentAccountsExcel(out, students, orgNames, classNames);
            }

            byte[] bytes = out.toByteArray();
            String fileEngine = resolveFileEngine();
            String fileId;
            try {
                fileId = devFileApi.storageStreamReturnId(fileEngine, new ByteArrayInputStream(bytes), fileName, (long) bytes.length);
            } catch (Exception storageEx) {
                if (!"LOCAL".equalsIgnoreCase(fileEngine)) {
                    fileId = devFileApi.storageStreamReturnId("LOCAL", new ByteArrayInputStream(bytes), fileName, (long) bytes.length);
                } else {
                    throw storageEx;
                }
            }

            job.setStatus("completed");
            job.setFileId(fileId);
            job.setExtJson(new JSONObject().set("rowCount", rowCount).set("fileName", fileName).toString());
            this.updateById(job);

            return new JSONObject()
                    .set("id", job.getId())
                    .set("fileId", fileId)
                    .set("fileName", fileName)
                    .set("rowCount", rowCount)
                    .set("status", "completed");
        } catch (Exception e) {
            job.setStatus("failed");
            job.setErrorMsg(StrUtil.maxLength(e.getMessage(), 240));
            this.updateById(job);
            throw new CommonException("报表导出失败：{}", e.getMessage());
        }
    }

    @Override
    public void download(String id, HttpServletResponse response) {
        BizExportJob job = this.getById(id);
        if (job == null) {
            throw new CommonException("导出任务不存在");
        }
        assertJobInScope(job, "下载导出报表");
        if (StrUtil.isBlank(job.getFileId())) {
            throw new CommonException("该导出任务尚未生成可下载文件");
        }
        JSONObject fi = devFileApi.getFileInfoById(job.getFileId());
        if (fi == null || StrUtil.isBlank(fi.getStr("id"))) {
            throw new CommonException("关联底座文件不存在或已被清理");
        }
        byte[] bytes;
        try {
            if ("LOCAL".equalsIgnoreCase(fi.getStr("engine")) && StrUtil.isNotBlank(fi.getStr("storagePath"))) {
                java.io.File localFile = FileUtil.file(fi.getStr("storagePath"));
                if (!FileUtil.isFile(localFile)) {
                    throw new CommonException("导出报表本地文件不存在");
                }
                bytes = FileUtil.readBytes(localFile);
            } else {
                String key = StrUtil.blankToDefault(fi.getStr("fileKey"),
                        StrUtil.blankToDefault(fi.getStr("objName"), fi.getStr("storagePath")));
                bytes = devFileApi.getFileBytes(fi.getStr("engine"), fi.getStr("bucket"), key);
            }
        } catch (CommonException ce) {
            throw ce;
        } catch (Exception ex) {
            throw new CommonException("读取报表存储文件失败：{}", ex.getMessage());
        }
        String fileName = StrUtil.blankToDefault(fi.getStr("name"), job.getReportType() + ".xlsx");
        CommonDownloadUtil.download(fileName, bytes, response);
    }

    private String resolveFileEngine() {
        try {
            String engine = devConfigApi.getValueByKey("SNOWY_SYS_DEFAULT_FILE_ENGINE");
            if (StrUtil.isNotBlank(engine)) {
                return StrUtil.trim(engine);
            }
        } catch (Exception ignored) {
        }
        return "MINIO";
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizExportIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizExportIdParam::getId);
        List<BizExportJob> jobs = this.listByIds(ids);
        for (BizExportJob job : jobs) {
            assertJobInScope(job, "删除导出任务");
        }
        this.removeByIds(ids);
    }

    private void assertJobInScope(BizExportJob job, String actionDesc) {
        List<String> scope = BizScopeUtil.getDataScope();
        if (scope == null) return;
        if ("school".equals(job.getScopeType())) {
            throw new CommonException("您没有权限{}", actionDesc);
        }
        if ("org".equals(job.getScopeType())) {
            BizScopeUtil.assertOrgInScope(job.getScopeId(), actionDesc);
        } else if ("class".equals(job.getScopeType()) && StrUtil.isNotBlank(job.getScopeId())) {
            BizClass cls = bizClassService.getById(job.getScopeId());
            if (cls != null) {
                BizScopeUtil.assertOrgInScope(cls.getOrgId(), actionDesc);
            }
        }
    }

    private List<BizStudentProfile> loadScopedStudents(String scopeType, String scopeId, List<String> dataScope) {
        LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<>();
        if ("class".equals(scopeType)) {
            sw.eq(BizStudentProfile::getClassId, scopeId);
        } else if ("org".equals(scopeType)) {
            sw.eq(BizStudentProfile::getOrgId, scopeId);
        } else if (ObjectUtil.isNotEmpty(dataScope)) {
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, dataScope);
        }
        return bizStudentProfileService.list(sw);
    }

    private int writeDailyExcel(ByteArrayOutputStream out, List<BizStudentProfile> students,
                              Map<String, BizStudentProfile> stuMap, Map<String, String> classNames, JSONObject params) {
        Set<String> sids = CollStreamUtil.toSet(students, BizStudentProfile::getId);
        List<BizDailyRecord> list = Collections.emptyList();
        if (!sids.isEmpty()) {
            LambdaQueryWrapper<BizDailyRecord> qw = new LambdaQueryWrapper<>();
            CommonSqlUtil.safeIn(qw, BizDailyRecord::getStudentId, sids);
            if (StrUtil.isNotBlank(params.getStr("startDate"))) {
                qw.ge(BizDailyRecord::getRecordDate, params.getStr("startDate"));
            }
            if (StrUtil.isNotBlank(params.getStr("endDate"))) {
                qw.le(BizDailyRecord::getRecordDate, params.getStr("endDate"));
            }
            qw.orderByDesc(BizDailyRecord::getRecordDate).last("LIMIT 50000");
            list = dailyRecordMapper.selectList(qw);
        }
        Map<String, String> courseNames = bizCourseService.list().stream()
                .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
        List<ReportExcelRows.DailyRow> rows = new ArrayList<>();
        for (BizDailyRecord dr : list) {
            BizStudentProfile stu = stuMap.get(dr.getStudentId());
            ReportExcelRows.DailyRow r = new ReportExcelRows.DailyRow();
            r.setRecordDate(dr.getRecordDate() != null ? sdf.format(dr.getRecordDate()) : "");
            r.setStudentNo(stu != null ? stu.getStudentNo() : "");
            r.setStudentName(stu != null ? stu.getName() : dr.getStudentId());
            r.setClassName(classNames.getOrDefault(dr.getClassId(), ""));
            r.setCourseName(courseNames.getOrDefault(dr.getCourseId(), ""));
            r.setAttendanceStatus(dr.getAttendanceStatus());
            r.setHomeworkStatus(dr.getHomeworkStatus());
            r.setClassBehavior(dr.getClassBehavior());
            r.setSource(dr.getSource());
            rows.add(r);
        }
        EasyExcel.write(out, ReportExcelRows.DailyRow.class)
                .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                .sheet("日常考勤与表现")
                .doWrite(rows);
        return rows.size();
    }

    private int writeWeeklyExcel(ByteArrayOutputStream out, List<BizStudentProfile> students,
                               Map<String, BizStudentProfile> stuMap, Map<String, String> classNames) {
        Set<String> sids = CollStreamUtil.toSet(students, BizStudentProfile::getId);
        List<BizWeeklySummary> list = Collections.emptyList();
        if (!sids.isEmpty()) {
            LambdaQueryWrapper<BizWeeklySummary> qw = new LambdaQueryWrapper<>();
            CommonSqlUtil.safeIn(qw, BizWeeklySummary::getStudentId, sids);
            qw.orderByDesc(BizWeeklySummary::getWeekStart).last("LIMIT 50000");
            list = weeklySummaryMapper.selectList(qw);
        }
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
        List<ReportExcelRows.WeeklyRow> rows = new ArrayList<>();
        for (BizWeeklySummary ws : list) {
            BizStudentProfile stu = stuMap.get(ws.getStudentId());
            ReportExcelRows.WeeklyRow r = new ReportExcelRows.WeeklyRow();
            r.setStudentNo(stu != null ? stu.getStudentNo() : "");
            r.setStudentName(stu != null ? stu.getName() : "");
            r.setClassName(stu != null ? classNames.getOrDefault(stu.getClassId(), "") : "");
            r.setWeekStart(ws.getWeekStart() != null ? sdf.format(ws.getWeekStart()) : "");
            r.setWeekEnd(ws.getWeekEnd() != null ? sdf.format(ws.getWeekEnd()) : "");
            r.setAbsentCount(ws.getAbsentCount());
            r.setLateCount(ws.getLateCount());
            r.setHomeworkNotSubmitCount(ws.getHomeworkNotSubmitCount());
            rows.add(r);
        }
        EasyExcel.write(out, ReportExcelRows.WeeklyRow.class)
                .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                .sheet("周度汇总")
                .doWrite(rows);
        return rows.size();
    }

    private int writeMonthlyExcel(ByteArrayOutputStream out, List<BizStudentProfile> students,
                                Map<String, BizStudentProfile> stuMap, Map<String, String> classNames) {
        Set<String> sids = CollStreamUtil.toSet(students, BizStudentProfile::getId);
        List<BizMonthlySummary> list = Collections.emptyList();
        if (!sids.isEmpty()) {
            LambdaQueryWrapper<BizMonthlySummary> qw = new LambdaQueryWrapper<>();
            CommonSqlUtil.safeIn(qw, BizMonthlySummary::getStudentId, sids);
            qw.orderByDesc(BizMonthlySummary::getYear).orderByDesc(BizMonthlySummary::getMonth).last("LIMIT 50000");
            list = monthlySummaryMapper.selectList(qw);
        }
        List<ReportExcelRows.MonthlyRow> rows = new ArrayList<>();
        for (BizMonthlySummary ms : list) {
            BizStudentProfile stu = stuMap.get(ms.getStudentId());
            ReportExcelRows.MonthlyRow r = new ReportExcelRows.MonthlyRow();
            r.setStudentNo(stu != null ? stu.getStudentNo() : "");
            r.setStudentName(stu != null ? stu.getName() : "");
            r.setClassName(stu != null ? classNames.getOrDefault(stu.getClassId(), "") : "");
            r.setYear(ms.getYear());
            r.setMonth(ms.getMonth());
            r.setAbsentCount(ms.getAbsentCount());
            r.setLateCount(ms.getLateCount());
            r.setHomeworkNotSubmitCount(ms.getHomeworkNotSubmitCount());
            rows.add(r);
        }
        EasyExcel.write(out, ReportExcelRows.MonthlyRow.class)
                .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                .sheet("月度汇总")
                .doWrite(rows);
        return rows.size();
    }

    private int writeSemesterExcel(ByteArrayOutputStream out, List<BizStudentProfile> students,
                                 Map<String, BizStudentProfile> stuMap, Map<String, String> classNames, String termCode) {
        Set<String> sids = CollStreamUtil.toSet(students, BizStudentProfile::getId);
        List<BizTermSummary> list = Collections.emptyList();
        if (!sids.isEmpty()) {
            LambdaQueryWrapper<BizTermSummary> qw = new LambdaQueryWrapper<>();
            CommonSqlUtil.safeIn(qw, BizTermSummary::getStudentId, sids);
            if (StrUtil.isNotBlank(termCode)) {
                qw.eq(BizTermSummary::getTermCode, termCode);
            }
            qw.orderByDesc(BizTermSummary::getGeneratedAt).last("LIMIT 50000");
            list = termSummaryMapper.selectList(qw);
        }
        List<ReportExcelRows.SemesterRow> rows = new ArrayList<>();
        for (BizTermSummary ts : list) {
            BizStudentProfile stu = stuMap.get(ts.getStudentId());
            ReportExcelRows.SemesterRow r = new ReportExcelRows.SemesterRow();
            r.setTermCode(ts.getTermCode());
            r.setStudentNo(stu != null ? stu.getStudentNo() : "");
            r.setStudentName(stu != null ? stu.getName() : "");
            r.setClassName(stu != null ? classNames.getOrDefault(stu.getClassId(), "") : "");
            r.setFailedCourseCount(ts.getFailedCourseCount());
            r.setEarnedCredits(ts.getEarnedCredits() != null ? ts.getEarnedCredits().toPlainString() : "0");
            r.setRequiredCredits(ts.getRequiredCredits() != null ? ts.getRequiredCredits().toPlainString() : "0");
            r.setGpa(ts.getGpa() != null ? ts.getGpa().toPlainString() : "0");
            rows.add(r);
        }
        EasyExcel.write(out, ReportExcelRows.SemesterRow.class)
                .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                .sheet("学期学业汇总")
                .doWrite(rows);
        return rows.size();
    }

    private int writeStudentAccountsExcel(ByteArrayOutputStream out, List<BizStudentProfile> students,
                                        Map<String, String> orgNames, Map<String, String> classNames) {
        List<ReportExcelRows.StudentAccountRow> rows = new ArrayList<>();
        for (BizStudentProfile stu : students) {
            ReportExcelRows.StudentAccountRow r = new ReportExcelRows.StudentAccountRow();
            r.setStudentNo(stu.getStudentNo());
            r.setStudentName(stu.getName());
            r.setOrgName(orgNames.getOrDefault(stu.getOrgId(), ""));
            r.setClassName(classNames.getOrDefault(stu.getClassId(), ""));
            r.setMajor(stu.getMajor());
            r.setEnrollYear(stu.getEnrollYear());
            r.setStatus(stu.getStatus());
            r.setInitialPassword(StrUtil.blankToDefault(stu.getInitialPassword(), "(已修改或未设置)"));
            rows.add(r);
        }
        EasyExcel.write(out, ReportExcelRows.StudentAccountRow.class)
                .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                .sheet("学生账号单")
                .doWrite(rows);
        return rows.size();
    }
}
