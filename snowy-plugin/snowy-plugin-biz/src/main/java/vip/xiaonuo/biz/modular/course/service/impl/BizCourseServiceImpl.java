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
package vip.xiaonuo.biz.modular.course.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.convert.Convert;
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
import vip.xiaonuo.biz.modular.course.mapper.BizCourseMapper;
import vip.xiaonuo.biz.modular.course.param.*;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.common.enums.CommonSortOrderEnum;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.common.util.CommonResponseUtil;

import java.io.File;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 课程信息Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizCourseServiceImpl extends ServiceImpl<BizCourseMapper, BizCourse> implements BizCourseService {

    @Resource
    private BizOrgService bizOrgService;

    @Override
    public Page<BizCourse> page(BizCoursePageParam param) {
        QueryWrapper<BizCourse> queryWrapper = new QueryWrapper<BizCourse>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizCourse::getOrgId)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(param.getOrgId())) {
            queryWrapper.lambda().eq(BizCourse::getOrgId, param.getOrgId());
        }
        if (ObjectUtil.isNotEmpty(param.getStatus())) {
            queryWrapper.lambda().eq(BizCourse::getStatus, param.getStatus());
        }
        if (ObjectUtil.isNotEmpty(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizCourse::getCourseName, param.getSearchKey())
                    .or().like(BizCourse::getCourseCode, param.getSearchKey()));
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByDesc(BizCourse::getCreateTime);
        }
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Override
    public List<BizCourse> listAll(String orgId) {
        LambdaQueryWrapper<BizCourse> wrapper = new LambdaQueryWrapper<>();
        if (!BizScopeUtil.applyOrgScope(wrapper, BizCourse::getOrgId)) {
            return Collections.emptyList();
        }
        if (StrUtil.isNotBlank(orgId)) {
            wrapper.eq(BizCourse::getOrgId, orgId);
        }
        wrapper.eq(BizCourse::getStatus, "active").orderByAsc(BizCourse::getCourseCode);
        return this.list(wrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizCourseAddParam param) {
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "新增课程");
        String code = StrUtil.trimToNull(param.getCourseCode());
        if (code != null && this.count(new LambdaQueryWrapper<BizCourse>()
                .eq(BizCourse::getOrgId, param.getOrgId())
                .eq(BizCourse::getCourseCode, code)) > 0) {
            throw new CommonException("该学院下已存在课程代码：{}", code);
        }
        BizCourse entity = BeanUtil.toBean(param, BizCourse.class);
        entity.setCourseCode(code);
        entity.setCourseName(StrUtil.trim(param.getCourseName()));
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizCourseEditParam param) {
        BizCourse entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "编辑课程");
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "变更课程所属学院");
        String code = StrUtil.trimToNull(param.getCourseCode());
        if (code != null && this.count(new LambdaQueryWrapper<BizCourse>()
                .eq(BizCourse::getOrgId, param.getOrgId())
                .eq(BizCourse::getCourseCode, code)
                .ne(BizCourse::getId, entity.getId())) > 0) {
            throw new CommonException("该学院下已存在课程代码：{}", code);
        }
        BeanUtil.copyProperties(param, entity);
        entity.setCourseCode(code);
        entity.setCourseName(StrUtil.trim(param.getCourseName()));
        if (StrUtil.isBlank(entity.getStatus())) {
            entity.setStatus("active");
        }
        this.updateById(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizCourseIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizCourseIdParam::getId);
        List<BizCourse> courses = this.listByIds(ids);
        for (BizCourse c : courses) {
            BizScopeUtil.assertOrgInScope(c.getOrgId(), "删除课程");
            String summary = buildRelationSummary(c.getId());
            if (StrUtil.isNotBlank(summary)) {
                throw new CommonException("课程【{}】仍有关联数据（{}），无法删除", c.getCourseName(), summary);
            }
        }
        this.removeByIds(ids);
    }

    @Override
    public BizCourse detail(BizCourseIdParam idParam) {
        BizCourse entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看课程");
        return entity;
    }

    @Override
    public BizCourse queryEntity(String id) {
        BizCourse entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("课程不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public void downloadImportTemplate(HttpServletResponse response) {
        File tempFile = null;
        try {
            BizCourseImportRow sample = new BizCourseImportRow();
            sample.setOrgName("人工智能学院");
            sample.setCourseCode("CS101");
            sample.setCourseName("数据结构与算法");
            sample.setCredit("3.5");

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "course_import_template.xlsx");
            EasyExcel.write(tempFile, BizCourseImportRow.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("课程导入模板")
                    .doWrite(Collections.singletonList(sample));
            CommonDownloadUtil.download("课程批量导入模板.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 生成课程导入模板失败", e);
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
    public JSONObject importCourses(MultipartFile file, boolean dryRun) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传Excel文件");
        }
        List<BizCourseImportRow> rows;
        try {
            rows = EasyExcel.read(file.getInputStream(), BizCourseImportRow.class, null).sheet().doReadSync();
        } catch (Exception e) {
            throw new CommonException("解析Excel失败：{}", e.getMessage());
        }

        Map<String, BizOrg> orgByName = bizOrgService.list().stream()
                .collect(Collectors.toMap(BizOrg::getName, o -> o, (a, b) -> a));

        int success = 0;
        int failed = 0;
        JSONArray errors = JSONUtil.createArray();

        for (int i = 0; i < rows.size(); i++) {
            int rowNum = i + 2;
            BizCourseImportRow row = rows.get(i);
            String orgName = StrUtil.trim(row.getOrgName());
            String code = StrUtil.trimToNull(row.getCourseCode());
            String name = StrUtil.trim(row.getCourseName());
            if (StrUtil.hasBlank(orgName, name)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学院与课程名称不能为空"));
                continue;
            }
            BizOrg org = orgByName.get(orgName);
            if (org == null) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "未找到学院：" + orgName));
                continue;
            }
            try {
                BizScopeUtil.assertOrgInScope(org.getId(), "导入课程");
            } catch (CommonException ex) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", ex.getMsg()));
                continue;
            }
            BigDecimal creditVal = null;
            if (StrUtil.isNotBlank(row.getCredit())) {
                try {
                    creditVal = new BigDecimal(StrUtil.trim(row.getCredit()));
                } catch (Exception ex) {
                    failed++;
                    errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学分格式错误：" + row.getCredit()));
                    continue;
                }
            }
            if (code != null && this.count(new LambdaQueryWrapper<BizCourse>()
                    .eq(BizCourse::getOrgId, org.getId())
                    .eq(BizCourse::getCourseCode, code)) > 0) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "课程代码已存在：" + code));
                continue;
            }
            if (!dryRun) {
                BizCourseAddParam addParam = new BizCourseAddParam();
                addParam.setOrgId(org.getId());
                addParam.setCourseCode(code);
                addParam.setCourseName(name);
                addParam.setCredit(creditVal);
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

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }

    private String buildRelationSummary(String courseId) {
        Map<String, Object> summary = this.baseMapper.selectCourseRelationSummary(courseId);
        if (ObjectUtil.isEmpty(summary)) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        appendCount(parts, summary.get("courseClassCnt"), "条开课班");
        appendCount(parts, summary.get("scheduleCnt"), "条课表");
        appendCount(parts, summary.get("sessionCnt"), "个课次");
        appendCount(parts, summary.get("bindingCnt"), "条教师绑定");
        appendCount(parts, summary.get("gradeCnt"), "条成绩");
        return String.join("、", parts);
    }

    private void appendCount(List<String> parts, Object val, String unit) {
        long count = Convert.toLong(val, 0L);
        if (count > 0) {
            parts.add(count + " " + unit);
        }
    }
}
