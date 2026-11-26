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
package vip.xiaonuo.biz.modular.workbench.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 学院通知防骚扰策略保存参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizWorkbenchNoticeStrategyParam {

    @Schema(description = "学院ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "orgId不能为空")
    private String orgId;

    @Schema(description = "是否启用策略")
    private Boolean enabled;

    @Schema(description = "生成预警时通知")
    private Boolean notifyOnCreate;

    @Schema(description = "预警升级时通知")
    private Boolean notifyOnUpgrade;

    @Schema(description = "预警关闭时通知")
    private Boolean notifyOnClose;

    @Schema(description = "通知学生本人")
    private Boolean notifyStudent;

    @Schema(description = "通知班主任")
    private Boolean notifyHeadTeacher;

    @Schema(description = "通知辅导员/学工")
    private Boolean notifyCounselor;

    @Schema(description = "通知家长")
    private Boolean notifyParents;

    @Schema(description = "推送通道列表(sms/wechat/email)")
    private List<String> channels;
}
