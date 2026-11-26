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
package vip.xiaonuo.biz.modular.clazz.controller;

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
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.param.BizClassAddParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassEditParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassIdParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassPageParam;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 班级信息控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "班级信息控制器")
@RestController
@Validated
public class BizClassController {

    @Resource
    private BizClassService bizClassService;

    @Operation(summary = "获取班级分页")
    @SaCheckPermission("/biz/clazz/page")
    @GetMapping("/biz/clazz/page")
    public CommonResult<Page<BizClass>> page(BizClassPageParam param) {
        return CommonResult.data(bizClassService.page(param));
    }

    @Operation(summary = "获取班级下拉列表")
    @SaCheckPermission("/biz/clazz/list")
    @GetMapping("/biz/clazz/list")
    public CommonResult<List<BizClass>> list(String orgId) {
        return CommonResult.data(bizClassService.listAll(orgId));
    }

    @Operation(summary = "新增班级")
    @CommonLog("新增班级")
    @SaCheckPermission("/biz/clazz/add")
    @PostMapping("/biz/clazz/add")
    public CommonResult<String> add(@RequestBody @Valid BizClassAddParam param) {
        bizClassService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "编辑班级")
    @CommonLog("编辑班级")
    @SaCheckPermission("/biz/clazz/edit")
    @PostMapping("/biz/clazz/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizClassEditParam param) {
        bizClassService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除班级")
    @CommonLog("删除班级")
    @SaCheckPermission("/biz/clazz/delete")
    @PostMapping("/biz/clazz/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizClassIdParam> idParamList) {
        bizClassService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取班级详情")
    @SaCheckPermission("/biz/clazz/detail")
    @GetMapping("/biz/clazz/detail")
    public CommonResult<BizClass> detail(@Valid BizClassIdParam idParam) {
        return CommonResult.data(bizClassService.detail(idParam));
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/clazz/orgTreeSelector")
    @GetMapping("/biz/clazz/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizClassService.orgTreeSelector(param));
    }

    @Operation(summary = "获取教师/班主任选择器")
    @SaCheckPermission("/biz/clazz/userSelector")
    @GetMapping("/biz/clazz/userSelector")
    public CommonResult<Page<JSONObject>> userSelector(String orgId, String searchKey) {
        return CommonResult.data(bizClassService.userSelector(orgId, searchKey));
    }
}
