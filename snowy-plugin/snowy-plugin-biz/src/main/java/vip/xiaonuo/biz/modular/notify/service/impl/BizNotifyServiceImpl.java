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
package vip.xiaonuo.biz.modular.notify.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.msgtemplate.entity.BizMessageTemplate;
import vip.xiaonuo.biz.modular.msgtemplate.service.BizMessageTemplateService;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationJob;
import vip.xiaonuo.biz.modular.notify.entity.BizNotificationLog;
import vip.xiaonuo.biz.modular.notify.mapper.BizNotificationJobMapper;
import vip.xiaonuo.biz.modular.notify.mapper.BizNotificationLogMapper;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyEnqueueParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyIdParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyJobPageParam;
import vip.xiaonuo.biz.modular.notify.param.BizNotifyLogPageParam;
import vip.xiaonuo.biz.modular.notify.service.BizNotifyService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningMapper;
import vip.xiaonuo.common.cache.CommonCacheOperator;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;
import vip.xiaonuo.dev.api.DevConfigApi;
import vip.xiaonuo.dev.api.DevEmailApi;
import vip.xiaonuo.dev.api.DevMessageApi;
import vip.xiaonuo.dev.api.DevSmsApi;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;

/**
 * 异步通知队列分发服务实现
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizNotifyServiceImpl extends ServiceImpl<BizNotificationJobMapper, BizNotificationJob>
        implements BizNotifyService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final String COOLDOWN_PREFIX = "warnsys:notify:cooldown:";
    private static final Set<String> VALID_CHANNELS = Set.of("inbox", "email", "sms", "wechat", "app");

    @Resource
    private BizNotificationLogMapper notificationLogMapper;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizWarningMapper bizWarningMapper;

    @Resource
    private BizMessageTemplateService bizMessageTemplateService;

    @Resource
    private DevConfigApi devConfigApi;

    @Resource
    private DevMessageApi devMessageApi;

    @Resource
    private DevEmailApi devEmailApi;

    @Resource
    private DevSmsApi devSmsApi;

    @Resource
    private CommonCacheOperator commonCacheOperator;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Override
    public Page<BizNotificationJob> jobPage(BizNotifyJobPageParam param) {
        LambdaQueryWrapper<BizNotificationJob> qw = new LambdaQueryWrapper<>();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizWarning> ww = new LambdaQueryWrapper<BizWarning>().select(BizWarning::getId);
            CommonSqlUtil.safeIn(ww, BizWarning::getOrgId, scope);
            List<String> wids = CollStreamUtil.toList(bizWarningMapper.selectList(ww), BizWarning::getId);
            String uid = StpUtil.getLoginIdAsString();
            qw.and(w -> {
                w.eq(BizNotificationJob::getSenderUserId, uid);
                if (!wids.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizNotificationJob::getWarningId, wids));
                }
            });
        }
        if (StrUtil.isNotBlank(param.getChannel())) {
            qw.eq(BizNotificationJob::getChannel, param.getChannel());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            qw.eq(BizNotificationJob::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getWarningId())) {
            qw.eq(BizNotificationJob::getWarningId, param.getWarningId());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            qw.and(w -> w.like(BizNotificationJob::getTemplateCode, key)
                    .or().like(BizNotificationJob::getReceiversJson, key));
        }
        qw.orderByDesc(BizNotificationJob::getCreateTime);
        return this.page(CommonPageRequest.defaultPage(), qw);
    }

    @Override
    public Page<BizNotificationLog> logPage(BizNotifyLogPageParam param) {
        LambdaQueryWrapper<BizNotificationLog> qw = new LambdaQueryWrapper<>();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizWarning> ww = new LambdaQueryWrapper<BizWarning>().select(BizWarning::getId);
            CommonSqlUtil.safeIn(ww, BizWarning::getOrgId, scope);
            List<String> wids = CollStreamUtil.toList(bizWarningMapper.selectList(ww), BizWarning::getId);
            String uid = StpUtil.getLoginIdAsString();
            LambdaQueryWrapper<BizNotificationJob> jw = new LambdaQueryWrapper<BizNotificationJob>()
                    .select(BizNotificationJob::getId)
                    .and(w -> {
                        w.eq(BizNotificationJob::getSenderUserId, uid);
                        if (!wids.isEmpty()) {
                            w.or(sub -> CommonSqlUtil.safeIn(sub, BizNotificationJob::getWarningId, wids));
                        }
                    })
                    .orderByDesc(BizNotificationJob::getCreateTime)
                    .last("LIMIT 5000");
            List<String> allowedJobIds = CollStreamUtil.toList(this.list(jw), BizNotificationJob::getId);
            if (allowedJobIds.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(qw, BizNotificationLog::getJobId, allowedJobIds);
        }
        if (StrUtil.isNotBlank(param.getJobId())) {
            qw.eq(BizNotificationLog::getJobId, param.getJobId());
        }
        if (StrUtil.isNotBlank(param.getChannel())) {
            qw.eq(BizNotificationLog::getChannel, param.getChannel());
        }
        if (StrUtil.isNotBlank(param.getSendStatus())) {
            qw.eq(BizNotificationLog::getSendStatus, param.getSendStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            qw.and(w -> w.like(BizNotificationLog::getReceiver, key)
                    .or().like(BizNotificationLog::getContentSnapshot, key));
        }
        qw.orderByDesc(BizNotificationLog::getSentAt);
        return notificationLogMapper.selectPage(CommonPageRequest.defaultPage(), qw);
    }

    @Override
    public JSONObject enqueue(BizNotifyEnqueueParam param) {
        String channel = StrUtil.trim(param.getChannel()).toLowerCase(Locale.ROOT);
        if (!VALID_CHANNELS.contains(channel)) {
            throw new CommonException("不支持的通知渠道: {}", channel);
        }
        if (StrUtil.isNotBlank(param.getWarningId())) {
            BizWarning warning = bizWarningMapper.selectById(param.getWarningId());
            if (warning == null) {
                throw new CommonException("关联预警不存在");
            }
            BizScopeUtil.assertOrgInScope(warning.getOrgId(), "发送预警通知");
        }

        JSONArray receiverArray = new JSONArray();
        if (ObjectUtil.isNotEmpty(param.getStudentIds())) {
            List<BizStudentProfile> students = bizStudentProfileService.listByIds(param.getStudentIds());
            for (BizStudentProfile stu : students) {
                BizScopeUtil.assertOrgInScope(stu.getOrgId(), "发送学生通知");
                JSONObject item = new JSONObject()
                        .set("studentId", stu.getId())
                        .set("studentNo", stu.getStudentNo())
                        .set("name", stu.getName())
                        .set("userId", StrUtil.isNotBlank(stu.getClientUserId()) ? stu.getClientUserId() : stu.getId())
                        .set("phone", stu.getMobile())
                        .set("email", stu.getEmail());
                receiverArray.add(item);
            }
        }
        if (ObjectUtil.isNotEmpty(param.getReceivers())) {
            for (String r : param.getReceivers()) {
                if (StrUtil.isBlank(r)) continue;
                String target = StrUtil.trim(r);
                receiverArray.add(new JSONObject()
                        .set("userId", target)
                        .set("email", target.contains("@") ? target : null)
                        .set("phone", target.matches("^1\\d{10}$") ? target : null)
                        .set("name", target));
            }
        }
        if (receiverArray.isEmpty()) {
            throw new CommonException("至少需要指定一名接收者");
        }

        JSONObject paramsJson = param.getParams() != null ? new JSONObject(param.getParams()) : new JSONObject();
        if (StrUtil.isNotBlank(param.getTitle())) {
            paramsJson.set("title", StrUtil.trim(param.getTitle()));
        }
        if (StrUtil.isNotBlank(param.getContent())) {
            paramsJson.set("content", StrUtil.trim(param.getContent()));
        }
        if (param.getCooldownMinutes() != null && param.getCooldownMinutes() > 0) {
            paramsJson.set("cooldownMinutes", param.getCooldownMinutes());
        }

        BizNotificationJob job = new BizNotificationJob();
        job.setTriggerType(StrUtil.isNotBlank(param.getTriggerType()) ? StrUtil.trim(param.getTriggerType()) : "manual");
        job.setWarningId(StrUtil.isNotBlank(param.getWarningId()) ? StrUtil.trim(param.getWarningId()) : null);
        job.setSenderUserId(StpUtil.getLoginIdAsString());
        job.setChannel(channel);
        job.setTemplateCode(StrUtil.isNotBlank(param.getTemplateCode()) ? StrUtil.trim(param.getTemplateCode()) : "MANUAL_NOTICE");
        job.setReceiversJson(receiverArray.toString());
        job.setParamsJson(paramsJson.toString());
        job.setScheduleAt(new Date());
        job.setCooldownKey(StrUtil.isNotBlank(param.getCooldownKey()) ? StrUtil.trim(param.getCooldownKey()) : null);
        job.setStatus("queued");
        job.setTryCount(0);
        this.save(job);

        JSONObject dispatchRes = null;
        if (Boolean.TRUE.equals(param.getDispatchNow())) {
            dispatchRes = dispatchSingleJob(job);
        }
        return new JSONObject()
                .set("jobId", job.getId())
                .set("status", job.getStatus())
                .set("dispatchResult", dispatchRes);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void enqueueSystemWarning(BizStudentProfile student, BizWarning warning, String eventType) {
        if (student == null || warning == null) {
            return;
        }
        JSONObject strategy = loadOrgStrategy(student.getOrgId());
        if (!strategy.getBool("enabled", true)) {
            return;
        }
        if ("create".equals(eventType) && !strategy.getBool("notifyOnCreate", true)) {
            return;
        }
        if ("upgrade".equals(eventType) && !strategy.getBool("notifyOnUpgrade", true)) {
            return;
        }
        if (!strategy.getBool("notifyStudent", true)) {
            return;
        }

        JSONObject prefs = StrUtil.isNotBlank(student.getNotifyPrefsJson()) && JSONUtil.isTypeJSONObject(student.getNotifyPrefsJson())
                ? JSONUtil.parseObj(student.getNotifyPrefsJson()) : new JSONObject();
        if (Boolean.FALSE.equals(prefs.getBool("warning_reminder", true))) {
            return;
        }

        String levelText = switch (StrUtil.blankToDefault(warning.getLevel(), "")) {
            case "yellow" -> "黄色预警";
            case "orange" -> "橙色预警";
            case "red" -> "红色预警";
            case "severe" -> "严重预警";
            default -> "学业预警";
        };
        String title = ("upgrade".equals(eventType) ? "学业预警升级提醒：" : "新增学业预警提醒：") + levelText;
        String content = student.getName() + "（" + student.getStudentNo() + "），您触发了" + levelText + "："
                + StrUtil.blankToDefault(warning.getTriggerSummary(), "请及时查看并处理");

        JSONArray receiverArray = new JSONArray();
        receiverArray.add(new JSONObject()
                .set("studentId", student.getId())
                .set("studentNo", student.getStudentNo())
                .set("name", student.getName())
                .set("userId", StrUtil.isNotBlank(student.getClientUserId()) ? student.getClientUserId() : student.getId())
                .set("phone", student.getMobile())
                .set("email", student.getEmail()));

        JSONObject paramsJson = new JSONObject()
                .set("title", title)
                .set("content", content)
                .set("student_name", student.getName())
                .set("student_no", student.getStudentNo())
                .set("level", levelText)
                .set("trigger_summary", warning.getTriggerSummary());

        // 站内信必达（受用户 inbox 偏好控制，默认开启）
        if (prefs.getBool("inbox", true)) {
            saveSystemNotifyJob(warning.getId(), "inbox", "WARNING_ALERT", receiverArray, paramsJson,
                    "warn:" + warning.getId() + ":" + eventType + ":inbox");
        }
        // 若学院策略包含 email 且学生开启了 email 且有邮箱，则入队邮件异步通知
        JSONArray orgChannels = strategy.getJSONArray("channels");
        boolean orgEmail = orgChannels != null && orgChannels.contains("email");
        if (orgEmail && prefs.getBool("email", true) && StrUtil.isNotBlank(student.getEmail())) {
            saveSystemNotifyJob(warning.getId(), "email", "WARNING_ALERT", receiverArray, paramsJson,
                    "warn:" + warning.getId() + ":" + eventType + ":email");
        }
    }

    private void saveSystemNotifyJob(String warningId, String channel, String templateCode,
                                     JSONArray receivers, JSONObject paramsJson, String cooldownKey) {
        BizNotificationJob job = new BizNotificationJob();
        job.setTriggerType("auto");
        job.setWarningId(warningId);
        job.setSenderUserId("SYSTEM");
        job.setChannel(channel);
        job.setTemplateCode(templateCode);
        job.setReceiversJson(receivers.toString());
        job.setParamsJson(paramsJson.toString());
        job.setScheduleAt(new Date());
        job.setCooldownKey(cooldownKey);
        job.setStatus("queued");
        job.setTryCount(0);
        this.save(job);
    }

    @Override
    public JSONObject dispatchPendingJobs(int batchSize) {
        int limit = Math.max(1, Math.min(batchSize, 200));
        Date now = new Date();
        JSONObject cfg = loadNotifyConfig();
        int maxRetry = Math.max(1, cfg.getInt("retryCount", 2));

        List<BizNotificationJob> pending = this.list(new LambdaQueryWrapper<BizNotificationJob>()
                .in(BizNotificationJob::getStatus, Arrays.asList("queued", "deferred"))
                .and(w -> w.isNull(BizNotificationJob::getScheduleAt).or().le(BizNotificationJob::getScheduleAt, now))
                .lt(BizNotificationJob::getTryCount, maxRetry)
                .orderByAsc(BizNotificationJob::getCreateTime)
                .last("LIMIT " + limit));

        int sent = 0, skippedCooldown = 0, deferred = 0, failed = 0;
        for (BizNotificationJob job : pending) {
            JSONObject r = dispatchSingleJob(job);
            String st = r.getStr("status");
            if ("sent".equals(st) || "completed".equals(st)) {
                sent++;
            } else if ("cancelled".equals(st)) {
                skippedCooldown++;
            } else if ("deferred".equals(st)) {
                deferred++;
            } else {
                failed++;
            }
        }
        return new JSONObject()
                .set("processed", pending.size())
                .set("sent", sent)
                .set("skippedCooldown", skippedCooldown)
                .set("deferred", deferred)
                .set("failed", failed);
    }

    protected JSONObject dispatchSingleJob(BizNotificationJob job) {
        JSONObject cfg = loadNotifyConfig();
        if (Boolean.FALSE.equals(cfg.getBool("enabled", true))) {
            job.setStatus("cancelled");
            job.setLastError("全局通知开关已关闭");
            this.updateById(job);
            return new JSONObject().set("jobId", job.getId()).set("status", "cancelled");
        }

        // 1. 免打扰时段判断（仅当配置显式开启 quietHoursEnabled 且非高优先级手动触发）
        if (Boolean.TRUE.equals(cfg.getBool("quietHoursEnabled", false)) && !"manual".equals(job.getTriggerType())) {
            int qStart = cfg.getInt("quietStartHour", 22);
            int qEnd = cfg.getInt("quietEndHour", 7);
            ZonedDateTime zNow = ZonedDateTime.now(ZONE_SHANGHAI);
            int hr = zNow.getHour();
            boolean inQuiet = (qStart > qEnd) ? (hr >= qStart || hr < qEnd) : (hr >= qStart && hr < qEnd);
            if (inQuiet) {
                ZonedDateTime nextMorning = zNow.toLocalDate()
                        .plusDays(hr >= qStart && qStart > qEnd ? 1 : 0)
                        .atTime(LocalTime.of(qEnd, 0)).atZone(ZONE_SHANGHAI);
                job.setStatus("deferred");
                job.setScheduleAt(Date.from(nextMorning.toInstant()));
                job.setLastError("处于静默免打扰时段，已顺延至 " + qEnd + ":00");
                this.updateById(job);
                return new JSONObject().set("jobId", job.getId()).set("status", "deferred");
            }
        }

        // 2. 冷却去重校验
        JSONObject params = StrUtil.isNotBlank(job.getParamsJson()) && JSONUtil.isTypeJSONObject(job.getParamsJson())
                ? JSONUtil.parseObj(job.getParamsJson()) : new JSONObject();
        int cooldownMinutes = params.getInt("cooldownMinutes", cfg.getInt("cooldownMinutes", 60));
        if (StrUtil.isNotBlank(job.getCooldownKey())) {
            String redisKey = COOLDOWN_PREFIX + job.getCooldownKey();
            if (commonCacheOperator.get(redisKey) != null) {
                job.setStatus("cancelled");
                job.setLastError("命中冷却去重窗口(" + cooldownMinutes + "分钟)");
                this.updateById(job);
                return new JSONObject().set("jobId", job.getId()).set("status", "cancelled");
            }
        }

        // 3. 模板渲染
        String title = StrUtil.blankToDefault(params.getStr("title"), "学业预警与教学通知");
        String content = params.getStr("content");
        if (StrUtil.isNotBlank(job.getTemplateCode())) {
            BizMessageTemplate tpl = bizMessageTemplateService.getOne(
                    new LambdaQueryWrapper<BizMessageTemplate>()
                            .eq(BizMessageTemplate::getTemplateCode, job.getTemplateCode())
                            .eq(BizMessageTemplate::getStatus, "active")
                            .last("LIMIT 1"));
            if (tpl != null) {
                if (StrUtil.isBlank(params.getStr("title")) && StrUtil.isNotBlank(tpl.getTitle())) {
                    title = renderTemplate(tpl.getTitle(), params);
                }
                if (StrUtil.isBlank(content) && StrUtil.isNotBlank(tpl.getContent())) {
                    content = renderTemplate(tpl.getContent(), params);
                }
            }
        }
        if (StrUtil.isBlank(content)) {
            content = StrUtil.blankToDefault(params.getStr("trigger_summary"),
                    StrUtil.blankToDefault(params.getStr("warning_reason"), title));
        }

        JSONArray receivers = JSONUtil.isTypeJSONArray(job.getReceiversJson())
                ? JSONUtil.parseArray(job.getReceiversJson()) : new JSONArray();
        int successCount = 0;
        int failCount = 0;
        String lastErr = null;
        Date now = new Date();

        for (int i = 0; i < receivers.size(); i++) {
            JSONObject rObj = receivers.getJSONObject(i);
            String receiverId = StrUtil.blankToDefault(rObj.getStr("userId"),
                    StrUtil.blankToDefault(rObj.getStr("studentId"), rObj.getStr("email")));
            String email = rObj.getStr("email");
            String phone = rObj.getStr("phone");
            String renderedContent = renderTemplate(content, rObj);

            BizNotificationLog logEntry = new BizNotificationLog();
            logEntry.setJobId(job.getId());
            logEntry.setChannel(job.getChannel());
            logEntry.setReceiver(StrUtil.blankToDefault(receiverId, "unknown"));
            logEntry.setContentSnapshot(title + " | " + renderedContent);
            logEntry.setSentAt(now);
            logEntry.setAcknowledged(0);

            try {
                if ("inbox".equals(job.getChannel()) || "app".equals(job.getChannel())) {
                    if (StrUtil.isBlank(receiverId)) {
                        throw new CommonException("站内信接收用户ID为空");
                    }
                    devMessageApi.sendMessageWithContent(Collections.singletonList(receiverId), "SYS", title, renderedContent);
                    logEntry.setSendStatus("sent");
                    logEntry.setProvider("snowy-inbox");
                    logEntry.setProviderMsgId(IdUtil.fastSimpleUUID());
                    successCount++;
                } else if ("email".equals(job.getChannel())) {
                    if (StrUtil.isBlank(email)) {
                        throw new CommonException("接收者邮箱为空");
                    }
                    devEmailApi.sendDynamicTxtEmail(email, title, renderedContent);
                    logEntry.setSendStatus("sent");
                    logEntry.setProvider("snowy-email");
                    logEntry.setProviderMsgId(IdUtil.fastSimpleUUID());
                    successCount++;
                } else if ("sms".equals(job.getChannel())) {
                    if (StrUtil.isBlank(phone)) {
                        throw new CommonException("接收者手机号为空");
                    }
                    devSmsApi.sendDynamicSms(phone, job.getTemplateCode(), params);
                    logEntry.setSendStatus("sent");
                    logEntry.setProvider("snowy-sms");
                    logEntry.setProviderMsgId(IdUtil.fastSimpleUUID());
                    successCount++;
                } else {
                    // wechat: 同步落入站内信确保学生可见，并记录微信待接入通道审计
                    if (StrUtil.isNotBlank(receiverId)) {
                        devMessageApi.sendMessageWithContent(Collections.singletonList(receiverId), "SYS", title, renderedContent);
                    }
                    logEntry.setSendStatus("sent");
                    logEntry.setProvider("wechat-inbox-bridge");
                    logEntry.setProviderMsgId(IdUtil.fastSimpleUUID());
                    successCount++;
                }
            } catch (Exception ex) {
                failCount++;
                lastErr = StrUtil.maxLength(ex.getMessage(), 240);
                logEntry.setSendStatus("failed");
                logEntry.setProvider("snowy-" + job.getChannel());
                logEntry.setErrorMsg(lastErr);
                log.warn("[BizNotifyService] 通知发送失败 jobId={}, channel={}, receiver={}, err={}",
                        job.getId(), job.getChannel(), receiverId, lastErr);
            }
            notificationLogMapper.insert(logEntry);
        }

        int nextTry = (job.getTryCount() == null ? 0 : job.getTryCount()) + 1;
        job.setTryCount(nextTry);
        int maxRetry = Math.max(1, cfg.getInt("retryCount", 2));
        if (successCount > 0 && failCount == 0) {
            job.setStatus("sent");
            job.setLastError(null);
            if (StrUtil.isNotBlank(job.getCooldownKey())) {
                commonCacheOperator.put(COOLDOWN_PREFIX + job.getCooldownKey(), "1", Math.max(60L, cooldownMinutes * 60L));
            }
        } else if (successCount > 0) {
            job.setStatus("completed");
            job.setLastError(lastErr);
        } else if (nextTry < maxRetry) {
            job.setStatus("queued");
            job.setScheduleAt(new Date(System.currentTimeMillis() + 5 * 60_000L));
            job.setLastError(StrUtil.blankToDefault(lastErr, "发送失败，等待第" + (nextTry + 1) + "次重试"));
        } else {
            job.setStatus("failed");
            job.setLastError(StrUtil.blankToDefault(lastErr, "全部接收者发送失败"));
        }
        this.updateById(job);
        return new JSONObject()
                .set("jobId", job.getId())
                .set("status", job.getStatus())
                .set("successCount", successCount)
                .set("failCount", failCount);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void cancelJob(BizNotifyIdParam idParam) {
        BizNotificationJob job = this.getById(idParam.getId());
        if (job == null) {
            throw new CommonException("通知任务不存在");
        }
        if ("sent".equals(job.getStatus())) {
            throw new CommonException("已发送任务不可取消");
        }
        job.setStatus("cancelled");
        job.setLastError("人工取消分发");
        this.updateById(job);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void acknowledgeLog(BizNotifyIdParam idParam) {
        BizNotificationLog logItem = notificationLogMapper.selectById(idParam.getId());
        if (logItem == null) {
            throw new CommonException("通知回执日志不存在");
        }
        logItem.setAcknowledged(1);
        logItem.setAcknowledgedAt(new Date());
        logItem.setAcknowledgedBy(StpUtil.getLoginIdAsString());
        notificationLogMapper.updateById(logItem);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void deleteJobs(List<BizNotifyIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizNotifyIdParam::getId);
        if (ids.isEmpty()) return;
        notificationLogMapper.delete(new LambdaQueryWrapper<BizNotificationLog>().in(BizNotificationLog::getJobId, ids));
        this.removeByIds(ids);
    }

    private JSONObject loadOrgStrategy(String orgId) {
        try {
            if (StrUtil.isNotBlank(orgId)) {
                List<String> src = jdbcTemplate.queryForList(
                        "SELECT SOURCE_ID FROM BIZ_MIGRATION_ID_MAP WHERE SOURCE_TABLE = 'orgs' AND TARGET_ID = ? LIMIT 1",
                        String.class, orgId);
                String key = "WARNSYS_NOTIFICATION_STRATEGY_" + (src.isEmpty() ? orgId : src.get(0));
                String raw = devConfigApi.getValueByKey(key);
                if (StrUtil.isNotBlank(raw) && JSONUtil.isTypeJSONObject(raw)) {
                    return JSONUtil.parseObj(raw);
                }
            }
        } catch (Exception ignored) {
        }
        return new JSONObject().set("enabled", true).set("notifyOnCreate", true).set("notifyOnUpgrade", true)
                .set("notifyStudent", true).set("channels", new JSONArray(List.of("inbox", "wechat", "email")));
    }

    private JSONObject loadNotifyConfig() {
        try {
            String raw = devConfigApi.getValueByKey("WARNSYS_NOTIFICATION");
            if (StrUtil.isNotBlank(raw) && JSONUtil.isTypeJSONObject(raw)) {
                return JSONUtil.parseObj(raw);
            }
        } catch (Exception ignored) {
        }
        return new JSONObject().set("enabled", true).set("retryCount", 2).set("cooldownMinutes", 60);
    }

    private String renderTemplate(String template, JSONObject vars) {
        if (StrUtil.isBlank(template) || vars == null) {
            return template;
        }
        String res = template;
        for (Map.Entry<String, Object> entry : vars.entrySet()) {
            if (entry.getValue() != null) {
                String k = entry.getKey();
                String v = String.valueOf(entry.getValue());
                res = res.replace("{" + k + "}", v).replace("${" + k + "}", v);
            }
        }
        return res;
    }
}
