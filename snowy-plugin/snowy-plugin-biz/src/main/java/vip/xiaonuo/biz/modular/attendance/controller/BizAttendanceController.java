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
package vip.xiaonuo.biz.modular.attendance.controller;

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
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.param.*;
import vip.xiaonuo.biz.modular.attendance.service.BizClassSessionService;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 课堂考勤签到控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "课堂考勤签到控制器")
@RestController
@Validated
public class BizAttendanceController {

    @Resource
    private BizClassSessionService bizClassSessionService;

    @Resource
    private BizDailyRecordService bizDailyRecordService;

    @Operation(summary = "获取签到课次分页")
    @SaCheckPermission("/biz/attendance/session/page")
    @GetMapping("/biz/attendance/session/page")
    public CommonResult<Page<BizClassSession>> sessionPage(BizClassSessionPageParam param) {
        return CommonResult.data(bizClassSessionService.page(param));
    }

    @Operation(summary = "发起课堂签到课次")
    @CommonLog("发起课堂签到课次")
    @SaCheckPermission("/biz/attendance/session/add")
    @PostMapping("/biz/attendance/session/add")
    public CommonResult<JSONObject> createSession(@RequestBody @Valid BizClassSessionCreateParam param) {
        return CommonResult.data(bizClassSessionService.createSession(param));
    }

    @Operation(summary = "按排课批量发起签到课次")
    @CommonLog("按排课批量发起签到课次")
    @SaCheckPermission("/biz/attendance/session/batchCreate")
    @PostMapping("/biz/attendance/session/batchCreate")
    public CommonResult<JSONObject> batchCreate(@RequestBody @Valid BizClassSessionBatchCreateParam param) {
        return CommonResult.data(bizClassSessionService.batchCreateFromSchedule(param));
    }

    @Operation(summary = "结束课堂签到课次")
    @CommonLog("结束课堂签到课次")
    @SaCheckPermission("/biz/attendance/session/end")
    @PostMapping("/biz/attendance/session/end")
    public CommonResult<JSONObject> endSession(@RequestBody @Valid BizClassSessionIdParam idParam) {
        return CommonResult.data(bizClassSessionService.endSession(idParam));
    }

    @Operation(summary = "批量结束签到课次")
    @CommonLog("批量结束签到课次")
    @SaCheckPermission("/biz/attendance/session/batchEnd")
    @PostMapping("/biz/attendance/session/batchEnd")
    public CommonResult<JSONObject> batchEnd(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizClassSessionIdParam> idParamList) {
        return CommonResult.data(bizClassSessionService.batchEnd(idParamList));
    }

    @Operation(summary = "删除签到课次")
    @CommonLog("删除签到课次")
    @SaCheckPermission("/biz/attendance/session/delete")
    @PostMapping("/biz/attendance/session/delete")
    public CommonResult<String> deleteSessions(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizClassSessionIdParam> idParamList) {
        bizClassSessionService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取签到课次详情")
    @SaCheckPermission("/biz/attendance/session/detail")
    @GetMapping("/biz/attendance/session/detail")
    public CommonResult<BizClassSession> sessionDetail(@Valid BizClassSessionIdParam idParam) {
        return CommonResult.data(bizClassSessionService.detail(idParam));
    }

    @Operation(summary = "获取课次动态二维码状态")
    @SaCheckPermission("/biz/attendance/session/qrState")
    @GetMapping("/biz/attendance/session/qrState")
    public CommonResult<JSONObject> getQrState(@Valid BizClassSessionIdParam idParam) {
        return CommonResult.data(bizClassSessionService.getQrState(idParam));
    }

    @Operation(summary = "强制刷新课次二维码")
    @CommonLog("强制刷新课次二维码")
    @SaCheckPermission("/biz/attendance/session/rotateQr")
    @PostMapping("/biz/attendance/session/rotateQr")
    public CommonResult<JSONObject> rotateQr(@RequestBody @Valid BizClassSessionIdParam idParam) {
        return CommonResult.data(bizClassSessionService.rotateQr(idParam));
    }

    @Operation(summary = "动态更新课次签到配置(含二维码刷新周期与多模式)")
    @CommonLog("更新课次签到配置")
    @SaCheckPermission("/biz/attendance/session/updateConfig")
    @PostMapping("/biz/attendance/session/updateConfig")
    public CommonResult<JSONObject> updateSessionConfig(@RequestBody @Valid BizClassSessionConfigUpdateParam param) {
        return CommonResult.data(bizClassSessionService.updateSessionConfig(param));
    }

    @Operation(summary = "获取课次实时花名册状态")
    @SaCheckPermission("/biz/attendance/session/roster")
    @GetMapping("/biz/attendance/session/roster")
    public CommonResult<JSONObject> getRoster(@Valid BizClassSessionIdParam idParam) {
        return CommonResult.data(bizClassSessionService.getRoster(idParam));
    }

    @Operation(summary = "批量修改花名册考勤状态")
    @CommonLog("批量修改花名册考勤状态")
    @SaCheckPermission("/biz/attendance/session/rosterStatus")
    @PostMapping("/biz/attendance/session/rosterStatus")
    public CommonResult<JSONObject> updateRosterStatus(@RequestBody @Valid BizSessionRosterStatusParam param) {
        return CommonResult.data(bizClassSessionService.updateRosterStatus(param));
    }

    @Operation(summary = "获取每日考勤与表现分页")
    @SaCheckPermission("/biz/attendance/daily/page")
    @GetMapping("/biz/attendance/daily/page")
    public CommonResult<Page<BizDailyRecord>> dailyPage(BizDailyRecordPageParam param) {
        return CommonResult.data(bizDailyRecordService.page(param));
    }

    @Operation(summary = "批量录入日考勤/作业/课堂表现")
    @CommonLog("批量录入日考勤/作业/课堂表现")
    @SaCheckPermission("/biz/attendance/daily/batchUpsert")
    @PostMapping("/biz/attendance/daily/batchUpsert")
    public CommonResult<JSONObject> batchUpsertDaily(@RequestBody @Valid @NotEmpty(message = "记录集合不能为空") List<BizDailyRecordUpsertParam> records) {
        return CommonResult.data(bizDailyRecordService.batchUpsert(records));
    }

    @Operation(summary = "删除日考勤表现记录")
    @CommonLog("删除日考勤表现记录")
    @SaCheckPermission("/biz/attendance/daily/delete")
    @PostMapping("/biz/attendance/daily/delete")
    public CommonResult<String> deleteDaily(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizDailyRecordIdParam> idParamList) {
        bizDailyRecordService.delete(idParamList);
        return CommonResult.ok();
    }
}
