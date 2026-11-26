package vip.xiaonuo.biz.modular.report.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;

@Getter
@Setter
public class BizExportCreateParam {

    @Schema(description = "报表类型(daily/weekly/monthly/semester/student_accounts)", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "reportType不能为空")
    private String reportType;

    @Schema(description = "导出范围(school/org/class)")
    private String scopeType;

    @Schema(description = "范围ID(学院ID或班级ID)")
    private String scopeId;

    @Schema(description = "附加筛选参数")
    private Map<String, Object> params;
}
