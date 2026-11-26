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
package vip.xiaonuo.biz.modular.attendance.util;

import cn.hutool.core.util.RandomUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import cn.hutool.json.JSONObject;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;

/**
 * 课堂动态轮换二维码算法工具（时间窗滚动口令 + 随机盐种子重置）
 *
 * @author migration-bot
 * @date 2026/11/25
 */
public final class BizAttendanceQrUtil {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    private BizAttendanceQrUtil() {
    }

    @Getter
    @AllArgsConstructor
    public static class RollingQrState {
        private final long bucketIndex;
        private final String scanToken;
        private final Date nextRefreshAt;
        private final long countdownSeconds;
        private final int refreshSeconds;
    }

    /**
     * 生成高熵课次二维码种子哈希
     */
    public static String generateTokenHash(String classId, String courseId, Date sessionStart) {
        String salt = RandomUtil.randomString(16);
        String raw = classId + ":" + courseId + ":" + Instant.ofEpochMilli(sessionStart.getTime()) + ":" + salt;
        return DigestUtil.sha256Hex(raw);
    }

    /**
     * 计算指定时间片对应的 16 位动态口令
     */
    public static String buildRollingScanToken(String seedHash, long bucketIndex) {
        return DigestUtil.sha256Hex(seedHash + ":" + bucketIndex).substring(0, 16);
    }

    public static long getQrBucketIndex(Date sessionStart, int refreshSeconds, Date now) {
        long elapsedSeconds = Math.max(0L, (now.getTime() - sessionStart.getTime()) / 1000L);
        return elapsedSeconds / Math.max(1, refreshSeconds);
    }

    public static RollingQrState computeRollingState(Date sessionStart, Date sessionEnd, String qrTokenHash, int refreshSeconds, Date now) {
        int safeRefresh = Math.max(1, refreshSeconds);
        long bucketIndex = getQrBucketIndex(sessionStart, safeRefresh, now);
        long nextRefreshMs = sessionStart.getTime() + (bucketIndex + 1) * safeRefresh * 1000L;
        long deadlineMs = sessionEnd != null ? sessionEnd.getTime() : nextRefreshMs;
        long boundedNextMs = Math.min(nextRefreshMs, deadlineMs);
        long countdownSeconds = Math.max(0L, (boundedNextMs - now.getTime() + 999L) / 1000L);
        return new RollingQrState(
                bucketIndex,
                buildRollingScanToken(qrTokenHash, bucketIndex),
                new Date(boundedNextMs),
                countdownSeconds,
                safeRefresh
        );
    }

    /**
     * 校验动态口令（允许 leewayBuckets 个上一时间片宽限，防止压线扫码失败；换码后因 seed 改变旧码立即失效）
     */
    public static boolean isRollingTokenValid(String providedToken, String qrTokenHash, Date sessionStart, int refreshSeconds, Date now, int leewayBuckets) {
        if (StrUtil.isBlank(providedToken) || StrUtil.isBlank(qrTokenHash)) {
            return false;
        }
        String trimmed = StrUtil.trim(providedToken);
        int safeRefresh = Math.max(1, refreshSeconds);
        long currentBucket = getQrBucketIndex(sessionStart, safeRefresh, now);
        int leeway = Math.max(0, leewayBuckets);
        for (int offset = 0; offset <= leeway; offset++) {
            long idx = Math.max(0L, currentBucket - offset);
            if (buildRollingScanToken(qrTokenHash, idx).equals(trimmed)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 按 Asia/Shanghai 计算考勤归属日期（java.sql.Date，避免 JVM 时区与 MySQL DATE 偏移）
     */
    public static Date computeRecordDate(Date sessionStart) {
        LocalDate localDate = Instant.ofEpochMilli(sessionStart.getTime()).atZone(ZONE_SHANGHAI).toLocalDate();
        return java.sql.Date.valueOf(localDate);
    }

    /**
     * 构建小程序端扫描二维码携带的标准载荷 JSON
     */
    public static String buildQrPayloadJson(String sessionId, String scanToken) {
        return new JSONObject()
                .set("type", "warnsys_checkin")
                .set("sessionId", sessionId)
                .set("scanToken", scanToken)
                .toString();
    }
}
