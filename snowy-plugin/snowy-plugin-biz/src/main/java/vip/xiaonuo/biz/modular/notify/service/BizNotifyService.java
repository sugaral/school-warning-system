package vip.xiaonuo.biz.modular.notify.service;

import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationJob;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationLog;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyEnqueueParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyIdParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyJobPageParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyLogPageParam;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;

import java.util.List;

public interface BizNotifyService extends IService<BizNotificationJob> {

    Page<BizNotificationJob> jobPage(BizNotifyJobPageParam param);

    Page<BizNotificationLog> logPage(BizNotifyLogPageParam param);

    JSONObject enqueue(BizNotifyEnqueueParam param);

    void enqueueSystemWarning(BizStudentProfile student, BizWarning warning, String eventType);

    JSONObject dispatchPendingJobs(int batchSize);

    void cancelJob(BizNotifyIdParam idParam);

    void acknowledgeLog(BizNotifyIdParam idParam);

    void deleteJobs(List<BizNotifyIdParam> idParamList);
}
