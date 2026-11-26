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
package vip.xiaonuo.biz.modular.warningrule.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.warningrule.entity.BizWarningRule;
import vip.xiaonuo.biz.modular.warningrule.mapper.BizWarningRuleMapper;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleAddParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleEditParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRuleIdParam;
import vip.xiaonuo.biz.modular.warningrule.param.BizWarningRulePageParam;
import vip.xiaonuo.biz.modular.warningrule.service.BizWarningRuleService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.util.*;

/**
 * 学业预警规则Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizWarningRuleServiceImpl extends ServiceImpl<BizWarningRuleMapper, BizWarningRule>
        implements BizWarningRuleService {

    private static final Set<String> ALLOWED_METRICS = Set.of(
            "late", "absent", "early_leave", "warning_total",
            "homework_not_submit", "homework_late_submit", "class_behavior",
            "leave", "failed_courses", "credits", "gpa", "unacknowledged"
    );
    private static final Set<String> ALLOWED_WINDOWS = Set.of("day", "week", "month", "term");
    private static final Set<String> ALLOWED_LEVELS = Set.of("yellow", "orange", "red", "severe");
    private static final Set<String> TERM_ONLY_METRICS = Set.of("failed_courses", "credits", "gpa");
    private static final String DEFAULT_NOTIFY_STRATEGY = "{\"channels\":[\"email\",\"inbox\"],\"cooldown_hours\":24}";

    @Resource
    private BizOrgService bizOrgService;

    @Override
    public Page<BizWarningRule> page(BizWarningRulePageParam param) {
        QueryWrapper<BizWarningRule> queryWrapper = new QueryWrapper<BizWarningRule>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            queryWrapper.lambda().and(w -> w.eq(BizWarningRule::getScope, "school")
                    .or(sub -> {
                        sub.eq(BizWarningRule::getScope, "college");
                        CommonSqlUtil.safeIn(sub, BizWarningRule::getScopeId, scope);
                    }));
        }
        if (StrUtil.isNotBlank(param.getScope())) {
            queryWrapper.lambda().eq(BizWarningRule::getScope, param.getScope());
        }
        if (StrUtil.isNotBlank(param.getScopeId())) {
            queryWrapper.lambda().eq(BizWarningRule::getScopeId, param.getScopeId());
        }
        if (StrUtil.isNotBlank(param.getMetric())) {
            queryWrapper.lambda().eq(BizWarningRule::getMetric, param.getMetric());
        }
        if (StrUtil.isNotBlank(param.getWindowType())) {
            queryWrapper.lambda().eq(BizWarningRule::getWindowType, param.getWindowType());
        }
        if (StrUtil.isNotBlank(param.getLevel())) {
            queryWrapper.lambda().eq(BizWarningRule::getLevel, param.getLevel());
        }
        if (param.getEnabled() != null) {
            queryWrapper.lambda().eq(BizWarningRule::getEnabled, param.getEnabled());
        }
        queryWrapper.lambda().orderByAsc(BizWarningRule::getMetric, BizWarningRule::getWindowType, BizWarningRule::getThreshold);
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizWarningRuleAddParam param) {
        String scope = StrUtil.blankToDefault(StrUtil.trim(param.getScope()), "school").toLowerCase();
        if (!"school".equals(scope) && !"college".equals(scope)) {
            throw new CommonException("规则作用域仅支持 school 或 college");
        }
        String scopeId = null;
        if ("college".equals(scope)) {
            if (StrUtil.isBlank(param.getScopeId())) {
                throw new CommonException("院级覆盖规则必须指定学院");
            }
            scopeId = param.getScopeId();
            BizScopeUtil.assertOrgInScope(scopeId, "新增院级预警规则");
        } else if (BizScopeUtil.getDataScope() != null) {
            throw new CommonException("仅校级管理员可新增全校默认预警规则");
        }

        String metric = StrUtil.trim(param.getMetric());
        String windowType = StrUtil.trim(param.getWindowType());
        String level = StrUtil.trim(param.getLevel());
        validateRuleFields(metric, windowType, level);

        LambdaQueryWrapper<BizWarningRule> dup = new LambdaQueryWrapper<BizWarningRule>()
                .eq(BizWarningRule::getScope, scope)
                .eq(BizWarningRule::getMetric, metric)
                .eq(BizWarningRule::getWindowType, windowType)
                .eq(BizWarningRule::getLevel, level);
        if (scopeId == null) {
            dup.isNull(BizWarningRule::getScopeId);
        } else {
            dup.eq(BizWarningRule::getScopeId, scopeId);
        }
        if (this.count(dup) > 0) {
            throw new CommonException("相同作用域与指标/窗口/级别的规则已存在，请直接编辑原规则");
        }

        BizWarningRule entity = new BizWarningRule();
        entity.setScope(scope);
        entity.setScopeId(scopeId);
        entity.setRuleVersion(1);
        entity.setMetric(metric);
        entity.setWindowType(windowType);
        entity.setLevel(level);
        entity.setThreshold(param.getThreshold());
        entity.setEnabled(param.getEnabled() == null || param.getEnabled());
        entity.setExclusionsJson(StrUtil.trimToNull(param.getExclusionsJson()));
        entity.setNotifyStrategyJson(StrUtil.blankToDefault(param.getNotifyStrategyJson(), DEFAULT_NOTIFY_STRATEGY));
        entity.setCreatedBy(StpUtil.getLoginIdAsString());
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizWarningRuleEditParam param) {
        BizWarningRule existing = this.queryEntity(param.getId());
        if ("college".equals(existing.getScope())) {
            BizScopeUtil.assertOrgInScope(existing.getScopeId(), "编辑院级预警规则");
        } else if (BizScopeUtil.getDataScope() != null) {
            throw new CommonException("仅校级管理员可修改全校默认预警规则");
        }

        String nextMetric = StrUtil.blankToDefault(StrUtil.trim(param.getMetric()), existing.getMetric());
        String nextWindow = StrUtil.blankToDefault(StrUtil.trim(param.getWindowType()), existing.getWindowType());
        String nextLevel = StrUtil.blankToDefault(StrUtil.trim(param.getLevel()), existing.getLevel());
        validateRuleFields(nextMetric, nextWindow, nextLevel);

        boolean changedJudgement = !Objects.equals(nextMetric, existing.getMetric())
                || !Objects.equals(nextWindow, existing.getWindowType())
                || !Objects.equals(nextLevel, existing.getLevel())
                || (param.getThreshold() != null && !Objects.equals(param.getThreshold(), existing.getThreshold()))
                || (param.getEnabled() != null && !Objects.equals(param.getEnabled(), existing.getEnabled()))
                || (param.getNotifyStrategyJson() != null && !Objects.equals(param.getNotifyStrategyJson(), existing.getNotifyStrategyJson()))
                || (param.getExclusionsJson() != null && !Objects.equals(param.getExclusionsJson(), existing.getExclusionsJson()));

        existing.setMetric(nextMetric);
        existing.setWindowType(nextWindow);
        existing.setLevel(nextLevel);
        if (param.getThreshold() != null) {
            existing.setThreshold(param.getThreshold());
        }
        if (param.getEnabled() != null) {
            existing.setEnabled(param.getEnabled());
        }
        if (param.getExclusionsJson() != null) {
            existing.setExclusionsJson(StrUtil.trimToNull(param.getExclusionsJson()));
        }
        if (param.getNotifyStrategyJson() != null) {
            existing.setNotifyStrategyJson(StrUtil.trimToNull(param.getNotifyStrategyJson()));
        }
        if (changedJudgement) {
            existing.setRuleVersion(ObjectUtil.defaultIfNull(existing.getRuleVersion(), 1) + 1);
        }
        this.updateById(existing);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizWarningRuleIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizWarningRuleIdParam::getId);
        List<BizWarningRule> list = this.listByIds(ids);
        for (BizWarningRule item : list) {
            if ("college".equals(item.getScope())) {
                BizScopeUtil.assertOrgInScope(item.getScopeId(), "删除院级预警规则");
            } else if (BizScopeUtil.getDataScope() != null) {
                throw new CommonException("仅校级管理员可删除全校默认预警规则");
            }
        }
        this.removeByIds(ids);
    }

    @Override
    public BizWarningRule detail(BizWarningRuleIdParam idParam) {
        BizWarningRule entity = this.queryEntity(idParam.getId());
        if ("college".equals(entity.getScope())) {
            BizScopeUtil.assertOrgInScope(entity.getScopeId(), "查看院级预警规则");
        }
        return entity;
    }

    @Override
    public BizWarningRule queryEntity(String id) {
        BizWarningRule entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("预警规则不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }

    private void validateRuleFields(String metric, String windowType, String level) {
        if (!ALLOWED_METRICS.contains(metric)) {
            throw new CommonException("不支持的预警指标：{}", metric);
        }
        if (!ALLOWED_WINDOWS.contains(windowType)) {
            throw new CommonException("不支持的统计窗口：{}（仅支持 day/week/month/term）", windowType);
        }
        if (!ALLOWED_LEVELS.contains(level)) {
            throw new CommonException("不支持的预警等级：{}（仅支持 yellow/orange/red/severe）", level);
        }
        if (TERM_ONLY_METRICS.contains(metric) && !"term".equals(windowType)) {
            throw new CommonException("学期学业指标 {} 仅允许配置 term 窗口", metric);
        }
    }
}
