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
package vip.xiaonuo.biz.modular.teacherbinding.controller;

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
import vip.xiaonuo.biz.modular.teacherbinding.entity.BizTeacherCourseBinding;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingAddParam;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingIdParam;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingPageParam;
import vip.xiaonuo.biz.modular.teacherbinding.service.BizTeacherCourseBindingService;
import vip.xiaonuo.common.annotation.CommonLog;
import vip.xiaonuo.common.pojo.CommonResult;

import java.util.List;

/**
 * 教师授课绑定控制器
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Tag(name = "教师授课绑定控制器")
@RestController
@Validated
public class BizTeacherCourseBindingController {

    @Resource
    private BizTeacherCourseBindingService bizTeacherCourseBindingService;

    @Operation(summary = "获取教师授课绑定分页")
    @SaCheckPermission("/biz/teacherbinding/page")
    @GetMapping("/biz/teacherbinding/page")
    public CommonResult<Page<BizTeacherCourseBinding>> page(BizTeacherCourseBindingPageParam param) {
        return CommonResult.data(bizTeacherCourseBindingService.page(param));
    }

    @Operation(summary = "新增教师授课绑定")
    @CommonLog("新增教师授课绑定")
    @SaCheckPermission("/biz/teacherbinding/add")
    @PostMapping("/biz/teacherbinding/add")
    public CommonResult<String> add(@RequestBody @Valid BizTeacherCourseBindingAddParam param) {
        bizTeacherCourseBindingService.add(param);
        return CommonResult.ok();
    }

    @Operation(summary = "删除教师授课绑定")
    @CommonLog("删除教师授课绑定")
    @SaCheckPermission("/biz/teacherbinding/delete")
    @PostMapping("/biz/teacherbinding/delete")
    public CommonResult<String> delete(@RequestBody @Valid @NotEmpty(message = "集合不能为空") List<BizTeacherCourseBindingIdParam> idParamList) {
        bizTeacherCourseBindingService.delete(idParamList);
        return CommonResult.ok();
    }
}
