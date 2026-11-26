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
package vip.xiaonuo.biz.modular.attendance.service.impl;

import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.modular.attendance.entity.BizAttendanceRecord;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSessionSnapshot;
import vip.xiaonuo.biz.modular.attendance.mapper.BizAttendanceRecordMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionSnapshotMapper;
import vip.xiaonuo.biz.modular.attendance.service.BizAttendanceSnapshotService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 课次签到统计快照Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizAttendanceSnapshotServiceImpl extends ServiceImpl<BizClassSessionSnapshotMapper, BizClassSessionSnapshot>
        implements BizAttendanceSnapshotService {

    @Resource
    private BizClassSessionMapper bizClassSessionMapper;

    @Resource
    private BizAttendanceRecordMapper bizAttendanceRecordMapper;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void refreshSessions(Collection<String> sessionIds) {
        if (ObjectUtil.isEmpty(sessionIds)) {
            return;
        }
        Set<String> cleanIds = sessionIds.stream().filter(StrUtil::isNotBlank).collect(Collectors.toCollection(LinkedHashSet::new));
        if (cleanIds.isEmpty()) {
            return;
        }

        List<BizClassSession> sessions = bizClassSessionMapper.selectBatchIds(cleanIds);
        if (sessions.isEmpty()) {
            deleteBySessionIds(cleanIds);
            return;
        }

        Set<String> classIds = sessions.stream().map(BizClassSession::getClassId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, BizClass> classMap = classIds.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(classIds).stream().collect(Collectors.toMap(BizClass::getId, c -> c, (a, b) -> a));

        Map<String, Integer> activeStudentCountMap = new HashMap<>();
        if (!classIds.isEmpty()) {
            LambdaQueryWrapper<BizStudentProfile> sw = new LambdaQueryWrapper<BizStudentProfile>()
                    .select(BizStudentProfile::getId, BizStudentProfile::getClassId)
                    .eq(BizStudentProfile::getStatus, "active");
            CommonSqlUtil.safeIn(sw, BizStudentProfile::getClassId, classIds);
            for (BizStudentProfile sp : bizStudentProfileService.list(sw)) {
                activeStudentCountMap.merge(sp.getClassId(), 1, Integer::sum);
            }
        }

        LambdaQueryWrapper<BizAttendanceRecord> arw = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(arw, BizAttendanceRecord::getSessionId, cleanIds);
        Map<String, List<BizAttendanceRecord>> recordMap = bizAttendanceRecordMapper.selectList(arw).stream()
                .collect(Collectors.groupingBy(BizAttendanceRecord::getSessionId));

        Date minStart = sessions.stream().map(BizClassSession::getSessionStart).filter(Objects::nonNull).min(Date::compareTo).orElse(new Date());
        Date maxEnd = sessions.stream().map(s -> s.getSessionEnd() != null ? s.getSessionEnd() : s.getQrExpireAt()).filter(Objects::nonNull).max(Date::compareTo).orElse(new Date());

        List<BizLeaveRequest> approvedLeaves = Collections.emptyList();
        if (!classIds.isEmpty()) {
            LambdaQueryWrapper<BizLeaveRequest> lw = new LambdaQueryWrapper<BizLeaveRequest>()
                    .eq(BizLeaveRequest::getStatus, "approved")
                    .le(BizLeaveRequest::getFromDate, maxEnd)
                    .ge(BizLeaveRequest::getToDate, minStart);
            CommonSqlUtil.safeIn(lw, BizLeaveRequest::getClassId, classIds);
            approvedLeaves = bizLeaveRequestService.list(lw);
        }

        LambdaQueryWrapper<BizClassSessionSnapshot> existingWrap = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(existingWrap, BizClassSessionSnapshot::getSessionId, cleanIds);
        Map<String, BizClassSessionSnapshot> existingMap = this.list(existingWrap).stream()
                .collect(Collectors.toMap(BizClassSessionSnapshot::getSessionId, s -> s, (a, b) -> a));

        long nowMs = System.currentTimeMillis();
        List<BizClassSessionSnapshot> toSave = new ArrayList<>();
        List<BizClassSessionSnapshot> toUpdate = new ArrayList<>();

        for (BizClassSession session : sessions) {
            BizClass cls = classMap.get(session.getClassId());
            String orgId = cls != null && StrUtil.isNotBlank(cls.getOrgId()) ? cls.getOrgId() : "0";
            int totalStudents = activeStudentCountMap.getOrDefault(session.getClassId(), 0);

            List<BizAttendanceRecord> records = recordMap.getOrDefault(session.getId(), Collections.emptyList());
            int onTime = 0;
            int late = 0;
            Set<String> leaveStudentIds = new HashSet<>();
            for (BizAttendanceRecord r : records) {
                String st = StrUtil.trimToEmpty(r.getAttendanceStatus());
                if ("on_time".equals(st)) {
                    onTime++;
                } else if ("late".equals(st)) {
                    late++;
                } else if ("leave".equals(st)) {
                    leaveStudentIds.add(r.getStudentId());
                }
            }
            Date deadline = session.getSessionEnd() != null ? session.getSessionEnd() : session.getQrExpireAt();
            for (BizLeaveRequest lr : approvedLeaves) {
                if (Objects.equals(lr.getClassId(), session.getClassId())
                        && !lr.getFromDate().after(deadline)
                        && !lr.getToDate().before(session.getSessionStart())) {
                    leaveStudentIds.add(lr.getStudentId());
                }
            }
            int checkedIn = onTime + late;
            int leaveCount = leaveStudentIds.size();
            boolean ended = "ended".equals(session.getStatus()) || (deadline != null && deadline.getTime() <= nowMs);
            int absentCount = ended ? Math.max(totalStudents - leaveCount - checkedIn, 0) : 0;

            BizClassSessionSnapshot snap = existingMap.get(session.getId());
            boolean isNew = snap == null;
            if (isNew) {
                snap = new BizClassSessionSnapshot();
                snap.setSessionId(session.getId());
            }
            snap.setClassId(session.getClassId());
            snap.setOrgId(orgId);
            snap.setCourseId(session.getCourseId());
            snap.setTotalStudents(totalStudents);
            snap.setCheckedInCount(checkedIn);
            snap.setOnTimeCount(onTime);
            snap.setLateCount(late);
            snap.setLeaveCount(leaveCount);
            snap.setAbsentCount(absentCount);
            if (isNew) {
                toSave.add(snap);
            } else {
                toUpdate.add(snap);
            }
        }
        if (!toSave.isEmpty()) {
            this.saveBatch(toSave);
        }
        if (!toUpdate.isEmpty()) {
            this.updateBatchById(toUpdate);
        }
    }

    @Override
    public Map<String, BizClassSessionSnapshot> getOrRefreshMap(Collection<String> sessionIds) {
        if (ObjectUtil.isEmpty(sessionIds)) {
            return Collections.emptyMap();
        }
        Set<String> cleanIds = sessionIds.stream().filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (cleanIds.isEmpty()) {
            return Collections.emptyMap();
        }
        LambdaQueryWrapper<BizClassSessionSnapshot> qw = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(qw, BizClassSessionSnapshot::getSessionId, cleanIds);
        Map<String, BizClassSessionSnapshot> initialMap = this.list(qw).stream()
                .collect(Collectors.toMap(BizClassSessionSnapshot::getSessionId, s -> s, (a, b) -> a));

        List<String> missing = cleanIds.stream().filter(id -> !initialMap.containsKey(id)).toList();
        if (!missing.isEmpty()) {
            refreshSessions(missing);
            return this.list(qw).stream()
                    .collect(Collectors.toMap(BizClassSessionSnapshot::getSessionId, s -> s, (a, b) -> a));
        }
        return initialMap;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void deleteBySessionIds(Collection<String> sessionIds) {
        if (ObjectUtil.isEmpty(sessionIds)) {
            return;
        }
        LambdaQueryWrapper<BizClassSessionSnapshot> qw = new LambdaQueryWrapper<>();
        CommonSqlUtil.safeIn(qw, BizClassSessionSnapshot::getSessionId, sessionIds);
        this.remove(qw);
    }
}
