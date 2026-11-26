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
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.common.pojo.CommonEntity;

import java.math.BigDecimal;
import java.util.Date;

/**
 * 学生学期学业汇总实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_TERM_SUMMARY")
public class BizTermSummary extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "学生档案ID")
    @Trans(type = TransType.SIMPLE, target = BizStudentProfile.class, fields = "name", alias = "stu", ref = "studentName")
    private String studentId;

    @Schema(description = "学期编码")
    private String termCode;

    @Schema(description = "挂科门数")
    private Integer failedCourseCount;

    @Schema(description = "已获学分")
    private BigDecimal earnedCredits;

    @Schema(description = "应修学分")
    private BigDecimal requiredCredits;

    @Schema(description = "平均学分绩点")
    private BigDecimal gpa;

    @Schema(description = "生成时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date generatedAt;

    @Schema(description = "扩展信息")
    private String extJson;

    @TableField(exist = false)
    private String studentName;

    @TableField(exist = false)
    private String studentNo;

    @TableField(exist = false)
    private String className;
}
