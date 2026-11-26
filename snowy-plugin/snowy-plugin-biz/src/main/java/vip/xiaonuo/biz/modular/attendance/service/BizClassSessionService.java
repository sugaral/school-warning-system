/*
 * Copyright [2022] [https://www.xiaonuo.vip]
 *
 * Snowy采用APACHE LICENSE 2.0开源协议，您在使用过程中，需要注意以下几点：
 *
 * 1.请不要删除和修改根目录下的LICENSE文件。
 * 2.请不要删除和修改Snowy源码头部的版权声明。
 * 3.本项目代码可免费商业使用，商业使用请保留源码和相关描述文件的项目出处，作者声明等。
 * 4.分发源码时候，请注明软件出处 https://www.xiaonuo.vip
 * 5.不可二次分发开源参与同类竞品，如有想法可联系团队xiaonuobase@qq.com商议合作。
 * 6.若您的项目无法满足以上几点，需要更多功能代码，获取Snowy商业授权许可，请在官网购买授权，地址为 https://www.xiaonuo.vip
 */
package vip.xiaonuo.biz.modular.attendance.service;

import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.param.*;

import java.util.List;
import java.util.Map;

/**
 * 课堂签到课次Service接口
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public interface BizClassSessionService extends IService<BizClassSession> {

    Page<BizClassSession> page(BizClassSessionPageParam param);

    JSONObject createSession(BizClassSessionCreateParam param);

    JSONObject batchCreateFromSchedule(BizClassSessionBatchCreateParam param);

    JSONObject endSession(BizClassSessionIdParam idParam);

    JSONObject batchEnd(List<BizClassSessionIdParam> idParamList);

    void delete(List<BizClassSessionIdParam> idParamList);

    BizClassSession detail(BizClassSessionIdParam idParam);

    JSONObject getQrState(BizClassSessionIdParam idParam);

    JSONObject rotateQr(BizClassSessionIdParam idParam);

    JSONObject updateSessionConfig(BizClassSessionConfigUpdateParam param);

    JSONObject getRoster(BizClassSessionIdParam idParam);

    JSONObject updateRosterStatus(BizSessionRosterStatusParam param);

    /**
     * 学生扫码核销签到（供 C 端或验证链路调用）
     */
    JSONObject scanCheckin(String sessionId, String scanToken, String studentId);

    /**
     * 学生多模式统一签到（支持 qr/photo/gesture/location）
     */
    JSONObject studentCheckin(String studentId, Map<String, Object> body);

    /**
     * 定时任务自动开课：将到点活跃排课转化为课堂签到课次
     */
    int autoOpenDueSchedules();

    /**
     * 定时任务自动结课：结算到期课次缺勤/请假记录
     */
    int autoCloseExpiredSessions();

    BizClassSession queryEntity(String id);
}
