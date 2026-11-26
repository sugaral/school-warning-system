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

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.attendance.param.BizDailyRecordIdParam;
import vip.xiaonuo.biz.modular.attendance.param.BizDailyRecordPageParam;
import vip.xiaonuo.biz.modular.attendance.param.BizDailyRecordUpsertParam;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonSqlUtil;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 每日考勤与表现记录Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizDailyRecordServiceImpl extends ServiceImpl<BizDailyRecordMapper, BizDailyRecord>
        implements BizDailyRecordService {

    private static final Set<String> VALID_ATTENDANCE = Set.of("on_time", "late", "absent", "leave", "early_leave", "present");
    private static final Set<String> VALID_HOMEWORK = Set.of("submitted", "not_submit", "late_submit", "unknown");
    private static final Set<String> VALID_BEHAVIOR = Set.of("normal", "disruptive");
    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizCourseService bizCourseService;

    @Override
    public Page<BizDailyRecord> page(BizDailyRecordPageParam param) {
        QueryWrapper<BizDailyRecord> queryWrapper = new QueryWrapper<BizDailyRecord>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizDailyRecord::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizDailyRecord::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizDailyRecord::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getRecordDate())) {
            String dateStr = parseLocalDateStr(param.getRecordDate());
            queryWrapper.lambda().eq(BizDailyRecord::getRecordDate, dateStr);
        }
        if (StrUtil.isNotBlank(param.getAttendanceStatus())) {
            queryWrapper.lambda().eq(BizDailyRecord::getAttendanceStatus, param.getAttendanceStatus());
        }
        if (StrUtil.isNotBlank(param.getHomeworkStatus())) {
            queryWrapper.lambda().eq(BizDailyRecord::getHomeworkStatus, param.getHomeworkStatus());
        }
        if (StrUtil.isNotBlank(param.getClassBehavior())) {
            queryWrapper.lambda().eq(BizDailyRecord::getClassBehavior, param.getClassBehavior());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            String key = StrUtil.trim(param.getSearchKey());
            List<String> matchedStudents = CollStreamUtil.toList(
                    bizStudentProfileService.list(new LambdaQueryWrapper<BizStudentProfile>()
                            .select(BizStudentProfile::getId)
                            .and(w -> w.like(BizStudentProfile::getStudentNo, key).or().like(BizStudentProfile::getName, key))),
                    BizStudentProfile::getId);
            queryWrapper.lambda().and(w -> {
                w.like(BizDailyRecord::getRemarks, key);
                if (!matchedStudents.isEmpty()) {
                    w.or(sub -> CommonSqlUtil.safeIn(sub, BizDailyRecord::getStudentId, matchedStudents));
                }
            });
        }
        queryWrapper.lambda().orderByDesc(BizDailyRecord::getRecordDate).orderByDesc(BizDailyRecord::getCreateTime);
        Page<BizDailyRecord> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillStudentNo(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject batchUpsert(List<BizDailyRecordUpsertParam> records) {
        if (ObjectUtil.isEmpty(records)) {
            throw new CommonException("录入记录不能为空");
        }
        if (records.size() > 500) {
            throw new CommonException("单次最多批量录入500条日记录");
        }
        int created = 0;
        int updated = 0;
        JSONArray items = new JSONArray();

        for (BizDailyRecordUpsertParam item : records) {
            String dateStr = parseLocalDateStr(item.getRecordDate());
            Date recordDate = java.sql.Date.valueOf(dateStr);
            String att = StrUtil.trim(item.getAttendanceStatus());
            String hw = StrUtil.trim(item.getHomeworkStatus());
            String behavior = StrUtil.trim(item.getClassBehavior());

            if (StrUtil.isNotBlank(att) && !VALID_ATTENDANCE.contains(att)) {
                throw new CommonException("出勤状态非法: {}", att);
            }
            if (StrUtil.isNotBlank(hw) && !VALID_HOMEWORK.contains(hw)) {
                throw new CommonException("作业状态非法: {}", hw);
            }
            if (StrUtil.isNotBlank(behavior) && !VALID_BEHAVIOR.contains(behavior)) {
                throw new CommonException("课堂表现状态非法: {}", behavior);
            }

            BizStudentProfile student = bizStudentProfileService.queryEntity(item.getStudentId());
            BizScopeUtil.assertOrgInScope(student.getOrgId(), "录入学生日常表现与考勤");
            bizCourseService.queryEntity(item.getCourseId());

            BizDailyRecord existing = this.getOne(new LambdaQueryWrapper<BizDailyRecord>()
                    .eq(BizDailyRecord::getStudentId, student.getId())
                    .eq(BizDailyRecord::getRecordDate, dateStr)
                    .eq(BizDailyRecord::getCourseId, item.getCourseId()));

            if (existing == null) {
                BizDailyRecord entity = new BizDailyRecord();
                entity.setStudentId(student.getId());
                entity.setRecordDate(recordDate);
                entity.setClassId(student.getClassId());
                entity.setOrgId(student.getOrgId());
                entity.setCourseId(item.getCourseId());
                entity.setAttendanceStatus(StrUtil.isNotBlank(att) ? att : "present");
                entity.setHomeworkStatus(StrUtil.isNotBlank(hw) ? hw : "unknown");
                entity.setClassBehavior(StrUtil.isNotBlank(behavior) ? behavior : "normal");
                entity.setRemarks(StrUtil.isNotBlank(item.getRemarks()) ? StrUtil.trim(item.getRemarks()) : null);
                entity.setSource("manual");
                entity.setApprovedStatus("approved");
                this.save(entity);
                created++;
                items.add(new JSONObject().set("id", entity.getId()).set("action", "created"));
            } else {
                if (StrUtil.isNotBlank(att)) {
                    existing.setAttendanceStatus(att);
                }
                if (StrUtil.isNotBlank(hw)) {
                    existing.setHomeworkStatus(hw);
                }
                if (StrUtil.isNotBlank(behavior)) {
                    existing.setClassBehavior(behavior);
                }
                if (item.getRemarks() != null) {
                    existing.setRemarks(StrUtil.isBlank(item.getRemarks()) ? null : StrUtil.trim(item.getRemarks()));
                }
                this.updateById(existing);
                updated++;
                items.add(new JSONObject().set("id", existing.getId()).set("action", "updated"));
            }
        }
        return new JSONObject()
                .set("created", created)
                .set("updated", updated)
                .set("total", created + updated)
                .set("items", items);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizDailyRecordIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizDailyRecordIdParam::getId);
        for (BizDailyRecord record : this.listByIds(ids)) {
            BizScopeUtil.assertOrgInScope(record.getOrgId(), "删除日考勤表现记录");
        }
        this.removeByIds(ids);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void mergeAttendanceStatus(String studentId, String classId, String orgId, String courseId,
                                      Date recordDate, String attendanceStatus, String source) {
        if (StrUtil.isBlank(studentId) || StrUtil.isBlank(courseId) || recordDate == null) {
            return;
        }
        String dateStr = (recordDate instanceof java.sql.Date)
                ? recordDate.toString()
                : Instant.ofEpochMilli(recordDate.getTime()).atZone(ZONE_SHANGHAI).toLocalDate().toString();
        Date sqlDate = java.sql.Date.valueOf(dateStr);
        BizDailyRecord existing = this.getOne(new LambdaQueryWrapper<BizDailyRecord>()
                .eq(BizDailyRecord::getStudentId, studentId)
                .eq(BizDailyRecord::getRecordDate, dateStr)
                .eq(BizDailyRecord::getCourseId, courseId));
        if (existing == null) {
            BizDailyRecord entity = new BizDailyRecord();
            entity.setStudentId(studentId);
            entity.setRecordDate(sqlDate);
            entity.setClassId(classId);
            entity.setOrgId(StrUtil.isNotBlank(orgId) ? orgId : "0");
            entity.setCourseId(courseId);
            entity.setAttendanceStatus(attendanceStatus);
            entity.setHomeworkStatus("unknown");
            entity.setSource(source);
            entity.setApprovedStatus("approved");
            this.save(entity);
        } else {
            existing.setAttendanceStatus(attendanceStatus);
            existing.setSource(source);
            this.updateById(existing);
        }
    }

    private String parseLocalDateStr(String dateRaw) {
        try {
            return LocalDate.parse(StrUtil.trim(dateRaw)).toString();
        } catch (DateTimeParseException e) {
            throw new CommonException("日期格式无效，应为 YYYY-MM-DD: {}", dateRaw);
        }
    }

    private void fillStudentNo(List<BizDailyRecord> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        Set<String> sids = records.stream().map(BizDailyRecord::getStudentId).filter(StrUtil::isNotBlank).collect(Collectors.toSet());
        if (sids.isEmpty()) {
            return;
        }
        Map<String, String> noMap = bizStudentProfileService.listByIds(sids).stream()
                .collect(Collectors.toMap(BizStudentProfile::getId, BizStudentProfile::getStudentNo, (a, b) -> a));
        for (BizDailyRecord r : records) {
            r.setStudentNo(noMap.get(r.getStudentId()));
        }
    }
}
