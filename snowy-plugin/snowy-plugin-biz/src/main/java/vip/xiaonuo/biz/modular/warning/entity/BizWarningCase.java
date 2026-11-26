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
package vip.xiaonuo.biz.modular.warning.entity;

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
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

import java.util.Date;
import java.util.List;

/**
 * 高风险学生干预工单实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_WARNING_CASE")
public class BizWarningCase extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "学生档案ID")
    @Trans(type = TransType.SIMPLE, target = BizStudentProfile.class, fields = "name", alias = "stu", ref = "studentName")
    private String studentId;

    @Schema(description = "班级ID")
    @Trans(type = TransType.SIMPLE, target = BizClass.class, fields = "className", alias = "cls", ref = "className")
    private String classId;

    @Schema(description = "学院ID")
    @Trans(type = TransType.SIMPLE, target = BizOrg.class, fields = "name", alias = "org", ref = "orgName")
    private String orgId;

    @Schema(description = "主关联预警ID")
    private String primaryWarningId;

    @Schema(description = "关联预警ID列表JSON")
    private String sourceWarningIdsJson;

    @Schema(description = "综合风险分")
    private Integer riskScore;

    @Schema(description = "风险构成明细JSON")
    private String riskBreakdownJson;

    @Schema(description = "预警摘要JSON")
    private String warningSummaryJson;

    @Schema(description = "处置优先级")
    private Integer handlingPriority;

    @Schema(description = "工单状态(pending_assignment/assigned/in_progress/completed/resolved)")
    private String status;

    @Schema(description = "当前处置人ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "handler", ref = "handlerName")
    private String handlerUserId;

    @Schema(description = "指派人ID")
    private String assignedBy;

    @Schema(description = "指派时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date assignedAt;

    @Schema(description = "接单时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date acceptedAt;

    @Schema(description = "完成时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date completedAt;

    @Schema(description = "结案时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date resolvedAt;

    @Schema(description = "处置结案摘要")
    private String completionSummary;

    @Schema(description = "处置详情JSON")
    private String completionDetailJson;

    @Schema(description = "最新预警时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date latestWarningAt;

    @Schema(description = "最近风险计算时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date lastRiskAt;

    @Schema(description = "是否活跃(1是/0否)")
    private Integer isActive;

    @Schema(description = "扩展信息")
    private String extJson;

    @TableField(exist = false)
    private String studentName;

    @TableField(exist = false)
    private String studentNo;

    @TableField(exist = false)
    private String className;

    @TableField(exist = false)
    private String orgName;

    @TableField(exist = false)
    private String handlerName;

    @TableField(exist = false)
    private List<BizWarningCaseLog> logs;
}
