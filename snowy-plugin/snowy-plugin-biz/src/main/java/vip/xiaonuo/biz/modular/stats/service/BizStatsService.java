package vip.xiaonuo.biz.modular.stats.service;

import cn.hutool.json.JSONObject;
import vip.xiaonuo.biz.modular.stats.param.BizStatsOverviewParam;

public interface BizStatsService {

    JSONObject dashboard(BizStatsOverviewParam param);
}
