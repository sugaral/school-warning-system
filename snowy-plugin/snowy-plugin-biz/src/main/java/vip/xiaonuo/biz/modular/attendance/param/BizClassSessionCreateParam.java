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
package vip.xiaonuo.biz.modular.attendance.param;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.Date;
import java.util.List;

/**
 * 发起课堂签到课次参数
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Getter
@Setter
public class BizClassSessionCreateParam {

    @Schema(description = "课程ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "courseId不能为空")
    private String courseId;

    @Schema(description = "班级ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "classId不能为空")
    private String classId;

    @Schema(description = "开始时间(不传则取当前时间)")
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date sessionStart;

    @Schema(description = "签到有效时长(分钟，默认45，范围1~240)")
    private Integer expireMinutes;

    @Schema(description = "签到有效时长(秒，优先级高于expireMinutes)")
    private Integer expireSeconds;

    @Schema(description = "允许的签到方式列表(qr/photo/gesture/location，默认[qr])")
    private List<String> checkinModes;

    @Schema(description = "二维码自动刷新间隔(秒，5~3600)")
    private Integer qrRefreshSeconds;

    @Schema(description = "手势签到图案(如 1-2-3-6-9-8-7-4-1，连接 4~25 个点位，允许重复经过已选点绘制闭合图形)")
    private String gesturePattern;

    @Schema(description = "定位签到中心纬度")
    private Double locationLat;

    @Schema(description = "定位签到中心经度")
    private Double locationLng;

    @Schema(description = "定位签到允许半径(米，默认150，范围20~5000)")
    private Integer locationRadiusMeters;

    @Schema(description = "定位签到地点名称")
    private String locationName;

    @Schema(description = "拍照签到要求提示")
    private String photoTip;
}
