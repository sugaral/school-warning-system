package vip.xiaonuo.biz.modular.attendance.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 动态修改课次签到配置（二维码刷新间隔、签到方式、手势/定位/拍照配置）
 */
@Getter
@Setter
public class BizClassSessionConfigUpdateParam {

    @Schema(description = "课次ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "id不能为空")
    private String id;

    @Schema(description = "允许的签到方式列表(qr/photo/gesture/location)")
    private List<String> checkinModes;

    @Schema(description = "二维码自动刷新间隔(秒，5~3600)")
    private Integer qrRefreshSeconds;

    @Schema(description = "手势签到图案(如 1-2-3-6-9)")
    private String gesturePattern;

    @Schema(description = "定位签到中心纬度")
    private Double locationLat;

    @Schema(description = "定位签到中心经度")
    private Double locationLng;

    @Schema(description = "定位签到允许半径(米，20~5000)")
    private Integer locationRadiusMeters;

    @Schema(description = "定位签到地点名称")
    private String locationName;

    @Schema(description = "拍照签到要求提示")
    private String photoTip;
}
