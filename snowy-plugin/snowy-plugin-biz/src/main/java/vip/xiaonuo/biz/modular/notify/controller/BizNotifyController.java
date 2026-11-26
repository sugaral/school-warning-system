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
package vip.xiaonuo.biz.modular.notify.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationJob;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationLog;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyEnqueueParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyIdParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyJobPageParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyLogPageParam;
import vip.xiaonuo.biz.modular.notify.service.BizNotifyService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 通知队列与回执日志控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "通知队列与回执日志控制器")
@RestController
@Validated
public class BizNotifyController {

    @Resource
    private BizNotifyService bizNotifyService;

    @Operation(summary = "获取通知任务队列分页")
    @SaCheckPermission("/biz/notify/job/page")
    @GetMapping("/biz/notify/job/page")
    public CommonResult<Page<BizNotificationJob>> jobPage(BizNotifyJobPageParam param) {
        return CommonResult.data(bizNotifyService.jobPage(param));
    }

    @Operation(summary = "获取通知发送回执日志分页")
    @SaCheckPermission("/biz/notify/log/page")
    @GetMapping("/biz/notify/log/page")
    public CommonResult<Page<BizNotificationLog>> logPage(BizNotifyLogPageParam param) {
        return CommonResult.data(bizNotifyService.logPage(param));
    }

    @Operation(summary = "入队通知发送任务")
    @CommonLog("入队通知发送任务")
    @SaCheckPermission("/biz/notify/job/enqueue")
    @PostMapping("/biz/notify/job/enqueue")
    public CommonResult<JSONObject> enqueue(@RequestBody @Valid BizNotifyEnqueueParam param) {
        return CommonResult.data(bizNotifyService.enqueue(param));
    }

    @Operation(summary = "立即触发待发通知队列分发")
    @CommonLog("触发通知队列分发")
    @SaCheckPermission("/biz/notify/job/dispatchNow")
    @PostMapping("/biz/notify/job/dispatchNow")
    public CommonResult<JSONObject> dispatchNow(@RequestParam(defaultValue = "50") int batchSize) {
        return CommonResult.data(bizNotifyService.dispatchPendingJobs(batchSize));
    }

    @Operation(summary = "取消待发通知任务")
    @CommonLog("取消通知任务")
    @SaCheckPermission("/biz/notify/job/cancel")
    @PostMapping("/biz/notify/job/cancel")
    public CommonResult<String> cancel(@RequestBody @Valid BizNotifyIdParam idParam) {
        bizNotifyService.cancelJob(idParam);
        return CommonResult.ok();
    }

    @Operation(summary = "确认通知回执")
    @CommonLog("确认通知回执")
    @SaCheckPermission("/biz/notify/log/ack")
    @PostMapping("/biz/notify/log/ack")
    public CommonResult<String> acknowledge(@RequestBody @Valid BizNotifyIdParam idParam) {
        bizNotifyService.acknowledgeLog(idParam);
        return CommonResult.ok();
    }

    @Operation(summary = "删除通知任务")
    @CommonLog("删除通知任务")
    @SaCheckPermission("/biz/notify/job/delete")
    @PostMapping("/biz/notify/job/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizNotifyIdParam> idParamList) {
        bizNotifyService.deleteJobs(idParamList);
        return CommonResult.ok();
    }
}
