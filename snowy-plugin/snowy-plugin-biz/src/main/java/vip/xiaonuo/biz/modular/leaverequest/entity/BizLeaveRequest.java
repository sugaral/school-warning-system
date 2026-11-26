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
package vip.xiaonuo.biz.modular.leaverequest.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

import java.util.Date;

/**
 * 请假申请实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_LEAVE_REQUEST")
public class BizLeaveRequest extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "学生档案ID")
    @Trans(type = TransType.SIMPLE, target = BizStudentProfile.class, fields = "name", alias = "stu", ref = "studentName")
    private String studentId;

    @Schema(description = "班级ID")
    @Trans(type = TransType.SIMPLE, target = BizClass.class, fields = "className", alias = "cls", ref = "className")
    private String classId;

    @Schema(description = "请假开始时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date fromDate;

    @Schema(description = "请假结束时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date toDate;

    @Schema(description = "请假原因")
    private String reason;

    @Schema(description = "主凭证文件ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String proofFileId;

    @Schema(description = "多凭证文件ID列表JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String proofFileIdsJson;

    @Schema(description = "审批状态(submitted/approved/rejected)")
    private String status;

    @Schema(description = "审批人ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "approver", ref = "approverName")
    private String approverUserId;

    @Schema(description = "通过时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date approvedAt;

    @Schema(description = "驳回时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date rejectedAt;

    @Schema(description = "驳回原因")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String rejectReason;

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

    @Schema(description = "审批人姓名")
    @TableField(exist = false)
    private String approverName;
}
