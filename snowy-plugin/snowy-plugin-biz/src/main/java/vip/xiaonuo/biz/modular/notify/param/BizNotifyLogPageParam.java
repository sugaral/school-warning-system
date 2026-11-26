package vip.xiaonuo.biz.modular.notify.param;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizNotifyLogPageParam {

    @Schema(description = "当前页")
    private Integer current;

    @Schema(description = "每页条数")
    private Integer size;

    @Schema(description = "任务ID")
    private String jobId;

    @Schema(description = "渠道")
    private String channel;

    @Schema(description = "发送状态")
    private String sendStatus;

    @Schema(description = "关键词(接收者/内容)")
    private String searchKey;
}
