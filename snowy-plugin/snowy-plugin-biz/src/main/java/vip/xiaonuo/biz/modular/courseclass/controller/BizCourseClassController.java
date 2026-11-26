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
package vip.xiaonuo.biz.modular.courseclass.controller;

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
import vip.xiaonuo.biz.modular.courseclass.entity.BizCourseClass;
import vip.xiaonuo.biz.modular.courseclass.param.BizCourseClassAddParam;
import vip.xiaonuo.biz.modular.courseclass.param.BizCourseClassEditParam;
import vip.xiaonuo.biz.modular.courseclass.param.BizCourseClassIdParam;
import vip.xiaonuo.biz.modular.courseclass.param.BizCourseClassPageParam;
import vip.xiaonuo.biz.modular.courseclass.service.BizCourseClassService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 开课班信息控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "开课班信息控制器")
@RestController
@Validated
public class BizCourseClassController {

    @Resource
    private BizCourseClassService bizCourseClassService;

    @Operation(summary = "获取开课班分页")
    @SaCheckPermission("/biz/courseclass/page")
    @GetMapping("/biz/courseclass/page")
    public CommonResult<Page<BizCourseClass>> page(BizCourseClassPageParam param) {
        return CommonResult.data(bizCourseClassService.page(param));
    }

    @Operation(summary = "新增开课班")
    @CommonLog("新增开课班")
    @SaCheckPermission("/biz/courseclass/add")
    @PostMapping("/biz/courseclass/add")
    public CommonResult<String> add(@RequestBody @Valid BizCourseClassAddParam param) {
        bizCourseClassService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑开课班")
    @CommonLog("编辑开课班")
    @SaCheckPermission("/biz/courseclass/edit")
    @PostMapping("/biz/courseclass/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizCourseClassEditParam param) {
        bizCourseClassService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除开课班")
    @CommonLog("删除开课班")
    @SaCheckPermission("/biz/courseclass/delete")
    @PostMapping("/biz/courseclass/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizCourseClassIdParam> idParamList) {
        bizCourseClassService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取开课班详情")
    @SaCheckPermission("/biz/courseclass/detail")
    @GetMapping("/biz/courseclass/detail")
    public CommonResult<BizCourseClass> detail(@Valid BizCourseClassIdParam idParam) {
        return CommonResult.data(bizCourseClassService.detail(idParam));
    }

    @Operation(summary = "下载开课班批量导入模板")
    @SaCheckPermission("/biz/courseclass/import")
    @GetMapping(value = "/biz/courseclass/importTemplate", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadImportTemplate(HttpServletResponse response) {
        bizCourseClassService.downloadImportTemplate(response);
    }

    @Operation(summary = "批量导入开课班")
    @CommonLog("批量导入开课班")
    @SaCheckPermission("/biz/courseclass/import")
    @PostMapping("/biz/courseclass/import")
    public CommonResult<JSONObject> importCourseClasses(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun) {
        return CommonResult.data(bizCourseClassService.importCourseClasses(file, dryRun));
    }
}
