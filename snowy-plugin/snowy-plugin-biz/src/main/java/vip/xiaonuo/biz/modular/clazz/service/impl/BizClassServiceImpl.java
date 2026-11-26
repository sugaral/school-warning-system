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
package vip.xiaonuo.biz.modular.clazz.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.convert.Convert;
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
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.mapper.BizClassMapper;
import vip.xiaonuo.biz.modular.clazz.param.BizClassAddParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassEditParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassIdParam;
import vip.xiaonuo.biz.modular.clazz.param.BizClassPageParam;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.major.entity.BizMajor;
import vip.xiaonuo.biz.modular.major.service.BizMajorService;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.common.enums.CommonSortOrderEnum;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.sys.api.SysUserApi;

import java.util.*;

/**
 * 班级信息Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizClassServiceImpl extends ServiceImpl<BizClassMapper, BizClass> implements BizClassService {

    private static final String HEAD_TEACHER_ROLE_ID = "1909000000000000001";

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizMajorService bizMajorService;

    @Resource
    private SysUserApi sysUserApi;

    @Override
    public Page<BizClass> page(BizClassPageParam param) {
        QueryWrapper<BizClass> queryWrapper = new QueryWrapper<BizClass>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizClass::getOrgId)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(param.getOrgId())) {
            queryWrapper.lambda().eq(BizClass::getOrgId, param.getOrgId());
        }
        if (ObjectUtil.isNotEmpty(param.getEnrollYear())) {
            queryWrapper.lambda().eq(BizClass::getEnrollYear, param.getEnrollYear());
        }
        if (ObjectUtil.isNotEmpty(param.getStatus())) {
            queryWrapper.lambda().eq(BizClass::getStatus, param.getStatus());
        }
        if (ObjectUtil.isNotEmpty(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizClass::getClassName, param.getSearchKey())
                    .or().like(BizClass::getMajor, param.getSearchKey()));
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByAsc(BizClass::getClassName);
        }
        Page<BizClass> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillStudentCounts(page.getRecords());
        return page;
    }

    @Override
    public List<BizClass> listAll(String orgId) {
        LambdaQueryWrapper<BizClass> wrapper = new LambdaQueryWrapper<>();
        if (!BizScopeUtil.applyOrgScope(wrapper, BizClass::getOrgId)) {
            return Collections.emptyList();
        }
        if (StrUtil.isNotBlank(orgId)) {
            wrapper.eq(BizClass::getOrgId, orgId);
        }
        wrapper.eq(BizClass::getStatus, "active").orderByAsc(BizClass::getClassName);
        return this.list(wrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizClassAddParam param) {
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "新增班级");
        String trimmedName = StrUtil.trim(param.getClassName());
        boolean exists = this.count(new LambdaQueryWrapper<BizClass>()
                .eq(BizClass::getOrgId, param.getOrgId())
                .eq(BizClass::getClassName, trimmedName)
                .eq(BizClass::getEnrollYear, param.getEnrollYear())) > 0;
        if (exists) {
            throw new CommonException("该学院 {} 级已存在同名班级：{}", param.getEnrollYear(), trimmedName);
        }
        BizClass entity = BeanUtil.toBean(param, BizClass.class);
        entity.setClassName(trimmedName);
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        syncMajorTextIfPresent(entity);
        this.save(entity);
        ensureHeadTeacherRole(entity.getCounselorUserId());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizClassEditParam param) {
        BizClass entity = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "编辑班级");
        BizScopeUtil.assertOrgInScope(param.getOrgId(), "变更班级所属学院");
        String trimmedName = StrUtil.trim(param.getClassName());
        boolean exists = this.count(new LambdaQueryWrapper<BizClass>()
                .eq(BizClass::getOrgId, param.getOrgId())
                .eq(BizClass::getClassName, trimmedName)
                .eq(BizClass::getEnrollYear, param.getEnrollYear())
                .ne(BizClass::getId, entity.getId())) > 0;
        if (exists) {
            throw new CommonException("该学院 {} 级已存在同名班级：{}", param.getEnrollYear(), trimmedName);
        }
        BeanUtil.copyProperties(param, entity);
        entity.setClassName(trimmedName);
        if (StrUtil.isBlank(entity.getStatus())) {
            entity.setStatus("active");
        }
        syncMajorTextIfPresent(entity);
        this.updateById(entity);
        ensureHeadTeacherRole(entity.getCounselorUserId());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizClassIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizClassIdParam::getId);
        List<BizClass> classes = this.listByIds(ids);
        for (BizClass cls : classes) {
            BizScopeUtil.assertOrgInScope(cls.getOrgId(), "删除班级");
            String blockingSummary = buildBlockingRelationSummary(cls.getId());
            if (StrUtil.isNotBlank(blockingSummary)) {
                throw new CommonException("班级【{}】仍有关联数据（{}），无法删除", cls.getClassName(), blockingSummary);
            }
        }
        this.removeByIds(ids);
    }

    @Override
    public BizClass detail(BizClassIdParam idParam) {
        BizClass entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看班级");
        fillStudentCounts(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizClass queryEntity(String id) {
        BizClass entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("班级不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }

    @Override
    public Page<JSONObject> userSelector(String orgId, String searchKey) {
        return sysUserApi.userSelector(orgId, searchKey);
    }

    private void syncMajorTextIfPresent(BizClass entity) {
        if (StrUtil.isNotBlank(entity.getMajorId())) {
            BizMajor major = bizMajorService.queryEntity(entity.getMajorId());
            if (!Objects.equals(major.getOrgId(), entity.getOrgId())) {
                throw new CommonException("所选专业不属于当前学院");
            }
            if (StrUtil.isBlank(entity.getMajor())) {
                entity.setMajor(major.getName());
            }
        }
    }

    private void ensureHeadTeacherRole(String counselorUserId) {
        if (StrUtil.isBlank(counselorUserId)) {
            return;
        }
        List<String> roleIds = new ArrayList<>(Optional.ofNullable(sysUserApi.ownRole(counselorUserId)).orElseGet(Collections::emptyList));
        if (!roleIds.contains(HEAD_TEACHER_ROLE_ID)) {
            roleIds.add(HEAD_TEACHER_ROLE_ID);
            sysUserApi.grantRole(counselorUserId, roleIds);
        }
    }

    private void fillStudentCounts(List<BizClass> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        List<String> classIds = CollStreamUtil.toList(records, BizClass::getId);
        List<Map<String, Object>> countRows = this.baseMapper.selectStudentCountByClassIds(classIds);
        Map<String, Long> countMap = new HashMap<>();
        if (ObjectUtil.isNotEmpty(countRows)) {
            for (Map<String, Object> row : countRows) {
                String classId = Convert.toStr(row.get("classId"));
                Long cnt = Convert.toLong(row.get("cnt"), 0L);
                if (classId != null) {
                    countMap.put(classId, cnt);
                }
            }
        }
        for (BizClass cls : records) {
            cls.setStudentCount(countMap.getOrDefault(cls.getId(), 0L));
        }
    }

    private String buildBlockingRelationSummary(String classId) {
        Map<String, Object> summary = this.baseMapper.selectClassRelationSummary(classId);
        if (ObjectUtil.isEmpty(summary)) {
            return "";
        }
        List<String> parts = new ArrayList<>();
        appendCount(parts, summary.get("studentCnt"), "名学生");
        appendCount(parts, summary.get("sessionCnt"), "个课次");
        appendCount(parts, summary.get("scheduleCnt"), "条课表");
        appendCount(parts, summary.get("courseClassCnt"), "条开课班");
        appendCount(parts, summary.get("leaveCnt"), "条请假申请");
        appendCount(parts, summary.get("warningCnt"), "条预警记录");
        appendCount(parts, summary.get("warningCaseCnt"), "条高风险工单");
        appendCount(parts, summary.get("bindingCnt"), "条授课绑定");
        appendCount(parts, summary.get("dailyCnt"), "条日考勤记录");
        return String.join("、", parts);
    }

    private void appendCount(List<String> parts, Object val, String unit) {
        long count = Convert.toLong(val, 0L);
        if (count > 0) {
            parts.add(count + " " + unit);
        }
    }
}
