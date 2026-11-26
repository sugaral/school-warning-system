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

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizAttendanceRecord;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSessionSnapshot;
import vip.xiaonuo.biz.modular.attendance.mapper.BizAttendanceRecordMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.param.*;
import vip.xiaonuo.biz.modular.attendance.service.BizAttendanceSnapshotService;
import vip.xiaonuo.biz.modular.attendance.service.BizClassSessionService;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.biz.modular.attendance.util.BizAttendanceQrUtil;
import vip.xiaonuo.biz.modular.calendar.entity.BizCalendarExclusion;
import vip.xiaonuo.biz.modular.calendar.service.BizCalendarExclusionService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.service.BizLeaveRequestService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.schedule.entity.BizSchedule;
import vip.xiaonuo.biz.modular.schedule.service.BizScheduleService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.common.cache.CommonCacheOperator;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;
import vip.xiaonuo.dev.api.DevConfigApi;
import vip.xiaonuo.dev.api.DevFileApi;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 课堂签到课次Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizClassSessionServiceImpl extends ServiceImpl<BizClassSessionMapper, BizClassSession>
        implements BizClassSessionService {

    private static final int DEFAULT_EXPIRE_MINUTES = 45;
    private static final int DEFAULT_QR_REFRESH_SECONDS = 30;
    private static final int LATE_THRESHOLD_MINUTES = 10;
    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final Set<String> VALID_ROSTER_STATUSES = Set.of("on_time", "late", "leave", "absent", "early_leave");
    private static final Set<String> VALID_CHECKIN_MODES = Set.of("qr", "photo", "gesture", "location");
    private static final String GESTURE_FAIL_CACHE_PREFIX = "warnsys:checkin:gesture_fail:";

    @Resource
    private BizAttendanceRecordMapper bizAttendanceRecordMapper;

    @Resource
    private BizAttendanceSnapshotService bizAttendanceSnapshotService;

    @Resource
    private BizDailyRecordService bizDailyRecordService;

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizLeaveRequestService bizLeaveRequestService;

    @Resource
    private BizScheduleService bizScheduleService;

    @Resource
    private DevConfigApi devConfigApi;

    @Resource
    private DevFileApi devFileApi;

    @Resource
    private BizCalendarExclusionService bizCalendarExclusionService;

    @Resource
    private CommonCacheOperator commonCacheOperator;

    @Resource
    private RedissonClient redissonClient;

    @Override
    public Page<BizClassSession> page(BizClassSessionPageParam param) {
        QueryWrapper<BizClassSession> queryWrapper = new QueryWrapper<BizClassSession>().checkSqlInjection();
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
            CommonSqlUtil.safeIn(queryWrapper.lambda(), BizClassSession::getClassId, allowedClassIds);
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizClassSession::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizClassSession::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizClassSession::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedCourseIds = CollStreamUtil.toList(
                    bizCourseService.list(new LambdaQueryWrapper<BizCourse>()
                            .select(BizCourse::getId)
                            .like(BizCourse::getCourseName, key)),
                    BizCourse::getId);
            List<String> matchedClassIds = CollStreamUtil.toList(
                    bizClassService.list(new LambdaQueryWrapper<BizClass>()
                            .select(BizClass::getId)
                            .like(BizClass::getClassName, key)),
                    BizClass::getId);
            if (matchedCourseIds.isEmpty() && matchedClassIds.isEmpty()) {
                return new Page<>();
            }
            queryWrapper.lambda().and(w -> {
                boolean has = false;
                if (!matchedCourseIds.isEmpty()) {
                    CommonSqlUtil.safeIn(w, BizClassSession::getCourseId, matchedCourseIds);
                    has = true;
                }
                if (!matchedClassIds.isEmpty()) {
                    if (has) {
                        w.or(sub -> CommonSqlUtil.safeIn(sub, BizClassSession::getClassId, matchedClassIds));
                    } else {
                        CommonSqlUtil.safeIn(w, BizClassSession::getClassId, matchedClassIds);
                    }
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizClassSession::getSessionStart).orderByDesc(BizClassSession::getCreateTime);
        Page<BizClassSession> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        enrichSessions(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject createSession(BizClassSessionCreateParam param) {
        BizCourse course = bizCourseService.queryEntity(param.getCourseId());
        if (!"active".equals(course.getStatus())) {
            throw new CommonException("课程未启用，无法发起签到");
        }
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        if (!"active".equals(cls.getStatus())) {
            throw new CommonException("班级未启用，无法发起签到");
        }
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "发起课堂签到课次");
        if (!Objects.equals(course.getOrgId(), cls.getOrgId())) {
            throw new CommonException("所选课程与班级不属于同一学院");
        }

        Date start = param.getSessionStart() != null ? param.getSessionStart() : new Date();
        int windowSeconds = resolveWindowSeconds(param.getExpireSeconds(), param.getExpireMinutes());
        JSONObject sessionConfig = validateAndBuildSessionConfig(
                param.getCheckinModes(), param.getQrRefreshSeconds(), param.getGesturePattern(),
                param.getLocationLat(), param.getLocationLng(), param.getLocationRadiusMeters(),
                param.getLocationName(), param.getPhotoTip());
        BizClassSession session = persistNewSession(course.getId(), cls.getId(), StpUtil.getLoginIdAsString(), start, windowSeconds, sessionConfig);
        bizAttendanceSnapshotService.refreshSessions(Collections.singletonList(session.getId()));
        return buildQrPayload(session);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject batchCreateFromSchedule(BizClassSessionBatchCreateParam param) {
        int limit = param.getCount() != null ? param.getCount() : 10;
        int fallbackExpireMin = param.getExpireMinutes() != null ? param.getExpireMinutes() : DEFAULT_EXPIRE_MINUTES;

        LambdaQueryWrapper<BizSchedule> sw = new LambdaQueryWrapper<BizSchedule>()
                .eq(BizSchedule::getStatus, "active")
                .orderByAsc(BizSchedule::getSessionStart);
        List<String> scope = BizScopeUtil.getDataScope();
        if (BizScopeUtil.isEmptyScope(scope)) {
            return new JSONObject().set("createdCount", 0).set("skippedCount", 0);
        }
        if (ObjectUtil.isNotEmpty(scope)) {
            LambdaQueryWrapper<BizClass> cw = new LambdaQueryWrapper<BizClass>().select(BizClass::getId);
            CommonSqlUtil.safeIn(cw, BizClass::getOrgId, scope);
            List<String> allowedClassIds = CollStreamUtil.toList(bizClassService.list(cw), BizClass::getId);
            if (allowedClassIds.isEmpty()) {
                return new JSONObject().set("createdCount", 0).set("skippedCount", 0);
            }
            CommonSqlUtil.safeIn(sw, BizSchedule::getClassId, allowedClassIds);
        }
        sw.last("LIMIT " + limit);
        List<BizSchedule> schedules = bizScheduleService.list(sw);

        int createdCount = 0;
        int skippedCount = 0;
        List<String> newIds = new ArrayList<>();
        String operatorId = StpUtil.getLoginIdAsString();

        for (BizSchedule sch : schedules) {
            long exists = this.count(new LambdaQueryWrapper<BizClassSession>()
                    .eq(BizClassSession::getCourseId, sch.getCourseId())
                    .eq(BizClassSession::getClassId, sch.getClassId())
                    .eq(BizClassSession::getStatus, "active"));
            if (exists > 0) {
                skippedCount++;
                continue;
            }
            int winMin = sch.getExpireMinutes() != null && sch.getExpireMinutes() > 0 ? sch.getExpireMinutes() : fallbackExpireMin;
            Date start = new Date();
            String teacherId = StrUtil.isNotBlank(sch.getTeacherUserId()) ? sch.getTeacherUserId() : operatorId;
            BizClassSession session = persistNewSession(sch.getCourseId(), sch.getClassId(), teacherId, start, winMin * 60, null);
            newIds.add(session.getId());
            createdCount++;
        }
        if (!newIds.isEmpty()) {
            bizAttendanceSnapshotService.refreshSessions(newIds);
        }
        return new JSONObject()
                .set("createdCount", createdCount)
                .set("skippedCount", skippedCount)
                .set("sessionIds", newIds);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject endSession(BizClassSessionIdParam idParam) {
        BizClassSession session = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "结束课堂签到");

        if (!"active".equals(session.getStatus())) {
            throw new CommonException("当前课次已结束，无需重复结课");
        }
        int absentMarked = settleSessionInternal(session, new Date(), "manual");
        return new JSONObject()
                .set("sessionId", session.getId())
                .set("absentMarked", absentMarked);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject batchEnd(List<BizClassSessionIdParam> idParamList) {
        int ended = 0;
        int skipped = 0;
        Date now = new Date();
        for (BizClassSessionIdParam idParam : idParamList) {
            BizClassSession session = this.queryEntity(idParam.getId());
            BizClass cls = bizClassService.queryEntity(session.getClassId());
            BizScopeUtil.assertOrgInScope(cls.getOrgId(), "批量结束签到课次");
            if (!"active".equals(session.getStatus())) {
                skipped++;
                continue;
            }
            settleSessionInternal(session, now, "manual");
            ended++;
        }
        return new JSONObject().set("endedCount", ended).set("skippedCount", skipped);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizClassSessionIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizClassSessionIdParam::getId);
        List<BizClassSession> list = this.listByIds(ids);
        Set<String> cids = list.stream().map(BizClassSession::getClassId).collect(Collectors.toSet());
        Map<String, BizClass> classMap = cids.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(cids).stream().collect(Collectors.toMap(BizClass::getId, c -> c, (a, b) -> a));
        for (BizClassSession s : list) {
            BizClass cls = classMap.get(s.getClassId());
            if (cls != null) {
                BizScopeUtil.assertOrgInScope(cls.getOrgId(), "删除签到课次");
            }
        }
        if (!ids.isEmpty()) {
            LambdaQueryWrapper<BizAttendanceRecord> arw = new LambdaQueryWrapper<>();
            CommonSqlUtil.safeIn(arw, BizAttendanceRecord::getSessionId, ids);
            bizAttendanceRecordMapper.delete(arw);
            bizAttendanceSnapshotService.deleteBySessionIds(ids);
            this.removeByIds(ids);
        }
    }

    @Override
    public BizClassSession detail(BizClassSessionIdParam idParam) {
        BizClassSession session = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "查看课次详情");
        enrichSessions(Collections.singletonList(session));
        return session;
    }

    @Override
    public JSONObject getQrState(BizClassSessionIdParam idParam) {
        BizClassSession session = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "查看课次动态二维码");
        enrichSessions(Collections.singletonList(session));
        JSONObject payload = buildQrPayload(session);
        payload.set("status", session.getStatus())
                .set("courseName", session.getCourseName())
                .set("className", session.getClassName())
                .set("totalStudents", session.getTotalStudents())
                .set("checkedInCount", session.getCheckedInCount())
                .set("onTimeCount", session.getOnTimeCount())
                .set("lateCount", session.getLateCount())
                .set("leaveCount", session.getLeaveCount())
                .set("absentCount", session.getAbsentCount());
        return payload;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject rotateQr(BizClassSessionIdParam idParam) {
        BizClassSession session = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "刷新动态二维码");

        Date now = new Date();
        Date deadline = getDeadline(session);
        if (!"active".equals(session.getStatus()) || (deadline != null && !deadline.after(now))) {
            throw new CommonException("课次已结束或超过签到截止时间，无法换码");
        }

        RLock lock = redissonClient.getLock("lock:session:rotate-qr:" + session.getId());
        boolean locked = false;
        try {
            locked = lock.tryLock(2, 10, TimeUnit.SECONDS);
            if (!locked) {
                throw new CommonException("二维码正在换码中，请稍后再试");
            }
            String nextHash = BizAttendanceQrUtil.generateTokenHash(session.getClassId(), session.getCourseId(), session.getSessionStart());
            session.setQrTokenHash(nextHash);
            JSONObject ext = parseExtJson(session.getExtJson());
            ext.set("qrManualRotatedAt", now.getTime());
            session.setExtJson(ext.toString());
            this.updateById(session);
            return getQrState(idParam);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommonException("刷新二维码被中断");
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject updateSessionConfig(BizClassSessionConfigUpdateParam param) {
        BizClassSession session = this.queryEntity(param.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "修改课次签到配置");
        if (!"active".equals(session.getStatus())) {
            throw new CommonException("仅进行中的课次可调整签到配置");
        }

        JSONObject oldExt = parseExtJson(session.getExtJson());
        List<String> modes = param.getCheckinModes() != null ? param.getCheckinModes() : extractModes(oldExt);
        Integer refreshSec = param.getQrRefreshSeconds() != null ? param.getQrRefreshSeconds() : oldExt.getInt("qrRefreshSeconds");
        String gesture = param.getGesturePattern() != null ? param.getGesturePattern() : oldExt.getStr("gesturePattern");
        Double lat = param.getLocationLat() != null ? param.getLocationLat() : oldExt.getDouble("locationLat");
        Double lng = param.getLocationLng() != null ? param.getLocationLng() : oldExt.getDouble("locationLng");
        Integer radius = param.getLocationRadiusMeters() != null ? param.getLocationRadiusMeters() : oldExt.getInt("locationRadiusMeters");
        String locName = param.getLocationName() != null ? param.getLocationName() : oldExt.getStr("locationName");
        String photoTip = param.getPhotoTip() != null ? param.getPhotoTip() : oldExt.getStr("photoTip");

        JSONObject newExt = validateAndBuildSessionConfig(modes, refreshSec, gesture, lat, lng, radius, locName, photoTip);
        Integer prevRefresh = oldExt.getInt("qrRefreshSeconds");
        Integer nextRefresh = newExt.getInt("qrRefreshSeconds");
        // 修改二维码刷新周期或强制配置刷新时，轮换种子作废旧二维码
        if (param.getQrRefreshSeconds() != null && !Objects.equals(prevRefresh, nextRefresh)) {
            session.setQrTokenHash(BizAttendanceQrUtil.generateTokenHash(session.getClassId(), session.getCourseId(), session.getSessionStart()));
            newExt.set("qrManualRotatedAt", System.currentTimeMillis());
        } else if (oldExt.containsKey("qrManualRotatedAt")) {
            newExt.set("qrManualRotatedAt", oldExt.getLong("qrManualRotatedAt"));
        }
        session.setExtJson(newExt.toString());
        this.updateById(session);
        BizClassSessionIdParam idParam = new BizClassSessionIdParam();
        idParam.setId(session.getId());
        return getQrState(idParam);
    }

    @Override
    public JSONObject getRoster(BizClassSessionIdParam idParam) {
        BizClassSession session = this.queryEntity(idParam.getId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "查看课次花名册");

        List<BizStudentProfile> students = bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                .eq(BizStudentProfile::getClassId, session.getClassId())
                .eq(BizStudentProfile::getStatus, "active")
                .orderByAsc(BizStudentProfile::getStudentNo));

        Map<String, BizAttendanceRecord> recordMap = bizAttendanceRecordMapper.selectList(
                        new LambdaQueryWrapper<BizAttendanceRecord>().eq(BizAttendanceRecord::getSessionId, session.getId()))
                .stream()
                .collect(Collectors.toMap(BizAttendanceRecord::getStudentId, r -> r, (a, b) -> a));

        Date deadline = getDeadline(session);
        Set<String> leaveIds = findApprovedLeaveStudentIds(session.getClassId(), session.getSessionStart(), deadline);

        JSONArray roster = new JSONArray();
        for (BizStudentProfile stu : students) {
            BizAttendanceRecord rec = recordMap.get(stu.getId());
            String status;
            if (rec != null && StrUtil.isNotBlank(rec.getAttendanceStatus())) {
                status = rec.getAttendanceStatus();
            } else if (leaveIds.contains(stu.getId())) {
                status = "leave";
            } else {
                status = "active".equals(session.getStatus()) ? "pending" : "absent";
            }
            JSONObject recExt = rec != null ? parseExtJson(rec.getExtJson()) : new JSONObject();
            roster.add(new JSONObject()
                    .set("studentId", stu.getId())
                    .set("studentNo", stu.getStudentNo())
                    .set("studentName", stu.getName())
                    .set("status", status)
                    .set("source", rec != null ? rec.getSource() : (leaveIds.contains(stu.getId()) ? "leave_sync" : null))
                    .set("checkinMode", recExt.getStr("checkinMode", rec != null ? rec.getSource() : null))
                    .set("photoFileId", recExt.getStr("photoFileId"))
                    .set("distanceMeters", recExt.getInt("distanceMeters"))
                    .set("checkinLat", recExt.getDouble("latitude"))
                    .set("checkinLng", recExt.getDouble("longitude"))
                    .set("checkinTime", rec != null ? rec.getCheckinTime() : null));
        }

        Map<String, BizClassSessionSnapshot> snapMap = bizAttendanceSnapshotService.getOrRefreshMap(Collections.singletonList(session.getId()));
        return new JSONObject()
                .set("sessionId", session.getId())
                .set("status", session.getStatus())
                .set("snapshot", snapMap.get(session.getId()))
                .set("roster", roster);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject updateRosterStatus(BizSessionRosterStatusParam param) {
        BizClassSession session = this.queryEntity(param.getSessionId());
        BizClass cls = bizClassService.queryEntity(session.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "调整课次签到状态");

        Date now = new Date();
        Date recordDate = BizAttendanceQrUtil.computeRecordDate(session.getSessionStart());
        int updatedCount = 0;

        for (BizSessionRosterStatusParam.RosterItem item : param.getStatusList()) {
            String targetStatus = StrUtil.trim(item.getStatus());
            if (!VALID_ROSTER_STATUSES.contains(targetStatus)) {
                throw new CommonException("非法的考勤状态: {}", targetStatus);
            }
            BizStudentProfile stu = bizStudentProfileService.queryEntity(item.getStudentId());
            if (!Objects.equals(stu.getClassId(), session.getClassId())) {
                throw new CommonException("学生 {} 不属于本课次班级", stu.getName());
            }

            BizAttendanceRecord existing = bizAttendanceRecordMapper.selectOne(new LambdaQueryWrapper<BizAttendanceRecord>()
                    .eq(BizAttendanceRecord::getSessionId, session.getId())
                    .eq(BizAttendanceRecord::getStudentId, stu.getId()));
            if (existing == null) {
                BizAttendanceRecord rec = new BizAttendanceRecord();
                rec.setSessionId(session.getId());
                rec.setStudentId(stu.getId());
                rec.setCheckinTime(now);
                rec.setAttendanceStatus(targetStatus);
                rec.setSource("manual");
                bizAttendanceRecordMapper.insert(rec);
            } else {
                existing.setAttendanceStatus(targetStatus);
                existing.setCheckinTime(now);
                existing.setSource("manual");
                bizAttendanceRecordMapper.updateById(existing);
            }

            bizDailyRecordService.mergeAttendanceStatus(
                    stu.getId(), session.getClassId(), cls.getOrgId(), session.getCourseId(),
                    recordDate, targetStatus, "manual");
            updatedCount++;
        }

        bizAttendanceSnapshotService.refreshSessions(Collections.singletonList(session.getId()));
        return new JSONObject().set("updatedCount", updatedCount);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject scanCheckin(String sessionId, String scanToken, String studentId) {
        Map<String, Object> body = new HashMap<>();
        body.put("session_id", sessionId);
        body.put("scan_token", scanToken);
        body.put("checkin_mode", "qr");
        return studentCheckin(studentId, body);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject studentCheckin(String studentId, Map<String, Object> body) {
        String sessionId = mapStr(body, "session_id", "sessionId");
        String scanToken = mapStr(body, "scan_token", "scanToken");
        String checkinMode = StrUtil.blankToDefault(mapStr(body, "checkin_mode", "checkinMode", "mode"),
                StrUtil.isNotBlank(scanToken) ? "qr" : "qr").toLowerCase(Locale.ROOT);
        if (StrUtil.isBlank(sessionId)) {
            throw new CommonException("缺少课次 ID");
        }
        if (!VALID_CHECKIN_MODES.contains(checkinMode)) {
            throw new CommonException("不支持的签到方式：" + checkinMode);
        }

        RLock lock = redissonClient.getLock("lock:checkin:" + sessionId + ":" + studentId);
        boolean locked = false;
        try {
            locked = lock.tryLock(3, 15, TimeUnit.SECONDS);
            if (!locked) {
                throw new CommonException("签到提交过于频繁，请稍后重试");
            }

            BizClassSession session = this.queryEntity(sessionId);
            if (!"active".equals(session.getStatus())) {
                throw new CommonException("该课次签到已结束");
            }
            Date now = new Date();
            Date deadline = getDeadline(session);
            if (deadline != null && now.after(deadline)) {
                throw new CommonException("已超过本节课签到截止时间");
            }

            BizStudentProfile student = bizStudentProfileService.queryEntity(studentId);
            if (!Objects.equals(student.getClassId(), session.getClassId())) {
                throw new CommonException("您不属于该课次所在班级，无法签到");
            }

            BizAttendanceRecord existing = bizAttendanceRecordMapper.selectOne(new LambdaQueryWrapper<BizAttendanceRecord>()
                    .eq(BizAttendanceRecord::getSessionId, session.getId())
                    .eq(BizAttendanceRecord::getStudentId, student.getId())
                    .last("LIMIT 1"));
            if (existing != null && ("on_time".equals(existing.getAttendanceStatus()) || "late".equals(existing.getAttendanceStatus()))) {
                throw new CommonException("您已完成本节课签到，请勿重复提交");
            }

            JSONObject sessionCfg = parseExtJson(session.getExtJson());
            List<String> enabledModes = extractModes(sessionCfg);
            if (!enabledModes.contains(checkinMode)) {
                throw new CommonException("教师未开启【" + modeLabel(checkinMode) + "】，请选择允许的签到方式");
            }

            JSONObject recExt = new JSONObject().set("checkinMode", checkinMode);
            if ("qr".equals(checkinMode)) {
                if (StrUtil.isBlank(scanToken)) {
                    throw new CommonException("缺少课堂动态二维码口令");
                }
                int refreshSeconds = resolveSessionRefreshSeconds(session);
                // 严格校验当前时间片口令（leewayBuckets = 0），刷新或过期后旧二维码立即失效
                if (!BizAttendanceQrUtil.isRollingTokenValid(scanToken, session.getQrTokenHash(), session.getSessionStart(), refreshSeconds, now, 0)) {
                    throw new CommonException("二维码已刷新或过期，请扫描讲台最新二维码");
                }
                recExt.set("scanToken", scanToken);
            } else if ("photo".equals(checkinMode)) {
                String photoFileId = mapStr(body, "photo_file_id", "photoFileId");
                if (StrUtil.isBlank(photoFileId)) {
                    throw new CommonException("请先拍摄并上传现场签到照片");
                }
                JSONObject fi = devFileApi.getFileInfoById(photoFileId);
                if (fi == null || StrUtil.isBlank(fi.getStr("id"))) {
                    throw new CommonException("签到照片不存在，请重新拍照上传");
                }
                String suffix = StrUtil.blankToDefault(fi.getStr("suffix"), "").toLowerCase(Locale.ROOT);
                if (!Set.of("jpg", "jpeg", "png", "gif", "webp", "bmp").contains(suffix)) {
                    throw new CommonException("仅支持图片格式的拍照签到凭证");
                }
                String creator = fi.getStr("createUser");
                if (StrUtil.isNotBlank(student.getClientUserId()) && StrUtil.isNotBlank(creator)
                        && !Objects.equals(creator, student.getClientUserId())) {
                    throw new CommonException("不可复用他人上传的签到照片");
                }
                recExt.set("photoFileId", photoFileId);
            } else if ("gesture".equals(checkinMode)) {
                String expectedPattern = normalizeGesturePattern(sessionCfg.getStr("gesturePattern"));
                if (StrUtil.isBlank(expectedPattern)) {
                    throw new CommonException("教师未设置有效手势图案");
                }
                String failKey = GESTURE_FAIL_CACHE_PREFIX + session.getId() + ":" + student.getId();
                Object failObj = commonCacheOperator.get(failKey);
                int failTimes = failObj != null ? Integer.parseInt(String.valueOf(failObj)) : 0;
                if (failTimes >= 5) {
                    throw new CommonException("手势连续错误超过 5 次已锁定，请联系任课教师人工处理");
                }
                String provided = normalizeGesturePattern(mapStr(body, "gesture_pattern", "gesturePattern"));
                if (StrUtil.isBlank(provided)) {
                    throw new CommonException("请绘制签到手势图案");
                }
                if (!expectedPattern.equals(provided)) {
                    int nextFail = failTimes + 1;
                    commonCacheOperator.put(failKey, String.valueOf(nextFail), 3600L);
                    int left = Math.max(0, 5 - nextFail);
                    throw new CommonException(left > 0 ? "手势密码不正确，还可尝试 " + left + " 次" : "手势密码连续错误 5 次已锁定，请联系任课教师");
                }
                commonCacheOperator.remove(failKey);
                recExt.set("gestureMatched", true);
            } else if ("location".equals(checkinMode)) {
                Double targetLat = sessionCfg.getDouble("locationLat");
                Double targetLng = sessionCfg.getDouble("locationLng");
                int radiusMeters = sessionCfg.getInt("locationRadiusMeters", 150);
                if (targetLat == null || targetLng == null) {
                    throw new CommonException("教师未配置课次定位中心坐标");
                }
                Double stuLat = mapDouble(body, "latitude", "lat");
                Double stuLng = mapDouble(body, "longitude", "lng");
                if (stuLat == null || stuLng == null || stuLat < -90 || stuLat > 90 || stuLng < -180 || stuLng > 180) {
                    throw new CommonException("未获取到有效 GPS 定位坐标，请开启微信定位权限后重试");
                }
                int distance = (int) Math.round(haversineMeters(targetLat, targetLng, stuLat, stuLng));
                if (distance > radiusMeters) {
                    throw new CommonException("当前位置距离签到点 " + distance + " 米，超出允许范围 " + radiusMeters + " 米");
                }
                recExt.set("latitude", stuLat).set("longitude", stuLng).set("distanceMeters", distance);
            }

            long lateCutoffMs = session.getSessionStart().getTime() + LATE_THRESHOLD_MINUTES * 60_000L;
            if (deadline != null && deadline.getTime() < lateCutoffMs) {
                lateCutoffMs = deadline.getTime();
            }
            String status = now.getTime() > lateCutoffMs ? "late" : "on_time";
            String source = "qr".equals(checkinMode) ? "scan" : checkinMode;

            if (existing == null) {
                BizAttendanceRecord rec = new BizAttendanceRecord();
                rec.setSessionId(session.getId());
                rec.setStudentId(student.getId());
                rec.setCheckinTime(now);
                rec.setAttendanceStatus(status);
                rec.setSource(source);
                rec.setExtJson(recExt.toString());
                bizAttendanceRecordMapper.insert(rec);
            } else {
                existing.setCheckinTime(now);
                existing.setAttendanceStatus(status);
                existing.setSource(source);
                existing.setExtJson(recExt.toString());
                bizAttendanceRecordMapper.updateById(existing);
            }

            Date recordDate = BizAttendanceQrUtil.computeRecordDate(session.getSessionStart());
            if (StrUtil.isNotBlank(session.getCourseId())) {
                bizDailyRecordService.mergeAttendanceStatus(
                        student.getId(), student.getClassId(), student.getOrgId(), session.getCourseId(),
                        recordDate, status, source);
            }
            bizAttendanceSnapshotService.refreshSessions(Collections.singletonList(session.getId()));

            java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            return new JSONObject()
                    .set("sessionId", session.getId())
                    .set("session_id", session.getId())
                    .set("studentId", student.getId())
                    .set("checkinMode", checkinMode)
                    .set("checkin_mode", checkinMode)
                    .set("attendanceStatus", status)
                    .set("attendance_status", status)
                    .set("is_late", "late".equals(status))
                    .set("distanceMeters", recExt.getInt("distanceMeters"))
                    .set("distance_meters", recExt.getInt("distanceMeters"))
                    .set("checkinTime", fmt.format(now))
                    .set("checkin_time", fmt.format(now));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommonException("签到请求被中断");
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public int autoOpenDueSchedules() {
        RLock lock = redissonClient.getLock("lock:attendance:schedule-open");
        boolean locked = false;
        try {
            locked = lock.tryLock(0, 30, TimeUnit.SECONDS);
            if (!locked) {
                return 0;
            }
            Date now = new Date();
            Date windowStart = new Date(now.getTime() - 15 * 60_000L);
            List<BizSchedule> dueSchedules = bizScheduleService.list(new LambdaQueryWrapper<BizSchedule>()
                    .eq(BizSchedule::getStatus, "active")
                    .ge(BizSchedule::getSessionStart, windowStart)
                    .le(BizSchedule::getSessionStart, now));
            if (dueSchedules.isEmpty()) {
                return 0;
            }
            String todayStr = LocalDate.now(ZONE_SHANGHAI).toString();
            List<BizCalendarExclusion> todayExclusions = bizCalendarExclusionService.list(
                    new LambdaQueryWrapper<BizCalendarExclusion>().eq(BizCalendarExclusion::getExclusionDate, todayStr));
            boolean schoolExcluded = todayExclusions.stream().anyMatch(e -> "school".equals(e.getScope()));
            if (schoolExcluded) {
                return 0;
            }
            Set<String> excludedOrgIds = todayExclusions.stream()
                    .filter(e -> "org".equals(e.getScope()) && StrUtil.isNotBlank(e.getScopeId()))
                    .map(BizCalendarExclusion::getScopeId)
                    .collect(Collectors.toSet());
            Set<String> excludedClassIds = excludedOrgIds.isEmpty() ? Collections.emptySet() :
                    bizClassService.list(new LambdaQueryWrapper<BizClass>().in(BizClass::getOrgId, excludedOrgIds))
                            .stream().map(BizClass::getId).collect(Collectors.toSet());

            int opened = 0;
            List<String> createdSessionIds = new ArrayList<>();
            for (BizSchedule sch : dueSchedules) {
                if (excludedClassIds.contains(sch.getClassId())) {
                    continue;
                }
                long exists = this.count(new LambdaQueryWrapper<BizClassSession>()
                        .eq(BizClassSession::getCourseId, sch.getCourseId())
                        .eq(BizClassSession::getClassId, sch.getClassId())
                        .ge(BizClassSession::getSessionStart, new Date(sch.getSessionStart().getTime() - 5 * 60_000L))
                        .le(BizClassSession::getSessionStart, new Date(sch.getSessionStart().getTime() + 5 * 60_000L)));
                if (exists > 0) {
                    continue;
                }
                int expireMin = sch.getExpireMinutes() != null && sch.getExpireMinutes() > 0 ? sch.getExpireMinutes() : DEFAULT_EXPIRE_MINUTES;
                BizClassSession session = persistNewSession(sch.getCourseId(), sch.getClassId(), sch.getTeacherUserId(), sch.getSessionStart(), expireMin * 60, null);
                createdSessionIds.add(session.getId());
                opened++;
            }
            if (!createdSessionIds.isEmpty()) {
                bizAttendanceSnapshotService.refreshSessions(createdSessionIds);
            }
            return opened;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return 0;
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public int autoCloseExpiredSessions() {
        RLock lock = redissonClient.getLock("lock:attendance:auto-close");
        boolean locked = false;
        try {
            locked = lock.tryLock(0, 30, TimeUnit.SECONDS);
            if (!locked) {
                return 0;
            }
            Date now = new Date();
            List<BizClassSession> expired = this.list(new LambdaQueryWrapper<BizClassSession>()
                    .eq(BizClassSession::getStatus, "active")
                    .and(w -> w.isNotNull(BizClassSession::getSessionEnd).lt(BizClassSession::getSessionEnd, now)
                            .or(sub -> sub.isNull(BizClassSession::getSessionEnd).lt(BizClassSession::getQrExpireAt, now)))
                    .orderByAsc(BizClassSession::getSessionStart)
                    .last("LIMIT 100"));
            int closed = 0;
            for (BizClassSession session : expired) {
                settleSessionInternal(session, now, "auto_close");
                closed++;
            }
            return closed;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return 0;
        } finally {
            if (locked && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    @Override
    public BizClassSession queryEntity(String id) {
        BizClassSession entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("签到课次不存在，id={}", id);
        }
        return entity;
    }

    private BizClassSession persistNewSession(String courseId, String classId, String teacherUserId, Date start, int windowSeconds, JSONObject extCfg) {
        JSONObject cfg = extCfg != null ? extCfg : validateAndBuildSessionConfig(null, null, null, null, null, null, null, null);
        int qrRefreshSeconds = cfg.getInt("qrRefreshSeconds", getQrRefreshSeconds());
        Date sessionEnd = new Date(start.getTime() + windowSeconds * 1000L);
        Date qrExpireAt = new Date(start.getTime() + qrRefreshSeconds * 1000L);
        BizClassSession session = new BizClassSession();
        session.setCourseId(courseId);
        session.setClassId(classId);
        session.setTeacherUserId(teacherUserId);
        session.setSessionStart(start);
        session.setSessionEnd(sessionEnd);
        session.setQrTokenHash(BizAttendanceQrUtil.generateTokenHash(classId, courseId, start));
        session.setQrExpireAt(qrExpireAt);
        session.setStatus("active");
        session.setExtJson(cfg.toString());
        this.save(session);
        return session;
    }

    private int settleSessionInternal(BizClassSession session, Date settleTime, String source) {
        boolean casUpdated = this.update(new LambdaUpdateWrapper<BizClassSession>()
                .eq(BizClassSession::getId, session.getId())
                .eq(BizClassSession::getStatus, "active")
                .set(BizClassSession::getStatus, "ended")
                .set(BizClassSession::getSessionEnd, settleTime));
        if (!casUpdated) {
            return 0;
        }

        List<BizStudentProfile> activeStudents = bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                .eq(BizStudentProfile::getClassId, session.getClassId())
                .eq(BizStudentProfile::getStatus, "active"));
        Set<String> recordedStudentIds = bizAttendanceRecordMapper.selectList(
                        new LambdaQueryWrapper<BizAttendanceRecord>()
                                .select(BizAttendanceRecord::getStudentId)
                                .eq(BizAttendanceRecord::getSessionId, session.getId()))
                .stream()
                .map(BizAttendanceRecord::getStudentId)
                .collect(Collectors.toSet());
        Set<String> leaveStudentIds = findApprovedLeaveStudentIds(session.getClassId(), session.getSessionStart(), settleTime);

        Date recordDate = BizAttendanceQrUtil.computeRecordDate(session.getSessionStart());
        int absentCount = 0;

        for (BizStudentProfile stu : activeStudents) {
            if (recordedStudentIds.contains(stu.getId())) {
                continue;
            }
            boolean onLeave = leaveStudentIds.contains(stu.getId());
            String status = onLeave ? "leave" : "absent";
            String recSource = onLeave ? "leave_sync" : source;

            BizAttendanceRecord rec = new BizAttendanceRecord();
            rec.setSessionId(session.getId());
            rec.setStudentId(stu.getId());
            rec.setCheckinTime(settleTime);
            rec.setAttendanceStatus(status);
            rec.setSource(recSource);
            bizAttendanceRecordMapper.insert(rec);

            bizDailyRecordService.mergeAttendanceStatus(
                    stu.getId(), stu.getClassId(), stu.getOrgId(), session.getCourseId(),
                    recordDate, status, recSource);
            if (!onLeave) {
                absentCount++;
            }
        }
        bizAttendanceSnapshotService.refreshSessions(Collections.singletonList(session.getId()));
        return absentCount;
    }

    private Set<String> findApprovedLeaveStudentIds(String classId, Date start, Date end) {
        if (StrUtil.isBlank(classId) || start == null || end == null) {
            return Collections.emptySet();
        }
        return bizLeaveRequestService.list(new LambdaQueryWrapper<BizLeaveRequest>()
                        .select(BizLeaveRequest::getStudentId)
                        .eq(BizLeaveRequest::getClassId, classId)
                        .eq(BizLeaveRequest::getStatus, "approved")
                        .le(BizLeaveRequest::getFromDate, end)
                        .ge(BizLeaveRequest::getToDate, start))
                .stream()
                .map(BizLeaveRequest::getStudentId)
                .collect(Collectors.toSet());
    }

    private JSONObject buildQrPayload(BizClassSession session) {
        int refreshSeconds = resolveSessionRefreshSeconds(session);
        Date deadline = getDeadline(session);
        JSONObject ext = parseExtJson(session.getExtJson());
        BizAttendanceQrUtil.RollingQrState state = BizAttendanceQrUtil.computeRollingState(
                session.getSessionStart(), deadline, session.getQrTokenHash(), refreshSeconds, new Date());
        return new JSONObject()
                .set("sessionId", session.getId())
                .set("scanToken", state.getScanToken())
                .set("qrContent", BizAttendanceQrUtil.buildQrPayloadJson(session.getId(), state.getScanToken()))
                .set("sessionStart", session.getSessionStart())
                .set("sessionEnd", deadline)
                .set("qrRefreshSeconds", state.getRefreshSeconds())
                .set("qrNextRefreshAt", state.getNextRefreshAt())
                .set("qrCountdownSeconds", state.getCountdownSeconds())
                .set("bucketIndex", state.getBucketIndex())
                .set("checkinModes", extractModes(ext))
                .set("gesturePattern", ext.getStr("gesturePattern"))
                .set("locationLat", ext.getDouble("locationLat"))
                .set("locationLng", ext.getDouble("locationLng"))
                .set("locationRadiusMeters", ext.getInt("locationRadiusMeters", 150))
                .set("locationName", ext.getStr("locationName"))
                .set("photoTip", ext.getStr("photoTip"));
    }

    private int resolveSessionRefreshSeconds(BizClassSession session) {
        JSONObject ext = parseExtJson(session.getExtJson());
        Integer custom = ext.getInt("qrRefreshSeconds");
        if (custom != null && custom >= 5) {
            return Math.min(3600, custom);
        }
        return getQrRefreshSeconds();
    }

    private JSONObject validateAndBuildSessionConfig(List<String> rawModes, Integer qrRefreshSeconds,
                                                     String gesturePattern, Double lat, Double lng,
                                                     Integer radiusMeters, String locationName, String photoTip) {
        List<String> modes = new ArrayList<>();
        if (rawModes != null) {
            for (String m : rawModes) {
                if (StrUtil.isBlank(m)) continue;
                String norm = StrUtil.trim(m).toLowerCase(Locale.ROOT);
                if (!VALID_CHECKIN_MODES.contains(norm)) {
                    throw new CommonException("不支持的签到方式：" + m);
                }
                if (!modes.contains(norm)) {
                    modes.add(norm);
                }
            }
        }
        if (modes.isEmpty()) {
            modes.add("qr");
        }
        int refreshSec = qrRefreshSeconds != null ? qrRefreshSeconds : getQrRefreshSeconds();
        if (refreshSec < 5 || refreshSec > 3600) {
            throw new CommonException("二维码刷新间隔须在 5~3600 秒之间");
        }

        JSONObject cfg = new JSONObject()
                .set("checkinModes", modes)
                .set("qrRefreshSeconds", refreshSec);

        if (modes.contains("gesture")) {
            String normalizedGesture = normalizeGesturePattern(gesturePattern);
            String[] pts = StrUtil.isNotBlank(normalizedGesture) ? normalizedGesture.split("-") : new String[0];
            Set<String> uniquePts = new LinkedHashSet<>(Arrays.asList(pts));
            if (pts.length < 4 || pts.length > 25) {
                throw new CommonException("手势签到请连接 4~25 个点位（允许重复经过已选点绘制闭合/复杂图形）");
            }
            if (uniquePts.size() < 3) {
                throw new CommonException("手势签到请至少经过 3 个不同的九宫格点位");
            }
            for (int i = 0; i < pts.length; i++) {
                String p = pts[i];
                if (!p.matches("[1-9]")) {
                    throw new CommonException("手势点位只能为 1~9 的数字");
                }
                if (i > 0 && p.equals(pts[i - 1])) {
                    throw new CommonException("手势连线中相邻两个点位不能相同");
                }
            }
            cfg.set("gesturePattern", normalizedGesture);
        } else if (StrUtil.isNotBlank(gesturePattern)) {
            cfg.set("gesturePattern", normalizeGesturePattern(gesturePattern));
        }

        if (modes.contains("location")) {
            if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                throw new CommonException("开启定位签到时，必须提供有效的中心经纬度坐标");
            }
            int radius = radiusMeters != null ? radiusMeters : 150;
            if (radius < 20 || radius > 5000) {
                throw new CommonException("定位签到允许半径须在 20~5000 米之间");
            }
            cfg.set("locationLat", lat)
                    .set("locationLng", lng)
                    .set("locationRadiusMeters", radius)
                    .set("locationName", StrUtil.blankToDefault(StrUtil.trim(locationName), "指定授课教室"));
        } else if (lat != null && lng != null) {
            cfg.set("locationLat", lat)
                    .set("locationLng", lng)
                    .set("locationRadiusMeters", radiusMeters != null ? radiusMeters : 150)
                    .set("locationName", StrUtil.trim(locationName));
        }

        if (StrUtil.isNotBlank(photoTip)) {
            cfg.set("photoTip", StrUtil.trim(photoTip));
        } else if (modes.contains("photo")) {
            cfg.set("photoTip", "请拍摄本人课堂现场照片完成签到");
        }
        return cfg;
    }

    private JSONObject parseExtJson(String extJson) {
        if (StrUtil.isNotBlank(extJson) && JSONUtil.isTypeJSONObject(extJson)) {
            return JSONUtil.parseObj(extJson);
        }
        return new JSONObject();
    }

    private List<String> extractModes(JSONObject ext) {
        if (ext != null && ext.containsKey("checkinModes")) {
            JSONArray arr = ext.getJSONArray("checkinModes");
            if (arr != null && !arr.isEmpty()) {
                List<String> list = new ArrayList<>();
                for (int i = 0; i < arr.size(); i++) {
                    String v = arr.getStr(i);
                    if (VALID_CHECKIN_MODES.contains(v) && !list.contains(v)) {
                        list.add(v);
                    }
                }
                if (!list.isEmpty()) {
                    return list;
                }
            }
        }
        return Collections.singletonList("qr");
    }

    private String normalizeGesturePattern(String raw) {
        if (StrUtil.isBlank(raw)) return "";
        String cleaned = raw.replaceAll("[^1-9]", "");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cleaned.length(); i++) {
            if (i > 0) sb.append('-');
            sb.append(cleaned.charAt(i));
        }
        return sb.toString();
    }

    private double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private String modeLabel(String mode) {
        return switch (mode) {
            case "qr" -> "扫码签到";
            case "photo" -> "拍照签到";
            case "gesture" -> "手势签到";
            case "location" -> "定位签到";
            default -> mode;
        };
    }

    private String mapStr(Map<String, Object> body, String... keys) {
        if (body == null) return null;
        for (String k : keys) {
            Object v = body.get(k);
            if (v != null && StrUtil.isNotBlank(String.valueOf(v))) {
                return StrUtil.trim(String.valueOf(v));
            }
        }
        return null;
    }

    private Double mapDouble(Map<String, Object> body, String... keys) {
        String s = mapStr(body, keys);
        if (StrUtil.isBlank(s)) return null;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private int resolveWindowSeconds(Integer expireSeconds, Integer expireMinutes) {
        if (expireSeconds != null && expireSeconds > 0) {
            return Math.min(4 * 3600, Math.max(60, expireSeconds));
        }
        int minutes = expireMinutes != null && expireMinutes > 0 ? Math.min(240, expireMinutes) : DEFAULT_EXPIRE_MINUTES;
        return minutes * 60;
    }

    private int getQrRefreshSeconds() {
        try {
            String raw = devConfigApi.getValueByKey("WARNSYS_WARNING");
            if (StrUtil.isNotBlank(raw) && JSONUtil.isTypeJSONObject(raw)) {
                int val = JSONUtil.parseObj(raw).getInt("qrRefreshSeconds", DEFAULT_QR_REFRESH_SECONDS);
                return Math.max(5, Math.min(3600, val));
            }
        } catch (Exception e) {
            log.debug("读取 WARNSYS_WARNING.qrRefreshSeconds 失败，使用默认值", e);
        }
        return DEFAULT_QR_REFRESH_SECONDS;
    }

    private Date getDeadline(BizClassSession session) {
        return session.getSessionEnd() != null ? session.getSessionEnd() : session.getQrExpireAt();
    }

    private void enrichSessions(List<BizClassSession> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> classIds = records.stream().map(BizClassSession::getClassId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, BizClass> classMap = classIds.isEmpty() ? Collections.emptyMap() :
                bizClassService.listByIds(classIds).stream().collect(Collectors.toMap(BizClass::getId, c -> c, (a, b) -> a));

        Set<String> orgIds = classMap.values().stream().map(BizClass::getOrgId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        Map<String, String> orgNameMap = orgIds.isEmpty() ? Collections.emptyMap() :
                bizOrgService.listByIds(orgIds).stream().collect(Collectors.toMap(BizOrg::getId, BizOrg::getName, (a, b) -> a));

        List<String> sessionIds = CollStreamUtil.toList(records, BizClassSession::getId);
        Map<String, BizClassSessionSnapshot> snapMap = bizAttendanceSnapshotService.getOrRefreshMap(sessionIds);

        for (BizClassSession s : records) {
            BizClass cls = classMap.get(s.getClassId());
            if (cls != null) {
                s.setOrgId(cls.getOrgId());
                s.setOrgName(orgNameMap.get(cls.getOrgId()));
            }
            BizClassSessionSnapshot snap = snapMap.get(s.getId());
            if (snap != null) {
                s.setTotalStudents(snap.getTotalStudents());
                s.setCheckedInCount(snap.getCheckedInCount());
                s.setOnTimeCount(snap.getOnTimeCount());
                s.setLateCount(snap.getLateCount());
                s.setLeaveCount(snap.getLeaveCount());
                s.setAbsentCount(snap.getAbsentCount());
            }
            JSONObject ext = parseExtJson(s.getExtJson());
            s.setCheckinModes(extractModes(ext));
            s.setQrRefreshSeconds(resolveSessionRefreshSeconds(s));
            s.setGesturePattern(ext.getStr("gesturePattern"));
            s.setLocationLat(ext.getDouble("locationLat"));
            s.setLocationLng(ext.getDouble("locationLng"));
            s.setLocationRadiusMeters(ext.getInt("locationRadiusMeters"));
            s.setLocationName(ext.getStr("locationName"));
            s.setPhotoTip(ext.getStr("photoTip"));
        }
    }
}
