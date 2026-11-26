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
package vip.xiaonuo.biz.modular.attendance.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import vip.xiaonuo.common.pojo.CommonEntity;

/**
 * 课次签到统计快照实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_CLASS_SESSION_SNAPSHOT")
public class BizClassSessionSnapshot extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "课次ID")
    private String sessionId;

    @Schema(description = "班级ID")
    private String classId;

    @Schema(description = "学院ID")
    private String orgId;

    @Schema(description = "课程ID")
    private String courseId;

    @Schema(description = "应到人数")
    private Integer totalStudents;

    @Schema(description = "实到人数")
    private Integer checkedInCount;

    @Schema(description = "准时人数")
    private Integer onTimeCount;

    @Schema(description = "迟到人数")
    private Integer lateCount;

    @Schema(description = "请假人数")
    private Integer leaveCount;

    @Schema(description = "缺勤人数")
    private Integer absentCount;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;
}
