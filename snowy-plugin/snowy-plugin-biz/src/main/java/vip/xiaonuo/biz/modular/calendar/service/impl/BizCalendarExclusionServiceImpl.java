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
package vip.xiaonuo.biz.modular.calendar.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.date.DateUtil;
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
import vip.xiaonuo.biz.modular.calendar.entity.BizCalendarExclusion;
import vip.xiaonuo.biz.modular.calendar.mapper.BizCalendarExclusionMapper;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionAddParam;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionIdParam;
import vip.xiaonuo.biz.modular.calendar.param.BizCalendarExclusionPageParam;
import vip.xiaonuo.biz.modular.calendar.service.BizCalendarExclusionService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.util.Date;
import java.util.List;

/**
 * 校历排除日期Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizCalendarExclusionServiceImpl extends ServiceImpl<BizCalendarExclusionMapper, BizCalendarExclusion>
        implements BizCalendarExclusionService {

    @Resource
    private BizOrgService bizOrgService;

    @Override
    public Page<BizCalendarExclusion> page(BizCalendarExclusionPageParam param) {
        QueryWrapper<BizCalendarExclusion> queryWrapper = new QueryWrapper<BizCalendarExclusion>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            // 院级用户可查看全校级排除日及本学院排除日
            queryWrapper.lambda().and(w -> w.eq(BizCalendarExclusion::getScope, "school")
                    .or(sub -> {
                        sub.eq(BizCalendarExclusion::getScope, "org");
                        CommonSqlUtil.safeIn(sub, BizCalendarExclusion::getScopeId, scope);
                    }));
        }
        if (StrUtil.isNotBlank(param.getScope())) {
            queryWrapper.lambda().eq(BizCalendarExclusion::getScope, param.getScope());
        }
        if (StrUtil.isNotBlank(param.getScopeId())) {
            queryWrapper.lambda().eq(BizCalendarExclusion::getScopeId, param.getScopeId());
        }
        if (StrUtil.isNotBlank(param.getMonth())) {
            Date monthStart = DateUtil.parse(StrUtil.trim(param.getMonth()) + "-01", "yyyy-MM-dd");
            Date nextMonthStart = DateUtil.offsetMonth(monthStart, 1);
            queryWrapper.lambda().ge(BizCalendarExclusion::getExclusionDate, monthStart)
                    .lt(BizCalendarExclusion::getExclusionDate, nextMonthStart);
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            queryWrapper.lambda().like(BizCalendarExclusion::getReason, param.getSearchKey());
        }
        queryWrapper.lambda().orderByDesc(BizCalendarExclusion::getExclusionDate);
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizCalendarExclusionAddParam param) {
        String scope = StrUtil.trim(param.getScope()).toLowerCase();
        if (!"school".equals(scope) && !"org".equals(scope)) {
            throw new CommonException("作用域仅支持 school 或 org");
        }
        String scopeId = null;
        if ("org".equals(scope)) {
            if (StrUtil.isBlank(param.getScopeId())) {
                throw new CommonException("院级排除日必须指定学院");
            }
            scopeId = param.getScopeId();
            BizScopeUtil.assertOrgInScope(scopeId, "新增院级校历排除日");
        } else {
            if (BizScopeUtil.getDataScope() != null) {
                throw new CommonException("仅校级管理员可配置全校级校历排除日");
            }
        }
        Date dayOnly = DateUtil.beginOfDay(param.getExclusionDate());
        LambdaQueryWrapper<BizCalendarExclusion> dupWrapper = new LambdaQueryWrapper<BizCalendarExclusion>()
                .eq(BizCalendarExclusion::getScope, scope)
                .eq(BizCalendarExclusion::getExclusionDate, dayOnly);
        if (scopeId == null) {
            dupWrapper.isNull(BizCalendarExclusion::getScopeId);
        } else {
            dupWrapper.eq(BizCalendarExclusion::getScopeId, scopeId);
        }
        if (this.count(dupWrapper) > 0) {
            throw new CommonException("该日期 {} 已存在重复排除配置", DateUtil.formatDate(dayOnly));
        }
        BizCalendarExclusion entity = new BizCalendarExclusion();
        entity.setScope(scope);
        entity.setScopeId(scopeId);
        entity.setExclusionDate(dayOnly);
        entity.setReason(StrUtil.trimToNull(param.getReason()));
        entity.setCreatedBy(StpUtil.getLoginIdAsString());
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizCalendarExclusionIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizCalendarExclusionIdParam::getId);
        List<BizCalendarExclusion> list = this.listByIds(ids);
        for (BizCalendarExclusion item : list) {
            if ("org".equals(item.getScope())) {
                BizScopeUtil.assertOrgInScope(item.getScopeId(), "删除校历排除日");
            } else if (BizScopeUtil.getDataScope() != null) {
                throw new CommonException("仅校级管理员可删除全校级校历排除日");
            }
        }
        this.removeByIds(ids);
    }

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }
}
