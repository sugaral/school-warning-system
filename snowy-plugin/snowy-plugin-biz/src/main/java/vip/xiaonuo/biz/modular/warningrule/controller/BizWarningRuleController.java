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
package vip.xiaonuo.biz.modular.warningrule.controller;

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
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.warningrule.entity.BizWarningRule;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleAddParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleEditParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleIdParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRulePageParam;
import vip.xiaonuo.biz.modular.warningrule.service.BizWarningRuleService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 学业预警规则控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "学业预警规则控制器")
@RestController
@Validated
public class BizWarningRuleController {

    @Resource
    private BizWarningRuleService bizWarningRuleService;

    @Operation(summary = "获取预警规则分页")
    @SaCheckPermission("/biz/warningrule/page")
    @GetMapping("/biz/warningrule/page")
    public CommonResult<Page<BizWarningRule>> page(BizWarningRulePageParam param) {
        return CommonResult.data(bizWarningRuleService.page(param));
    }

    @Operation(summary = "新增预警规则")
    @CommonLog("新增预警规则")
    @SaCheckPermission("/biz/warningrule/add")
    @PostMapping("/biz/warningrule/add")
    public CommonResult<String> add(@RequestBody @Valid BizWarningRuleAddParam param) {
        bizWarningRuleService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑预警规则")
    @CommonLog("编辑预警规则")
    @SaCheckPermission("/biz/warningrule/edit")
    @PostMapping("/biz/warningrule/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizWarningRuleEditParam param) {
        bizWarningRuleService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除预警规则")
    @CommonLog("删除预警规则")
    @SaCheckPermission("/biz/warningrule/delete")
    @PostMapping("/biz/warningrule/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizWarningRuleIdParam> idParamList) {
        bizWarningRuleService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取预警规则详情")
    @SaCheckPermission("/biz/warningrule/detail")
    @GetMapping("/biz/warningrule/detail")
    public CommonResult<BizWarningRule> detail(@Valid BizWarningRuleIdParam idParam) {
        return CommonResult.data(bizWarningRuleService.detail(idParam));
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/warningrule/orgTreeSelector")
    @GetMapping("/biz/warningrule/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizWarningRuleService.orgTreeSelector(param));
    }
}
