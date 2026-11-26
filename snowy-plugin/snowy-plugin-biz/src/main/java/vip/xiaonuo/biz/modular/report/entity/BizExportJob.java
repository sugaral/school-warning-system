package vip.xiaonuo.biz.modular.report.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Getter;
import lombok.Setter;
import org.dromara.core.trans.anno.Trans;
import org.dromara.core.trans.constant.TransType;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.common.pojo.CommonEntity;

@Getter
@Setter
@TableName("BIZ_EXPORT_JOB")
public class BizExportJob extends CommonEntity {

    @TableId
    @Schema(description = "主键")
    private String id;

    @Schema(description = "创建用户ID")
    @Trans(type = TransType.SIMPLE, target = BizUser.class, fields = "name", alias = "creator", ref = "creatorName")
    private String creatorUserId;

    @Schema(description = "导出范围类型(school/org/class)")
    private String scopeType;

    @Schema(description = "导出范围ID")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String scopeId;

    @Schema(description = "报表类型(daily/weekly/monthly/semester/student_accounts)")
    private String reportType;

    @Schema(description = "查询参数JSON")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String paramsJson;

    @Schema(description = "任务状态(queued/processing/completed/failed)")
    private String status;

    @Schema(description = "生成文件ID(DEV_FILE)")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String fileId;

    @Schema(description = "错误信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String errorMsg;

    @Schema(description = "扩展信息")
    @TableField(insertStrategy = FieldStrategy.ALWAYS, updateStrategy = FieldStrategy.ALWAYS)
    private String extJson;

    @TableField(exist = false)
    private String creatorName;

    @TableField(exist = false)
    private String fileName;
}
