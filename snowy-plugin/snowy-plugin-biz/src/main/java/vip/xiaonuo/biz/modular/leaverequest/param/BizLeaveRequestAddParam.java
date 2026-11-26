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
package vip.xiaonuo.biz.modular.leaverequest.param;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/**
 * 请假申请新增参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizLeaveRequestAddParam {

    @Schema(description = "学生档案ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "studentId不能为空")
    private String studentId;

    @Schema(description = "开始时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "fromDate不能为空")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date fromDate;

    @Schema(description = "结束时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "toDate不能为空")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date toDate;

    @Schema(description = "请假原因", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "reason不能为空")
    private String reason;
}
