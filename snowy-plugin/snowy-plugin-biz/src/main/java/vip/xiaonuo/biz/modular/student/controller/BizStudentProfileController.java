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
package vip.xiaonuo.biz.modular.student.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.param.*;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 学生档案控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "学生档案控制器")
@RestController
@Validated
public class BizStudentProfileController {

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Operation(summary = "获取学生档案分页")
    @SaCheckPermission("/biz/student/page")
    @GetMapping("/biz/student/page")
    public CommonResult<Page<BizStudentProfile>> page(BizStudentPageParam param) {
        return CommonResult.data(bizStudentProfileService.page(param));
    }

    @Operation(summary = "新增学生档案及C端账号")
    @CommonLog("新增学生档案")
    @SaCheckPermission("/biz/student/add")
    @PostMapping("/biz/student/add")
    public CommonResult<JSONObject> add(@RequestBody @Valid BizStudentAddParam param) {
        return CommonResult.data(bizStudentProfileService.add(param));
    }

    @Operation(summary = "编辑学生档案")
    @CommonLog("编辑学生档案")
    @SaCheckPermission("/biz/student/edit")
    @PostMapping("/biz/student/edit")
    public CommonResult<String> edit(@RequestBody @Valid BizStudentEditParam param) {
        bizStudentProfileService.edit(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除学生档案")
    @CommonLog("删除学生档案")
    @SaCheckPermission("/biz/student/delete")
    @PostMapping("/biz/student/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizStudentIdParam> idParamList) {
        bizStudentProfileService.delete(idParamList);
        return CommonResult.ok();
    }

    @Operation(summary = "获取学生档案详情")
    @SaCheckPermission("/biz/student/detail")
    @GetMapping("/biz/student/detail")
    public CommonResult<BizStudentProfile> detail(@Valid BizStudentIdParam idParam) {
        return CommonResult.data(bizStudentProfileService.detail(idParam));
    }

    @Operation(summary = "重置学生密码")
    @CommonLog("重置学生密码")
    @SaCheckPermission("/biz/student/resetPassword")
    @PostMapping("/biz/student/resetPassword")
    public CommonResult<JSONObject> resetPassword(@RequestBody @Valid BizStudentResetPasswordParam param) {
        return CommonResult.data(bizStudentProfileService.resetPassword(param));
    }

    @Operation(summary = "解绑学生微信")
    @CommonLog("解绑学生微信")
    @SaCheckPermission("/biz/student/unbindWechat")
    @PostMapping("/biz/student/unbindWechat")
    public CommonResult<String> unbindWechat(@RequestBody @Valid BizStudentIdParam idParam) {
        bizStudentProfileService.unbindWechat(idParam);
        return CommonResult.ok();
    }

    @Operation(summary = "导出学生账号与初始密码")
    @CommonLog("导出学生账号")
    @SaCheckPermission("/biz/student/exportAccounts")
    @GetMapping(value = "/biz/student/exportAccounts", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void exportAccounts(BizStudentPageParam param, HttpServletResponse response) {
        bizStudentProfileService.exportAccounts(param, response);
    }

    @Operation(summary = "下载学生批量导入模板")
    @SaCheckPermission("/biz/student/import")
    @GetMapping(value = "/biz/student/importTemplate", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void downloadImportTemplate(HttpServletResponse response) {
        bizStudentProfileService.downloadImportTemplate(response);
    }

    @Operation(summary = "批量导入学生档案")
    @CommonLog("批量导入学生")
    @SaCheckPermission("/biz/student/import")
    @PostMapping("/biz/student/import")
    public CommonResult<JSONObject> importStudents(
            @RequestPart("file") MultipartFile file,
            @RequestParam(value = "dryRun", defaultValue = "false") boolean dryRun) {
        return CommonResult.data(bizStudentProfileService.importStudents(file, dryRun));
    }

    @Operation(summary = "获取学院组织树选择器")
    @SaCheckPermission("/biz/student/orgTreeSelector")
    @GetMapping("/biz/student/orgTreeSelector")
    public CommonResult<List<JSONObject>> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return CommonResult.data(bizStudentProfileService.orgTreeSelector(param));
    }
}
