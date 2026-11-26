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
package vip.xiaonuo.biz.modular.grade.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.write.style.column.LongestMatchColumnWidthStyleStrategy;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.grade.entity.BizGrade;
import vip.xiaonuo.biz.modular.grade.mapper.BizGradeMapper;
import vip.xiaonuo.biz.modular.grade.param.*;
import vip.xiaonuo.biz.modular.grade.service.BizGradeService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.common.util.CommonResponseUtil;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.io.File;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 学生成绩Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizGradeServiceImpl extends ServiceImpl<BizGradeMapper, BizGrade> implements BizGradeService {

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizCourseService bizCourseService;

    @Override
    public Page<BizGrade> page(BizGradePageParam param) {
        QueryWrapper<BizGrade> queryWrapper = new QueryWrapper<BizGrade>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>().select(BizStudentProfile::getId);
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, scope);
            List<String> allowedStudents = CollStreamUtil.toList(bizStudentProfileService.list(sw), BizStudentProfile::getId);
            if (allowedStudents.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizGrade::getStudentId, allowedStudents);
        }
        if (StrUtil.isNotBlank(param.getTermCode())) {
            queryWrapper.lambda().eq(BizGrade::getTermCode, param.getTermCode());
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizGrade::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getPassStatus())) {
            queryWrapper.lambda().eq(BizGrade::getPassStatus, param.getPassStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizGrade::getTermCode, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizGrade::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizGrade::getCreateTime);
        Page<BizGrade> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichMeta(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizGradeAddParam param) {
        BizStudentProfile student = bizStudentProfileService.queryEntity(param.getStudentId());
        BizCourse course = bizCourseService.queryEntity(param.getCourseId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "录入学生成绩");

        String termCode = StrUtil.trim(param.getTermCode());
        if (this.count(new LambdaQueryWrapper<BizGrade>()
                .eq(BizGrade::getStudentId, student.getId())
                .eq(BizGrade::getCourseId, course.getId())
                .eq(BizGrade::getTermCode, termCode)) > 0) {
            throw new CommonException("该学生在本学期该课程成绩已存在，请直接编辑");
        }
        BizGrade entity = BeanUtil.toBean(param, BizGrade.class);
        entity.setTermCode(termCode);
        entity.setPassStatus(resolvePassStatus(param.getPassStatus(), param.getScore()));
        entity.setSource(StrUtil.blankToDefault(param.getSource(), "manual"));
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizGradeEditParam param) {
        BizGrade existing = this.queryEntity(param.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(existing.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "编辑学生成绩");

        existing.setScore(param.getScore());
        existing.setGradePoint(param.getGradePoint());
        existing.setPassStatus(resolvePassStatus(param.getPassStatus(), param.getScore()));
        this.updateById(existing);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizGradeIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizGradeIdParam::getId);
        List<BizGrade> list = this.listByIds(ids);
        for (BizGrade item : list) {
            BizStudentProfile student = bizStudentProfileService.queryEntity(item.getStudentId());
            BizScopeUtil.assertOrgInScope(student.getOrgId(), "删除学生成绩");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizGrade detail(BizGradeIdParam idParam) {
        BizGrade entity = this.queryEntity(idParam.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(entity.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "查看学生成绩");
        enrichMeta(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizGrade queryEntity(String id) {
        BizGrade entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("成绩记录不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public void downloadImportTemplate(HttpServletResponse response) {
        File tempFile = null;
        try {
            BizGradeImportRow sample = new BizGradeImportRow();
            sample.setStudentNo("202600200201");
            sample.setCourseCode("CS101");
            sample.setTermCode("2026-2027-1");
            sample.setScore("86.5");
            sample.setGradePoint("3.6");
            sample.setPassStatus("pass");

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "grade_import_template.xlsx");
            EasyExcel.write(tempFile, BizGradeImportRow.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("成绩导入模板")
                    .doWrite(Collections.singletonList(sample));
            CommonDownloadUtil.download("学生成绩批量导入模板.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 生成成绩导入模板失败", e);
            try {
                CommonResponseUtil.renderError(response, "生成导入模板失败");
            } catch (Exception ignored) {
            }
        } finally {
            FileUtil.del(tempFile);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject importGrades(MultipartFile file, boolean dryRun) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传Excel文件");
        }
        List<BizGradeImportRow> rows;
        try {
            rows = EasyExcel.read(file.getInputStream(), BizGradeImportRow.class, null).sheet().doReadSync();
        } catch (Exception e) {
            throw new CommonException("解析Excel失败：{}", e.getMessage());
        }

        Map<String, BizStudentProfile> studentByNo = bizStudentProfileService.list().stream()
                .collect(Collectors.toMap(BizStudentProfile::getStudentNo, s -> s, (a, b) -> a));
        Map<String, BizCourse> courseByCode = bizCourseService.listAll(null).stream()
                .filter(c -> StrUtil.isNotBlank(c.getCourseCode()))
                .collect(Collectors.toMap(BizCourse::getCourseCode, c -> c, (a, b) -> a));

        int success = 0;
        int failed = 0;
        JSONArray errors = JSONUtil.createArray();

        for (int i = 0; i < rows.size(); i++) {
            int rowNum = i + 2;
            BizGradeImportRow row = rows.get(i);
            String studentNo = StrUtil.trim(row.getStudentNo());
            String courseCode = StrUtil.trim(row.getCourseCode());
            String termCode = StrUtil.trim(row.getTermCode());

            if (StrUtil.hasBlank(studentNo, courseCode, termCode)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学号、课程代码、学期编码均为必填"));
                continue;
            }
            BizStudentProfile student = studentByNo.get(studentNo);
            BizCourse course = courseByCode.get(courseCode);
            if (student == null || course == null) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学号或课程代码不存在：" + studentNo + " / " + courseCode));
                continue;
            }
            try {
                BizScopeUtil.assertOrgInScope(student.getOrgId(), "导入学生成绩");
            } catch (CommonException ex) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", ex.getMsg()));
                continue;
            }
            BigDecimal score = null;
            BigDecimal gpa = null;
            try {
                if (StrUtil.isNotBlank(row.getScore())) score = new BigDecimal(StrUtil.trim(row.getScore()));
                if (StrUtil.isNotBlank(row.getGradePoint())) gpa = new BigDecimal(StrUtil.trim(row.getGradePoint()));
            } catch (Exception ex) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "分数或绩点数字格式错误"));
                continue;
            }
            if (!dryRun) {
                BizGrade existing = this.getOne(new LambdaQueryWrapper<BizGrade>()
                        .eq(BizGrade::getStudentId, student.getId())
                        .eq(BizGrade::getCourseId, course.getId())
                        .eq(BizGrade::getTermCode, termCode));
                if (existing != null) {
                    existing.setScore(score);
                    existing.setGradePoint(gpa);
                    existing.setPassStatus(resolvePassStatus(row.getPassStatus(), score));
                    this.updateById(existing);
                } else {
                    BizGrade entity = new BizGrade();
                    entity.setStudentId(student.getId());
                    entity.setCourseId(course.getId());
                    entity.setTermCode(termCode);
                    entity.setScore(score);
                    entity.setGradePoint(gpa);
                    entity.setPassStatus(resolvePassStatus(row.getPassStatus(), score));
                    entity.setSource("import");
                    this.save(entity);
                }
            }
            success++;
        }

        return JSONUtil.createObj()
                .set("dryRun", dryRun)
                .set("total", rows.size())
                .set("success", success)
                .set("failed", failed)
                .set("errors", errors);
    }

    private String resolvePassStatus(String raw, BigDecimal score) {
        if (StrUtil.isNotBlank(raw)) {
            String v = StrUtil.trim(raw).toLowerCase();
            if ("pass".equals(v) || "fail".equals(v) || "unknown".equals(v)) {
                return v;
            }
        }
        if (score != null) {
            return score.compareTo(new BigDecimal("60")) >= 0 ? "pass" : "fail";
        }
        return "unknown";
    }

    private void enrichMeta(List<BizGrade> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> studentIds = records.stream().map(BizGrade::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Set<String> courseIds = records.stream().map(BizGrade::getCourseId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, BizStudentProfile> stuMap = studentIds.isEmpty() ? Collections.emptyMap()
                : bizStudentProfileService.listByIds(studentIds).stream().collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));
        Map<String, BizCourse> courseMap = courseIds.isEmpty() ? Collections.emptyMap()
                : bizCourseService.listByIds(courseIds).stream().collect(Collectors.toMap(BizCourse::getId, c -> c, (a, b) -> a));
        for (BizGrade g : records) {
            BizStudentProfile s = stuMap.get(g.getStudentId());
            if (s != null) g.setStudentNo(s.getStudentNo());
            BizCourse c = courseMap.get(g.getCourseId());
            if (c != null) g.setCourseCode(c.getCourseCode());
        }
    }
}
