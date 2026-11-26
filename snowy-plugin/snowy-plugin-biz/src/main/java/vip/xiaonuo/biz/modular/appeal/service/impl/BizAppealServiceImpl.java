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
package vip.xiaonuo.biz.modular.appeal.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.appeal.entity.BizAppeal;
import vip.xiaonuo.biz.modular.appeal.mapper.BizAppealMapper;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealAddParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealHandleParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealIdParam;
import vip.xiaonuo.biz.modular.appeal.param.BizAppealPageParam;
import vip.xiaonuo.biz.modular.appeal.service.BizAppealService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.param.BizWarningCloseParam;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 学生申诉工单Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizAppealServiceImpl extends ServiceImpl<BizAppealMapper, BizAppeal>
        implements BizAppealService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final Set<String> VALID_HANDLE_STATUSES = Set.of("approved", "resolved", "rejected");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Lazy
    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Override
    public Page<BizAppeal> page(BizAppealPageParam param) {
        QueryWrapper<BizAppeal> queryWrapper = new QueryWrapper<BizAppeal>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>()
                    .select(BizStudentProfile::getId);
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, scope);
            List<String> allowedStudentIds = CollStreamUtil.toList(bizStudentProfileService.list(sw), BizStudentProfile::getId);
            if (allowedStudentIds.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizAppeal::getStudentId, allowedStudentIds);
        }
        if (StrUtil.isNotBlank(param.getStudentId())) {
            queryWrapper.lambda().eq(BizAppeal::getStudentId, param.getStudentId());
        }
        if (StrUtil.isNotBlank(param.getAppealType())) {
            queryWrapper.lambda().eq(BizAppeal::getAppealType, param.getAppealType());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizAppeal::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizAppeal::getContent, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizAppeal::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizAppeal::getCreateTime);
        Page<BizAppeal> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichRecords(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizAppealAddParam param) {
        BizStudentProfile student = bizStudentProfileService.queryEntity(param.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "代录学生申诉");

        BizAppeal entity = new BizAppeal();
        entity.setStudentId(student.getId());
        entity.setAppealType(StrUtil.trim(param.getAppealType()));
        entity.setRelatedType(StrUtil.isNotBlank(param.getRelatedType()) ? StrUtil.trim(param.getRelatedType()) : null);
        entity.setRelatedId(StrUtil.isNotBlank(param.getRelatedId()) ? StrUtil.trim(param.getRelatedId()) : null);
        entity.setContent(StrUtil.trim(param.getContent()));
        entity.setStatus("submitted");
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void handle(BizAppealHandleParam param) {
        String targetStatus = StrUtil.trim(param.getStatus());
        if (!VALID_HANDLE_STATUSES.contains(targetStatus)) {
            throw new CommonException("申诉处理状态仅支持 approved、resolved 或 rejected");
        }
        if ("rejected".equals(targetStatus) && StrUtil.isBlank(param.getResultNote())) {
            throw new CommonException("驳回申诉必须填写处理结果说明");
        }
        BizAppeal existing = this.queryEntity(param.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(existing.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "处理学生申诉");

        existing.setStatus(targetStatus);
        existing.setHandlerUserId(StpUtil.getLoginIdAsString());
        existing.setResultNote(StrUtil.isNotBlank(param.getResultNote()) ? StrUtil.trim(param.getResultNote()) : null);
        this.updateById(existing);

        if ("approved".equals(targetStatus) || "resolved".equals(targetStatus)) {
            syncAppealResolution(existing);
        }
    }

    private void syncAppealResolution(BizAppeal appeal) {
        if ("warning".equalsIgnoreCase(StrUtil.trim(appeal.getRelatedType()))
                && StrUtil.isNotBlank(appeal.getRelatedId())) {
            BizWarning warning = bizWarningEngineService.getById(appeal.getRelatedId());
            if (warning != null && !"closed".equals(warning.getStatus())) {
                BizWarningCloseParam closeParam = new BizWarningCloseParam();
                closeParam.setId(warning.getId());
                closeParam.setCloseNote("申诉办结自动关闭：" + StrUtil.blankToDefault(appeal.getResultNote(), "申诉通过"));
                bizWarningEngineService.close(closeParam);
                return;
            }
        }
        if (StrUtil.isNotBlank(appeal.getStudentId())) {
            bizWarningEngineService.evaluateStudent(appeal.getStudentId(), LocalDate.now(ZONE_SHANGHAI), null);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizAppealIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizAppealIdParam::getId);
        List<BizAppeal> list = this.listByIds(ids);
        for (BizAppeal item : list) {
            BizStudentProfile student = bizStudentProfileService.queryEntity(item.getStudentId());
            BizScopeUtil.assertOrgInScope(student.getOrgId(), "删除学生申诉");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizAppeal detail(BizAppealIdParam idParam) {
        BizAppeal entity = this.queryEntity(idParam.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(entity.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "查看申诉详情");
        enrichRecords(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizAppeal queryEntity(String id) {
        BizAppeal entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("学生申诉记录不存在，id={}", id);
        }
        return entity;
    }

    private void enrichRecords(List<BizAppeal> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizAppeal::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, BizStudentProfile> stuMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));
        Set<String> classIds = stuMap.values().stream().map(BizStudentProfile::getClassId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, String> classMap = classIds.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(classIds).stream()
                        .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));
        for (BizAppeal r : records) {
            BizStudentProfile stu = stuMap.get(r.getStudentId());
            if (stu != null) {
                r.setStudentNo(stu.getStudentNo());
                r.setClassName(classMap.get(stu.getClassId()));
            }
        }
    }
}
