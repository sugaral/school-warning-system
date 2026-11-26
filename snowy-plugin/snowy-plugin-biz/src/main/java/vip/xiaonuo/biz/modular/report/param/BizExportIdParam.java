package vip.xiaonuo.biz.modular.report.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizExportIdParam {

    @Schema(description = "导出任务ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "id不能为空")
    private String id;
}
