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
 * 学生当前实时预警状态实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_WARNING_CURRENT_STATE")
public class BizWarningCurrentState extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "学生档案ID")
    private String studentId;

    @Schema(description = "班级ID")
    private String classId;

    @Schema(description = "学院ID")
    private String orgId;

    @Schema(description = "预警指标")
    private String metric;

    @Schema(description = "预警等级")
    private String level;

    @Schema(description = "统计窗口")
    private String windowType;

    @Schema(description = "周期开始日期")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date periodStart;

    @Schema(description = "周期结束日期")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date periodEnd;

    @Schema(description = "课程唯一键")
    private String courseKey;

    @Schema(description = "课程ID")
    private String courseId;

    @Schema(description = "规则ID")
    private String ruleId;

    @Schema(description = "规则快照JSON")
    private String ruleSnapshotJson;

    @Schema(description = "触发摘要")
    private String triggerSummary;

    @Schema(description = "触发明细JSON")
    private String triggerDetailJson;

    @Schema(description = "当前累计次数")
    private Integer currentCount;

    @Schema(description = "状态(open/acknowledged)")
    private String status;

    @Schema(description = "确认时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date acknowledgedAt;

    @Schema(description = "确认人ID")
    private String acknowledgedBy;

    @Schema(description = "扩展信息")
    private String extJson;

    @TableField(exist = false)
    private String studentName;

    @TableField(exist = false)
    private String studentNo;
}
