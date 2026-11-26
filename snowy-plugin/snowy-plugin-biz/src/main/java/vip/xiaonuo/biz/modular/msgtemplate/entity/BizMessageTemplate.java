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
package vip.xiaonuo.biz.modular.msgtemplate.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 消息模板实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_MESSAGE_TEMPLATE")
public class BizMessageTemplate extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "通知渠道(email/sms/inbox/wechat)")
    private String channel;

    @Schema(description = "模板编码")
    private String templateCode;

    @Schema(description = "模板标题")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String title;

    @Schema(description = "模板内容")
    private String content;

    @Schema(description = "状态(active/inactive)")
    private String status;

    @Schema(description = "创建人ID")
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "creator", ref = "creatorName")
    private String createdBy;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @Schema(description = "创建人姓名")
    @TableField(exist = false)
    private String creatorName;
}
