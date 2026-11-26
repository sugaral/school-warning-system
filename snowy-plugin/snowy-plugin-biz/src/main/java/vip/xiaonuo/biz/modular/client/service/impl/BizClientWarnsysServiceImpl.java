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
package vip.xiaonuo.biz.modular.client.service.impl;

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.BCrypt;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.auth.core.util.StpClientUtil;
import vip.xiaonuo.biz.modular.appeal.entity.BizAppeal;
import vip.xiaonuo.biz.modular.appeal.mapper.BizAppealMapper;
import vip.xiaonuo.biz.modular.attendance.entity.BizAttendanceRecord;
import vip.xiaonuo.biz.modular.attendance.entity.BizClassSession;
import vip.xiaonuo.biz.modular.attendance.entity.BizDailyRecord;
import vip.xiaonuo.biz.modular.attendance.mapper.BizAttendanceRecordMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizClassSessionMapper;
import vip.xiaonuo.biz.modular.attendance.mapper.BizDailyRecordMapper;
import vip.xiaonuo.biz.modular.attendance.service.BizAttendanceSnapshotService;
import vip.xiaonuo.biz.modular.attendance.service.BizClassSessionService;
import vip.xiaonuo.biz.modular.attendance.service.BizDailyRecordService;
import vip.xiaonuo.biz.modular.attendance.util.BizAttendanceQrUtil;
import vip.xiaonuo.biz.modular.changerequest.entity.BizChangeRequest;
import vip.xiaonuo.biz.modular.changerequest.mapper.BizChangeRequestMapper;
import vip.xiaonuo.biz.modular.classnotice.entity.BizClassNotification;
import vip.xiaonuo.biz.modular.classnotice.mapper.BizClassNotificationMapper;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.courseclass.entity.BizCourseClass;
import vip.xiaonuo.biz.modular.courseclass.service.BizCourseClassService;
import vip.xiaonuo.biz.modular.leaverequest.entity.BizLeaveRequest;
import vip.xiaonuo.biz.modular.leaverequest.mapper.BizLeaveRequestMapper;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.schedule.entity.BizSchedule;
import vip.xiaonuo.biz.modular.schedule.mapper.BizScheduleMapper;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.biz.modular.teacherbinding.entity.BizTeacherCourseBinding;
import vip.xiaonuo.biz.modular.teacherbinding.service.BizTeacherCourseBindingService;
import vip.xiaonuo.biz.modular.user.entity.BizUser;
import vip.xiaonuo.biz.modular.user.service.BizUserService;
import vip.xiaonuo.biz.modular.warning.entity.BizMonthlySummary;
import vip.xiaonuo.biz.modular.warning.entity.BizTermSummary;
import vip.xiaonuo.biz.modular.warning.entity.BizWarning;
import vip.xiaonuo.biz.modular.warning.entity.BizWarningCurrentState;
import vip.xiaonuo.biz.modular.warning.entity.BizWeeklySummary;
import vip.xiaonuo.biz.modular.warning.mapper.BizMonthlySummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizTermSummaryMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningCurrentStateMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWarningMapper;
import vip.xiaonuo.biz.modular.warning.mapper.BizWeeklySummaryMapper;
import vip.xiaonuo.biz.modular.client.service.BizClientWarnsysService;
import vip.xiaonuo.common.cache.CommonCacheOperator;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.util.CommonCryptogramUtil;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.dev.api.DevConfigApi;
import vip.xiaonuo.dev.api.DevEmailApi;
import vip.xiaonuo.dev.api.DevFileApi;
import vip.xiaonuo.dev.api.DevSmsApi;

import java.text.SimpleDateFormat;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 微信小程序 / C端学生服务实现（全链路使用 StpClientUtil 与国密 SM2/SM3/SM4）
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizClientWarnsysServiceImpl implements BizClientWarnsysService {

    private static final ZoneId ZONE_SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final String CHALLENGE_CACHE_PREFIX = "warnsys:c:challenge:";
    private static final String CHALLENGE_RATE_PREFIX = "warnsys:c:rate:";
    private static final String TICKET_CACHE_PREFIX = "warnsys:c:ticket:";
    private static final Set<String> ALLOWED_IMAGE_EXT = Set.of("jpg", "jpeg", "png", "gif", "webp", "bmp");

    @Resource
    private BizStudentProfileService bizStudentProfileService;

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizCourseClassService bizCourseClassService;

    @Resource
    private BizTeacherCourseBindingService bizTeacherCourseBindingService;

    @Resource
    private BizUserService bizUserService;

    @Resource
    private BizScheduleMapper bizScheduleMapper;

    @Resource
    private BizDailyRecordMapper dailyRecordMapper;

    @Resource
    private BizDailyRecordService bizDailyRecordService;

    @Resource
    private BizClassSessionMapper classSessionMapper;

    @Resource
    private BizAttendanceRecordMapper attendanceRecordMapper;

    @Resource
    private BizAttendanceSnapshotService attendanceSnapshotService;

    @Resource
    private BizWarningMapper warningMapper;

    @Resource
    private BizWarningCurrentStateMapper currentStateMapper;

    @Resource
    private BizWeeklySummaryMapper weeklySummaryMapper;

    @Resource
    private BizMonthlySummaryMapper monthlySummaryMapper;

    @Resource
    private BizTermSummaryMapper termSummaryMapper;

    @Resource
    private BizLeaveRequestMapper leaveRequestMapper;

    @Resource
    private BizAppealMapper appealMapper;

    @Resource
    private BizChangeRequestMapper changeRequestMapper;

    @Resource
    private BizClassNotificationMapper classNotificationMapper;

    @Resource
    private DevConfigApi devConfigApi;

    @Resource
    private DevFileApi devFileApi;

    @Resource
    private DevEmailApi devEmailApi;

    @Resource
    private DevSmsApi devSmsApi;

    @Lazy
    @Resource
    private BizClassSessionService bizClassSessionService;

    @Resource
    private CommonCacheOperator commonCacheOperator;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject login(Map<String, Object> body) {
        String wxCode = str(body, "wx_code", "wxCode");
        String studentNo = str(body, "student_no", "studentNo", "account");
        String name = str(body, "name");
        String cipherPwd = str(body, "password");

        if (StrUtil.isBlank(studentNo) && StrUtil.isNotBlank(wxCode)) {
            return wxLogin(body);
        }
        if (StrUtil.hasBlank(studentNo, cipherPwd)) {
            throw new CommonException("请输入学号和密码");
        }
        String plainPwd = decryptSm2Strict(cipherPwd);

        BizStudentProfile stu = bizStudentProfileService.getOne(
                new LambdaQueryWrapper<BizStudentProfile>().eq(BizStudentProfile::getStudentNo, studentNo).last("LIMIT 1"));
        if (stu == null) {
            throw new CommonException("学号或密码错误");
        }
        if (StrUtil.isNotBlank(name) && !StrUtil.equals(StrUtil.trim(name), StrUtil.trim(stu.getName()))) {
            throw new CommonException("学号与姓名不匹配");
        }
        if (StrUtil.isBlank(stu.getClientUserId())) {
            throw new CommonException("该生尚未开通学生端账号");
        }
        List<Map<String, Object>> cuRows = jdbcTemplate.queryForList(
                "SELECT ID, PASSWORD, USER_STATUS FROM CLIENT_USER WHERE ID = ? AND DELETE_FLAG = 'NOT_DELETE' LIMIT 1",
                stu.getClientUserId());
        if (cuRows.isEmpty()) {
            throw new CommonException("学生端登录账号不存在");
        }
        Map<String, Object> cu = cuRows.get(0);
        if (!"ENABLE".equals(String.valueOf(cu.get("USER_STATUS")))) {
            throw new CommonException("当前学生账号已被停用");
        }
        String dbHash = String.valueOf(cu.get("PASSWORD"));
        boolean matched;
        if (dbHash.startsWith("$2a$") || dbHash.startsWith("$2b$") || dbHash.startsWith("$2y$")) {
            matched = BCrypt.checkpw(plainPwd, dbHash);
            if (matched) {
                // 历史 bcrypt 首次登录自动无感升级为国密 SM3
                String newSm3 = CommonCryptogramUtil.doHashValue(plainPwd);
                jdbcTemplate.update("UPDATE CLIENT_USER SET PASSWORD = ?, UPDATE_TIME = NOW() WHERE ID = ?",
                        newSm3, stu.getClientUserId());
            }
        } else {
            String sm3 = CommonCryptogramUtil.doHashValue(plainPwd);
            matched = sm3.equalsIgnoreCase(dbHash);
        }
        if (!matched) {
            throw new CommonException("学号或密码错误");
        }

        if (StrUtil.isNotBlank(wxCode)) {
            bindWxCodeInternal(stu, wxCode);
        }
        jdbcTemplate.update("UPDATE CLIENT_USER SET LATEST_LOGIN_TIME = NOW() WHERE ID = ?", stu.getClientUserId());
        StpClientUtil.login(stu.getClientUserId());
        String token = StpClientUtil.getTokenValue();

        return new JSONObject()
                .set("token", token)
                .set("student", buildStudentDto(stu));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject wxLogin(Map<String, Object> body) {
        String wxCode = str(body, "wx_code", "wxCode");
        if (StrUtil.isBlank(wxCode)) {
            throw new CommonException("缺少 wx_code 登录凭证");
        }
        String openid = resolveOpenIdFromWxCode(wxCode);
        BizStudentProfile stu = bizStudentProfileService.getOne(
                new LambdaQueryWrapper<BizStudentProfile>().eq(BizStudentProfile::getWxOpenid, openid).last("LIMIT 1"));
        if (stu == null) {
            List<String> uids = jdbcTemplate.queryForList(
                    "SELECT USER_ID FROM AUTH_THIRD_USER WHERE THIRD_ID = ? AND CATEGORY = 'WECHAT_MINI' AND DELETE_FLAG = 'NOT_DELETE' LIMIT 1",
                    String.class, openid);
            if (!uids.isEmpty()) {
                stu = bizStudentProfileService.getOne(new LambdaQueryWrapper<BizStudentProfile>()
                        .eq(BizStudentProfile::getClientUserId, uids.get(0)).last("LIMIT 1"));
            }
        }
        if (stu == null || StrUtil.isBlank(stu.getClientUserId())) {
            throw new CommonException("当前微信尚未绑定学生账号，请先使用学号姓名密码登录");
        }
        jdbcTemplate.update("UPDATE CLIENT_USER SET LATEST_LOGIN_TIME = NOW() WHERE ID = ?", stu.getClientUserId());
        StpClientUtil.login(stu.getClientUserId());
        return new JSONObject()
                .set("token", StpClientUtil.getTokenValue())
                .set("student", buildStudentDto(stu));
    }

    @Override
    public void logout() {
        StpClientUtil.logout();
    }

    @Override
    public JSONObject sendCode(Map<String, Object> body) {
        String channel = StrUtil.blankToDefault(str(body, "channel"), "email").toLowerCase(Locale.ROOT);
        String purpose = StrUtil.blankToDefault(str(body, "purpose"), "verify");
        String account = str(body, "account", "student_no", "studentNo");
        String target = StrUtil.trim(str(body, "target", "email", "mobile", "account"));
        if (StrUtil.isBlank(target)) {
            throw new CommonException("请输入接收验证码的邮箱或手机号");
        }
        if (StrUtil.isNotBlank(account)) {
            BizStudentProfile stu = bizStudentProfileService.getOne(
                    new LambdaQueryWrapper<BizStudentProfile>().eq(BizStudentProfile::getStudentNo, account).last("LIMIT 1"));
            if (stu == null) {
                throw new CommonException("未找到对应学生档案");
            }
            if ("email".equals(channel) && (StrUtil.isBlank(stu.getEmail()) || !stu.getEmail().equalsIgnoreCase(target))) {
                throw new CommonException("输入邮箱与该学号绑定邮箱不一致");
            }
            if ("sms".equals(channel) && (StrUtil.isBlank(stu.getMobile()) || !stu.getMobile().equals(target))) {
                throw new CommonException("输入手机号与该学号绑定手机号不一致");
            }
        }
        String rateKey = CHALLENGE_RATE_PREFIX + channel + ":" + target.toLowerCase(Locale.ROOT);
        if (commonCacheOperator.get(rateKey) != null) {
            throw new CommonException("验证码发送过于频繁，请 60 秒后再试");
        }

        String code = RandomUtil.randomNumbers(6);
        String challengeId = IdUtil.fastSimpleUUID();
        JSONObject payload = new JSONObject()
                .set("code", code)
                .set("channel", channel)
                .set("purpose", purpose)
                .set("account", StrUtil.blankToDefault(account, ""))
                .set("target", target)
                .set("attempts", 0);
        commonCacheOperator.put(CHALLENGE_CACHE_PREFIX + challengeId, payload.toString(), 300L);
        commonCacheOperator.put(rateKey, "1", 60L);

        if ("email".equals(channel) && target.contains("@")) {
            try {
                devEmailApi.sendDynamicTxtEmail(target, "学业预警系统验证码", "您的验证码为：" + code + "（5分钟内有效）。");
            } catch (Exception e) {
                log.warn("[C-SendCode] 邮件发送异常 target={}, err={}", target, e.getMessage());
            }
        } else if ("sms".equals(channel)) {
            try {
                devSmsApi.sendDynamicSms(target, "WARNSYS_VERIFY_CODE", new JSONObject().set("code", code));
            } catch (Exception e) {
                log.warn("[C-SendCode] 短信发送异常 target={}, err={}", maskTarget(target), e.getMessage());
            }
        }
        return new JSONObject()
                .set("challenge_id", challengeId)
                .set("cooldown_seconds", 60)
                .set("mask_target", maskTarget(target));
    }

    @Override
    public JSONObject verifyCode(Map<String, Object> body) {
        String challengeId = str(body, "challenge_id", "challengeId");
        String code = str(body, "code");
        if (StrUtil.hasBlank(challengeId, code)) {
            throw new CommonException("请输入完整验证码");
        }
        String cacheKey = CHALLENGE_CACHE_PREFIX + challengeId;
        Object raw = commonCacheOperator.get(cacheKey);
        if (raw == null) {
            throw new CommonException("验证码已过期，请重新发送");
        }
        JSONObject info = JSONUtil.parseObj(String.valueOf(raw));
        int attempts = info.getInt("attempts", 0);
        if (attempts >= 5) {
            commonCacheOperator.remove(cacheKey);
            throw new CommonException("验证码错误次数过多，请重新获取");
        }
        if (!StrUtil.equals(info.getStr("code"), StrUtil.trim(code))) {
            info.set("attempts", attempts + 1);
            commonCacheOperator.put(cacheKey, info.toString(), 300L);
            throw new CommonException("验证码不正确");
        }
        commonCacheOperator.remove(cacheKey);
        String ticket = IdUtil.fastSimpleUUID();
        String ticketVal = StrUtil.isNotBlank(info.getStr("account")) ? info.getStr("account") : info.getStr("target");
        commonCacheOperator.put(TICKET_CACHE_PREFIX + ticket, ticketVal, 600L);
        return new JSONObject().set("ticket", ticket);
    }

    @Override
    public JSONObject recoveryOptions(Map<String, Object> body) {
        String account = str(body, "account", "student_no", "studentNo");
        if (StrUtil.isBlank(account)) {
            throw new CommonException("请输入学号");
        }
        BizStudentProfile stu = bizStudentProfileService.getOne(
                new LambdaQueryWrapper<BizStudentProfile>().eq(BizStudentProfile::getStudentNo, account).last("LIMIT 1"));
        if (stu == null) {
            throw new CommonException("未找到对应学生档案");
        }
        boolean hasEmail = StrUtil.isNotBlank(stu.getEmail());
        boolean hasSms = StrUtil.isNotBlank(stu.getMobile());
        return new JSONObject()
                .set("student_no", stu.getStudentNo())
                .set("email", new JSONObject()
                        .set("bound", hasEmail)
                        .set("enabled", hasEmail)
                        .set("masked", maskTarget(stu.getEmail()))
                        .set("reason", hasEmail ? "" : "尚未绑定邮箱"))
                .set("sms", new JSONObject()
                        .set("bound", hasSms)
                        .set("enabled", hasSms)
                        .set("masked", maskTarget(stu.getMobile()))
                        .set("reason", hasSms ? "" : "尚未绑定手机号"));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject resetPassword(Map<String, Object> body) {
        String ticket = str(body, "ticket");
        String cipherNew = str(body, "new_password", "newPassword", "password");
        if (StrUtil.hasBlank(ticket, cipherNew)) {
            throw new CommonException("参数不完整");
        }
        Object targetObj = commonCacheOperator.get(TICKET_CACHE_PREFIX + ticket);
        if (targetObj == null) {
            throw new CommonException("重置凭证已失效，请重新验证");
        }
        String target = String.valueOf(targetObj);
        String plainNew = decryptSm2Strict(cipherNew);
        if (plainNew.length() < 8) {
            throw new CommonException("新密码长度至少 8 位");
        }

        BizStudentProfile stu = bizStudentProfileService.getOne(
                new LambdaQueryWrapper<BizStudentProfile>()
                        .eq(BizStudentProfile::getStudentNo, target)
                        .or().eq(BizStudentProfile::getEmail, target)
                        .last("LIMIT 1"));
        if (stu == null && target.matches("^1\\d{10}$")) {
            List<BizStudentProfile> allStu = bizStudentProfileService.list();
            stu = allStu.stream().filter(s -> target.equals(s.getMobile())).findFirst().orElse(null);
        }
        if (stu == null || StrUtil.isBlank(stu.getClientUserId())) {
            throw new CommonException("未匹配到学生账号");
        }
        String sm3 = CommonCryptogramUtil.doHashValue(plainNew);
        jdbcTemplate.update("UPDATE CLIENT_USER SET PASSWORD = ?, UPDATE_TIME = NOW() WHERE ID = ?", sm3, stu.getClientUserId());
        stu.setInitialPassword(null);
        bizStudentProfileService.updateById(stu);
        StpClientUtil.logout(stu.getClientUserId());
        commonCacheOperator.remove(TICKET_CACHE_PREFIX + ticket);
        return new JSONObject().set("updated", true);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject bindWechat(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String wxCode = str(body, "wx_code", "wxCode");
        if (StrUtil.isBlank(wxCode)) {
            throw new CommonException("缺少 wx_code");
        }
        bindWxCodeInternal(me, wxCode);
        return buildStudentDto(me);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject bindEmail(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String email = str(body, "email");
        if (StrUtil.isBlank(email) || !email.contains("@")) {
            throw new CommonException("请输入合法邮箱地址");
        }
        me.setEmail(email);
        bizStudentProfileService.updateById(me);
        jdbcTemplate.update("UPDATE CLIENT_USER SET EMAIL = ?, UPDATE_TIME = NOW() WHERE ID = ?", email, me.getClientUserId());
        return buildStudentDto(me);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject bindPhone(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String phone = str(body, "phone", "mobile");
        if (StrUtil.isBlank(phone) || !phone.matches("^1\\d{10}$")) {
            throw new CommonException("请输入合法 11 位手机号");
        }
        me.setMobile(phone);
        bizStudentProfileService.updateById(me);
        jdbcTemplate.update("UPDATE CLIENT_USER SET PHONE = ?, UPDATE_TIME = NOW() WHERE ID = ?",
                CommonCryptogramUtil.doSm4CbcEncrypt(phone), me.getClientUserId());
        return buildStudentDto(me);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject bindClass(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isNotBlank(me.getClassId())) {
            throw new CommonException("您已绑定班级，如需转班请在「我的资料 - 换班申请」中提交审批");
        }
        String classId = str(body, "class_id", "classId");
        BizClass cls = bizClassService.queryEntity(classId);
        me.setClassId(cls.getId());
        me.setOrgId(cls.getOrgId());
        me.setMajorId(cls.getMajorId());
        if (StrUtil.isNotBlank(cls.getMajor())) {
            me.setMajor(cls.getMajor());
        }
        bizStudentProfileService.updateById(me);
        return buildStudentDto(me);
    }

    @Override
    public List<JSONObject> availableClasses() {
        List<BizClass> classes = bizClassService.list(
                new LambdaQueryWrapper<BizClass>().eq(BizClass::getStatus, "active").orderByAsc(BizClass::getClassName));
        Map<String, String> orgNames = bizOrgService.list().stream()
                .collect(Collectors.toMap(BizOrg::getId, BizOrg::getName, (a, b) -> a));
        return classes.stream().map(c -> new JSONObject()
                .set("id", c.getId())
                .set("class_name", c.getClassName())
                .set("org_id", c.getOrgId())
                .set("org_name", orgNames.getOrDefault(c.getOrgId(), ""))
                .set("major", c.getMajor())
                .set("enroll_year", c.getEnrollYear())).toList();
    }

    @Override
    public JSONObject getProfile() {
        return buildStudentDto(currentStudent());
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject updateProfile(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        if (body.containsKey("mobile") || body.containsKey("phone")) {
            String phone = str(body, "mobile", "phone");
            me.setMobile(StrUtil.isNotBlank(phone) ? phone : null);
        }
        if (body.containsKey("email")) {
            me.setEmail(StrUtil.isNotBlank(str(body, "email")) ? str(body, "email") : null);
        }
        if (body.containsKey("gender")) {
            me.setGender(StrUtil.isNotBlank(str(body, "gender")) ? str(body, "gender") : null);
        }
        if (body.containsKey("student_position")) {
            me.setStudentPosition(StrUtil.isNotBlank(str(body, "student_position")) ? str(body, "student_position") : null);
        }
        if (body.containsKey("photo_file_id")) {
            me.setPhotoFileId(StrUtil.isNotBlank(str(body, "photo_file_id")) ? str(body, "photo_file_id") : null);
        }
        if (body.containsKey("emergency_contact_name")) {
            me.setEmergencyContactName(str(body, "emergency_contact_name"));
        }
        if (body.containsKey("emergency_contact_mobile")) {
            me.setEmergencyContactMobile(str(body, "emergency_contact_mobile"));
        }
        bizStudentProfileService.updateById(me);
        return buildStudentDto(me);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void changePassword(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String ticket = str(body, "ticket");
        String cipherOld = str(body, "old_password", "oldPassword");
        String cipherNew = str(body, "new_password", "newPassword");
        if (StrUtil.isBlank(cipherNew)) {
            throw new CommonException("请输入新密码");
        }
        String plainNew = decryptSm2Strict(cipherNew);
        if (plainNew.length() < 8) {
            throw new CommonException("新密码长度至少 8 位");
        }
        if (StrUtil.isNotBlank(ticket)) {
            Object t = commonCacheOperator.get(TICKET_CACHE_PREFIX + ticket);
            if (t == null) {
                throw new CommonException("验证码凭证已过期");
            }
            commonCacheOperator.remove(TICKET_CACHE_PREFIX + ticket);
        } else if (StrUtil.isNotBlank(cipherOld)) {
            String plainOld = decryptSm2Strict(cipherOld);
            List<String> pwds = jdbcTemplate.queryForList(
                    "SELECT PASSWORD FROM CLIENT_USER WHERE ID = ? AND DELETE_FLAG = 'NOT_DELETE' LIMIT 1",
                    String.class, me.getClientUserId());
            if (pwds.isEmpty() || !CommonCryptogramUtil.doHashValue(plainOld).equalsIgnoreCase(pwds.get(0))) {
                throw new CommonException("原密码错误");
            }
        } else {
            throw new CommonException("请提供原密码或验证码凭证");
        }
        String sm3New = CommonCryptogramUtil.doHashValue(plainNew);
        jdbcTemplate.update("UPDATE CLIENT_USER SET PASSWORD = ?, UPDATE_TIME = NOW() WHERE ID = ?", sm3New, me.getClientUserId());
        me.setInitialPassword(null);
        bizStudentProfileService.updateById(me);
        StpClientUtil.logout(me.getClientUserId());
    }

    @Override
    public List<JSONObject> getTeachers() {
        BizStudentProfile me = currentStudent();
        List<JSONObject> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (StrUtil.isNotBlank(me.getClassId())) {
            BizClass cls = bizClassService.getById(me.getClassId());
            if (cls != null && StrUtil.isNotBlank(cls.getCounselorUserId())) {
                BizUser ht = bizUserService.getById(cls.getCounselorUserId());
                if (ht != null && seen.add(ht.getId())) {
                    result.add(new JSONObject()
                            .set("id", ht.getId())
                            .set("name", ht.getName())
                            .set("type", "班主任")
                            .set("role", "班主任"));
                }
            }
            List<BizTeacherCourseBinding> bindings = bizTeacherCourseBindingService.list(
                    new LambdaQueryWrapper<BizTeacherCourseBinding>().eq(BizTeacherCourseBinding::getClassId, me.getClassId()));
            Map<String, String> courseMap = bizCourseService.list().stream()
                    .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));
            for (BizTeacherCourseBinding b : bindings) {
                BizUser t = bizUserService.getById(b.getTeacherId());
                if (t != null) {
                    result.add(new JSONObject()
                            .set("id", t.getId())
                            .set("name", t.getName())
                            .set("type", "任课教师")
                            .set("role", "任课教师")
                            .set("course_name", courseMap.getOrDefault(b.getCourseId(), "")));
                }
            }
        }
        return result;
    }

    @Override
    public JSONObject today() {
        BizStudentProfile me = currentStudent();
        LocalDate today = LocalDate.now(ZONE_SHANGHAI);
        String todayStr = today.toString();

        List<BizDailyRecord> drs = dailyRecordMapper.selectList(
                new LambdaQueryWrapper<BizDailyRecord>()
                        .eq(BizDailyRecord::getStudentId, me.getId())
                        .eq(BizDailyRecord::getRecordDate, todayStr));
        Map<String, String> courseNames = bizCourseService.list().stream()
                .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));

        Date dayStart = Date.from(today.atStartOfDay(ZONE_SHANGHAI).toInstant());
        Date dayEnd = Date.from(today.plusDays(1).atStartOfDay(ZONE_SHANGHAI).toInstant());
        List<BizSchedule> schedules = StrUtil.isBlank(me.getClassId()) ? Collections.emptyList()
                : bizScheduleMapper.selectList(new LambdaQueryWrapper<BizSchedule>()
                        .eq(BizSchedule::getClassId, me.getClassId())
                        .ge(BizSchedule::getSessionStart, dayStart)
                        .lt(BizSchedule::getSessionStart, dayEnd));

        List<JSONObject> records = drs.stream().map(d -> new JSONObject()
                .set("id", d.getId())
                .set("course_id", d.getCourseId())
                .set("course_name", courseNames.getOrDefault(d.getCourseId(), "课堂记录"))
                .set("attendance_status", d.getAttendanceStatus())
                .set("homework_status", d.getHomeworkStatus())
                .set("class_behavior", d.getClassBehavior())).toList();

        String overallAtt = drs.stream().map(BizDailyRecord::getAttendanceStatus).filter(Objects::nonNull).findFirst().orElse("unknown");
        String overallHw = drs.stream().map(BizDailyRecord::getHomeworkStatus).filter(Objects::nonNull).findFirst().orElse("unknown");

        return new JSONObject()
                .set("record_date", todayStr)
                .set("course_count", Math.max(schedules.size(), records.size()))
                .set("attendance_status", overallAtt)
                .set("homework_status", overallHw)
                .set("records", records)
                .set("schedules", schedules);
    }

    @Override
    public List<JSONObject> weekly() {
        BizStudentProfile me = currentStudent();
        LocalDate today = LocalDate.now(ZONE_SHANGHAI);
        LocalDate mon = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate sun = mon.plusDays(6);
        List<BizDailyRecord> drs = dailyRecordMapper.selectList(
                new LambdaQueryWrapper<BizDailyRecord>()
                        .eq(BizDailyRecord::getStudentId, me.getId())
                        .ge(BizDailyRecord::getRecordDate, mon.toString())
                        .le(BizDailyRecord::getRecordDate, sun.toString())
                        .orderByAsc(BizDailyRecord::getRecordDate));
        Map<String, String> courseNames = bizCourseService.list().stream()
                .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd");
        return drs.stream().map(d -> {
            String dateStr = d.getRecordDate() != null ? sdf.format(d.getRecordDate()) : "";
            String att = StrUtil.blankToDefault(d.getAttendanceStatus(), "unknown");
            return new JSONObject()
                    .set("id", d.getId())
                    .set("date", dateStr)
                    .set("record_date", dateStr)
                    .set("course_id", d.getCourseId())
                    .set("course_name", courseNames.getOrDefault(d.getCourseId(), "课堂记录"))
                    .set("attendance", att)
                    .set("attendance_status", att)
                    .set("homework_status", StrUtil.blankToDefault(d.getHomeworkStatus(), "unknown"))
                    .set("class_behavior", StrUtil.blankToDefault(d.getClassBehavior(), "normal"));
        }).toList();
    }

    @Override
    public JSONObject summaries(Map<String, String> query) {
        BizStudentProfile me = currentStudent();
        SimpleDateFormat dFmt = new SimpleDateFormat("yyyy-MM-dd");
        List<BizWeeklySummary> weeks = weeklySummaryMapper.selectList(
                new LambdaQueryWrapper<BizWeeklySummary>().eq(BizWeeklySummary::getStudentId, me.getId())
                        .orderByDesc(BizWeeklySummary::getWeekStart).last("LIMIT 12"));
        List<BizMonthlySummary> months = monthlySummaryMapper.selectList(
                new LambdaQueryWrapper<BizMonthlySummary>().eq(BizMonthlySummary::getStudentId, me.getId())
                        .orderByDesc(BizMonthlySummary::getYear).orderByDesc(BizMonthlySummary::getMonth).last("LIMIT 12"));
        List<BizTermSummary> terms = termSummaryMapper.selectList(
                new LambdaQueryWrapper<BizTermSummary>().eq(BizTermSummary::getStudentId, me.getId())
                        .orderByDesc(BizTermSummary::getGeneratedAt).last("LIMIT 8"));

        List<JSONObject> weekDtos = weeks.stream().map(w -> new JSONObject()
                .set("id", w.getId())
                .set("week_start", w.getWeekStart() != null ? dFmt.format(w.getWeekStart()) : "")
                .set("week_end", w.getWeekEnd() != null ? dFmt.format(w.getWeekEnd()) : "")
                .set("late_count", w.getLateCount() != null ? w.getLateCount() : 0)
                .set("absent_count", w.getAbsentCount() != null ? w.getAbsentCount() : 0)
                .set("homework_not_submit_count", w.getHomeworkNotSubmitCount() != null ? w.getHomeworkNotSubmitCount() : 0)).toList();
        List<JSONObject> monthDtos = months.stream().map(m -> new JSONObject()
                .set("id", m.getId())
                .set("year", m.getYear())
                .set("month", m.getMonth())
                .set("late_count", m.getLateCount() != null ? m.getLateCount() : 0)
                .set("absent_count", m.getAbsentCount() != null ? m.getAbsentCount() : 0)
                .set("homework_not_submit_count", m.getHomeworkNotSubmitCount() != null ? m.getHomeworkNotSubmitCount() : 0)).toList();
        List<JSONObject> termDtos = terms.stream().map(t -> new JSONObject()
                .set("id", t.getId())
                .set("term_code", t.getTermCode())
                .set("failed_course_count", t.getFailedCourseCount() != null ? t.getFailedCourseCount() : 0)
                .set("earned_credits", t.getEarnedCredits())
                .set("required_credits", t.getRequiredCredits())
                .set("gpa", t.getGpa())).toList();

        return new JSONObject()
                .set("weekly", weekDtos)
                .set("monthly", monthDtos)
                .set("term", termDtos);
    }

    @Override
    public List<JSONObject> courses() {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isBlank(me.getClassId())) {
            return Collections.emptyList();
        }
        List<BizCourseClass> ccs = bizCourseClassService.list(
                new LambdaQueryWrapper<BizCourseClass>().eq(BizCourseClass::getClassId, me.getClassId()));
        Set<String> courseIds = CollStreamUtil.toSet(ccs, BizCourseClass::getCourseId);
        if (courseIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<BizCourse> courses = bizCourseService.listByIds(courseIds);
        return courses.stream().map(c -> new JSONObject()
                .set("id", c.getId())
                .set("course_code", c.getCourseCode())
                .set("course_name", c.getCourseName())
                .set("credit", c.getCredit())).toList();
    }

    @Override
    public JSONObject warnings(Map<String, String> query) {
        BizStudentProfile me = currentStudent();
        LambdaQueryWrapper<BizWarning> qw = new LambdaQueryWrapper<BizWarning>().eq(BizWarning::getStudentId, me.getId());
        if (query != null) {
            if (StrUtil.isNotBlank(query.get("id"))) qw.eq(BizWarning::getId, query.get("id"));
            if (StrUtil.isNotBlank(query.get("level"))) qw.eq(BizWarning::getLevel, query.get("level"));
            if (StrUtil.isNotBlank(query.get("status"))) qw.eq(BizWarning::getStatus, query.get("status"));
            if (StrUtil.isNotBlank(query.get("course_id"))) qw.eq(BizWarning::getCourseId, query.get("course_id"));
        }
        qw.orderByDesc(BizWarning::getCreateTime);
        List<BizWarning> list = warningMapper.selectList(qw);
        Map<String, String> courseMap = bizCourseService.list().stream()
                .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));
        SimpleDateFormat dFmt = new SimpleDateFormat("yyyy-MM-dd");
        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<JSONObject> items = list.stream().map(w -> new JSONObject()
                .set("id", w.getId())
                .set("course_id", w.getCourseId())
                .set("course_name", StrUtil.isNotBlank(w.getCourseId()) ? courseMap.getOrDefault(w.getCourseId(), "") : "全部课程")
                .set("metric", w.getMetric())
                .set("level", w.getLevel())
                .set("window", w.getWindowType())
                .set("status", w.getStatus())
                .set("trigger_summary", w.getTriggerSummary())
                .set("warning_reason", w.getTriggerSummary())
                .set("trigger_detail_json", w.getTriggerDetailJson())
                .set("rule_snapshot_json", w.getRuleSnapshotJson())
                .set("period_start", w.getPeriodStart() != null ? dFmt.format(w.getPeriodStart()) : "")
                .set("period_end", w.getPeriodEnd() != null ? dFmt.format(w.getPeriodEnd()) : "")
                .set("acknowledged_at", w.getAcknowledgedAt() != null ? dtFmt.format(w.getAcknowledgedAt()) : "")
                .set("created_at", w.getCreateTime() != null ? dtFmt.format(w.getCreateTime()) : "")
                .set("close_note", w.getCloseNote())).toList();

        long pending = list.stream().filter(w -> "open".equals(w.getStatus())).count();
        long processing = list.stream().filter(w -> "acknowledged".equals(w.getStatus())).count();
        long closed = list.stream().filter(w -> "closed".equals(w.getStatus())).count();
        return new JSONObject()
                .set("list", items)
                .set("items", items)
                .set("stats", new JSONObject()
                        .set("total", items.size())
                        .set("pending", pending)
                        .set("processing", processing)
                        .set("closed", closed));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void confirmWarning(String id) {
        BizStudentProfile me = currentStudent();
        BizWarning w = warningMapper.selectById(id);
        if (w == null) {
            throw new CommonException("预警记录不存在");
        }
        if (!Objects.equals(w.getStudentId(), me.getId())) {
            throw new CommonException("越权拒绝：不可确认他人预警");
        }
        if ("closed".equals(w.getStatus())) {
            throw new CommonException("该预警已关闭");
        }
        Date now = new Date();
        w.setStatus("acknowledged");
        w.setAcknowledgedAt(now);
        w.setAcknowledgedBy(me.getClientUserId());
        warningMapper.updateById(w);

        BizWarningCurrentState st = currentStateMapper.selectOne(new LambdaQueryWrapper<BizWarningCurrentState>()
                .eq(BizWarningCurrentState::getStudentId, me.getId())
                .eq(BizWarningCurrentState::getMetric, w.getMetric())
                .eq(BizWarningCurrentState::getWindowType, w.getWindowType())
                .eq(BizWarningCurrentState::getPeriodStart, w.getPeriodStart())
                .eq(BizWarningCurrentState::getPeriodEnd, w.getPeriodEnd())
                .last("LIMIT 1"));
        if (st != null) {
            st.setStatus("acknowledged");
            st.setAcknowledgedAt(now);
            st.setAcknowledgedBy(me.getClientUserId());
            currentStateMapper.updateById(st);
        }
    }

    @Override
    public JSONObject leaveRequests(Map<String, String> query) {
        BizStudentProfile me = currentStudent();
        LambdaQueryWrapper<BizLeaveRequest> qw = new LambdaQueryWrapper<BizLeaveRequest>()
                .eq(BizLeaveRequest::getStudentId, me.getId())
                .orderByDesc(BizLeaveRequest::getCreateTime);
        if (query != null && StrUtil.isNotBlank(query.get("status"))) {
            qw.eq(BizLeaveRequest::getStatus, query.get("status"));
        }
        List<BizLeaveRequest> list = leaveRequestMapper.selectList(qw);
        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<JSONObject> dtos = list.stream().map(lr -> {
            JSONObject ext = StrUtil.isNotBlank(lr.getExtJson()) && JSONUtil.isTypeJSONObject(lr.getExtJson())
                    ? JSONUtil.parseObj(lr.getExtJson()) : new JSONObject();
            String fromStr = lr.getFromDate() != null ? dtFmt.format(lr.getFromDate()) : "";
            String toStr = lr.getToDate() != null ? dtFmt.format(lr.getToDate()) : "";
            JSONArray proofArr = StrUtil.isNotBlank(lr.getProofFileIdsJson()) && JSONUtil.isTypeJSONArray(lr.getProofFileIdsJson())
                    ? JSONUtil.parseArray(lr.getProofFileIdsJson()) : new JSONArray();
            return new JSONObject()
                    .set("id", lr.getId())
                    .set("student_id", lr.getStudentId())
                    .set("class_id", lr.getClassId())
                    .set("leave_type", ext.getStr("leave_type", "请假"))
                    .set("from_date", fromStr)
                    .set("start_date", fromStr)
                    .set("to_date", toStr)
                    .set("end_date", toStr)
                    .set("reason", lr.getReason())
                    .set("status", lr.getStatus())
                    .set("reject_reason", lr.getRejectReason())
                    .set("proof_file_id", lr.getProofFileId())
                    .set("proof_file_ids", proofArr)
                    .set("approved_at", lr.getApprovedAt() != null ? dtFmt.format(lr.getApprovedAt()) : "")
                    .set("created_at", lr.getCreateTime() != null ? dtFmt.format(lr.getCreateTime()) : "");
        }).toList();
        return new JSONObject().set("list", dtos).set("items", dtos).set("total", dtos.size());
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject createLeave(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String fromStr = str(body, "from_date", "fromDate", "start_date", "startDate");
        String toStr = str(body, "to_date", "toDate", "end_date", "endDate");
        String reason = str(body, "reason");
        if (StrUtil.hasBlank(fromStr, toStr, reason)) {
            throw new CommonException("请完整填写请假时间和原因");
        }
        Date fromDate = parseFlexibleDateTime(fromStr);
        Date toDate = parseFlexibleDateTime(toStr);
        if (toDate.before(fromDate)) {
            throw new CommonException("请假结束时间不能早于开始时间");
        }
        BizLeaveRequest req = new BizLeaveRequest();
        req.setStudentId(me.getId());
        req.setClassId(me.getClassId());
        req.setFromDate(fromDate);
        req.setToDate(toDate);
        req.setReason(reason);
        Object proofIds = body.get("proof_file_ids");
        if (proofIds != null) {
            req.setProofFileIdsJson(JSONUtil.toJsonStr(proofIds));
        }
        req.setProofFileId(str(body, "proof_file_id", "proofFileId"));
        req.setStatus("submitted");
        JSONObject ext = new JSONObject()
                .set("leave_type", StrUtil.blankToDefault(str(body, "leave_type", "leaveType"), "请假"));
        String approverId = str(body, "approver_user_id", "approverUserId");
        if (StrUtil.isNotBlank(approverId)) {
            ext.set("preferred_approver_id", approverId);
        }
        req.setExtJson(ext.toString());
        leaveRequestMapper.insert(req);
        return JSONUtil.parseObj(req);
    }

    @Override
    public JSONObject appeals(Map<String, String> query) {
        BizStudentProfile me = currentStudent();
        LambdaQueryWrapper<BizAppeal> qw = new LambdaQueryWrapper<BizAppeal>()
                .eq(BizAppeal::getStudentId, me.getId())
                .orderByDesc(BizAppeal::getCreateTime);
        if (query != null && StrUtil.isNotBlank(query.get("status"))) {
            qw.eq(BizAppeal::getStatus, query.get("status"));
        }
        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<JSONObject> dtos = appealMapper.selectList(qw).stream().map(a -> {
            JSONArray evArr = StrUtil.isNotBlank(a.getEvidenceFileIdsJson()) && JSONUtil.isTypeJSONArray(a.getEvidenceFileIdsJson())
                    ? JSONUtil.parseArray(a.getEvidenceFileIdsJson()) : new JSONArray();
            return new JSONObject()
                    .set("id", a.getId())
                    .set("student_id", a.getStudentId())
                    .set("appeal_type", a.getAppealType())
                    .set("related_type", a.getRelatedType())
                    .set("related_id", a.getRelatedId())
                    .set("warning_course", StrUtil.blankToDefault(a.getRelatedType(), ""))
                    .set("content", a.getContent())
                    .set("status", a.getStatus())
                    .set("result_note", a.getResultNote())
                    .set("evidence_file_id", a.getEvidenceFileId())
                    .set("evidence_file_ids", evArr)
                    .set("created_at", a.getCreateTime() != null ? dtFmt.format(a.getCreateTime()) : "")
                    .set("handled_at", a.getUpdateTime() != null ? dtFmt.format(a.getUpdateTime()) : "");
        }).toList();
        return new JSONObject().set("list", dtos).set("items", dtos).set("total", dtos.size());
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject createAppeal(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String appealType = StrUtil.blankToDefault(str(body, "appeal_type", "appealType"), "warning");
        String content = str(body, "content");
        if (StrUtil.isBlank(content)) {
            throw new CommonException("请填写申诉说明");
        }
        String warningId = str(body, "warning_id", "warningId", "related_id", "relatedId");
        String relatedType = str(body, "related_type", "relatedType");
        if (StrUtil.isBlank(relatedType) && StrUtil.isNotBlank(warningId)) {
            relatedType = "warning";
        }
        BizAppeal appeal = new BizAppeal();
        appeal.setStudentId(me.getId());
        appeal.setAppealType(appealType);
        appeal.setRelatedType(relatedType);
        appeal.setRelatedId(warningId);
        appeal.setContent(content);
        appeal.setEvidenceFileId(str(body, "evidence_file_id", "evidenceFileId"));
        if (body.get("evidence_file_ids") != null) {
            appeal.setEvidenceFileIdsJson(JSONUtil.toJsonStr(body.get("evidence_file_ids")));
        }
        appeal.setStatus("submitted");
        appealMapper.insert(appeal);
        return JSONUtil.parseObj(appeal);
    }

    @Override
    public List<JSONObject> classChangeRequests() {
        BizStudentProfile me = currentStudent();
        List<BizChangeRequest> list = changeRequestMapper.selectList(
                new LambdaQueryWrapper<BizChangeRequest>()
                        .eq(BizChangeRequest::getTargetId, me.getId())
                        .eq(BizChangeRequest::getTargetType, "student_profile_class_change")
                        .orderByDesc(BizChangeRequest::getCreateTime));
        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        return list.stream().map(r -> {
            JSONObject cj = StrUtil.isNotBlank(r.getChangeJson()) && JSONUtil.isTypeJSONObject(r.getChangeJson())
                    ? JSONUtil.parseObj(r.getChangeJson()) : new JSONObject();
            return new JSONObject()
                    .set("id", r.getId())
                    .set("target_type", r.getTargetType())
                    .set("target_id", r.getTargetId())
                    .set("target_class_id", cj.getStr("target_class_id"))
                    .set("target_class_name", cj.getStr("target_class_name"))
                    .set("reason", r.getReason())
                    .set("status", r.getStatus())
                    .set("reject_reason", r.getRejectReason())
                    .set("evidence_file_ids", cj.getJSONArray("evidence_file_ids"))
                    .set("created_at", r.getCreateTime() != null ? dtFmt.format(r.getCreateTime()) : "");
        }).toList();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject createClassChange(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        String targetClassId = str(body, "target_class_id", "targetClassId");
        String reason = str(body, "reason");
        if (StrUtil.hasBlank(targetClassId, reason)) {
            throw new CommonException("请选择目标班级并填写申请原因");
        }
        BizClass targetCls = bizClassService.queryEntity(targetClassId);
        JSONObject cj = new JSONObject()
                .set("request_type", "student_class_change")
                .set("student_no", me.getStudentNo())
                .set("student_name", me.getName())
                .set("current_class_id", me.getClassId())
                .set("current_org_id", me.getOrgId())
                .set("target_class_id", targetCls.getId())
                .set("target_class_name", targetCls.getClassName())
                .set("target_org_id", targetCls.getOrgId())
                .set("target_major", targetCls.getMajor())
                .set("target_major_id", targetCls.getMajorId());

        BizChangeRequest req = new BizChangeRequest();
        req.setRequesterUserId(me.getClientUserId());
        req.setTargetType("student_profile_class_change");
        req.setTargetId(me.getId());
        req.setChangeJson(cj.toString());
        req.setReason(reason);
        req.setStatus("pending_head");
        changeRequestMapper.insert(req);
        return JSONUtil.parseObj(req);
    }

    @Override
    public JSONObject inbox(Map<String, String> query) {
        BizStudentProfile me = currentStudent();
        List<Map<String, Object>> devMsgs = jdbcTemplate.queryForList(
                "SELECT m.ID, m.SUBJECT, m.CONTENT, m.CATEGORY, m.CREATE_TIME, r.ID AS REL_ID, r.EXT_JSON " +
                        "FROM DEV_MESSAGE m INNER JOIN DEV_RELATION r ON m.ID = r.OBJECT_ID " +
                        "WHERE r.CATEGORY = 'MSG_TO_USER' AND r.TARGET_ID = ? AND m.DELETE_FLAG = 'NOT_DELETE' " +
                        "ORDER BY m.CREATE_TIME DESC LIMIT 200",
                me.getClientUserId());

        List<BizClassNotification> classNotices = StrUtil.isBlank(me.getClassId()) ? Collections.emptyList()
                : classNotificationMapper.selectList(new LambdaQueryWrapper<BizClassNotification>()
                        .eq(BizClassNotification::getClassId, me.getClassId())
                        .orderByDesc(BizClassNotification::getCreateTime).last("LIMIT 100"));
        Set<String> readNoticeIds = new HashSet<>(jdbcTemplate.queryForList(
                "SELECT NOTIFICATION_ID FROM BIZ_STUDENT_NOTIFICATION_READ WHERE STUDENT_ID = ? AND DELETE_FLAG = 'NOT_DELETE'",
                String.class, me.getId()));

        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        List<JSONObject> allItems = new ArrayList<>();
        for (Map<String, Object> m : devMsgs) {
            String ext = m.get("EXT_JSON") != null ? String.valueOf(m.get("EXT_JSON")) : "{}";
            boolean read = JSONUtil.isTypeJSONObject(ext) && JSONUtil.parseObj(ext).getBool("read", false);
            String subj = m.get("SUBJECT") != null ? String.valueOf(m.get("SUBJECT")) : "系统通知";
            String msgType = subj.contains("预警") ? "warning_orange" : "system";
            String typeLabel = subj.contains("预警") ? "预警提醒" : "站内通知";
            String createdAt = m.get("CREATE_TIME") instanceof Date d ? dtFmt.format(d) : String.valueOf(m.get("CREATE_TIME"));
            allItems.add(new JSONObject()
                    .set("id", String.valueOf(m.get("ID")))
                    .set("type", msgType)
                    .set("type_label", typeLabel)
                    .set("title", subj)
                    .set("content", m.get("CONTENT"))
                    .set("is_read", read)
                    .set("created_at", createdAt));
        }
        for (BizClassNotification cn : classNotices) {
            allItems.add(new JSONObject()
                    .set("id", "notice:" + cn.getId())
                    .set("type", "class_notice")
                    .set("type_label", "班级公告")
                    .set("title", cn.getTitle())
                    .set("content", cn.getContent())
                    .set("publisher_name", cn.getPublisherName())
                    .set("is_read", readNoticeIds.contains(cn.getId()))
                    .set("created_at", cn.getCreateTime() != null ? dtFmt.format(cn.getCreateTime()) : ""));
        }

        allItems.sort((a, b) -> String.valueOf(b.getStr("created_at", "")).compareTo(String.valueOf(a.getStr("created_at", ""))));
        long unreadCount = allItems.stream().filter(it -> !it.getBool("is_read", false)).count();

        String statusFilter = query != null ? StrUtil.trim(query.get("status")) : null;
        List<JSONObject> filtered = allItems;
        if ("unread".equalsIgnoreCase(statusFilter)) {
            filtered = allItems.stream().filter(it -> !it.getBool("is_read", false)).toList();
        } else if ("read".equalsIgnoreCase(statusFilter)) {
            filtered = allItems.stream().filter(it -> it.getBool("is_read", false)).toList();
        }

        int page = 1;
        int pageSize = 50;
        if (query != null) {
            try {
                if (StrUtil.isNotBlank(query.get("page"))) page = Math.max(1, Integer.parseInt(query.get("page")));
                if (StrUtil.isNotBlank(query.get("pageSize"))) pageSize = Math.min(200, Math.max(1, Integer.parseInt(query.get("pageSize"))));
            } catch (NumberFormatException ignored) {
            }
        }
        int fromIdx = Math.min((page - 1) * pageSize, filtered.size());
        int toIdx = Math.min(fromIdx + pageSize, filtered.size());
        List<JSONObject> paged = filtered.subList(fromIdx, toIdx);

        return new JSONObject()
                .set("list", paged)
                .set("items", paged)
                .set("total", filtered.size())
                .set("unread", unreadCount)
                .set("unread_count", unreadCount);
    }

    @Override
    public JSONObject inboxUnreadCount() {
        JSONObject box = inbox(Collections.emptyMap());
        long unread = box.getLong("unread", 0L);
        return new JSONObject().set("unread_count", unread).set("unread", unread);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void readInbox(String id) {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isBlank(id)) return;
        if (id.startsWith("notice:")) {
            String noticeId = id.substring("notice:".length());
            Integer cnt = jdbcTemplate.queryForObject(
                    "SELECT COUNT(1) FROM BIZ_STUDENT_NOTIFICATION_READ WHERE STUDENT_ID = ? AND NOTIFICATION_ID = ?",
                    Integer.class, me.getId(), noticeId);
            if (cnt == null || cnt == 0) {
                jdbcTemplate.update(
                        "INSERT INTO BIZ_STUDENT_NOTIFICATION_READ (ID, STUDENT_ID, NOTIFICATION_ID, READ_AT, DELETE_FLAG, CREATE_TIME) " +
                                "VALUES (?, ?, ?, NOW(), 'NOT_DELETE', NOW())",
                        IdUtil.getSnowflakeNextIdStr(), me.getId(), noticeId);
            }
        } else {
            jdbcTemplate.update(
                    "UPDATE DEV_RELATION SET EXT_JSON = '{\"read\":true}' WHERE CATEGORY = 'MSG_TO_USER' AND OBJECT_ID = ? AND TARGET_ID = ?",
                    id, me.getClientUserId());
        }
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void readAllInbox() {
        BizStudentProfile me = currentStudent();
        jdbcTemplate.update(
                "UPDATE DEV_RELATION SET EXT_JSON = '{\"read\":true}' WHERE CATEGORY = 'MSG_TO_USER' AND TARGET_ID = ?",
                me.getClientUserId());
        if (StrUtil.isNotBlank(me.getClassId())) {
            List<BizClassNotification> notices = classNotificationMapper.selectList(
                    new LambdaQueryWrapper<BizClassNotification>().eq(BizClassNotification::getClassId, me.getClassId()));
            for (BizClassNotification cn : notices) {
                readInbox("notice:" + cn.getId());
            }
        }
    }

    @Override
    public JSONObject getPreferences() {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isNotBlank(me.getNotifyPrefsJson()) && JSONUtil.isTypeJSONObject(me.getNotifyPrefsJson())) {
            return JSONUtil.parseObj(me.getNotifyPrefsJson());
        }
        return new JSONObject()
                .set("inbox", true)
                .set("wechat", true)
                .set("email", true)
                .set("quiet_enabled", false)
                .set("quiet_start", "22:00")
                .set("quiet_end", "07:00");
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject updatePreferences(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        JSONObject prefs = new JSONObject(body);
        me.setNotifyPrefsJson(prefs.toString());
        bizStudentProfileService.updateById(me);
        return prefs;
    }

    @Override
    public List<JSONObject> activeSessions() {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isBlank(me.getClassId())) {
            return Collections.emptyList();
        }
        Date now = new Date();
        List<BizClassSession> active = classSessionMapper.selectList(
                new LambdaQueryWrapper<BizClassSession>()
                        .eq(BizClassSession::getClassId, me.getClassId())
                        .eq(BizClassSession::getStatus, "active")
                        .orderByDesc(BizClassSession::getSessionStart)
                        .last("LIMIT 20"));
        if (active.isEmpty()) {
            return Collections.emptyList();
        }
        Map<String, String> courseMap = bizCourseService.list().stream()
                .collect(Collectors.toMap(BizCourse::getId, BizCourse::getCourseName, (a, b) -> a));
        BizClass cls = bizClassService.getById(me.getClassId());
        String className = cls != null ? cls.getClassName() : "";
        SimpleDateFormat dtFmt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

        List<String> sessionIds = CollStreamUtil.toList(active, BizClassSession::getId);
        Map<String, BizAttendanceRecord> myRecMap = attendanceRecordMapper.selectList(
                        new LambdaQueryWrapper<BizAttendanceRecord>()
                                .eq(BizAttendanceRecord::getStudentId, me.getId())
                                .in(BizAttendanceRecord::getSessionId, sessionIds))
                .stream().collect(Collectors.toMap(BizAttendanceRecord::getSessionId, r -> r, (a, b) -> a));

        List<JSONObject> res = new ArrayList<>();
        for (BizClassSession s : active) {
            Date deadline = s.getSessionEnd() != null ? s.getSessionEnd() : s.getQrExpireAt();
            if (deadline != null && now.after(deadline)) {
                continue;
            }
            JSONObject ext = StrUtil.isNotBlank(s.getExtJson()) && JSONUtil.isTypeJSONObject(s.getExtJson())
                    ? JSONUtil.parseObj(s.getExtJson()) : new JSONObject();
            JSONArray modes = ext.containsKey("checkinModes") && ext.getJSONArray("checkinModes") != null
                    && !ext.getJSONArray("checkinModes").isEmpty()
                    ? ext.getJSONArray("checkinModes") : new JSONArray(List.of("qr"));
            BizUser teacher = StrUtil.isNotBlank(s.getTeacherUserId()) ? bizUserService.getById(s.getTeacherUserId()) : null;
            BizAttendanceRecord myRec = myRecMap.get(s.getId());
            boolean checkedIn = myRec != null && ("on_time".equals(myRec.getAttendanceStatus()) || "late".equals(myRec.getAttendanceStatus()));
            JSONObject recExt = myRec != null && StrUtil.isNotBlank(myRec.getExtJson()) && JSONUtil.isTypeJSONObject(myRec.getExtJson())
                    ? JSONUtil.parseObj(myRec.getExtJson()) : new JSONObject();

            res.add(new JSONObject()
                    .set("session_id", s.getId())
                    .set("course_id", s.getCourseId())
                    .set("course_name", courseMap.getOrDefault(s.getCourseId(), "课堂签到"))
                    .set("class_name", className)
                    .set("teacher_name", teacher != null ? teacher.getName() : "任课教师")
                    .set("session_start", s.getSessionStart() != null ? dtFmt.format(s.getSessionStart()) : "")
                    .set("session_end", deadline != null ? dtFmt.format(deadline) : "")
                    .set("checkin_modes", modes)
                    .set("qr_refresh_seconds", ext.getInt("qrRefreshSeconds", 30))
                    .set("location_name", ext.getStr("locationName", "授课教室"))
                    .set("location_radius_meters", ext.getInt("locationRadiusMeters", 150))
                    .set("photo_tip", ext.getStr("photoTip", "请拍摄本人课堂现场照片"))
                    .set("already_checked_in", checkedIn)
                    .set("my_status", myRec != null ? myRec.getAttendanceStatus() : null)
                    .set("my_checkin_mode", recExt.getStr("checkinMode")));
        }
        return res;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public JSONObject checkin(Map<String, Object> body) {
        BizStudentProfile me = currentStudent();
        return bizClassSessionService.studentCheckin(me.getId(), body);
    }

    @Override
    public JSONObject uploadFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传图片文件");
        }
        if (file.getSize() > 10L * 1024 * 1024) {
            throw new CommonException("图片大小不能超过 10MB");
        }
        String origName = StrUtil.blankToDefault(file.getOriginalFilename(), "image.png");
        String ext = FileUtil.extName(origName).toLowerCase(Locale.ROOT);
        if (!ALLOWED_IMAGE_EXT.contains(ext)) {
            throw new CommonException("仅支持 jpg/jpeg/png/gif/webp/bmp 图片格式");
        }
        try {
            byte[] bytes = file.getBytes();
            if (!isValidImageMagic(bytes)) {
                throw new CommonException("文件内容不是合法图片格式");
            }
            String engine = "MINIO";
            try {
                String cfg = devConfigApi.getValueByKey("SNOWY_SYS_DEFAULT_FILE_ENGINE");
                if (StrUtil.isNotBlank(cfg)) engine = StrUtil.trim(cfg);
            } catch (Exception ignored) {
            }
            String fileId;
            try {
                fileId = devFileApi.storageStreamReturnId(engine, new java.io.ByteArrayInputStream(bytes), origName, (long) bytes.length);
            } catch (Exception storageEx) {
                if (!"LOCAL".equalsIgnoreCase(engine)) {
                    fileId = devFileApi.storageStreamReturnId("LOCAL", new java.io.ByteArrayInputStream(bytes), origName, (long) bytes.length);
                } else {
                    throw storageEx;
                }
            }
            return new JSONObject()
                    .set("id", fileId)
                    .set("file_id", fileId)
                    .set("name", origName)
                    .set("url", "/client/c/warnsys/file/download?id=" + fileId);
        } catch (CommonException ce) {
            throw ce;
        } catch (Exception e) {
            throw new CommonException("上传图片失败：{}", e.getMessage());
        }
    }

    private boolean isValidImageMagic(byte[] b) {
        if (b == null || b.length < 4) return false;
        // JPEG: FF D8 FF
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return true;
        // PNG: 89 50 4E 47
        if ((b[0] & 0xFF) == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return true;
        // GIF: 47 49 46 38
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x38) return true;
        // BMP: 42 4D
        if (b[0] == 0x42 && b[1] == 0x4D) return true;
        // WEBP: RIFF....WEBP
        return b.length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46
                && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50;
    }

    @Override
    public void downloadFile(String id, HttpServletResponse response) {
        BizStudentProfile me = currentStudent();
        if (StrUtil.isBlank(id)) {
            throw new CommonException("缺少文件id");
        }
        // 校验学生权属（本人提交的请假/申诉凭证、证件照或本人上传的底座文件）
        boolean ownsPhoto = Objects.equals(id, me.getPhotoFileId());
        long leaveOwned = leaveRequestMapper.selectCount(new LambdaQueryWrapper<BizLeaveRequest>()
                .eq(BizLeaveRequest::getStudentId, me.getId())
                .and(w -> w.eq(BizLeaveRequest::getProofFileId, id).or().like(BizLeaveRequest::getProofFileIdsJson, id)));
        long appealOwned = appealMapper.selectCount(new LambdaQueryWrapper<BizAppeal>()
                .eq(BizAppeal::getStudentId, me.getId())
                .and(w -> w.eq(BizAppeal::getEvidenceFileId, id).or().like(BizAppeal::getEvidenceFileIdsJson, id)));
        Integer uploadedByMe = jdbcTemplate.queryForObject(
                "SELECT COUNT(1) FROM DEV_FILE WHERE ID = ? AND CREATE_USER = ? AND DELETE_FLAG = 'NOT_DELETE'",
                Integer.class, id, me.getClientUserId());

        if (!ownsPhoto && leaveOwned == 0 && appealOwned == 0 && (uploadedByMe == null || uploadedByMe == 0)) {
            throw new CommonException("越权访问拒绝：无权下载他人附件");
        }

        JSONObject fi = devFileApi.getFileInfoById(id);
        if (fi == null || StrUtil.isBlank(fi.getStr("id"))) {
            throw new CommonException("文件不存在或已被清理");
        }
        byte[] bytes;
        if ("LOCAL".equalsIgnoreCase(fi.getStr("engine")) && StrUtil.isNotBlank(fi.getStr("storagePath"))) {
            java.io.File f = FileUtil.file(fi.getStr("storagePath"));
            if (!FileUtil.isFile(f)) {
                throw new CommonException("本地文件不存在");
            }
            bytes = FileUtil.readBytes(f);
        } else {
            String key = StrUtil.blankToDefault(fi.getStr("fileKey"), fi.getStr("objName"));
            bytes = devFileApi.getFileBytes(fi.getStr("engine"), fi.getStr("bucket"), key);
        }
        CommonDownloadUtil.download(StrUtil.blankToDefault(fi.getStr("name"), id + ".png"), bytes, response);
    }

    private BizStudentProfile currentStudent() {
        String clientUserId = StpClientUtil.getLoginIdAsString();
        BizStudentProfile stu = bizStudentProfileService.getOne(
                new LambdaQueryWrapper<BizStudentProfile>()
                        .eq(BizStudentProfile::getClientUserId, clientUserId)
                        .last("LIMIT 1"));
        if (stu == null) {
            throw new CommonException("未找到当前登录学生档案");
        }
        return stu;
    }

    private JSONObject buildStudentDto(BizStudentProfile stu) {
        BizClass cls = StrUtil.isNotBlank(stu.getClassId()) ? bizClassService.getById(stu.getClassId()) : null;
        BizOrg org = StrUtil.isNotBlank(stu.getOrgId()) ? bizOrgService.getById(stu.getOrgId()) : null;
        BizUser ht = (cls != null && StrUtil.isNotBlank(cls.getCounselorUserId())) ? bizUserService.getById(cls.getCounselorUserId()) : null;
        return new JSONObject()
                .set("id", stu.getId())
                .set("client_user_id", stu.getClientUserId())
                .set("student_no", stu.getStudentNo())
                .set("name", stu.getName())
                .set("gender", stu.getGender())
                .set("photo_file_id", stu.getPhotoFileId())
                .set("student_position", stu.getStudentPosition())
                .set("class_id", stu.getClassId())
                .set("class_name", cls != null ? cls.getClassName() : null)
                .set("head_teacher_user_id", cls != null ? cls.getCounselorUserId() : null)
                .set("head_teacher_name", ht != null ? ht.getName() : null)
                .set("org_id", stu.getOrgId())
                .set("org_name", org != null ? org.getName() : null)
                .set("major", stu.getMajor())
                .set("enroll_year", stu.getEnrollYear())
                .set("mobile", stu.getMobile())
                .set("email", stu.getEmail())
                .set("emergency_contact_name", stu.getEmergencyContactName())
                .set("emergency_contact_mobile", stu.getEmergencyContactMobile())
                .set("status", stu.getStatus())
                .set("is_bound", StrUtil.isNotBlank(stu.getClassId()))
                .set("wechat_bound", StrUtil.isNotBlank(stu.getWxOpenid()));
    }

    private String decryptSm2Strict(String cipherText) {
        if (StrUtil.isBlank(cipherText) || cipherText.length() < 64) {
            throw new CommonException("密码传输须采用国密 SM2 密文格式");
        }
        try {
            String plain = CommonCryptogramUtil.doSm2Decrypt(cipherText);
            if (StrUtil.isBlank(plain)) {
                throw new CommonException("密码传输须采用国密 SM2 密文格式");
            }
            return plain;
        } catch (Exception e) {
            throw new CommonException("密码传输须采用国密 SM2 密文格式");
        }
    }

    private String resolveOpenIdFromWxCode(String wxCode) {
        // 本地/测试环境兼容 mock code 或直传 openid，正式环境可扩展调用微信 code2Session 接口
        return "wx_openid_" + CommonCryptogramUtil.doHashValue(wxCode).substring(0, 24);
    }

    private void bindWxCodeInternal(BizStudentProfile stu, String wxCode) {
        String openid = resolveOpenIdFromWxCode(wxCode);
        stu.setWxOpenid(openid);
        bizStudentProfileService.updateById(stu);
        Integer exists = jdbcTemplate.queryForObject(
                "SELECT COUNT(1) FROM AUTH_THIRD_USER WHERE THIRD_ID = ? AND CATEGORY = 'WECHAT_MINI' AND DELETE_FLAG = 'NOT_DELETE'",
                Integer.class, openid);
        if (exists == null || exists == 0) {
            jdbcTemplate.update(
                    "INSERT INTO AUTH_THIRD_USER (ID, THIRD_ID, USER_ID, NAME, NICKNAME, CATEGORY, DELETE_FLAG, CREATE_TIME) " +
                            "VALUES (?, ?, ?, ?, ?, 'WECHAT_MINI', 'NOT_DELETE', NOW())",
                    IdUtil.getSnowflakeNextIdStr(), openid, stu.getClientUserId(), stu.getName(), stu.getName());
        }
    }

    private String maskTarget(String raw) {
        if (StrUtil.isBlank(raw)) return "";
        if (raw.contains("@")) {
            int idx = raw.indexOf('@');
            return (idx > 2 ? raw.substring(0, 2) + "***" : "***") + raw.substring(idx);
        }
        if (raw.length() >= 7) {
            return raw.substring(0, 3) + "****" + raw.substring(raw.length() - 4);
        }
        return raw;
    }

    private Date parseFlexibleDateTime(String s) {
        String t = StrUtil.trim(s);
        try {
            if (t.length() == 10) {
                return java.sql.Timestamp.valueOf(t + " 00:00:00");
            }
            if (t.length() == 16) {
                return java.sql.Timestamp.valueOf(t.replace("T", " ") + ":00");
            }
            return java.sql.Timestamp.valueOf(t.replace("T", " ").substring(0, 19));
        } catch (Exception e) {
            return new Date();
        }
    }

    private String str(Map<String, Object> body, String... keys) {
        if (body == null) return null;
        for (String k : keys) {
            Object v = body.get(k);
            if (v != null && StrUtil.isNotBlank(String.valueOf(v))) {
                return StrUtil.trim(String.valueOf(v));
            }
        }
        return null;
    }
}
