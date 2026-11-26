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
package vip.xiaonuo.biz.modular.makeuprequest.service.impl;

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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizAttendanceRecord;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizAttendanceRecordMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.param.BizDailyRecordUpsertParam;
import vip.xiaonuo.biz.modular.attendance.service.BizAttendanceSnapshotService;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.makeuprequest.entity.BizMakeupRequest;
import vip.xiaonuo.biz.modular.makeuprequest.mapper.BizMakeupRequestMapper;
import vip.xiaonuo.biz.modular.makeuprequest.param.BizMakeupRequestAddParam;
import vip.xiaonuo.biz.modular.makeuprequest.param.BizMakeupRequestApproveParam;
import vip.xiaonuo.biz.modular.makeuprequest.param.BizMakeupRequestIdParam;
import vip.xiaonuo.biz.modular.makeuprequest.param.BizMakeupRequestPageParam;
import vip.xiaonuo.biz.modular.makeuprequest.service.BizMakeupRequestService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.warning.service.BizWarningEngineService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 考勤补录申请Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizMakeupRequestServiceImpl extends ServiceImpl<BizMakeupRequestMapper, BizMakeupRequest>
        implements BizMakeupRequestService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizCourseService bizCourseService;

    @Lazy
    @Resource
    private BizDailyRecordService bizDailyRecordService;

    @Resource
    private BizClassSessionMapper bizClassSessionMapper;

    @Resource
    private BizAttendanceRecordMapper bizAttendanceRecordMapper;

    @Lazy
    @Resource
    private BizAttendanceSnapshotService bizAttendanceSnapshotService;

    @Lazy
    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Override
    public Page<BizMakeupRequest> page(BizMakeupRequestPageParam param) {
        QueryWrapper<BizMakeupRequest> queryWrapper = new QueryWrapper<BizMakeupRequest>().checkSqlInjection();
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
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizMakeupRequest::getStudentId, allowedStudentIds);
        }
        if (StrUtil.isNotBlank(param.getStudentId())) {
            queryWrapper.lambda().eq(BizMakeupRequest::getStudentId, param.getStudentId());
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizMakeupRequest::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizMakeupRequest::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizMakeupRequest::getReason, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizMakeupRequest::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizMakeupRequest::getCreateTime);
        Page<BizMakeupRequest> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichRecords(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizMakeupRequestAddParam param) {
        String trimmedChange = StrUtil.trim(param.getChangeJson());
        if (!JSONUtil.isTypeJSON(trimmedChange)) {
            throw new CommonException("变更内容必须是合法的JSON字符串");
        }
        BizStudentProfile student = bizStudentProfileService.queryEntity(param.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "代录考勤补录申请");
        if (StrUtil.isNotBlank(param.getCourseId())) {
            bizCourseService.queryEntity(param.getCourseId());
        }

        BizMakeupRequest entity = new BizMakeupRequest();
        entity.setStudentId(student.getId());
        entity.setRecordDate(param.getRecordDate());
        entity.setCourseId(StrUtil.isNotBlank(param.getCourseId()) ? StrUtil.trim(param.getCourseId()) : null);
        entity.setChangeJson(trimmedChange);
        entity.setReason(StrUtil.trim(param.getReason()));
        entity.setStatus("submitted");
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void approve(BizMakeupRequestApproveParam param) {
        BizMakeupRequest existing = this.queryEntity(param.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(existing.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "审批考勤补录申请");

        existing.setApproverUserId(StpUtil.getLoginIdAsString());
        Date now = new Date();
        if (Boolean.TRUE.equals(param.getApprove())) {
            existing.setStatus("approved");
            existing.setApprovedAt(now);
            existing.setRejectReason(null);
            applyMakeupEffects(existing, student);
        } else {
            if (StrUtil.isBlank(param.getRejectReason())) {
                throw new CommonException("驳回补录申请必须填写驳回原因");
            }
            existing.setStatus("rejected");
            existing.setRejectedAt(now);
            existing.setRejectReason(StrUtil.trim(param.getRejectReason()));
        }
        this.updateById(existing);
    }

    private void applyMakeupEffects(BizMakeupRequest req, BizStudentProfile student) {
        if (req.getRecordDate() == null || StrUtil.isBlank(req.getChangeJson())) {
            return;
        }
        JSONObject payload = JSONUtil.parseObj(req.getChangeJson());
        String attStatus = StrUtil.blankToDefault(
                payload.getStr("attendance_status"), payload.getStr("attendanceStatus"));
        String hwStatus = StrUtil.blankToDefault(
                payload.getStr("homework_status"), payload.getStr("homeworkStatus"));
        String behavior = StrUtil.blankToDefault(
                payload.getStr("class_behavior"), payload.getStr("classBehavior"));
        String remarks = StrUtil.blankToDefault(payload.getStr("remarks"), req.getReason());
        String courseId = StrUtil.blankToDefault(req.getCourseId(),
                StrUtil.blankToDefault(payload.getStr("course_id"), payload.getStr("courseId")));
        String sessionId = StrUtil.blankToDefault(payload.getStr("session_id"), payload.getStr("sessionId"));

        LocalDate recordLocal = (req.getRecordDate() instanceof java.sql.Date)
                ? LocalDate.parse(req.getRecordDate().toString())
                : Instant.ofEpochMilli(req.getRecordDate().getTime()).atZone(ZONE_SHANGHAI).toLocalDate();
        String dateStr = recordLocal.toString();

        // 1. 写入或合并 BIZ_DAILY_RECORD 并回填 appliedDailyRecordId
        if (StrUtil.isNotBlank(courseId)) {
            BizDailyRecordUpsertParam upsert = new BizDailyRecordUpsertParam();
            upsert.setStudentId(student.getId());
            upsert.setRecordDate(dateStr);
            upsert.setCourseId(courseId);
            if (StrUtil.isNotBlank(attStatus)) {
                upsert.setAttendanceStatus(attStatus);
            }
            if (StrUtil.isNotBlank(hwStatus)) {
                upsert.setHomeworkStatus(hwStatus);
            }
            if (StrUtil.isNotBlank(behavior)) {
                upsert.setClassBehavior(behavior);
            }
            upsert.setRemarks(remarks);
            JSONObject upsertRes = bizDailyRecordService.batchUpsert(Collections.singletonList(upsert));
            JSONArray items = upsertRes.getJSONArray("items");
            if (items != null && !items.isEmpty()) {
                req.setAppliedDailyRecordId(items.getJSONObject(0).getStr("id"));
            }
        } else {
            List<BizDailyRecord> sameDayRecords = bizDailyRecordService.list(
                    new LambdaQueryWrapper<BizDailyRecord>()
                            .eq(BizDailyRecord::getStudentId, student.getId())
                            .eq(BizDailyRecord::getRecordDate, dateStr));
            for (BizDailyRecord dr : sameDayRecords) {
                if (StrUtil.isNotBlank(attStatus)) dr.setAttendanceStatus(attStatus);
                if (StrUtil.isNotBlank(hwStatus)) dr.setHomeworkStatus(hwStatus);
                if (StrUtil.isNotBlank(behavior)) dr.setClassBehavior(behavior);
                bizDailyRecordService.updateById(dr);
                if (StrUtil.isBlank(req.getAppliedDailyRecordId())) {
                    req.setAppliedDailyRecordId(dr.getId());
                }
            }
        }

        // 2. 若指定了课次或同日存在对应课程课次，同步修正课堂签到记录与快照
        if (StrUtil.isNotBlank(attStatus)) {
            Set<String> targetSessionIds = new HashSet<>();
            if (StrUtil.isNotBlank(sessionId)) {
                targetSessionIds.add(sessionId);
            } else if (StrUtil.isNotBlank(student.getClassId()) && StrUtil.isNotBlank(courseId)) {
                Date dayStart = Date.from(recordLocal.atStartOfDay(ZONE_SHANGHAI).toInstant());
                Date dayEnd = Date.from(recordLocal.plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
                List<BizClassSession> sessions = bizClassSessionMapper.selectList(
                        new LambdaQueryWrapper<BizClassSession>()
                                .eq(BizClassSession::getClassId, student.getClassId())
                                .eq(BizClassSession::getCourseId, courseId)
                                .ge(BizClassSession::getSessionStart, dayStart)
                                .lt(BizClassSession::getSessionStart, dayEnd));
                sessions.forEach(s -> targetSessionIds.add(s.getId()));
            }
            Set<String> refreshed = new HashSet<>();
            String normalizedAtt = "present".equals(attStatus) ? "on_time" : attStatus;
            for (String sid : targetSessionIds) {
                BizAttendanceRecord ar = bizAttendanceRecordMapper.selectOne(
                        new LambdaQueryWrapper<BizAttendanceRecord>()
                                .eq(BizAttendanceRecord::getSessionId, sid)
                                .eq(BizAttendanceRecord::getStudentId, student.getId())
                                .last("LIMIT 1"));
                if (ar != null) {
                    ar.setAttendanceStatus(normalizedAtt);
                    ar.setSource("manual");
                    bizAttendanceRecordMapper.updateById(ar);
                    refreshed.add(sid);
                }
            }
            if (!refreshed.isEmpty()) {
                bizAttendanceSnapshotService.refreshSessions(refreshed);
            }
        }

        // 3. 重算补录对应日期的预警状态
        bizWarningEngineService.evaluateStudent(student.getId(), recordLocal, null);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizMakeupRequestIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizMakeupRequestIdParam::getId);
        List<BizMakeupRequest> list = this.listByIds(ids);
        for (BizMakeupRequest item : list) {
            BizStudentProfile student = bizStudentProfileService.queryEntity(item.getStudentId());
            BizScopeUtil.assertOrgInScope(student.getOrgId(), "删除考勤补录申请");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizMakeupRequest detail(BizMakeupRequestIdParam idParam) {
        BizMakeupRequest entity = this.queryEntity(idParam.getId());
        BizStudentProfile student = bizStudentProfileService.queryEntity(entity.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "查看考勤补录详情");
        enrichRecords(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizMakeupRequest queryEntity(String id) {
        BizMakeupRequest entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("考勤补录申请不存在，id={}", id);
        }
        return entity;
    }

    private void enrichRecords(List<BizMakeupRequest> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizMakeupRequest::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, BizStudentProfile> stuMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, s -> s, (a, b) -> a));
        Set<String> classIds = stuMap.values().stream().map(BizStudentProfile::getClassId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, String> classMap = classIds.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(classIds).stream()
                        .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));
        for (BizMakeupRequest r : records) {
            BizStudentProfile stu = stuMap.get(r.getStudentId());
            if (stu != null) {
                r.setStudentNo(stu.getStudentNo());
                r.setClassName(classMap.get(stu.getClassId()));
            }
        }
    }
}
