package vip.xiaonuo.biz.modular.stats.param;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizStatsOverviewParam {

    @Schema(description = "视角类型(school/org/class)")
    private String viewType;

    @Schema(description = "学院ID")
    private String orgId;

    @Schema(description = "班级ID")
    private String classId;
}
