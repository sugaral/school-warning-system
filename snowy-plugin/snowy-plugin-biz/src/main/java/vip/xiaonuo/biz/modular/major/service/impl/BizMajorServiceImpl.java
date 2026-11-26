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
package vip.xiaonuo.biz.modular.major.service.impl;

import cn.hutool.core.bean.BeanUtil;
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
import vip.xiaonuo.biz.modular.major.entity.BizMajor;
import vip.xiaonuo.biz.modular.major.mapper.BizMajorMapper;
import vip.xiaonuo.biz.modular.major.param.BizMajorAddParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorEditParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorIdParam;
import vip.xiaonuo.biz.modular.major.param.BizMajorPageParam;
import vip.xiaonuo.biz.modular.major.service.BizMajorService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.common.enums.CommonSortOrderEnum;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;

import java.util.Collections;
import java.util.List;

/**
 * 专业信息Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizMajorServiceImpl extends ServiceImpl<BizMajorMapper, BizMajor> implements BizMajorService {

    @Resource
    private BizOrgService bizOrgService;

    @Override
    public Page<BizMajor> page(BizMajorPageParam param) {
        QueryWrapper<BizMajor> queryWrapper = new QueryWrapper<BizMajor>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizMajor::getOrgId)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(param.getOrgId())) {
            queryWrapper.lambda().eq(BizMajor::getOrgId, param.getOrgId());
        }
        if (ObjectUtil.isNotEmpty(param.getStatus())) {
            queryWrapper.lambda().eq(BizMajor::getStatus, param.getStatus());
        }
        if (ObjectUtil.isNotEmpty(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizMajor::getName, param.getSearchKey())
                    .or().like(BizMajor::getCode, param.getSearchKey()));
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByDesc(BizMajor::getCreateTime);
        }
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Override
    public List<BizMajor> listAll(String orgId) {
        LambdaQueryWrapper<BizMajor> wrapper = new LambdaQueryWrapper<>();
        if (!BizScopeUtil.applyOrgScope(wrapper, BizMajor::getOrgId)) {
            return Collections.emptyList();
        }
        if (StrUtil.isNotBlank(orgId)) {
            wrapper.eq(BizMajor::getOrgId, orgId);
        }
        wrapper.eq(BizMajor::getStatus, "active").orderByAsc(BizMajor::getName);
        return this.list(wrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizMajorAddParam param) {
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "新增专业");
        String trimmedName = StrUtil.trim(param.getName());
        boolean exists = this.count(new LambdaQueryWrapper<BizMajor>()
                .eq(BizMajor::getOrgId, param.getOrgId())
                .eq(BizMajor::getName, trimmedName)) > 0;
        if (exists) {
            throw new CommonException("该学院下已存在同名专业：{}", trimmedName);
        }
        BizMajor entity = BeanUtil.toBean(param, BizMajor.class);
        entity.setName(trimmedName);
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizMajorEditParam param) {
        BizMajor entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "编辑专业");
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "变更专业所属学院");
        String trimmedName = StrUtil.trim(param.getName());
        boolean exists = this.count(new LambdaQueryWrapper<BizMajor>()
                .eq(BizMajor::getOrgId, param.getOrgId())
                .eq(BizMajor::getName, trimmedName)
                .ne(BizMajor::getId, entity.getId())) > 0;
        if (exists) {
            throw new CommonException("该学院下已存在同名专业：{}", trimmedName);
        }
        BeanUtil.copyProperties(param, entity);
        entity.setName(trimmedName);
        if (StrUtil.isBlank(entity.getStatus())) {
            entity.setStatus("active");
        }
        this.updateById(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizMajorIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizMajorIdParam::getId);
        List<BizMajor> majors = this.listByIds(ids);
        for (BizMajor major : majors) {
            BizScopeUtil.assertOrgInScope(major.getOrgId(), "删除专业");
            long classCount = this.baseMapper.countRelatedClasses(major.getId());
            long studentCount = this.baseMapper.countRelatedStudents(major.getId());
            if (classCount > 0 || studentCount > 0) {
                throw new CommonException("专业【{}】仍关联 {} 个班级、{} 名学生，无法删除",
                        major.getName(), classCount, studentCount);
            }
        }
        this.removeByIds(ids);
    }

    @Override
    public BizMajor detail(BizMajorIdParam idParam) {
        BizMajor entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看专业");
        return entity;
    }

    @Override
    public BizMajor queryEntity(String id) {
        BizMajor entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("专业不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }
}
