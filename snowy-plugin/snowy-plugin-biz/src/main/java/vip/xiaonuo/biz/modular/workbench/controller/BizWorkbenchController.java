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
package vip.xiaonuo.biz.modular.workbench.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchNoticeStrategyParam;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchParam;
import vip.xiaonuo.biz.modular.workbench.param.BizWorkbenchSpecialApproveParam;
import vip.xiaonuo.biz.modular.workbench.service.BizWorkbenchService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

/**
 * 多角色工作台控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "多角色工作台控制器")
@RestController
@Validated
public class BizWorkbenchController {

    @Resource
    private BizWorkbenchService bizWorkbenchService;

    @Operation(summary = "获取多角色工作台总览")
    @SaCheckPermission("/biz/workbench/overview")
    @GetMapping("/biz/workbench/overview")
    public CommonResult<JSONObject> overview(BizWorkbenchParam param) {
        return CommonResult.data(bizWorkbenchService.overview(param));
    }

    @Operation(summary = "读取学院通知防骚扰策略")
    @SaCheckPermission("/biz/workbench/notificationStrategy")
    @GetMapping("/biz/workbench/notificationStrategy")
    public CommonResult<JSONObject> getNotificationStrategy(@RequestParam(required = false) String orgId) {
        return CommonResult.data(bizWorkbenchService.getNotificationStrategy(orgId));
    }

    @Operation(summary = "保存学院通知防骚扰策略")
    @CommonLog("保存学院防骚扰通知策略")
    @SaCheckPermission("/biz/workbench/notificationStrategy/save")
    @PostMapping("/biz/workbench/notificationStrategy/save")
    public CommonResult<JSONObject> saveNotificationStrategy(@RequestBody @Valid BizWorkbenchNoticeStrategyParam param) {
        return CommonResult.data(bizWorkbenchService.saveNotificationStrategy(param));
    }

    @Operation(summary = "教学副院长特批终审信息变更申请")
    @CommonLog("特批终审变更申请")
    @SaCheckPermission("/biz/workbench/specialApproveChange")
    @PostMapping("/biz/workbench/specialApproveChange")
    public CommonResult<String> specialApproveChange(@RequestBody @Valid BizWorkbenchSpecialApproveParam param) {
        bizWorkbenchService.specialApproveChange(param);
        return CommonResult.ok();
    }
}
