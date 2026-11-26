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
package vip.xiaonuo.biz.modular.schedule.controller;

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
import vip.xiaonuo.biz.modular.schedule.entity.BizSchedule;
import vip.xiaonuo.biz.modular.schedule.param.BizScheduleAddParam;
import vip.xiaonuo.biz.modular.schedule.param.BizScheduleEditParam;
import vip.xiaonuo.biz.modular.schedule.param.BizScheduleIdParam;
import vip.xiaonuo.biz.modular.schedule.param.BizSchedulePageParam;
import vip.xiaonuo.biz.modular.schedule.service.BizScheduleService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 排课课表控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "排课课表控制器")
@RestController
@Validated
public class BizScheduleController {

    @Resource
    private BizScheduleService bizScheduleService;

    @Operation(summary = "获取课表分页")
    @SaCheckPermission("/biz/schedule/page")
    @GetMapping("/biz/schedule/page")
    public CommonResult<Page<BizSchedule>> page(BizSchedulePageParam param) {
        return CommonResult.data(bizScheduleService.page(param));
    }

    @Operation(summary = "新增课表")
    @CommonLog("新增课表")
    @SaCheckPermission("/biz/schedule/add")
    @PostMapping("/biz/schedule/add")
    public CommonResult<String> add(@RequestBody @Valid BizScheduleAddParam param) {
        bizScheduleService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑课表")
    @CommonLog("编辑课表")
    @SaCheckPermission("/biz/schedule/edit")
    @PostMapping("/biz/schedule/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizScheduleEditParam param) {
        bizScheduleService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除课表")
    @CommonLog("删除课表")
    @SaCheckPermission("/biz/schedule/delete")
    @PostMapping("/biz/schedule/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizScheduleIdParam> idParamList) {
        bizScheduleService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取课表详情")
    @SaCheckPermission("/biz/schedule/detail")
    @GetMapping("/biz/schedule/detail")
    public CommonResult<BizSchedule> detail(@Valid BizScheduleIdParam idParam) {
        return CommonResult.data(bizScheduleService.detail(idParam));
    }

    @Operation(summary = "下载课表批量导入模板")
    @SaCheckPermission("/biz/schedule/import")
    @GetMapping(value = "/biz/schedule/importTemplate", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadImportTemplate(HttpServletResponse response) {
        bizScheduleService.downloadImportTemplate(response);
    }

    @Operation(summary = "批量导入课表")
    @CommonLog("批量导入课表")
    @SaCheckPermission("/biz/schedule/import")
    @PostMapping("/biz/schedule/import")
    public CommonResult<JSONObject> importSchedules(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun) {
        return CommonResult.data(bizScheduleService.importSchedules(file, dryRun));
    }
}
