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
package vip.xiaonuo.biz.modular.leaverequest.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
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
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestAddParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestApproveParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestIdParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestPageParam;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 请假申请控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "请假申请控制器")
@RestController
@Validated
public class BizLeaveRequestController {

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Operation(summary = "获取请假分页")
    @SaCheckPermission("/biz/leaverequest/page")
    @GetMapping("/biz/leaverequest/page")
    public CommonResult<Page<BizLeaveRequest>> page(BizLeaveRequestPageParam param) {
        return CommonResult.data(bizLeaveRequestService.page(param));
    }

    @Operation(summary = "新增请假")
    @CommonLog("新增请假")
    @SaCheckPermission("/biz/leaverequest/add")
    @PostMapping("/biz/leaverequest/add")
    public CommonResult<String> add(@RequestBody @Valid BizLeaveRequestAddParam param) {
        bizLeaveRequestService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "审批请假")
    @CommonLog("审批请假")
    @SaCheckPermission("/biz/leaverequest/approve")
    @PostMapping("/biz/leaverequest/approve")
    public CommonResult<String> approve(@RequestBody @Valid BizLeaveRequestApproveParam param) {
        bizLeaveRequestService.approve(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除请假")
    @CommonLog("删除请假")
    @SaCheckPermission("/biz/leaverequest/delete")
    @PostMapping("/biz/leaverequest/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizLeaveRequestIdParam> idParamList) {
        bizLeaveRequestService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取请假详情")
    @SaCheckPermission("/biz/leaverequest/detail")
    @GetMapping("/biz/leaverequest/detail")
    public CommonResult<BizLeaveRequest> detail(@Valid BizLeaveRequestIdParam idParam) {
        return CommonResult.data(bizLeaveRequestService.detail(idParam));
    }
}
