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
package vip.xiaonuo.biz.modular.course.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.param.BizCourseAddParam;
import vip.xiaonuo.biz.modular.course.param.BizCourseEditParam;
import vip.xiaonuo.biz.modular.course.param.BizCourseIdParam;
import vip.xiaonuo.biz.modular.course.param.BizCoursePageParam;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 课程信息控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "课程信息控制器")
@RestController
@Validated
public class BizCourseController {

    @Resource
    private BizCourseService bizCourseService;

    @Operation(summary = "获取课程分页")
    @SaCheckPermission("/biz/course/page")
    @GetMapping("/biz/course/page")
    public CommonResult<Page<BizCourse>> page(BizCoursePageParam param) {
        return CommonResult.data(bizCourseService.page(param));
    }

    @Operation(summary = "获取课程下拉列表")
    @SaCheckPermission("/biz/course/list")
    @GetMapping("/biz/course/list")
    public CommonResult<List<BizCourse>> list(String orgId) {
        return CommonResult.data(bizCourseService.listAll(orgId));
    }

    @Operation(summary = "新增课程")
    @CommonLog("新增课程")
    @SaCheckPermission("/biz/course/add")
    @PostMapping("/biz/course/add")
    public CommonResult<String> add(@RequestBody @Valid BizCourseAddParam param) {
        bizCourseService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑课程")
    @CommonLog("编辑课程")
    @SaCheckPermission("/biz/course/edit")
    @PostMapping("/biz/course/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizCourseEditParam param) {
        bizCourseService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除课程")
    @CommonLog("删除课程")
    @SaCheckPermission("/biz/course/delete")
    @PostMapping("/biz/course/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizCourseIdParam> idParamList) {
        bizCourseService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取课程详情")
    @SaCheckPermission("/biz/course/detail")
    @GetMapping("/biz/course/detail")
    public CommonResult<BizCourse> detail(@Valid BizCourseIdParam idParam) {
        return CommonResult.data(bizCourseService.detail(idParam));
    }

    @Operation(summary = "下载课程批量导入模板")
    @SaCheckPermission("/biz/course/import")
    @GetMapping(value = "/biz/course/importTemplate", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadImportTemplate(HttpServletResponse response) {
        bizCourseService.downloadImportTemplate(response);
    }

    @Operation(summary = "批量导入课程")
    @CommonLog("批量导入课程")
    @SaCheckPermission("/biz/course/import")
    @PostMapping("/biz/course/import")
    public CommonResult<JSONObject> importCourses(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun) {
        return CommonResult.data(bizCourseService.importCourses(file, dryRun));
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/course/orgTreeSelector")
    @GetMapping("/biz/course/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizCourseService.orgTreeSelector(param));
    }
}
