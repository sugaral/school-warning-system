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
package vip.xiaonuo.biz.modular.calendar.controller;

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
import vip.xiaonuo.biz.modular.calendar.entity.BizCalendarExclusion;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionAddParam;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionIdParam;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionPageParam;
import vip.xiaonuo.biz.modular.calendar.service.BizCalendarExclusionService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 校历排除日期控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "校历排除日期控制器")
@RestController
@Validated
public class BizCalendarExclusionController {

    @Resource
    private BizCalendarExclusionService bizCalendarExclusionService;

    @Operation(summary = "获取校历排除日分页")
    @SaCheckPermission("/biz/calendar/page")
    @GetMapping("/biz/calendar/page")
    public CommonResult<Page<BizCalendarExclusion>> page(BizCalendarExclusionPageParam param) {
        return CommonResult.data(bizCalendarExclusionService.page(param));
    }

    @Operation(summary = "新增校历排除日")
    @CommonLog("新增校历排除日")
    @SaCheckPermission("/biz/calendar/add")
    @PostMapping("/biz/calendar/add")
    public CommonResult<String> add(@RequestBody @Valid BizCalendarExclusionAddParam param) {
        bizCalendarExclusionService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除校历排除日")
    @CommonLog("删除校历排除日")
    @SaCheckPermission("/biz/calendar/delete")
    @PostMapping("/biz/calendar/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizCalendarExclusionIdParam> idParamList) {
        bizCalendarExclusionService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/calendar/orgTreeSelector")
    @GetMapping("/biz/calendar/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizCalendarExclusionService.orgTreeSelector(param));
    }
}
