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
package vip.xiaonuo.biz.modular.warningrule.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 学业预警规则实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_WARNING_RULE")
public class BizWarningRule extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "规则范围(school/college)")
    private String scope;

    @Schema(description = "范围对象ID(院级时为学院ID)")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizOrg.class, fields = "name", alias = "org", ref = "orgName")
    private String scopeId;

    @Schema(description = "规则版本号")
    private Integer ruleVersion;

    @Schema(description = "预警等级(yellow/orange/red/severe)")
    private String level;

    @Schema(description = "统计窗口(day/week/month/term)")
    private String windowType;

    @Schema(description = "统计指标")
    private String metric;

    @Schema(description = "触发阈值")
    private Integer threshold;

    @Schema(description = "是否启用(true启用/false停用)")
    private Boolean enabled;

    @Schema(description = "排除条件JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String exclusionsJson;

    @Schema(description = "通知策略JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String notifyStrategyJson;

    @Schema(description = "创建人ID")
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "creator", ref = "creatorName")
    private String createdBy;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @Schema(description = "所属学院名称")
    @TableField(exist = false)
    private String orgName;

    @Schema(description = "创建人姓名")
    @TableField(exist = false)
    private String creatorName;
}
