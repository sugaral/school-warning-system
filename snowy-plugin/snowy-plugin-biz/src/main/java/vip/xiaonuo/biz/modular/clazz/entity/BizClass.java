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
package vip.xiaonuo.biz.modular.clazz.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.major.entity.BizMajor;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 班级信息实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_CLASS")
public class BizClass extends CommonEntity {

    /** 主键 */
    @TableId
    @Schema(description = "主键")
    private String id;

    /** 所属学院ID */
    @Schema(description = "所属学院ID")
    @Trans(type = TransType.SIMPLE, target = BizOrg.class, fields = "name", alias = "org", ref = "orgName")
    private String orgId;

    /** 专业ID */
    @Schema(description = "专业ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizMajor.class, fields = "name", alias = "majorObj", ref = "majorRefName")
    private String majorId;

    /** 班级名称 */
    @Schema(description = "班级名称")
    private String className;

    /** 入学年份 */
    @Schema(description = "入学年份")
    private Integer enrollYear;

    /** 专业名称 */
    @Schema(description = "专业名称")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String major;

    /** 年级层次 */
    @Schema(description = "年级层次")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String gradeLevel;

    /** 班主任用户ID */
    @Schema(description = "班主任用户ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "counselor", ref = "counselorName")
    private String counselorUserId;

    /** 状态(active/inactive) */
    @Schema(description = "状态(active/inactive)")
    private String status;

    /** 扩展信息 */
    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    /** 所属学院名称 */
    @Schema(description = "所属学院名称")
    @TableField(exist = false)
    private String orgName;

    /** 关联专业名称 */
    @Schema(description = "关联专业名称")
    @TableField(exist = false)
    private String majorRefName;

    /** 班主任姓名 */
    @Schema(description = "班主任姓名")
    @TableField(exist = false)
    private String counselorName;

    /** 在册学生数 */
    @Schema(description = "在册学生数")
    @TableField(exist = false)
    private Long studentCount;
}
