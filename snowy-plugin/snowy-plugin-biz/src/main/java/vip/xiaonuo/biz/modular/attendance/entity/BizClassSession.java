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
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

import java.util.Date;
import java.util.List;

/**
 * 课堂签到课次实体
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
@TableName("BIZ_CLASS_SESSION")
public class BizClassSession extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "课程ID")
    @Trans(type = TransType.SIMPLE, target = BizCourse.class, fields = "courseName", alias = "crs", ref = "courseName")
    private String courseId;

    @Schema(description = "班级ID")
    @Trans(type = TransType.SIMPLE, target = BizClass.class, fields = "className", alias = "cls", ref = "className")
    private String classId;

    @Schema(description = "任课教师ID")
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "teacher", ref = "teacherName")
    private String teacherUserId;

    @Schema(description = "签到开始时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date sessionStart;

    @Schema(description = "签到结束时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date sessionEnd;

    @JsonIgnore
    @Schema(description = "二维码令牌哈希")
    private String qrTokenHash;

    @Schema(description = "二维码过期时间")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date qrExpireAt;

    @Schema(description = "课次状态(active/ended/cancelled)")
    private String status;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @Schema(description = "课程名称")
    @TableField(exist = false)
    private String courseName;

    @Schema(description = "班级名称")
    @TableField(exist = false)
    private String className;

    @Schema(description = "任课教师姓名")
    @TableField(exist = false)
    private String teacherName;

    @Schema(description = "所属学院ID")
    @TableField(exist = false)
    private String orgId;

    @Schema(description = "所属学院名称")
    @TableField(exist = false)
    private String orgName;

    @Schema(description = "应到人数")
    @TableField(exist = false)
    private Integer totalStudents;

    @Schema(description = "实到人数")
    @TableField(exist = false)
    private Integer checkedInCount;

    @Schema(description = "准时人数")
    @TableField(exist = false)
    private Integer onTimeCount;

    @Schema(description = "迟到人数")
    @TableField(exist = false)
    private Integer lateCount;

    @Schema(description = "请假人数")
    @TableField(exist = false)
    private Integer leaveCount;

    @Schema(description = "缺勤人数")
    @TableField(exist = false)
    private Integer absentCount;

    @Schema(description = "允许的签到方式列表(qr/photo/gesture/location)")
    @TableField(exist = false)
    private List<String> checkinModes;

    @Schema(description = "二维码自动刷新间隔(秒)")
    @TableField(exist = false)
    private Integer qrRefreshSeconds;

    @Schema(description = "手势签到图案")
    @TableField(exist = false)
    private String gesturePattern;

    @Schema(description = "定位签到纬度")
    @TableField(exist = false)
    private Double locationLat;

    @Schema(description = "定位签到经度")
    @TableField(exist = false)
    private Double locationLng;

    @Schema(description = "定位签到允许半径(米)")
    @TableField(exist = false)
    private Integer locationRadiusMeters;

    @Schema(description = "定位签到地点名称")
    @TableField(exist = false)
    private String locationName;

    @Schema(description = "拍照签到提示说明")
    @TableField(exist = false)
    private String photoTip;
}
