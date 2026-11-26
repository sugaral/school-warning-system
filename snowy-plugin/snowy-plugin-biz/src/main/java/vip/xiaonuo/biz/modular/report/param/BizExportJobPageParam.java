package vip.xiaonuo.biz.modular.report.param;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizExportJobPageParam {

    @Schema(description = "当前页")
    private Integer current;

    @Schema(description = "每页条数")
    private Integer size;

    @Schema(description = "报表类型")
    private String reportType;

    @Schema(description = "范围类型")
    private String scopeType;

    @Schema(description = "状态")
    private String status;
}
