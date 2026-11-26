package vip.xiaonuo.biz.modular.report.service;

import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import jakarta.servlet.http.HttpServletResponse;
import vip.xiaonuo.biz.modular.report.entity.BizExportJob;
import vip.xiaonuo.biz.modular.report.param.BizExportCreateParam;
import vip.xiaonuo.biz.modular.report.param.BizExportIdParam;
import vip.xiaonuo.biz.modular.report.param.BizExportJobPageParam;

import java.util.List;

public interface BizReportService extends IService<BizExportJob> {

    Page<BizExportJob> page(BizExportJobPageParam param);

    JSONObject createAndRun(BizExportCreateParam param);

    void download(String id, HttpServletResponse response);

    void delete(List<BizExportIdParam> idParamList);
}
