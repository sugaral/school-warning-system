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
package vip.xiaonuo.biz.modular.grade.controller;

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
import vip.xiaonuo.biz.modular.grade.entity.BizGrade;
import vip.xiaonuo.biz.modular.grade.param.BizGradeAddParam;
import vip.xiaonuo.biz.modular.grade.param.BizGradeEditParam;
import vip.xiaonuo.biz.modular.grade.param.BizGradeIdParam;
import vip.xiaonuo.biz.modular.grade.param.BizGradePageParam;
import vip.xiaonuo.biz.modular.grade.service.BizGradeService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 学生成绩控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "学生成绩控制器")
@RestController
@Validated
public class BizGradeController {

    @Resource
    private BizGradeService bizGradeService;

    @Operation(summary = "获取成绩分页")
    @SaCheckPermission("/biz/grade/page")
    @GetMapping("/biz/grade/page")
    public CommonResult<Page<BizGrade>> page(BizGradePageParam param) {
        return CommonResult.data(bizGradeService.page(param));
    }

    @Operation(summary = "录入学生成绩")
    @CommonLog("录入学生成绩")
    @SaCheckPermission("/biz/grade/add")
    @PostMapping("/biz/grade/add")
    public CommonResult<String> add(@RequestBody @Valid BizGradeAddParam param) {
        bizGradeService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑学生成绩")
    @CommonLog("编辑学生成绩")
    @SaCheckPermission("/biz/grade/edit")
    @PostMapping("/biz/grade/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizGradeEditParam param) {
        bizGradeService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除学生成绩")
    @CommonLog("删除学生成绩")
    @SaCheckPermission("/biz/grade/delete")
    @PostMapping("/biz/grade/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizGradeIdParam> idParamList) {
        bizGradeService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取成绩详情")
    @SaCheckPermission("/biz/grade/detail")
    @GetMapping("/biz/grade/detail")
    public CommonResult<BizGrade> detail(@Valid BizGradeIdParam idParam) {
        return CommonResult.data(bizGradeService.detail(idParam));
    }

    @Operation(summary = "下载成绩导入模板")
    @SaCheckPermission("/biz/grade/import")
    @GetMapping(value = "/biz/grade/importTemplate", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadImportTemplate(HttpServletResponse response) {
        bizGradeService.downloadImportTemplate(response);
    }

    @Operation(summary = "批量导入学生成绩")
    @CommonLog("批量导入学生成绩")
    @SaCheckPermission("/biz/grade/import")
    @PostMapping("/biz/grade/import")
    public CommonResult<JSONObject> importGrades(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun) {
        return CommonResult.data(bizGradeService.importGrades(file, dryRun));
    }
}
