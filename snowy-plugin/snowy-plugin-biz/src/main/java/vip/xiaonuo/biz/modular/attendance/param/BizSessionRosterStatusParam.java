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
package vip.xiaonuo.biz.modular.attendance.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 花名册考勤状态批量微调参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizSessionRosterStatusParam {

    @Schema(description = "课次ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "sessionId不能为空")
    private String sessionId;

    @Schema(description = "状态变更列表", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotEmpty(message = "statusList不能为空")
    @Valid
    private List<RosterItem> statusList;

    @Getter
    @Setter
    public static class RosterItem {

        @Schema(description = "学生档案ID", requiredMode = Schema.RequiredMode.REQUIRED)
        @NotBlank(message = "studentId不能为空")
        private String studentId;

        @Schema(description = "考勤状态(on_time/late/leave/absent/early_leave)", requiredMode = Schema.RequiredMode.REQUIRED)
        @NotBlank(message = "status不能为空")
        private String status;
    }
}
