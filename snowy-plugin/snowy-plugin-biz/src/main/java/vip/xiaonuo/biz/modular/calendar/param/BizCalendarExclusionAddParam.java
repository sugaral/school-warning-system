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
package vip.xiaonuo.biz.modular.calendar.param;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 校历排除日新增参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizCalendarExclusionAddParam {

    @Schema(description = "作用域(school/org)", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "scope不能为空")
    private String scope;

    @Schema(description = "学院ID(scope为org时必填)")
    private String scopeId;

    @Schema(description = "排除日期", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "exclusionDate不能为空")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date exclusionDate;

    @Schema(description = "排除原因")
    private String reason;
}
