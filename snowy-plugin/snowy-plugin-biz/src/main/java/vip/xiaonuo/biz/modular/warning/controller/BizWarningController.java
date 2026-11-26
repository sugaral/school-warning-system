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
package vip.xiaonuo.biz.modular.warning.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import vip.xiaonuo.biz.modular.warning.entity.*;
import vip.xiaonuo.biz.modular.warning.param.*;
import vip.xiaonuo.biz.modular.warning.service.BizSummaryService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningCaseService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningSnapshotService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 学业预警与高风险干预工单控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "学业预警与干预工单控制器")
@RestController
@Validated
public class BizWarningController {

    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Resource
    private BizWarningCaseService bizWarningCaseService;

    @Resource
    private BizSummaryService bizSummaryService;

    @Resource
    private BizWarningSnapshotService bizWarningSnapshotService;

    @Operation(summary = "获取学业预警分页")
    @SaCheckPermission("/biz/warning/page")
    @GetMapping("/biz/warning/page")
    public CommonResult<Page<BizWarning>> page(BizWarningPageParam param) {
        return CommonResult.data(bizWarningEngineService.page(param));
    }

    @Operation(summary = "获取学业预警详情")
    @SaCheckPermission("/biz/warning/detail")
    @GetMapping("/biz/warning/detail")
    public CommonResult<BizWarning> detail(@Valid BizWarningIdParam idParam) {
        return CommonResult.data(bizWarningEngineService.detail(idParam));
    }

    @Operation(summary = "确认学业预警")
    @CommonLog("确认学业预警")
    @SaCheckPermission("/biz/warning/acknowledge")
    @PostMapping("/biz/warning/acknowledge")
    public CommonResult<String> acknowledge(@RequestBody @Valid BizWarningIdParam idParam) {
        bizWarningEngineService.acknowledge(idParam);
        return CommonResult.ok();
    }

    @Operation(summary = "手动关闭学业预警")
    @CommonLog("手动关闭学业预警")
    @SaCheckPermission("/biz/warning/close")
    @PostMapping("/biz/warning/close")
    public CommonResult<String> close(@RequestBody @Valid BizWarningCloseParam param) {
        bizWarningEngineService.close(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除学业预警")
    @CommonLog("删除学业预警")
    @SaCheckPermission("/biz/warning/delete")
    @PostMapping("/biz/warning/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizWarningIdParam> idParamList) {
        bizWarningEngineService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "触发预警规则全量重算扫描")
    @CommonLog("触发预警规则全量重算扫描")
    @SaCheckPermission("/biz/warning/rescan")
    @PostMapping("/biz/warning/rescan")
    public CommonResult<JSONObject> rescan(@RequestBody(required = false) BizWarningRescanParam param) {
        return CommonResult.data(bizWarningEngineService.rescan(param != null ? param : new BizWarningRescanParam()));
    }

    @Operation(summary = "获取高风险干预工单分页")
    @SaCheckPermission("/biz/warning/case/page")
    @GetMapping("/biz/warning/case/page")
    public CommonResult<Page<BizWarningCase>> casePage(BizWarningCasePageParam param) {
        return CommonResult.data(bizWarningCaseService.page(param));
    }

    @Operation(summary = "获取高风险干预工单详情与流转日志")
    @SaCheckPermission("/biz/warning/case/detail")
    @GetMapping("/biz/warning/case/detail")
    public CommonResult<BizWarningCase> caseDetail(@Valid BizWarningCaseIdParam idParam) {
        return CommonResult.data(bizWarningCaseService.detail(idParam));
    }

    @Operation(summary = "指派高风险干预工单处置人")
    @CommonLog("指派高风险干预工单")
    @SaCheckPermission("/biz/warning/case/assign")
    @PostMapping("/biz/warning/case/assign")
    public CommonResult<String> assignCase(@RequestBody @Valid BizWarningCaseAssignParam param) {
        bizWarningCaseService.assign(param);
        return CommonResult.ok();
    }

    @Operation(summary = "接单处理干预工单")
    @CommonLog("接单处理干预工单")
    @SaCheckPermission("/biz/warning/case/accept")
    @PostMapping("/biz/warning/case/accept")
    public CommonResult<String> acceptCase(@RequestBody @Valid BizWarningCaseHandleParam param) {
        bizWarningCaseService.accept(param);
        return CommonResult.ok();
    }

    @Operation(summary = "提交干预工单处置完成")
    @CommonLog("提交干预工单处置完成")
    @SaCheckPermission("/biz/warning/case/complete")
    @PostMapping("/biz/warning/case/complete")
    public CommonResult<String> completeCase(@RequestBody @Valid BizWarningCaseHandleParam param) {
        bizWarningCaseService.complete(param);
        return CommonResult.ok();
    }

    @Operation(summary = "办结高风险干预工单")
    @CommonLog("办结高风险干预工单")
    @SaCheckPermission("/biz/warning/case/resolve")
    @PostMapping("/biz/warning/case/resolve")
    public CommonResult<String> resolveCase(@RequestBody @Valid BizWarningCaseHandleParam param) {
        bizWarningCaseService.resolve(param);
        return CommonResult.ok();
    }

    @Operation(summary = "获取周度考勤作业汇总分页")
    @SaCheckPermission("/biz/warning/summary/weekly")
    @GetMapping("/biz/warning/summary/weekly")
    public CommonResult<Page<BizWeeklySummary>> weeklySummary(BizSummaryPageParam param) {
        return CommonResult.data(bizSummaryService.weeklyPage(param));
    }

    @Operation(summary = "获取月度考勤作业汇总分页")
    @SaCheckPermission("/biz/warning/summary/monthly")
    @GetMapping("/biz/warning/summary/monthly")
    public CommonResult<Page<BizMonthlySummary>> monthlySummary(BizSummaryPageParam param) {
        return CommonResult.data(bizSummaryService.monthlyPage(param));
    }

    @Operation(summary = "获取学期学业汇总分页")
    @SaCheckPermission("/biz/warning/summary/term")
    @GetMapping("/biz/warning/summary/term")
    public CommonResult<Page<BizTermSummary>> termSummary(BizSummaryPageParam param) {
        return CommonResult.data(bizSummaryService.termPage(param));
    }

    @Operation(summary = "重算周/月/学期汇总统计")
    @CommonLog("重算周月学期汇总")
    @SaCheckPermission("/biz/warning/summary/rebuild")
    @PostMapping("/biz/warning/summary/rebuild")
    public CommonResult<JSONObject> rebuildSummary(@RequestBody(required = false) BizSummaryRebuildParam param) {
        return CommonResult.data(bizSummaryService.rebuildAll(param != null ? param : new BizSummaryRebuildParam()));
    }

    @Operation(summary = "获取学生预警快照分页")
    @SaCheckPermission("/biz/warning/snapshot/students")
    @GetMapping("/biz/warning/snapshot/students")
    public CommonResult<Page<BizStudentWarningSnapshot>> studentSnapshotPage(BizSummaryPageParam param) {
        return CommonResult.data(bizWarningSnapshotService.studentSnapshotPage(param));
    }

    @Operation(summary = "获取班级监控快照分页")
    @SaCheckPermission("/biz/warning/snapshot/classes")
    @GetMapping("/biz/warning/snapshot/classes")
    public CommonResult<Page<BizClassMonitorSnapshot>> classSnapshotPage(BizSummaryPageParam param) {
        return CommonResult.data(bizWarningSnapshotService.classSnapshotPage(param));
    }
}
