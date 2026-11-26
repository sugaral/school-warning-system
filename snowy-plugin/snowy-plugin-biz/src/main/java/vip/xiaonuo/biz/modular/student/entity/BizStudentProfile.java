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
package vip.xiaonuo.biz.modular.student.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.common.handler.CommonSm4CbcTypeHandler;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 学生档案实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName(value = "BIZ_STUDENT_PROFILE", autoResultMap = true)
public class BizStudentProfile extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "C端用户ID")
    private String clientUserId;

    @Schema(description = "学号")
    private String studentNo;

    @Schema(description = "学生姓名")
    private String name;

    @Schema(description = "性别")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String gender;

    @Schema(description = "证件照文件ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String photoFileId;

    @Schema(description = "所属班级ID")
    @Trans(type = TransType.SIMPLE, target = BizClass.class, fields = "className", alias = "cls", ref = "className")
    private String classId;

    @Schema(description = "所属学院ID")
    @Trans(type = TransType.SIMPLE, target = BizOrg.class, fields = "name", alias = "org", ref = "orgName")
    private String orgId;

    @Schema(description = "专业ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String majorId;

    @Schema(description = "专业名称")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String major;

    @Schema(description = "入学年份")
    private Integer enrollYear;

    @Schema(description = "手机号(SM4加密)")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS, typeHandler = CommonSm4CbcTypeHandler.class)
    private String mobile;

    @Schema(description = "邮箱")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String email;

    @Schema(description = "紧急联系人姓名")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String emergencyContactName;

    @Schema(description = "紧急联系人手机(SM4加密)")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS, typeHandler = CommonSm4CbcTypeHandler.class)
    private String emergencyContactMobile;

    @Schema(description = "通知偏好配置JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String notifyPrefsJson;

    @Schema(description = "学籍状态(active/inactive/graduated)")
    private String status;

    @JsonIgnore
    @Schema(description = "初始密码密文(SM4加密)")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS, typeHandler = CommonSm4CbcTypeHandler.class)
    private String initialPassword;

    @Schema(description = "学生职务")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String studentPosition;

    @Schema(description = "微信OpenID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String wxOpenid;

    @Schema(description = "微信UnionID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String wxUnionid;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @Schema(description = "所属班级名称")
    @TableField(exist = false)
    private String className;

    @Schema(description = "所属学院名称")
    @TableField(exist = false)
    private String orgName;

    @Schema(description = "是否已绑定微信")
    @TableField(exist = false)
    private Boolean wechatBound;
}
