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
package vip.xiaonuo.biz.modular.courseclass.service.impl;

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
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.courseclass.entity.BizCourseClass;
import vip.xiaonuo.biz.modular.courseclass.mapper.BizCourseClassMapper;
import vip.xiaonuo.biz.modular.courseclass.param.*;
import vip.xiaonuo.biz.modular.courseclass.service.BizCourseClassService;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.biz.modular.user.service.BizUserService;
import vip.xiaonuo.common.enums.CommonSortOrderEnum;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.common.util.CommonResponseUtil;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.io.File;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 开课班信息Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizCourseClassServiceImpl extends ServiceImpl<BizCourseClassMapper, BizCourseClass> implements BizCourseClassService {

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizUserService bizUserService;

    @Override
    public Page<BizCourseClass> page(BizCourseClassPageParam param) {
        QueryWrapper<BizCourseClass> queryWrapper = new QueryWrapper<BizCourseClass>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope) || StrUtil.isNotBlank(param.getOrgId())) {
            LambdaQueryWrapper<BizCourse> cw = new LambdaQueryWrapper<BizCourse>().select(BizCourse::getId);
            if (ObjectUtil.isNotEmpty(scope)) {
                CommonSqlUtil.safeIn(cw, BizCourse::getOrgId, scope);
            }
            if (StrUtil.isNotBlank(param.getOrgId())) {
                cw.eq(BizCourse::getOrgId, param.getOrgId());
            }
            List<String> allowedCourseIds = CollStreamUtil.toList(bizCourseService.list(cw), BizCourse::getId);
            if (allowedCourseIds.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizCourseClass::getCourseId, allowedCourseIds);
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizCourseClass::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getTermCode())) {
            queryWrapper.lambda().eq(BizCourseClass::getTermCode, param.getTermCode());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedCourses = CollStreamUtil.toList(
                    bizCourseService.list(new LambdaQueryWrapper<BizCourse>()
                            .select(BizCourse::getId)
                            .and(w -> w.like(BizCourse::getCourseName, key).or().like(BizCourse::getCourseCode, key))),
                    BizCourse::getId);
            List<String> matchedClasses = CollStreamUtil.toList(
                    bizClassService.list(new LambdaQueryWrapper<BizClass>()
                            .select(BizClass::getId)
                            .like(BizClass::getClassName, key)),
                    BizClass::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizCourseClass::getTermCode, key);
                if (!matchedCourses.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizCourseClass::getCourseId, matchedCourses));
                }
                if (!matchedClasses.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizCourseClass::getClassId, matchedClasses));
                }
            });
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByDesc(BizCourseClass::getCreateTime);
        }
        Page<BizCourseClass> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichCourseMeta(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizCourseClassAddParam param) {
        BizCourse course = bizCourseService.queryEntity(param.getCourseId());
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(course.getOrgId(), "新增开课班");
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "选择该班级开课");
        String termCode = StrUtil.trim(param.getTermCode());
        boolean exists = this.count(new LambdaQueryWrapper<BizCourseClass>()
                .eq(BizCourseClass::getCourseId, param.getCourseId())
                .eq(BizCourseClass::getClassId, param.getClassId())
                .eq(BizCourseClass::getTermCode, termCode)) > 0;
        if (exists) {
            throw new CommonException("该课程、班级在学期 {} 下已存在开课班", termCode);
        }
        BizCourseClass entity = BeanUtil.toBean(param, BizCourseClass.class);
        entity.setTermCode(termCode);
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizCourseClassEditParam param) {
        BizCourseClass entity = this.queryEntity(param.getId());
        BizCourse oldCourse = bizCourseService.queryEntity(entity.getCourseId());
        BizScopeUtil.assertOrgInScope(oldCourse.getOrgId(), "编辑开课班");

        BizCourse nextCourse = bizCourseService.queryEntity(param.getCourseId());
        BizClass nextClass = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(nextCourse.getOrgId(), "变更开课班课程");
        BizScopeUtil.assertOrgInScope(nextClass.getOrgId(), "变更开课班班级");

        String termCode = StrUtil.trim(param.getTermCode());
        boolean exists = this.count(new LambdaQueryWrapper<BizCourseClass>()
                .eq(BizCourseClass::getCourseId, param.getCourseId())
                .eq(BizCourseClass::getClassId, param.getClassId())
                .eq(BizCourseClass::getTermCode, termCode)
                .ne(BizCourseClass::getId, entity.getId())) > 0;
        if (exists) {
            throw new CommonException("该课程、班级在学期 {} 下已存在开课班", termCode);
        }
        BeanUtil.copyProperties(param, entity);
        entity.setTermCode(termCode);
        this.updateById(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizCourseClassIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizCourseClassIdParam::getId);
        List<BizCourseClass> list = this.listByIds(ids);
        for (BizCourseClass item : list) {
            BizCourse course = bizCourseService.queryEntity(item.getCourseId());
            BizScopeUtil.assertOrgInScope(course.getOrgId(), "删除开课班");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizCourseClass detail(BizCourseClassIdParam idParam) {
        BizCourseClass entity = this.queryEntity(idParam.getId());
        BizCourse course = bizCourseService.queryEntity(entity.getCourseId());
        BizScopeUtil.assertOrgInScope(course.getOrgId(), "查看开课班");
        enrichCourseMeta(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizCourseClass queryEntity(String id) {
        BizCourseClass entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("开课班不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public void downloadImportTemplate(HttpServletResponse response) {
        File tempFile = null;
        try {
            BizCourseClassImportRow sample = new BizCourseClassImportRow();
            sample.setCourseCode("CS101");
            sample.setClassName("2025级软件工程一班");
            sample.setTeacherName("软工吴老师");
            sample.setTermCode("2026-2027-1");

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "course_class_import_template.xlsx");
            EasyExcel.write(tempFile, BizCourseClassImportRow.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("开课班导入模板")
                    .doWrite(Collections.singletonList(sample));
            CommonDownloadUtil.download("开课班批量导入模板.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 生成开课班导入模板失败", e);
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
    public JSONObject importCourseClasses(MultipartFile file, boolean dryRun) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传Excel文件");
        }
        List<BizCourseClassImportRow> rows;
        try {
            rows = EasyExcel.read(file.getInputStream(), BizCourseClassImportRow.class, null).sheet().doReadSync();
        } catch (Exception e) {
            throw new CommonException("解析Excel失败：{}", e.getMessage());
        }

        Map<String, BizCourse> courseByCode = bizCourseService.listAll(null).stream()
                .filter(c -> StrUtil.isNotBlank(c.getCourseCode()))
                .collect(Collectors.toMap(BizCourse::getCourseCode, c -> c, (a, b) -> a));
        Map<String, BizClass> classByName = bizClassService.listAll(null).stream()
                .collect(Collectors.toMap(BizClass::getClassName, c -> c, (a, b) -> a));
        Map<String, BizUser> userByName = bizUserService.list().stream()
                .collect(Collectors.toMap(BizUser::getName, u -> u, (a, b) -> a));

        int success = 0;
        int failed = 0;
        JSONArray errors = JSONUtil.createArray();

        for (int i = 0; i < rows.size(); i++) {
            int rowNum = i + 2;
            BizCourseClassImportRow row = rows.get(i);
            String courseCode = StrUtil.trim(row.getCourseCode());
            String className = StrUtil.trim(row.getClassName());
            String teacherName = StrUtil.trim(row.getTeacherName());
            String termCode = StrUtil.trim(row.getTermCode());

            if (StrUtil.hasBlank(courseCode, className, teacherName, termCode)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "课程代码、班级名称、教师姓名、学期编码均为必填"));
                continue;
            }
            BizCourse course = courseByCode.get(courseCode);
            BizClass cls = classByName.get(className);
            BizUser teacher = userByName.get(teacherName);
            if (course == null || cls == null || teacher == null) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum)
                        .set("message", "课程/班级/教师主数据不存在或无权访问"));
                continue;
            }
            if (this.count(new LambdaQueryWrapper<BizCourseClass>()
                    .eq(BizCourseClass::getCourseId, course.getId())
                    .eq(BizCourseClass::getClassId, cls.getId())
                    .eq(BizCourseClass::getTermCode, termCode)) > 0) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "该开课班记录已存在"));
                continue;
            }
            if (!dryRun) {
                BizCourseClassAddParam addParam = new BizCourseClassAddParam();
                addParam.setCourseId(course.getId());
                addParam.setClassId(cls.getId());
                addParam.setTeacherUserId(teacher.getId());
                addParam.setTermCode(termCode);
                this.add(addParam);
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

    private void enrichCourseMeta(List<BizCourseClass> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> courseIds = records.stream().map(BizCourseClass::getCourseId)
                .filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (courseIds.isEmpty()) {
            return;
        }
        Map<String, BizCourse> courseMap = bizCourseService.listByIds(courseIds).stream()
                .collect(Collectors.toMap(BizCourse::getId, c -> c, (a, b) -> a));
        for (BizCourseClass item : records) {
            BizCourse c = courseMap.get(item.getCourseId());
            if (c != null) {
                item.setCourseCode(c.getCourseCode());
                item.setCredit(c.getCredit());
                item.setOrgId(c.getOrgId());
            }
        }
    }
}
