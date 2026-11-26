package vip.xiaonuo.biz.modular.notify.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.List;
import java.util.Map;

@Getter
@Setter
public class BizNotifyEnqueueParam {

    @Schema(description = "发送渠道(inbox/email/sms/wechat)", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "channel不能为空")
    private String channel;

    @Schema(description = "触发方式(manual/auto/rule)")
    private String triggerType;

    @Schema(description = "关联预警ID")
    private String warningId;

    @Schema(description = "模板编码")
    private String templateCode;

    @Schema(description = "学生ID列表")
    private List<String> studentIds;

    @Schema(description = "接收者地址/用户ID列表")
    private List<String> receivers;

    @Schema(description = "自定义标题")
    private String title;

    @Schema(description = "自定义正文")
    private String content;

    @Schema(description = "模板参数映射")
    private Map<String, Object> params;

    @Schema(description = "冷却去重键")
    private String cooldownKey;

    @Schema(description = "冷却分钟数(默认60)")
    private Integer cooldownMinutes;

    @Schema(description = "是否立即分发")
    private Boolean dispatchNow;
}
