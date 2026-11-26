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
package vip.xiaonuo.biz.modular.schedule.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.date.DateUtil;
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
import vip.xiaonuo.biz.modular.schedule.entity.BizSchedule;
import vip.xiaonuo.biz.modular.schedule.mapper.BizScheduleMapper;
import vip.xiaonuo.biz.modular.schedule.param.*;
import vip.xiaonuo.biz.modular.schedule.service.BizScheduleService;
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
 * 排课课表Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizScheduleServiceImpl extends ServiceImpl<BizScheduleMapper, BizSchedule> implements BizScheduleService {

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizUserService bizUserService;

    @Override
    public Page<BizSchedule> page(BizSchedulePageParam param) {
        QueryWrapper<BizSchedule> queryWrapper = new QueryWrapper<BizSchedule>().checkSqlInjection();
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
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizSchedule::getCourseId, allowedCourseIds);
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizSchedule::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizSchedule::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getTermCode())) {
            queryWrapper.lambda().eq(BizSchedule::getTermCode, param.getTermCode());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizSchedule::getStatus, param.getStatus());
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
                w.like(BizSchedule::getTermCode, key);
                if (!matchedCourses.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizSchedule::getCourseId, matchedCourses));
                }
                if (!matchedClasses.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizSchedule::getClassId, matchedClasses));
                }
            });
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByDesc(BizSchedule::getSessionStart);
        }
        Page<BizSchedule> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichCourseMeta(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizScheduleAddParam param) {
        validateTimeWindow(param.getSessionStart(), param.getSessionEnd());
        BizCourse course = bizCourseService.queryEntity(param.getCourseId());
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(course.getOrgId(), "新增排课");
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "为该班级排课");

        BizSchedule entity = BeanUtil.toBean(param, BizSchedule.class);
        entity.setTermCode(StrUtil.trim(param.getTermCode()));
        entity.setExpireMinutes(ObjectUtil.defaultIfNull(param.getExpireMinutes(), 15));
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizScheduleEditParam param) {
        validateTimeWindow(param.getSessionStart(), param.getSessionEnd());
        BizSchedule entity = this.queryEntity(param.getId());
        BizCourse oldCourse = bizCourseService.queryEntity(entity.getCourseId());
        BizScopeUtil.assertOrgInScope(oldCourse.getOrgId(), "编辑排课");

        BizCourse nextCourse = bizCourseService.queryEntity(param.getCourseId());
        BizClass nextClass = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(nextCourse.getOrgId(), "变更排课课程");
        BizScopeUtil.assertOrgInScope(nextClass.getOrgId(), "变更排课班级");

        BeanUtil.copyProperties(param, entity);
        entity.setTermCode(StrUtil.trim(param.getTermCode()));
        entity.setExpireMinutes(ObjectUtil.defaultIfNull(param.getExpireMinutes(), 15));
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.updateById(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizScheduleIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizScheduleIdParam::getId);
        List<BizSchedule> list = this.listByIds(ids);
        for (BizSchedule item : list) {
            BizCourse course = bizCourseService.queryEntity(item.getCourseId());
            BizScopeUtil.assertOrgInScope(course.getOrgId(), "删除排课");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizSchedule detail(BizScheduleIdParam idParam) {
        BizSchedule entity = this.queryEntity(idParam.getId());
        BizCourse course = bizCourseService.queryEntity(entity.getCourseId());
        BizScopeUtil.assertOrgInScope(course.getOrgId(), "查看排课");
        enrichCourseMeta(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizSchedule queryEntity(String id) {
        BizSchedule entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("排课记录不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public void downloadImportTemplate(HttpServletResponse response) {
        File tempFile = null;
        try {
            BizScheduleImportRow sample = new BizScheduleImportRow();
            sample.setTermCode("2026-2027-1");
            sample.setCourseCode("CS101");
            sample.setClassName("2025级软件工程一班");
            sample.setTeacherName("软工吴老师");
            sample.setSessionStart("2026-09-07 08:00:00");
            sample.setSessionEnd("2026-09-07 09:40:00");
            sample.setExpireMinutes("15");

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "schedule_import_template.xlsx");
            EasyExcel.write(tempFile, BizScheduleImportRow.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("课表导入模板")
                    .doWrite(Collections.singletonList(sample));
            CommonDownloadUtil.download("课表批量导入模板.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 生成课表导入模板失败", e);
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
    public JSONObject importSchedules(MultipartFile file, boolean dryRun) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传Excel文件");
        }
        List<BizScheduleImportRow> rows;
        try {
            rows = EasyExcel.read(file.getInputStream(), BizScheduleImportRow.class, null).sheet().doReadSync();
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
            BizScheduleImportRow row = rows.get(i);
            String termCode = StrUtil.trim(row.getTermCode());
            String courseCode = StrUtil.trim(row.getCourseCode());
            String className = StrUtil.trim(row.getClassName());
            String teacherName = StrUtil.trim(row.getTeacherName());

            if (StrUtil.hasBlank(termCode, courseCode, className, teacherName, row.getSessionStart(), row.getSessionEnd())) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学期、课程代码、班级、教师、上下课时间均为必填"));
                continue;
            }
            BizCourse course = courseByCode.get(courseCode);
            BizClass cls = classByName.get(className);
            BizUser teacher = userByName.get(teacherName);
            if (course == null || cls == null || teacher == null) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "课程/班级/教师主数据不存在或无权访问"));
                continue;
            }
            Date start;
            Date end;
            try {
                start = DateUtil.parse(StrUtil.trim(row.getSessionStart()));
                end = DateUtil.parse(StrUtil.trim(row.getSessionEnd()));
                validateTimeWindow(start, end);
            } catch (Exception ex) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "上下课时间格式或区间无效：" + ex.getMessage()));
                continue;
            }
            Integer expireMinutes = StrUtil.isNotBlank(row.getExpireMinutes())
                    ? Math.max(1, Integer.parseInt(StrUtil.trim(row.getExpireMinutes())))
                    : 15;
            if (!dryRun) {
                BizScheduleAddParam addParam = new BizScheduleAddParam();
                addParam.setTermCode(termCode);
                addParam.setCourseId(course.getId());
                addParam.setClassId(cls.getId());
                addParam.setTeacherUserId(teacher.getId());
                addParam.setSessionStart(start);
                addParam.setSessionEnd(end);
                addParam.setExpireMinutes(expireMinutes);
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

    private void validateTimeWindow(Date start, Date end) {
        if (start == null || end == null || !end.after(start)) {
            throw new CommonException("下课时间必须晚于上课时间");
        }
    }

    private void enrichCourseMeta(List<BizSchedule> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> courseIds = records.stream().map(BizSchedule::getCourseId)
                .filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (courseIds.isEmpty()) {
            return;
        }
        Map<String, BizCourse> courseMap = bizCourseService.listByIds(courseIds).stream()
                .collect(Collectors.toMap(BizCourse::getId, c -> c, (a, b) -> a));
        for (BizSchedule item : records) {
            BizCourse c = courseMap.get(item.getCourseId());
            if (c != null) {
                item.setCourseCode(c.getCourseCode());
                item.setOrgId(c.getOrgId());
            }
        }
    }
}
