package vip.xiaonuo.biz.modular.report.controller;

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
import vip.xiaonuo.biz.modular.report.entity.BizExportJob;
import vip.xiaonuo.biz.modular.report.param.BizExportCreateParam;
import vip.xiaonuo.biz.modular.report.param.BizExportIdParam;
import vip.xiaonuo.biz.modular.report.param.BizExportJobPageParam;
import vip.xiaonuo.biz.modular.report.service.BizReportService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

@Tag(name = "报表导出任务控制器")
@RestController
@Validated
public class BizReportController {

    @Resource
    private BizReportService bizReportService;

    @Operation(summary = "获取导出任务分页")
    @SaCheckPermission("/biz/report/page")
    @GetMapping("/biz/report/page")
    public CommonResult<Page<BizExportJob>> page(BizExportJobPageParam param) {
        return CommonResult.data(bizReportService.page(param));
    }

    @Operation(summary = "创建并执行EasyExcel报表导出")
    @CommonLog("创建并执行报表导出")
    @SaCheckPermission("/biz/report/export")
    @PostMapping("/biz/report/export")
    public CommonResult<JSONObject> export(@RequestBody @Valid BizExportCreateParam param) {
        return CommonResult.data(bizReportService.createAndRun(param));
    }

    @Operation(summary = "鉴权下载已导出Excel报表")
    @CommonLog("鉴权下载导出报表")
    @SaCheckPermission("/biz/report/download")
    @GetMapping(value = "/biz/report/download", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void download(@RequestParam String id, HttpServletResponse response) {
        bizReportService.download(id, response);
    }

    @Operation(summary = "删除导出任务记录")
    @CommonLog("删除导出任务")
    @SaCheckPermission("/biz/report/delete")
    @PostMapping("/biz/report/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizExportIdParam> idParamList) {
        bizReportService.delete(idParamList);
        return CommonResult.ok();
    }
}
