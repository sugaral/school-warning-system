package vip.xiaonuo.biz.modular.notify.param;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BizNotifyIdParam {

    @Schema(description = "主键ID", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotBlank(message = "id不能为空")
    private String id;
}
