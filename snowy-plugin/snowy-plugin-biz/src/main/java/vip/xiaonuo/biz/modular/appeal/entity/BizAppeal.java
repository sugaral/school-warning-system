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
package vip.xiaonuo.biz.modular.appeal.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 学生申诉工单实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_APPEAL")
public class BizAppeal extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "学生档案ID")
    @Trans(type = TransType.SIMPLE, target = BizStudentProfile.class, fields = "name", alias = "stu", ref = "studentName")
    private String studentId;

    @Schema(description = "申诉类型")
    private String appealType;

    @Schema(description = "关联业务类型")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String relatedType;

    @Schema(description = "关联业务ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String relatedId;

    @Schema(description = "申诉内容")
    private String content;

    @Schema(description = "主凭证文件ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String evidenceFileId;

    @Schema(description = "多凭证文件ID列表JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String evidenceFileIdsJson;

    @Schema(description = "处理状态(submitted/approved/resolved/rejected)")
    private String status;

    @Schema(description = "处理人ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "handler", ref = "handlerName")
    private String handlerUserId;

    @Schema(description = "处理结果说明")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String resultNote;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @Schema(description = "学生姓名")
    @TableField(exist = false)
    private String studentName;

    @Schema(description = "学号")
    @TableField(exist = false)
    private String studentNo;

    @Schema(description = "班级名称")
    @TableField(exist = false)
    private String className;

    @Schema(description = "处理人姓名")
    @TableField(exist = false)
    private String handlerName;
}
