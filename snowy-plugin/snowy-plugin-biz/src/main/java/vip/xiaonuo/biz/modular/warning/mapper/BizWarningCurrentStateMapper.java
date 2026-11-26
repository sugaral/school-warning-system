package vip.xiaonuo.biz.modular.warning.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCurrentState;

public interface BizWarningCurrentStateMapper extends BaseMapper<BizWarningCurrentState> {

    /**
     * 物理删除已关闭/消警的实时预警状态，避免与 UK_BIZ_WCS_COURSE 唯一索引在同窗口重复触发时冲突
     */
    @Delete("DELETE FROM BIZ_WARNING_CURRENT_STATE WHERE ID = #{id}")
    int physicalDeleteById(@Param("id") String id);
}
