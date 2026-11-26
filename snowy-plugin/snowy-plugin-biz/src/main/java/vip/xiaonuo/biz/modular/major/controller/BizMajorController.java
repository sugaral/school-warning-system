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
package vip.xiaonuo.biz.modular.major.controller;

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
import vip.xiaonuo.biz.modular.major.entity.BizMajor;
import vip.xiaonuo.biz.modular.major.param.BizMajorAddParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorEditParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorIdParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorPageParam;
import vip.xiaonuo.biz.modular.major.service.BizMajorService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 专业信息控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "专业信息控制器")
@RestController
@Validated
public class BizMajorController {

    @Resource
    private BizMajorService bizMajorService;

    @Operation(summary = "获取专业分页")
    @SaCheckPermission("/biz/major/page")
    @GetMapping("/biz/major/page")
    public CommonResult<Page<BizMajor>> page(BizMajorPageParam param) {
        return CommonResult.data(bizMajorService.page(param));
    }

    @Operation(summary = "获取专业下拉列表")
    @SaCheckPermission("/biz/major/list")
    @GetMapping("/biz/major/list")
    public CommonResult<List<BizMajor>> list(String orgId) {
        return CommonResult.data(bizMajorService.listAll(orgId));
    }

    @Operation(summary = "新增专业")
    @CommonLog("新增专业")
    @SaCheckPermission("/biz/major/add")
    @PostMapping("/biz/major/add")
    public CommonResult<String> add(@RequestBody @Valid BizMajorAddParam param) {
        bizMajorService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑专业")
    @CommonLog("编辑专业")
    @SaCheckPermission("/biz/major/edit")
    @PostMapping("/biz/major/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizMajorEditParam param) {
        bizMajorService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除专业")
    @CommonLog("删除专业")
    @SaCheckPermission("/biz/major/delete")
    @PostMapping("/biz/major/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizMajorIdParam> idParamList) {
        bizMajorService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取专业详情")
    @SaCheckPermission("/biz/major/detail")
    @GetMapping("/biz/major/detail")
    public CommonResult<BizMajor> detail(@Valid BizMajorIdParam idParam) {
        return CommonResult.data(bizMajorService.detail(idParam));
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/major/orgTreeSelector")
    @GetMapping("/biz/major/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizMajorService.orgTreeSelector(param));
    }
}
