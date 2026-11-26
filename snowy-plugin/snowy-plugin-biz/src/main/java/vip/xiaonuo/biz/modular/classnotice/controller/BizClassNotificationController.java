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
package vip.xiaonuo.biz.modular.classnotice.controller;

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
import vip.xiaonuo.biz.modular.classnotice.entity.BizClassNotification;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationAddParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationEditParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationIdParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationPageParam;
import vip.xiaonuo.biz.modular.classnotice.service.BizClassNotificationService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 班级公告控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "班级公告控制器")
@RestController
@Validated
public class BizClassNotificationController {

    @Resource
    private BizClassNotificationService bizClassNotificationService;

    @Operation(summary = "获取班级公告分页")
    @SaCheckPermission("/biz/classnotice/page")
    @GetMapping("/biz/classnotice/page")
    public CommonResult<Page<BizClassNotification>> page(BizClassNotificationPageParam param) {
        return CommonResult.data(bizClassNotificationService.page(param));
    }

    @Operation(summary = "发布班级公告")
    @CommonLog("发布班级公告")
    @SaCheckPermission("/biz/classnotice/add")
    @PostMapping("/biz/classnotice/add")
    public CommonResult<String> add(@RequestBody @Valid BizClassNotificationAddParam param) {
        bizClassNotificationService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑班级公告")
    @CommonLog("编辑班级公告")
    @SaCheckPermission("/biz/classnotice/edit")
    @PostMapping("/biz/classnotice/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizClassNotificationEditParam param) {
        bizClassNotificationService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除班级公告")
    @CommonLog("删除班级公告")
    @SaCheckPermission("/biz/classnotice/delete")
    @PostMapping("/biz/classnotice/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizClassNotificationIdParam> idParamList) {
        bizClassNotificationService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取班级公告详情")
    @SaCheckPermission("/biz/classnotice/detail")
    @GetMapping("/biz/classnotice/detail")
    public CommonResult<BizClassNotification> detail(@Valid BizClassNotificationIdParam idParam) {
        return CommonResult.data(bizClassNotificationService.detail(idParam));
    }

    @Operation(summary = "获取班级公告已读明细统计")
    @SaCheckPermission("/biz/classnotice/readStats")
    @GetMapping("/biz/classnotice/readStats")
    public CommonResult<JSONObject> readStats(@Valid BizClassNotificationIdParam idParam) {
        return CommonResult.data(bizClassNotificationService.readStats(idParam));
    }
}
