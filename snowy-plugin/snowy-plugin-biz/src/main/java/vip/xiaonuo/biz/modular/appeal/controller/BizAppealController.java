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
package vip.xiaonuo.biz.modular.appeal.controller;

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
import vip.xiaonuo.biz.modular.appeal.entity.BizAppeal;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealAddParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealHandleParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealIdParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealPageParam;
import vip.xiaonuo.biz.modular.appeal.service.BizAppealService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 学生申诉工单控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "学生申诉工单控制器")
@RestController
@Validated
public class BizAppealController {

    @Resource
    private BizAppealService bizAppealService;

    @Operation(summary = "获取学生申诉分页")
    @SaCheckPermission("/biz/appeal/page")
    @GetMapping("/biz/appeal/page")
    public CommonResult<Page<BizAppeal>> page(BizAppealPageParam param) {
        return CommonResult.data(bizAppealService.page(param));
    }

    @Operation(summary = "新增学生申诉")
    @CommonLog("新增学生申诉")
    @SaCheckPermission("/biz/appeal/add")
    @PostMapping("/biz/appeal/add")
    public CommonResult<String> add(@RequestBody @Valid BizAppealAddParam param) {
        bizAppealService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "处理学生申诉")
    @CommonLog("处理学生申诉")
    @SaCheckPermission("/biz/appeal/handle")
    @PostMapping("/biz/appeal/handle")
    public CommonResult<String> handle(@RequestBody @Valid BizAppealHandleParam param) {
        bizAppealService.handle(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除学生申诉")
    @CommonLog("删除学生申诉")
    @SaCheckPermission("/biz/appeal/delete")
    @PostMapping("/biz/appeal/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizAppealIdParam> idParamList) {
        bizAppealService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取学生申诉详情")
    @SaCheckPermission("/biz/appeal/detail")
    @GetMapping("/biz/appeal/detail")
    public CommonResult<BizAppeal> detail(@Valid BizAppealIdParam idParam) {
        return CommonResult.data(bizAppealService.detail(idParam));
    }
}
