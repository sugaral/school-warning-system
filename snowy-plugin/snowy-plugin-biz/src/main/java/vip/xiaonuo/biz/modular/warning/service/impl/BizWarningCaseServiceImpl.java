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
package vip.xiaonuo.biz.modular.warning.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.biz.modular.user.service.BizUserService;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCase;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCaseLog;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCaseLogMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCaseMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningMapper;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCaseAssignParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCaseHandleParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCaseIdParam;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCasePageParam;
import vip.xiaonuo.biz.modular.warning.service.BizWarningCaseService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 高风险学生干预工单Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizWarningCaseServiceImpl extends ServiceImpl<BizWarningCaseMapper, BizWarningCase>
        implements BizWarningCaseService {

    @Resource
    private BizWarningCaseLogMapper caseLogMapper;

    @Resource
    private BizWarningMapper bizWarningMapper;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizUserService bizUserService;

    @Override
    public Page<BizWarningCase> page(BizWarningCasePageParam param) {
        QueryWrapper<BizWarningCase> queryWrapper = new QueryWrapper<BizWarningCase>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizWarningCase::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizWarningCase::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizWarningCase::getStatus, param.getStatus());
        }
        if (param.getIsActive() != null) {
            queryWrapper.lambda().eq(BizWarningCase::getIsActive, param.getIsActive());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matched = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            if (matched.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizWarningCase::getStudentId, matched);
        }
        queryWrapper.lambda().orderByDesc(BizWarningCase::getIsActive)
                .orderByDesc(BizWarningCase::getRiskScore)
                .orderByDesc(BizWarningCase::getCreateTime);
        Page<BizWarningCase> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillStudentNo(page.getRecords());
        return page;
    }

    @Override
    public BizWarningCase detail(BizWarningCaseIdParam idParam) {
        BizWarningCase entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看干预工单详情");
        fillStudentNo(Collections.singletonList(entity));
        List<BizWarningCaseLog> logs = caseLogMapper.selectList(
                new LambdaQueryWrapper<BizWarningCaseLog>()
                        .eq(BizWarningCaseLog::getCaseId, entity.getId())
                        .orderByAsc(BizWarningCaseLog::getCreateTime));
        entity.setLogs(logs);
        return entity;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void assign(BizWarningCaseAssignParam param) {
        BizWarningCase entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "指派干预工单");
        if (Integer.valueOf(0).equals(entity.getIsActive()) || "resolved".equals(entity.getStatus())) {
            throw new CommonException("工单已结案，不可重复指派");
        }
        BizUser handler = bizUserService.getById(param.getHandlerUserId());
        if (handler == null) {
            throw new CommonException("指派的处置人不存在");
        }
        Date now = new Date();
        entity.setHandlerUserId(handler.getId());
        entity.setAssignedBy(StpUtil.getLoginIdAsString());
        entity.setAssignedAt(now);
        entity.setStatus("assigned");
        this.updateById(entity);

        appendLog(entity.getId(), "assign", StpUtil.getLoginIdAsString(),
                StrUtil.isNotBlank(param.getNote()) ? StrUtil.trim(param.getNote()) : "指派给 " + handler.getName(),
                new JSONObject().set("handlerUserId", handler.getId()).set("handlerName", handler.getName()).toString());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void accept(BizWarningCaseHandleParam param) {
        BizWarningCase entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "接单处理干预工单");
        if ("resolved".equals(entity.getStatus())) {
            throw new CommonException("工单已结案，无法接单");
        }
        String currentUserId = StpUtil.getLoginIdAsString();
        if (StrUtil.isBlank(entity.getHandlerUserId())) {
            entity.setHandlerUserId(currentUserId);
        }
        entity.setAcceptedAt(new Date());
        entity.setStatus("in_progress");
        this.updateById(entity);

        appendLog(entity.getId(), "accept", currentUserId,
                StrUtil.isNotBlank(param.getNote()) ? StrUtil.trim(param.getNote()) : "已接单开始线下谈话/家校沟通",
                null);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void complete(BizWarningCaseHandleParam param) {
        BizWarningCase entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "提交干预工单处置结果");
        if ("resolved".equals(entity.getStatus())) {
            throw new CommonException("工单已结案");
        }
        String summary = StrUtil.isNotBlank(param.getCompletionSummary()) ? StrUtil.trim(param.getCompletionSummary()) : StrUtil.trim(param.getNote());
        if (StrUtil.isBlank(summary)) {
            throw new CommonException("提交处置完成必须填写处置总结");
        }
        entity.setCompletedAt(new Date());
        entity.setCompletionSummary(summary);
        entity.setStatus("completed");
        this.updateById(entity);

        appendLog(entity.getId(), "complete", StpUtil.getLoginIdAsString(), summary, null);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void resolve(BizWarningCaseHandleParam param) {
        BizWarningCase entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "办结干预工单");
        if ("resolved".equals(entity.getStatus())) {
            throw new CommonException("工单已结案，无需重复操作");
        }
        String summary = StrUtil.isNotBlank(param.getCompletionSummary()) ? StrUtil.trim(param.getCompletionSummary()) : entity.getCompletionSummary();
        if (StrUtil.isBlank(summary)) {
            summary = StrUtil.isNotBlank(param.getNote()) ? StrUtil.trim(param.getNote()) : "已完成学业干预并核验结案";
        }
        Date now = new Date();
        entity.setResolvedAt(now);
        if (entity.getCompletedAt() == null) {
            entity.setCompletedAt(now);
        }
        entity.setCompletionSummary(summary);
        entity.setStatus("resolved");
        entity.setIsActive(0);
        this.updateById(entity);

        appendLog(entity.getId(), "resolve", StpUtil.getLoginIdAsString(), summary, null);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void syncStudentRiskCase(String studentId) {
        if (StrUtil.isBlank(studentId)) {
            return;
        }
        BizStudentProfile stu = bizStudentProfileService.getById(studentId);
        if (stu == null) {
            return;
        }
        List<BizWarning> activeWarnings = bizWarningMapper.selectList(
                new LambdaQueryWrapper<BizWarning>()
                        .eq(BizWarning::getStudentId, studentId)
                        .ne(BizWarning::getStatus, "closed")
                        .orderByDesc(BizWarning::getCreateTime));

        BizWarningCase existing = this.getOne(new LambdaQueryWrapper<BizWarningCase>()
                .eq(BizWarningCase::getStudentId, studentId)
                .eq(BizWarningCase::getIsActive, 1)
                .last("LIMIT 1"));

        if (activeWarnings.isEmpty()) {
            if (existing != null) {
                existing.setRiskScore(0);
                existing.setLastRiskAt(new Date());
                this.updateById(existing);
            }
            return;
        }

        int warningScore = 0;
        Map<String, Integer> levelCounts = new LinkedHashMap<>();
        boolean hasHighLevel = false;
        JSONArray srcIds = new JSONArray();
        String primaryId = activeWarnings.get(0).getId();
        Date latestAt = activeWarnings.get(0).getCreateTime();

        for (BizWarning w : activeWarnings) {
            srcIds.add(w.getId());
            String lv = StrUtil.trimToEmpty(w.getLevel());
            levelCounts.merge(lv, 1, Integer::sum);
            if ("severe".equals(lv)) {
                warningScore += 45;
                hasHighLevel = true;
            } else if ("red".equals(lv)) {
                warningScore += 35;
                hasHighLevel = true;
            } else if ("orange".equals(lv)) {
                warningScore += 20;
            } else {
                warningScore += 10;
            }
        }
        int totalRisk = Math.min(100, warningScore);
        boolean shouldOpen = hasHighLevel || totalRisk >= 60;
        if (!shouldOpen && existing == null) {
            return;
        }

        Date now = new Date();
        JSONObject breakdown = new JSONObject()
                .set("warning_score", Math.min(80, warningScore))
                .set("active_warning_count", activeWarnings.size());
        JSONObject summary = new JSONObject()
                .set("active_warning_count", activeWarnings.size())
                .set("levels", levelCounts);

        if (existing == null) {
            BizWarningCase created = new BizWarningCase();
            created.setStudentId(stu.getId());
            created.setClassId(stu.getClassId());
            created.setOrgId(stu.getOrgId());
            created.setPrimaryWarningId(primaryId);
            created.setSourceWarningIdsJson(srcIds.toString());
            created.setRiskScore(totalRisk);
            created.setRiskBreakdownJson(breakdown.toString());
            created.setWarningSummaryJson(summary.toString());
            created.setHandlingPriority(totalRisk >= 80 ? 3 : (totalRisk >= 60 ? 2 : 1));
            created.setStatus("pending_assignment");
            created.setLatestWarningAt(latestAt != null ? latestAt : now);
            created.setLastRiskAt(now);
            created.setIsActive(1);
            this.save(created);

            appendLog(created.getId(), "create", null, "系统风险引擎自动创建高风险干预工单（风险分=" + totalRisk + "）", breakdown.toString());
        } else {
            existing.setPrimaryWarningId(primaryId);
            existing.setSourceWarningIdsJson(srcIds.toString());
            existing.setRiskScore(totalRisk);
            existing.setRiskBreakdownJson(breakdown.toString());
            existing.setWarningSummaryJson(summary.toString());
            existing.setHandlingPriority(totalRisk >= 80 ? 3 : (totalRisk >= 60 ? 2 : 1));
            existing.setLatestWarningAt(latestAt != null ? latestAt : now);
            existing.setLastRiskAt(now);
            this.updateById(existing);
        }
    }

    @Override
    public BizWarningCase queryEntity(String id) {
        BizWarningCase entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("干预工单不存在，id={}", id);
        }
        return entity;
    }

    private void appendLog(String caseId, String action, String actorUserId, String note, String detailJson) {
        BizWarningCaseLog log = new BizWarningCaseLog();
        log.setCaseId(caseId);
        log.setAction(action);
        log.setActorUserId(actorUserId);
        log.setNote(note);
        log.setDetailJson(detailJson);
        caseLogMapper.insert(log);
    }

    private void fillStudentNo(List<BizWarningCase> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizWarningCase::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, String> noMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, BizStudentProfile::getStudentNo, (a, b) -> a));
        for (BizWarningCase r : records) {
            r.setStudentNo(noMap.get(r.getStudentId()));
        }
    }
}
