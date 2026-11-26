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
package vip.xiaonuo.biz.modular.notify.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import vip.xiaonuo.common.pojo.CommonEntity;

import java.util.Date;

/**
 * 通知异步队列任务实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_NOTIFICATION_JOB")
public class BizNotificationJob extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "触发方式(auto/rule/manual)")
    private String triggerType;

    @Schema(description = "关联预警ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String warningId;

    @Schema(description = "发送人ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String senderUserId;

    @Schema(description = "发送渠道(inbox/email/sms/wechat/app)")
    private String channel;

    @Schema(description = "模板编码")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String templateCode;

    @Schema(description = "接收者列表JSON")
    private String receiversJson;

    @Schema(description = "模板参数JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String paramsJson;

    @Schema(description = "计划调度时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date scheduleAt;

    @Schema(description = "冷却去重键")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String cooldownKey;

    @Schema(description = "任务状态(queued/deferred/sent/completed/failed/cancelled)")
    private String status;

    @Schema(description = "重试次数")
    private Integer tryCount;

    @Schema(description = "最后错误信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String lastError;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;
}
