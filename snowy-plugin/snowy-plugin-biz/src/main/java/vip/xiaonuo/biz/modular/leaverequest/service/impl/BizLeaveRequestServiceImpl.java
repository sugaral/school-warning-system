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
package vip.xiaonuo.biz.modular.leaverequest.service.impl;

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
import vip.xiaonuo.biz.modular.attendance.entity.BizAttendanceRecord;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizAttendanceRecordMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.service.BizAttendanceSnapshotService;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.mapper.BizLeaveRequestMapper;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestAddParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestApproveParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestIdParam;
import vip.xiaonuo.biz.modular.leaverequest.param.BizLeaveRequestPageParam;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
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
 * 请假申请Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizLeaveRequestServiceImpl extends ServiceImpl<BizLeaveRequestMapper, BizLeaveRequest>
        implements BizLeaveRequestService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassSessionMapper bizClassSessionMapper;

    @Resource
    private BizAttendanceRecordMapper bizAttendanceRecordMapper;

    @Lazy
    @Resource
    private BizAttendanceSnapshotService bizAttendanceSnapshotService;

    @Lazy
    @Resource
    private BizDailyRecordService bizDailyRecordService;

    @Lazy
    @Resource
    private BizWarningEngineService bizWarningEngineService;

    @Override
    public Page<BizLeaveRequest> page(BizLeaveRequestPageParam param) {
        QueryWrapper<BizLeaveRequest> queryWrapper = new QueryWrapper<BizLeaveRequest>().checkSqlInjection();
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizClass> cw = new LambdaQueryWrapper<BizClass>().select(BizClass::getId);
            CommonSqlUtil.safeIn(cw, BizClass::getOrgId, scope);
            List<String> allowedClassIds = CollStreamUtil.toList(bizClassService.list(cw), BizClass::getId);
            if (allowedClassIds.isEmpty()) {
                return new Page<>();
            }
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizLeaveRequest::getClassId, allowedClassIds);
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizLeaveRequest::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizLeaveRequest::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizLeaveRequest::getReason, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizLeaveRequest::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizLeaveRequest::getCreateTime);
        Page<BizLeaveRequest> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillStudentNo(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizLeaveRequestAddParam param) {
        if (!param.getToDate().after(param.getFromDate())) {
            throw new CommonException("请假结束时间必须晚于开始时间");
        }
        BizStudentProfile student = bizStudentProfileService.queryEntity(param.getStudentId());
        BizScopeUtil.assertOrgInScope(student.getOrgId(), "代录请假申请");

        BizLeaveRequest entity = new BizLeaveRequest();
        entity.setStudentId(student.getId());
        entity.setClassId(student.getClassId());
        entity.setFromDate(param.getFromDate());
        entity.setToDate(param.getToDate());
        entity.setReason(StrUtil.trim(param.getReason()));
        entity.setStatus("submitted");
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void approve(BizLeaveRequestApproveParam param) {
        BizLeaveRequest existing = this.queryEntity(param.getId());
        BizClass cls = bizClassService.queryEntity(existing.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "审批请假申请");
        if ("approved".equals(existing.getStatus()) || "rejected".equals(existing.getStatus())) {
            throw new CommonException("该请假申请已审批完成，请勿重复操作");
        }

        existing.setApproverUserId(StpUtil.getLoginIdAsString());
        Date now = new Date();
        if (Boolean.TRUE.equals(param.getApprove())) {
            existing.setStatus("approved");
            existing.setApprovedAt(now);
            existing.setRejectReason(null);
        } else {
            if (StrUtil.isBlank(param.getRejectReason())) {
                throw new CommonException("驳回请假必须填写驳回原因");
            }
            existing.setStatus("rejected");
            existing.setRejectedAt(now);
            existing.setRejectReason(StrUtil.trim(param.getRejectReason()));
        }
        this.updateById(existing);
        if (Boolean.TRUE.equals(param.getApprove())) {
            syncLeaveEffects(existing);
        }
    }

    private void syncLeaveEffects(BizLeaveRequest leave) {
        if (leave.getFromDate() == null || leave.getToDate() == null || StrUtil.isBlank(leave.getStudentId())) {
            return;
        }
        BizStudentProfile student = bizStudentProfileService.getById(leave.getStudentId());
        String orgId = student != null ? student.getOrgId() : null;

        // 1. 同步请假时间段内的课堂考勤记录(absent/late/early_leave -> leave)并刷新快照
        if (StrUtil.isNotBlank(leave.getClassId())) {
            List<BizClassSession> overlappingSessions = bizClassSessionMapper.selectList(
                    new LambdaQueryWrapper<BizClassSession>()
                            .eq(BizClassSession::getClassId, leave.getClassId())
                            .le(BizClassSession::getSessionStart, leave.getToDate())
                            .ge(BizClassSession::getSessionEnd, leave.getFromDate()));
            Set<String> touchedSessions = new HashSet<>();
            for (BizClassSession session : overlappingSessions) {
                BizAttendanceRecord record = bizAttendanceRecordMapper.selectOne(
                        new LambdaQueryWrapper<BizAttendanceRecord>()
                                .eq(BizAttendanceRecord::getSessionId, session.getId())
                                .eq(BizAttendanceRecord::getStudentId, leave.getStudentId())
                                .last("LIMIT 1"));
                if (record != null && ("absent".equals(record.getAttendanceStatus())
                        || "late".equals(record.getAttendanceStatus())
                        || "early_leave".equals(record.getAttendanceStatus()))) {
                    record.setAttendanceStatus("leave");
                    record.setSource("leave_sync");
                    bizAttendanceRecordMapper.updateById(record);
                    touchedSessions.add(session.getId());
                }
                if (StrUtil.isNotBlank(session.getCourseId()) && session.getSessionStart() != null) {
                    bizDailyRecordService.mergeAttendanceStatus(leave.getStudentId(), leave.getClassId(), orgId,
                            session.getCourseId(), session.getSessionStart(), "leave", "leave_sync");
                }
            }
            if (!touchedSessions.isEmpty()) {
                bizAttendanceSnapshotService.refreshSessions(touchedSessions);
            }
        }

        // 2. 同步请假日期范围(fromDate..toDate)内的每日考勤异常记录为 leave
        LocalDate fromLocal = Instant.ofEpochMilli(leave.getFromDate().getTime()).atZone(ZONE_SHANGHAI).toLocalDate();
        LocalDate toLocal = Instant.ofEpochMilli(leave.getToDate().getTime()).atZone(ZONE_SHANGHAI).toLocalDate();
        if (toLocal.isBefore(fromLocal)) {
            toLocal = fromLocal;
        }
        List<BizDailyRecord> dailyRecords = bizDailyRecordService.list(
                new LambdaQueryWrapper<BizDailyRecord>()
                        .eq(BizDailyRecord::getStudentId, leave.getStudentId())
                        .ge(BizDailyRecord::getRecordDate, fromLocal.toString())
                        .le(BizDailyRecord::getRecordDate, toLocal.toString()));
        for (BizDailyRecord dr : dailyRecords) {
            if ("absent".equals(dr.getAttendanceStatus())
                    || "late".equals(dr.getAttendanceStatus())
                    || "early_leave".equals(dr.getAttendanceStatus())) {
                dr.setAttendanceStatus("leave");
                dr.setSource("leave_sync");
                dr.setApprovedStatus("approved");
                dr.setApprovedBy(leave.getApproverUserId());
                dr.setApprovedAt(leave.getApprovedAt());
                bizDailyRecordService.updateById(dr);
            }
        }

        // 3. 触发请假日期区间学业预警重算（请假生效后自动消除对应区间预警并同步风险工单）
        for (LocalDate d = fromLocal; !d.isAfter(toLocal); d = d.plusDays(1)) {
            bizWarningEngineService.evaluateStudent(leave.getStudentId(), d, null);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizLeaveRequestIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizLeaveRequestIdParam::getId);
        List<BizLeaveRequest> list = this.listByIds(ids);
        for (BizLeaveRequest item : list) {
            BizClass cls = bizClassService.queryEntity(item.getClassId());
            BizScopeUtil.assertOrgInScope(cls.getOrgId(), "删除请假记录");
        }
        this.removeByIds(ids);
    }

    @Override
    public BizLeaveRequest detail(BizLeaveRequestIdParam idParam) {
        BizLeaveRequest entity = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(entity.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "查看请假详情");
        fillStudentNo(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizLeaveRequest queryEntity(String id) {
        BizLeaveRequest entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("请假申请不存在，id={}", id);
        }
        return entity;
    }

    private void fillStudentNo(List<BizLeaveRequest> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizLeaveRequest::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, String> noMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, BizStudentProfile::getStudentNo, (a, b) -> a));
        for (BizLeaveRequest r : records) {
            r.setStudentNo(noMap.get(r.getStudentId()));
        }
    }
}
