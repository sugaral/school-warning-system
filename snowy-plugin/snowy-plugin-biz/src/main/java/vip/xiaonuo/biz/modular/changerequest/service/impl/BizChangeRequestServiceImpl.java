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
package vip.xiaonuo.biz.modular.changerequest.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.auth.core.pojo.SaBaseLoginUser;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.changerequest.entity.BizChangeRequest;
import vip.xiaonuo.biz.modular.changerequest.mapper.BizChangeRequestMapper;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestAddParam;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestApproveParam;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestIdParam;
import vip.xiaonuo.biz.modular.changerequest.param.BizChangeRequestPageParam;
import vip.xiaonuo.biz.modular.changerequest.service.BizChangeRequestService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.grade.entity.BizGrade;
import vip.xiaonuo.biz.modular.grade.service.BizGradeService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.teacherbinding.entity.BizTeacherCourseBinding;
import vip.xiaonuo.biz.modular.teacherbinding.service.BizTeacherCourseBindingService;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.biz.modular.user.service.BizUserService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningSnapshotService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 信息变更申请Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizChangeRequestServiceImpl extends ServiceImpl<BizChangeRequestMapper, BizChangeRequest>
        implements BizChangeRequestService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Resource
    private BizUserService bizUserService;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizGradeService bizGradeService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizTeacherCourseBindingService bizTeacherCourseBindingService;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Lazy
    @Resource
    private BizWarningSnapshotService bizWarningSnapshotService;

    @Lazy
    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Override
    public Page<BizChangeRequest> page(BizChangeRequestPageParam param) {
        QueryWrapper<BizChangeRequest> queryWrapper = new QueryWrapper<BizChangeRequest>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>()
                    .select(BizStudentProfile::getId);
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getOrgId, scope);
            List<String> allowedStudentIds = CollStreamUtil.toList(bizStudentProfileService.list(sw), BizStudentProfile::getId);

            List<String> allowedGradeIds = allowedStudentIds.isEmpty() ? Collections.emptyList() :
                    CollStreamUtil.toList(
                            bizGradeService.list(new LambdaQueryWrapper<BizGrade>()
                                    .select(BizGrade::getId)
                                    .in(BizGrade::getStudentId, allowedStudentIds)),
                            BizGrade::getId);

            LambdaQueryWrapper<BizUser> uw = new LambdaQueryWrapper<BizUser>().select(BizUser::getId);
            CommonSqlUtil.safeIn(uw, BizUser::getOrgId, scope);
            List<String> allowedUserIds = CollStreamUtil.toList(bizUserService.list(uw), BizUser::getId);

            if (allowedStudentIds.isEmpty() && allowedGradeIds.isEmpty() && allowedUserIds.isEmpty()) {
                return new Page<>();
            }
            queryWrapper.lambda().and(w -> {
                boolean hasBranch = false;
                if (!allowedStudentIds.isEmpty()) {
                    w.and(sub -> {
                        sub.in(BizChangeRequest::getTargetType, "student_profile", "student_profile_class_change");
                        CommonSqlUtil.safeIn(sub, BizChangeRequest::getTargetId, allowedStudentIds);
                    });
                    hasBranch = true;
                }
                if (!allowedGradeIds.isEmpty()) {
                    if (hasBranch) {
                        w.or(sub -> {
                            sub.eq(BizChangeRequest::getTargetType, "grade");
                            CommonSqlUtil.safeIn(sub, BizChangeRequest::getTargetId, allowedGradeIds);
                        });
                    } else {
                        w.and(sub -> {
                            sub.eq(BizChangeRequest::getTargetType, "grade");
                            CommonSqlUtil.safeIn(sub, BizChangeRequest::getTargetId, allowedGradeIds);
                        });
                        hasBranch = true;
                    }
                }
                if (!allowedUserIds.isEmpty()) {
                    if (hasBranch) {
                        w.or(sub -> CommonSqlUtil.safeIn(sub, BizChangeRequest::getRequesterUserId, allowedUserIds));
                    } else {
                        CommonSqlUtil.safeIn(w, BizChangeRequest::getRequesterUserId, allowedUserIds);
                    }
                }
            });
        }
        if (StrUtil.isNotBlank(param.getTargetType())) {
            queryWrapper.lambda().eq(BizChangeRequest::getTargetType, param.getTargetType());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizChangeRequest::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            queryWrapper.lambda().and(w -> w
                    .like(BizChangeRequest::getReason, key)
                    .or().like(BizChangeRequest::getChangeJson, key)
                    .or().like(BizChangeRequest::getTargetId, key));
        }
        queryWrapper.lambda().orderByDesc(BizChangeRequest::getCreateTime);
        Page<BizChangeRequest> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichRecords(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizChangeRequestAddParam param) {
        String trimmedChange = StrUtil.trim(param.getChangeJson());
        if (!JSONUtil.isTypeJSON(trimmedChange)) {
            throw new CommonException("变更内容必须是合法的JSON字符串");
        }
        String targetOrgId = resolveTargetOrgId(StrUtil.trim(param.getTargetType()), StrUtil.trim(param.getTargetId()), StpUtil.getLoginIdAsString());
        if (StrUtil.isNotBlank(targetOrgId)) {
            BizScopeUtil.assertOrgInScope(targetOrgId, "提交信息变更申请");
        }

        BizChangeRequest entity = new BizChangeRequest();
        entity.setRequesterUserId(StpUtil.getLoginIdAsString());
        entity.setTargetType(StrUtil.trim(param.getTargetType()));
        entity.setTargetId(StrUtil.trim(param.getTargetId()));
        entity.setChangeJson(trimmedChange);
        entity.setReason(StrUtil.isNotBlank(param.getReason()) ? StrUtil.trim(param.getReason()) : null);
        entity.setStatus("submitted");
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void approve(BizChangeRequestApproveParam param) {
        BizChangeRequest existing = this.queryEntity(param.getId());
        assertRequestInScope(existing, "审批信息变更申请");

        if ("approved".equals(existing.getStatus()) || "rejected".equals(existing.getStatus())) {
            throw new CommonException("该信息变更申请已终审，请勿重复审批");
        }
        String currentUserId = StpUtil.getLoginIdAsString();
        existing.setApproverUserId(currentUserId);
        Date now = new Date();
        if (Boolean.TRUE.equals(param.getApprove())) {
            SaBaseLoginUser loginUser = StpLoginUserUtil.getLoginUser();
            List<String> roles = loginUser != null && loginUser.getRoleCodeList() != null
                    ? loginUser.getRoleCodeList() : Collections.emptyList();
            boolean isHeadTeacherOnly = roles.contains("head_teacher")
                    && !roles.contains("vice_dean")
                    && !roles.contains("student_admin")
                    && !roles.contains("teaching_admin")
                    && !roles.contains("superAdmin")
                    && !roles.contains("bizAdmin");

            if ("pending_dean".equals(existing.getStatus()) && isHeadTeacherOnly) {
                throw new CommonException("该申请已进入副院长复核阶段，班主任无终审权限");
            }
            boolean isTwoStageClassChange = "student_profile_class_change".equals(existing.getTargetType())
                    && ("submitted".equals(existing.getStatus()) || "pending_head".equals(existing.getStatus()));
            if (isTwoStageClassChange && isHeadTeacherOnly) {
                existing.setStatus("pending_dean");
                existing.setRejectReason(null);
                appendHeadTeacherReviewJson(existing, loginUser);
                this.updateById(existing);
                return;
            }
            existing.setStatus("approved");
            existing.setApprovedAt(now);
            existing.setRejectReason(null);
            applyApprovedChange(existing);
        } else {
            if (StrUtil.isBlank(param.getRejectReason())) {
                throw new CommonException("驳回变更申请必须填写驳回原因");
            }
            existing.setStatus("rejected");
            existing.setRejectedAt(now);
            existing.setRejectReason(StrUtil.trim(param.getRejectReason()));
        }
        this.updateById(existing);
    }

    private void appendHeadTeacherReviewJson(BizChangeRequest req, SaBaseLoginUser reviewer) {
        try {
            JSONObject json = JSONUtil.parseObj(req.getChangeJson());
            json.set("workflow_stage", "vice_dean_review");
            json.set("head_teacher_review", new JSONObject()
                    .set("approved", true)
                    .set("reviewer_user_id", reviewer.getId())
                    .set("reviewer_name", reviewer.getName())
                    .set("reviewed_at", new Date().toInstant().toString()));
            req.setChangeJson(json.toString());
        } catch (Exception ignored) {
        }
    }

    private void applyApprovedChange(BizChangeRequest req) {
        if (StrUtil.isBlank(req.getChangeJson())) {
            return;
        }
        JSONObject json = JSONUtil.parseObj(req.getChangeJson());
        String targetType = StrUtil.trim(req.getTargetType());
        if ("student_profile_class_change".equals(targetType) || "student_profile".equals(targetType)) {
            BizStudentProfile stu = bizStudentProfileService.queryEntity(req.getTargetId());
            String oldClassId = stu.getClassId();
            String rawClassId = StrUtil.blankToDefault(json.getStr("target_class_id"),
                    StrUtil.blankToDefault(json.getStr("targetClassId"),
                            StrUtil.blankToDefault(json.getStr("class_id"), json.getStr("classId"))));
            String rawOrgId = StrUtil.blankToDefault(json.getStr("target_org_id"),
                    StrUtil.blankToDefault(json.getStr("targetOrgId"),
                            StrUtil.blankToDefault(json.getStr("org_id"), json.getStr("orgId"))));
            String resolvedClassId = resolveClassId(rawClassId);
            String resolvedOrgId = resolveOrgId(rawOrgId);
            if (StrUtil.isNotBlank(resolvedClassId)) {
                BizClass targetCls = bizClassService.getById(resolvedClassId);
                stu.setClassId(resolvedClassId);
                if (StrUtil.isBlank(resolvedOrgId) && targetCls != null) {
                    resolvedOrgId = targetCls.getOrgId();
                }
            }
            if (StrUtil.isNotBlank(resolvedOrgId)) {
                stu.setOrgId(resolvedOrgId);
            }
            String majorId = StrUtil.blankToDefault(json.getStr("target_major_id"), json.getStr("major_id"));
            if (StrUtil.isNotBlank(majorId)) {
                String resolvedMajorId = resolveMappedId(majorId, "majors");
                stu.setMajorId(resolvedMajorId);
            }
            String major = StrUtil.blankToDefault(json.getStr("target_major"), json.getStr("major"));
            if (StrUtil.isNotBlank(major)) {
                stu.setMajor(major);
            }
            String targetStatus = StrUtil.blankToDefault(json.getStr("target_status"), json.getStr("status"));
            if (StrUtil.isNotBlank(targetStatus)) {
                stu.setStatus(targetStatus);
            }
            Integer enrollYear = json.getInt("target_enroll_year", json.getInt("enroll_year"));
            if (enrollYear != null) {
                stu.setEnrollYear(enrollYear);
            }
            bizStudentProfileService.updateById(stu);

            bizWarningSnapshotService.refreshStudentSnapshots(Collections.singletonList(stu.getId()));
            Set<String> classIds = new HashSet<>();
            if (StrUtil.isNotBlank(oldClassId)) classIds.add(oldClassId);
            if (StrUtil.isNotBlank(stu.getClassId())) classIds.add(stu.getClassId());
            if (!classIds.isEmpty()) {
                bizWarningSnapshotService.refreshClassSnapshots(classIds);
            }
        } else if ("grade".equals(targetType)) {
            BizGrade grade = bizGradeService.queryEntity(req.getTargetId());
            BigDecimal targetScore = json.getBigDecimal("target_score",
                    json.getBigDecimal("targetScore", json.getBigDecimal("score")));
            if (targetScore != null) {
                grade.setScore(targetScore.setScale(2, RoundingMode.HALF_UP));
                if (json.getBigDecimal("target_grade_point") == null && targetScore.compareTo(BigDecimal.valueOf(60)) >= 0) {
                    BigDecimal gp = targetScore.subtract(BigDecimal.valueOf(50)).divide(BigDecimal.TEN, 2, RoundingMode.HALF_UP);
                    grade.setGradePoint(gp);
                } else if (json.getBigDecimal("target_grade_point") == null) {
                    grade.setGradePoint(BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP));
                }
            }
            BigDecimal gp = json.getBigDecimal("target_grade_point", json.getBigDecimal("gradePoint"));
            if (gp != null) {
                grade.setGradePoint(gp.setScale(2, RoundingMode.HALF_UP));
            }
            String passStatus = StrUtil.blankToDefault(json.getStr("target_pass_status"), json.getStr("passStatus"));
            if (StrUtil.isNotBlank(passStatus)) {
                grade.setPassStatus(passStatus);
            } else if (targetScore != null) {
                grade.setPassStatus(targetScore.compareTo(BigDecimal.valueOf(60)) >= 0 ? "pass" : "fail");
            }
            bizGradeService.updateById(grade);
            bizWarningEngineService.evaluateStudent(grade.getStudentId(), LocalDate.now(ZONE_SHANGHAI), grade.getTermCode());
        } else if ("teacher_org_change".equals(targetType)) {
            BizUser teacher = bizUserService.getById(req.getTargetId());
            if (teacher != null) {
                String rawOrgId = StrUtil.blankToDefault(json.getStr("target_org_id"),
                        StrUtil.blankToDefault(json.getStr("targetOrgId"),
                                StrUtil.blankToDefault(json.getStr("org_id"), json.getStr("orgId"))));
                String resolvedOrgId = resolveOrgId(rawOrgId);
                if (StrUtil.isNotBlank(resolvedOrgId)) {
                    teacher.setOrgId(resolvedOrgId);
                    bizUserService.updateById(teacher);
                }
            }
        } else if ("teacher_course_binding_change".equals(targetType)) {
            JSONArray targetBindings = json.getJSONArray("target_bindings");
            if (targetBindings == null) {
                targetBindings = json.getJSONArray("targetBindings");
            }
            if (targetBindings != null && StrUtil.isNotBlank(req.getTargetId())) {
                BizUser teacher = bizUserService.getById(req.getTargetId());
                String defaultOrgId = resolveOrgId(StrUtil.blankToDefault(json.getStr("org_id"),
                        teacher != null ? teacher.getOrgId() : null));
                bizTeacherCourseBindingService.remove(new LambdaQueryWrapper<BizTeacherCourseBinding>()
                        .eq(BizTeacherCourseBinding::getTeacherId, req.getTargetId()));
                List<BizTeacherCourseBinding> toSave = new ArrayList<>();
                for (int i = 0; i < targetBindings.size(); i++) {
                    JSONObject item = targetBindings.getJSONObject(i);
                    String courseId = resolveMappedId(
                            StrUtil.blankToDefault(item.getStr("course_id"), item.getStr("courseId")), "courses");
                    JSONArray classIds = item.getJSONArray("class_ids");
                    if (classIds == null) classIds = item.getJSONArray("classIds");
                    if (StrUtil.isBlank(courseId) || classIds == null) continue;
                    for (int j = 0; j < classIds.size(); j++) {
                        String cid = resolveClassId(classIds.getStr(j));
                        if (StrUtil.isBlank(cid)) continue;
                        BizClass cls = bizClassService.getById(cid);
                        BizTeacherCourseBinding b = new BizTeacherCourseBinding();
                        b.setTeacherId(req.getTargetId());
                        b.setCourseId(courseId);
                        b.setClassId(cid);
                        b.setOrgId(cls != null ? cls.getOrgId() : defaultOrgId);
                        toSave.add(b);
                    }
                }
                if (!toSave.isEmpty()) {
                    bizTeacherCourseBindingService.saveBatch(toSave);
                }
            }
        }
    }

    private String resolveClassId(String rawId) {
        if (StrUtil.isBlank(rawId)) return null;
        if (bizClassService.getById(rawId) != null) return rawId;
        String mapped = resolveMappedId(rawId, "classes");
        return bizClassService.getById(mapped) != null ? mapped : null;
    }

    private String resolveOrgId(String rawId) {
        if (StrUtil.isBlank(rawId)) return null;
        BizOrg org = bizOrgService.getById(rawId);
        if (org != null) return org.getId();
        String mapped = resolveMappedId(rawId, "orgs");
        return bizOrgService.getById(mapped) != null ? mapped : null;
    }

    private String resolveMappedId(String rawId, String sourceTable) {
        if (StrUtil.isBlank(rawId)) return rawId;
        List<String> list = jdbcTemplate.queryForList(
                "SELECT TARGET_ID FROM BIZ_MIGRATION_ID_MAP WHERE SOURCE_TABLE = ? AND SOURCE_ID = ? LIMIT 1",
                String.class, sourceTable, rawId);
        return list.isEmpty() ? rawId : list.get(0);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizChangeRequestIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizChangeRequestIdParam::getId);
        List<BizChangeRequest> list = this.listByIds(ids);
        for (BizChangeRequest item : list) {
            assertRequestInScope(item, "删除信息变更申请");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizChangeRequest detail(BizChangeRequestIdParam idParam) {
        BizChangeRequest entity = this.queryEntity(idParam.getId());
        assertRequestInScope(entity, "查看信息变更详情");
        enrichRecords(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizChangeRequest queryEntity(String id) {
        BizChangeRequest entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("信息变更申请不存在，id={}", id);
        }
        return entity;
    }

    private void assertRequestInScope(BizChangeRequest req, String actionDesc) {
        List<String> scope = BizScopeUtil.getDataScope();
        if (scope == null) {
            return;
        }
        String orgId = resolveTargetOrgId(req.getTargetType(), req.getTargetId(), req.getRequesterUserId());
        if (StrUtil.isBlank(orgId)) {
            throw new CommonException("您没有权限{}", actionDesc);
        }
        BizScopeUtil.assertOrgInScope(orgId, actionDesc);
    }

    private String resolveTargetOrgId(String targetType, String targetId, String requesterUserId) {
        if ("student_profile".equals(targetType) || "student_profile_class_change".equals(targetType)) {
            BizStudentProfile stu = bizStudentProfileService.getById(targetId);
            if (stu != null) {
                return stu.getOrgId();
            }
        } else if ("grade".equals(targetType)) {
            BizGrade grade = bizGradeService.getById(targetId);
            if (grade != null) {
                BizStudentProfile stu = bizStudentProfileService.getById(grade.getStudentId());
                if (stu != null) {
                    return stu.getOrgId();
                }
            }
        }
        if (StrUtil.isNotBlank(requesterUserId)) {
            BizUser user = bizUserService.getById(requesterUserId);
            if (user != null) {
                return user.getOrgId();
            }
        }
        if (StrUtil.isNotBlank(targetId)) {
            BizUser targetUser = bizUserService.getById(targetId);
            if (targetUser != null) {
                return targetUser.getOrgId();
            }
        }
        return null;
    }

    private void enrichRecords(List<BizChangeRequest> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> userIds = records.stream()
                .map(BizChangeRequest::getRequesterUserId)
                .filter(StrUtil::isNotBlank)
                .collect(Collectors.toSet());
        Map<String, String> userNameMap = userIds.isEmpty() ? Collections.emptyMap() :
                bizUserService.listByIds(userIds).stream()
                        .collect(Collectors.toMap(BizUser::getId, BizUser::getName, (a, b) -> a));

        Set<String> studentTargetIds = records.stream()
                .filter(r -> r.getTargetType() != null && r.getTargetType().startsWith("student"))
                .map(BizChangeRequest::getTargetId)
                .filter(StrUtil::isNotBlank)
                .collect(Collectors.toSet());
        Map<String, BizStudentProfile> stuByIdMap = studentTargetIds.isEmpty() ? Collections.emptyMap() :
                bizStudentProfileService.listByIds(studentTargetIds).stream()
                        .collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));

        Set<String> unresolvedReqIds = records.stream()
                .map(BizChangeRequest::getRequesterUserId)
                .filter(id -> StrUtil.isNotBlank(id) && !userNameMap.containsKey(id))
                .collect(Collectors.toSet());
        Map<String, BizStudentProfile> stuByClientMap = unresolvedReqIds.isEmpty() ? Collections.emptyMap() :
                bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                                .in(BizStudentProfile::getClientUserId, unresolvedReqIds))
                        .stream()
                        .collect(Collectors.toMap(BizStudentProfile::getClientUserId, s -> s, (a, b) -> a));

        for (BizChangeRequest r : records) {
            String name = userNameMap.get(r.getRequesterUserId());
            if (StrUtil.isBlank(name) && StrUtil.isNotBlank(r.getRequesterUserId())) {
                BizStudentProfile stuByClient = stuByClientMap.get(r.getRequesterUserId());
                if (stuByClient != null) {
                    name = stuByClient.getName() + " (" + stuByClient.getStudentNo() + ")";
                }
            }
            if (StrUtil.isBlank(name) && r.getTargetType() != null && r.getTargetType().startsWith("student")) {
                BizStudentProfile stu = stuByIdMap.get(r.getTargetId());
                if (stu != null) {
                    name = stu.getName() + " (" + stu.getStudentNo() + ")";
                }
            }
            r.setRequesterName(StrUtil.isNotBlank(name) ? name : r.getRequesterUserId());
        }
    }
}
