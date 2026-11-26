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
package vip.xiaonuo.biz.modular.client.controller;

import cn.hutool.json.JSONObject;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.modular.client.service.BizClientWarnsysService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;
import java.util.Map;

/**
 * 微信小程序 C端控制器 (/client/c/warnsys/**，受 GlobalConfigure StpClientUtil 强制隔离保护)
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "小程序C端学生控制器")
@RestController
@RequestMapping("/client/c/warnsys")
public class BizClientWarnsysController {

    @Resource
    private BizClientWarnsysService clientWarnsysService;

    @Operation(summary = "C端学号密码/微信登录")
    @PostMapping("/auth/login")
    public CommonResult<JSONObject> login(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.login(body));
    }

    @Operation(summary = "C端微信一键登录")
    @PostMapping("/auth/wxLogin")
    public CommonResult<JSONObject> wxLogin(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.wxLogin(body));
    }

    @Operation(summary = "C端退出登录")
    @PostMapping("/auth/logout")
    public CommonResult<String> logout() {
        clientWarnsysService.logout();
        return CommonResult.ok();
    }

    @Operation(summary = "发送验证码")
    @PostMapping("/auth/sendCode")
    public CommonResult<JSONObject> sendCode(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.sendCode(body));
    }

    @Operation(summary = "核验验证码")
    @PostMapping("/auth/verifyCode")
    public CommonResult<JSONObject> verifyCode(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.verifyCode(body));
    }

    @Operation(summary = "查询密码找回方式")
    @PostMapping("/auth/recovery/options")
    public CommonResult<JSONObject> recoveryOptions(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.recoveryOptions(body));
    }

    @Operation(summary = "找回密码邮件验证码")
    @PostMapping("/auth/recovery/sendEmailCode")
    public CommonResult<JSONObject> sendRecoveryEmailCode(@RequestBody Map<String, Object> body) {
        body.put("channel", "email");
        return CommonResult.data(clientWarnsysService.sendCode(body));
    }

    @Operation(summary = "找回密码短信验证码")
    @PostMapping("/auth/recovery/sendSmsCode")
    public CommonResult<JSONObject> sendRecoverySmsCode(@RequestBody Map<String, Object> body) {
        body.put("channel", "sms");
        return CommonResult.data(clientWarnsysService.sendCode(body));
    }

    @Operation(summary = "找回密码重置(SM2)")
    @PostMapping("/auth/recovery/resetPassword")
    public CommonResult<JSONObject> resetPassword(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.resetPassword(body));
    }

    @PostMapping("/student/bindWechat")
    public CommonResult<JSONObject> bindWechat(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.bindWechat(body));
    }

    @PostMapping("/student/bindEmail")
    public CommonResult<JSONObject> bindEmail(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.bindEmail(body));
    }

    @PostMapping("/student/bindPhone")
    public CommonResult<JSONObject> bindPhone(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.bindPhone(body));
    }

    @PostMapping("/student/bindClass")
    public CommonResult<JSONObject> bindClass(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.bindClass(body));
    }

    @GetMapping("/student/availableClasses")
    public CommonResult<List<JSONObject>> availableClasses() {
        return CommonResult.data(clientWarnsysService.availableClasses());
    }

    @GetMapping("/student/profile")
    public CommonResult<JSONObject> getProfile() {
        return CommonResult.data(clientWarnsysService.getProfile());
    }

    @PutMapping("/student/profile")
    public CommonResult<JSONObject> updateProfile(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.updateProfile(body));
    }

    @CommonLog("C端学生改密")
    @PostMapping("/student/changePassword")
    public CommonResult<String> changePassword(@RequestBody Map<String, Object> body) {
        clientWarnsysService.changePassword(body);
        return CommonResult.ok();
    }

    @GetMapping("/student/teachers")
    public CommonResult<List<JSONObject>> getTeachers() {
        return CommonResult.data(clientWarnsysService.getTeachers());
    }

    @GetMapping("/student/today")
    public CommonResult<JSONObject> today() {
        return CommonResult.data(clientWarnsysService.today());
    }

    @GetMapping("/student/weekly")
    public CommonResult<List<JSONObject>> weekly() {
        return CommonResult.data(clientWarnsysService.weekly());
    }

    @GetMapping("/student/summaries")
    public CommonResult<JSONObject> summaries(@RequestParam(required = false) Map<String, String> query) {
        return CommonResult.data(clientWarnsysService.summaries(query));
    }

    @GetMapping("/student/courses")
    public CommonResult<List<JSONObject>> courses() {
        return CommonResult.data(clientWarnsysService.courses());
    }

    @GetMapping("/student/warnings")
    public CommonResult<JSONObject> warnings(@RequestParam(required = false) Map<String, String> query) {
        return CommonResult.data(clientWarnsysService.warnings(query));
    }

    @PostMapping("/student/warnings/{id}/confirm")
    public CommonResult<String> confirmWarning(@PathVariable String id) {
        clientWarnsysService.confirmWarning(id);
        return CommonResult.ok();
    }

    @GetMapping("/student/leaveRequests")
    public CommonResult<JSONObject> leaveRequests(@RequestParam(required = false) Map<String, String> query) {
        return CommonResult.data(clientWarnsysService.leaveRequests(query));
    }

    @PostMapping("/student/leaveRequests")
    public CommonResult<JSONObject> createLeave(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.createLeave(body));
    }

    @GetMapping("/student/appeals")
    public CommonResult<JSONObject> appeals(@RequestParam(required = false) Map<String, String> query) {
        return CommonResult.data(clientWarnsysService.appeals(query));
    }

    @PostMapping("/student/appeals")
    public CommonResult<JSONObject> createAppeal(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.createAppeal(body));
    }

    @GetMapping("/student/classChangeRequests")
    public CommonResult<List<JSONObject>> classChangeRequests() {
        return CommonResult.data(clientWarnsysService.classChangeRequests());
    }

    @PostMapping("/student/classChangeRequests")
    public CommonResult<JSONObject> createClassChange(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.createClassChange(body));
    }

    @GetMapping("/student/inbox")
    public CommonResult<JSONObject> inbox(@RequestParam(required = false) Map<String, String> query) {
        return CommonResult.data(clientWarnsysService.inbox(query));
    }

    @GetMapping("/student/inbox/unreadCount")
    public CommonResult<JSONObject> inboxUnreadCount() {
        return CommonResult.data(clientWarnsysService.inboxUnreadCount());
    }

    @PostMapping("/student/inbox/{id}/read")
    public CommonResult<String> readInbox(@PathVariable String id) {
        clientWarnsysService.readInbox(id);
        return CommonResult.ok();
    }

    @PostMapping("/student/inbox/readAll")
    public CommonResult<String> readAllInbox() {
        clientWarnsysService.readAllInbox();
        return CommonResult.ok();
    }

    @GetMapping("/student/preferences")
    public CommonResult<JSONObject> getPreferences() {
        return CommonResult.data(clientWarnsysService.getPreferences());
    }

    @PutMapping("/student/preferences")
    public CommonResult<JSONObject> updatePreferences(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.updatePreferences(body));
    }

    @Operation(summary = "获取当前班级进行中的签到课次")
    @GetMapping("/attendance/activeSessions")
    public CommonResult<List<JSONObject>> activeSessions() {
        return CommonResult.data(clientWarnsysService.activeSessions());
    }

    @CommonLog("C端课堂多模式签到")
    @PostMapping("/attendance/checkin")
    public CommonResult<JSONObject> checkin(@RequestBody Map<String, Object> body) {
        return CommonResult.data(clientWarnsysService.checkin(body));
    }

    @PostMapping("/file/upload")
    public CommonResult<JSONObject> uploadFile(@RequestPart("file") MultipartFile file) {
        return CommonResult.data(clientWarnsysService.uploadFile(file));
    }

    @GetMapping(value = "/file/download", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadFile(@RequestParam String id, HttpServletResponse response) {
        clientWarnsysService.downloadFile(id, response);
    }
}
