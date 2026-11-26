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
package vip.xiaonuo.biz.modular.clazz.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

/**
 * 班级新增参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizClassAddParam {

    @Schema(description = "所属学院ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "orgId不能为空")
    private String orgId;

    @Schema(description = "专业ID")
    private String majorId;

    @Schema(description = "班级名称", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "className不能为空")
    private String className;

    @Schema(description = "入学年份", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "enrollYear不能为空")
    private Integer enrollYear;

    @Schema(description = "专业名称")
    private String major;

    @Schema(description = "年级层次")
    private String gradeLevel;

    @Schema(description = "班主任用户ID")
    private String counselorUserId;

    @Schema(description = "状态(active/inactive)")
    private String status;

    @Schema(description = "扩展信息")
    private String extJson;
}
