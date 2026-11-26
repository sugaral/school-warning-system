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
package vip.xiaonuo.biz.modular.msgtemplate.controller;

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
import vip.xiaonuo.biz.modular.msgtemplate.entity.BizMessageTemplate;
import vip.xiaonuo.biz.modular.msgtemplate.param.*;
import vip.xiaonuo.biz.modular.msgtemplate.service.BizMessageTemplateService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 消息模板控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "消息模板控制器")
@RestController
@Validated
public class BizMessageTemplateController {

    @Resource
    private BizMessageTemplateService bizMessageTemplateService;

    @Operation(summary = "获取消息模板分页")
    @SaCheckPermission("/biz/msgtemplate/page")
    @GetMapping("/biz/msgtemplate/page")
    public CommonResult<Page<BizMessageTemplate>> page(BizMessageTemplatePageParam param) {
        return CommonResult.data(bizMessageTemplateService.page(param));
    }

    @Operation(summary = "新增消息模板")
    @CommonLog("新增消息模板")
    @SaCheckPermission("/biz/msgtemplate/add")
    @PostMapping("/biz/msgtemplate/add")
    public CommonResult<String> add(@RequestBody @Valid BizMessageTemplateAddParam param) {
        bizMessageTemplateService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑消息模板")
    @CommonLog("编辑消息模板")
    @SaCheckPermission("/biz/msgtemplate/edit")
    @PostMapping("/biz/msgtemplate/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizMessageTemplateEditParam param) {
        bizMessageTemplateService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除消息模板")
    @CommonLog("删除消息模板")
    @SaCheckPermission("/biz/msgtemplate/delete")
    @PostMapping("/biz/msgtemplate/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizMessageTemplateIdParam> idParamList) {
        bizMessageTemplateService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取消息模板详情")
    @SaCheckPermission("/biz/msgtemplate/detail")
    @GetMapping("/biz/msgtemplate/detail")
    public CommonResult<BizMessageTemplate> detail(@Valid BizMessageTemplateIdParam idParam) {
        return CommonResult.data(bizMessageTemplateService.detail(idParam));
    }

    @Operation(summary = "模板调试渲染与测试发送")
    @CommonLog("调试发送消息模板")
    @SaCheckPermission("/biz/msgtemplate/testSend")
    @PostMapping("/biz/msgtemplate/testSend")
    public CommonResult<JSONObject> testSend(@RequestBody @Valid BizMessageTemplateTestSendParam param) {
        return CommonResult.data(bizMessageTemplateService.testSend(param));
    }
}
