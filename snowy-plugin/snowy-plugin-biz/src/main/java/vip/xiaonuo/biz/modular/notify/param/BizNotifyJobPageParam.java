package vip.xiaonuo.biz.modular.notify.param;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizNotifyJobPageParam {

    @Schema(description = "当前页")
    private Integer current;

    @Schema(description = "每页条数")
    private Integer size;

    @Schema(description = "渠道")
    private String channel;

    @Schema(description = "状态")
    private String status;

    @Schema(description = "关联预警ID")
    private String warningId;

    @Schema(description = "关键词(模板编码/接收人)")
    private String searchKey;
}
