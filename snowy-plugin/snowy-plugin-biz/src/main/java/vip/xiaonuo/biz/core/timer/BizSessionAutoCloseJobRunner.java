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
package vip.xiaonuo.biz.core.timer;

import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vip.xiaonuo.biz.modular.attendance.service.BizClassSessionService;
import vip.xiaonuo.common.timer.CommonTimerTaskRunner;

/**
 * 超时课次自动结课判缺勤定时任务（对接 DEV_JOB 1909100000000000002）
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Component
public class BizSessionAutoCloseJobRunner implements CommonTimerTaskRunner {

    @Resource
    private BizClassSessionService bizClassSessionService;

    @Override
    public void action(String extJson) {
        int closed = bizClassSessionService.autoCloseExpiredSessions();
        if (closed > 0) {
            log.info("[BizSessionAutoCloseJobRunner] 本轮自动结算超时课次数量={}", closed);
        }
    }
}
