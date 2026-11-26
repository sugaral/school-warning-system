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

import cn.hutool.json.JSONObject;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Component;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.common.timer.CommonTimerTaskRunner;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.concurrent.TimeUnit;

/**
 * 每日学业预警全量扫描定时任务（对接 DEV_JOB 1909100000000000003）
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Component
public class BizDailyWarningScanJobRunner implements CommonTimerTaskRunner {

    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Resource
    private RedissonClient redissonClient;

    @Override
    public void action(String extJson) {
        RLock lock = redissonClient.getLock("lock:warning:daily-scan");
        boolean locked = false;
        try {
            locked = lock.tryLock(0, 300, TimeUnit.SECONDS);
            if (!locked) {
                return;
            }
            JSONObject res = bizWarningEngineService.scanAll(LocalDate.now(ZoneId.of("Asia/Shanghai")), null, null);
            log.info("[BizDailyWarningScanJobRunner] 每日预警扫描完成: {}", res);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
