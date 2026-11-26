package vip.xiaonuo.biz.modular.stats.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import vip.xiaonuo.biz.modular.stats.param.BizStatsOverviewParam;
import vip.xiaonuo.biz.modular.stats.service.BizStatsService;
import vip.xiaonuo.common.pojo.CommonResult;

@Tag(name = "学业统计大屏控制器")
@RestController
@Validated
public class BizStatsController {

    @Resource
    private BizStatsService bizStatsService;

    @Operation(summary = "获取校/院/班三视角ECharts统计看板数据")
    @SaCheckPermission("/biz/stats/dashboard")
    @GetMapping("/biz/stats/dashboard")
    public CommonResult<JSONObject> dashboard(BizStatsOverviewParam param) {
        return CommonResult.data(bizStatsService.dashboard(param));
    }
}
