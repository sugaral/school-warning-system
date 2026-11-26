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
package vip.xiaonuo.biz.modular.student.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.PhoneUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.write.style.column.LongestMatchColumnWidthStyleStrategy;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.org.entity.BizOrg;
import vip.xiaonuo.biz.modular.org.param.BizOrgSelectorTreeParam;
import vip.xiaonuo.biz.modular.org.service.BizOrgService;
import vip.xiaonuo.biz.modular.student.entity.BizStudentProfile;
import vip.xiaonuo.biz.modular.student.mapper.BizStudentProfileMapper;
import vip.xiaonuo.biz.modular.student.param.*;
import vip.xiaonuo.biz.modular.student.result.BizStudentAccountExportResult;
import vip.xiaonuo.biz.modular.student.service.BizStudentProfileService;
import vip.xiaonuo.client.ClientUserApi;
import vip.xiaonuo.common.enums.CommonSortOrderEnum;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.common.util.CommonCryptogramUtil;
import vip.xiaonuo.common.util.CommonDownloadUtil;
import vip.xiaonuo.common.util.CommonResponseUtil;

import java.io.File;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 学生档案Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Slf4j
@Service
public class BizStudentProfileServiceImpl extends ServiceImpl<BizStudentProfileMapper, BizStudentProfile> implements BizStudentProfileService {

    private static final String PWD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    @Resource
    private BizClassService bizClassService;

    @Resource
    private BizOrgService bizOrgService;

    @Resource
    private ClientUserApi clientUserApi;

    @Override
    public Page<BizStudentProfile> page(BizStudentPageParam param) {
        QueryWrapper<BizStudentProfile> queryWrapper = new QueryWrapper<BizStudentProfile>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizStudentProfile::getOrgId)) {
            return new Page<>();
        }
        if (ObjectUtil.isNotEmpty(param.getOrgId())) {
            queryWrapper.lambda().eq(BizStudentProfile::getOrgId, param.getOrgId());
        }
        if (ObjectUtil.isNotEmpty(param.getClassId())) {
            queryWrapper.lambda().eq(BizStudentProfile::getClassId, param.getClassId());
        }
        if (ObjectUtil.isNotEmpty(param.getStatus())) {
            queryWrapper.lambda().eq(BizStudentProfile::getStatus, param.getStatus());
        }
        if (ObjectUtil.isNotEmpty(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizStudentProfile::getStudentNo, param.getSearchKey())
                    .or().like(BizStudentProfile::getName, param.getSearchKey()));
        }
        if (ObjectUtil.isAllNotEmpty(param.getSortField(), param.getSortOrder())) {
            CommonSortOrderEnum.validate(param.getSortOrder());
            queryWrapper.orderBy(true, param.getSortOrder().equals(CommonSortOrderEnum.ASC.getValue()),
                    StrUtil.toUnderlineCase(param.getSortField()));
        } else {
            queryWrapper.lambda().orderByDesc(BizStudentProfile::getCreateTime);
        }
        Page<BizStudentProfile> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        for (BizStudentProfile item : page.getRecords()) {
            item.setWechatBound(StrUtil.isNotBlank(item.getWxOpenid()));
        }
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject add(BizStudentAddParam param) {
        String studentNo = StrUtil.trim(param.getStudentNo());
        String name = StrUtil.trim(param.getName());
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "新增学生");

        validateStudentUniqueness(studentNo, param.getMobile(), null);

        String rawPwd = resolveInputPasswordOrGenerate(param.getPassword());
        String clientUserId = clientUserApi.createStudentClientUser(
                studentNo, name, StrUtil.trimToNull(param.getMobile()),
                StrUtil.trimToNull(param.getEmail()), param.getGender(), rawPwd);

        BizStudentProfile profile = BeanUtil.toBean(param, BizStudentProfile.class);
        profile.setClientUserId(clientUserId);
        profile.setStudentNo(studentNo);
        profile.setName(name);
        profile.setMobile(StrUtil.trimToNull(param.getMobile()));
        profile.setEmail(StrUtil.trimToNull(param.getEmail()));
        profile.setEmergencyContactMobile(StrUtil.trimToNull(param.getEmergencyContactMobile()));
        profile.setOrgId(cls.getOrgId());
        profile.setMajorId(cls.getMajorId());
        profile.setMajor(cls.getMajor());
        profile.setEnrollYear(cls.getEnrollYear());
        profile.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        profile.setInitialPassword(rawPwd);
        this.save(profile);

        return JSONUtil.createObj()
                .set("id", profile.getId())
                .set("studentNo", profile.getStudentNo())
                .set("initialPassword", rawPwd);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizStudentEditParam param) {
        BizStudentProfile existing = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(existing.getOrgId(), "编辑学生");

        BizClass targetClass = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(targetClass.getOrgId(), "转入班级所属学院");

        String studentNo = StrUtil.trim(param.getStudentNo());
        validateStudentUniqueness(studentNo, param.getMobile(), existing.getId());

        BeanUtil.copyProperties(param, existing);
        existing.setStudentNo(studentNo);
        existing.setName(StrUtil.trim(param.getName()));
        existing.setMobile(StrUtil.trimToNull(param.getMobile()));
        existing.setEmail(StrUtil.trimToNull(param.getEmail()));
        existing.setEmergencyContactMobile(StrUtil.trimToNull(param.getEmergencyContactMobile()));
        existing.setOrgId(targetClass.getOrgId());
        existing.setMajorId(targetClass.getMajorId());
        existing.setMajor(targetClass.getMajor());
        existing.setEnrollYear(targetClass.getEnrollYear());
        existing.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.updateById(existing);

        clientUserApi.updateStudentClientUser(
                existing.getClientUserId(),
                existing.getStudentNo(),
                existing.getName(),
                existing.getMobile(),
                existing.getEmail(),
                existing.getGender(),
                existing.getStatus());
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizStudentIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizStudentIdParam::getId);
        List<BizStudentProfile> profiles = this.listByIds(ids);
        List<String> clientUserIds = new ArrayList<>();
        for (BizStudentProfile profile : profiles) {
            BizScopeUtil.assertOrgInScope(profile.getOrgId(), "删除学生");
            cleanStudentChildRecords(profile.getId());
            if (StrUtil.isNotBlank(profile.getClientUserId())) {
                clientUserIds.add(profile.getClientUserId());
            }
        }
        this.removeByIds(ids);
        clientUserApi.deleteStudentClientUsers(clientUserIds);
    }

    @Override
    public BizStudentProfile detail(BizStudentIdParam idParam) {
        BizStudentProfile entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看学生档案");
        entity.setWechatBound(StrUtil.isNotBlank(entity.getWxOpenid()));
        return entity;
    }

    @Override
    public BizStudentProfile queryEntity(String id) {
        BizStudentProfile entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("学生档案不存在，id={}", id);
        }
        return entity;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject resetPassword(BizStudentResetPasswordParam param) {
        BizStudentProfile profile = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(profile.getOrgId(), "重置学生密码");
        String newPwd = resolveInputPasswordOrGenerate(param.getPassword());
        profile.setInitialPassword(newPwd);
        this.updateById(profile);
        clientUserApi.resetStudentPassword(profile.getClientUserId(), newPwd);
        return JSONUtil.createObj()
                .set("studentNo", profile.getStudentNo())
                .set("name", profile.getName())
                .set("initialPassword", newPwd);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void unbindWechat(BizStudentIdParam idParam) {
        BizStudentProfile profile = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(profile.getOrgId(), "解绑学生微信");
        profile.setWxOpenid(null);
        profile.setWxUnionid(null);
        this.updateById(profile);
        clientUserApi.unbindStudentWechat(profile.getClientUserId());
    }

    @Override
    public void exportAccounts(BizStudentPageParam param, HttpServletResponse response) {
        File tempFile = null;
        try {
            LambdaQueryWrapper<BizStudentProfile> wrapper = new LambdaQueryWrapper<>();
            if (!BizScopeUtil.applyOrgScope(wrapper, BizStudentProfile::getOrgId)) {
                CommonResponseUtil.renderError(response, "无权导出学生账号");
                return;
            }
            if (ObjectUtil.isNotEmpty(param.getOrgId())) {
                wrapper.eq(BizStudentProfile::getOrgId, param.getOrgId());
            }
            if (ObjectUtil.isNotEmpty(param.getClassId())) {
                wrapper.eq(BizStudentProfile::getClassId, param.getClassId());
            }
            wrapper.orderByAsc(BizStudentProfile::getOrgId, BizStudentProfile::getClassId, BizStudentProfile::getStudentNo);
            List<BizStudentProfile> list = this.list(wrapper);

            Map<String, String> orgNameMap = bizOrgService.list().stream()
                    .collect(Collectors.toMap(BizOrg::getId, BizOrg::getName, (a, b) -> a));
            Map<String, String> classNameMap = bizClassService.list().stream()
                    .collect(Collectors.toMap(BizClass::getId, BizClass::getClassName, (a, b) -> a));

            List<BizStudentAccountExportResult> rows = new ArrayList<>(list.size());
            for (BizStudentProfile s : list) {
                BizStudentAccountExportResult r = new BizStudentAccountExportResult();
                r.setOrgName(orgNameMap.getOrDefault(s.getOrgId(), ""));
                r.setClassName(classNameMap.getOrDefault(s.getClassId(), ""));
                r.setStudentNo(s.getStudentNo());
                r.setName(s.getName());
                r.setAccount(s.getStudentNo());
                r.setInitialPassword(StrUtil.blankToDefault(s.getInitialPassword(), ""));
                r.setPasswordStatus(StrUtil.isNotBlank(s.getInitialPassword())
                        ? "可直接发放初始密码" : "密码已修改或未设置，请重置后发放");
                rows.add(r);
            }

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "student_accounts_export.xlsx");
            EasyExcel.write(tempFile, BizStudentAccountExportResult.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("学生账号信息")
                    .doWrite(rows);
            CommonDownloadUtil.download("学生账号与初始密码.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 导出学生账号失败", e);
            try {
                CommonResponseUtil.renderError(response, "导出学生账号失败");
            } catch (Exception ignored) {
            }
        } finally {
            FileUtil.del(tempFile);
        }
    }

    @Override
    public void downloadImportTemplate(HttpServletResponse response) {
        File tempFile = null;
        try {
            BizStudentImportRow sample = new BizStudentImportRow();
            sample.setStudentNo("202600100101");
            sample.setName("张三");
            sample.setGender("男");
            sample.setClassName("2025级软件工程一班");
            sample.setMobile("13800138000");
            sample.setEmail("student@example.edu.cn");
            sample.setEmergencyContactName("张父");
            sample.setEmergencyContactMobile("13900139000");

            tempFile = FileUtil.file(FileUtil.getTmpDir() + FileUtil.FILE_SEPARATOR + "student_import_template.xlsx");
            EasyExcel.write(tempFile, BizStudentImportRow.class)
                    .registerWriteHandler(new LongestMatchColumnWidthStyleStrategy())
                    .sheet("学生导入模板")
                    .doWrite(Collections.singletonList(sample));
            CommonDownloadUtil.download("学生批量导入模板.xlsx", FileUtil.readBytes(tempFile), response);
        } catch (Exception e) {
            log.error(">>> 生成学生导入模板失败", e);
            try {
                CommonResponseUtil.renderError(response, "生成导入模板失败");
            } catch (Exception ignored) {
            }
        } finally {
            FileUtil.del(tempFile);
        }
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public JSONObject importStudents(MultipartFile file, boolean dryRun) {
        if (file == null || file.isEmpty()) {
            throw new CommonException("请上传Excel文件");
        }
        List<BizStudentImportRow> rows;
        try {
            rows = EasyExcel.read(file.getInputStream(), BizStudentImportRow.class, null).sheet().doReadSync();
        } catch (Exception e) {
            throw new CommonException("解析Excel失败：{}", e.getMessage());
        }

        List<BizClass> accessibleClasses = bizClassService.listAll(null);
        Map<String, BizClass> classByName = accessibleClasses.stream()
                .collect(Collectors.toMap(BizClass::getClassName, c -> c, (a, b) -> a));
        Set<String> existingStudentNos = this.list(new LambdaQueryWrapper<BizStudentProfile>()
                        .select(BizStudentProfile::getStudentNo))
                .stream().map(BizStudentProfile::getStudentNo).collect(Collectors.toSet());

        int success = 0;
        int failed = 0;
        JSONArray errors = JSONUtil.createArray();
        JSONArray generatedAccounts = JSONUtil.createArray();
        Set<String> batchStudentNos = new HashSet<>();

        for (int i = 0; i < rows.size(); i++) {
            int rowNum = i + 2;
            BizStudentImportRow row = rows.get(i);
            String studentNo = StrUtil.trim(row.getStudentNo());
            String name = StrUtil.trim(row.getName());
            String className = StrUtil.trim(row.getClassName());
            String mobile = StrUtil.trimToNull(row.getMobile());

            if (StrUtil.hasBlank(studentNo, name, className)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学号、姓名、班级均为必填"));
                continue;
            }
            if (existingStudentNos.contains(studentNo) || !batchStudentNos.add(studentNo)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "学号已存在或文件内重复：" + studentNo));
                continue;
            }
            BizClass targetClass = classByName.get(className);
            if (targetClass == null) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "无权访问或不存在的班级：" + className));
                continue;
            }
            if (mobile != null && !PhoneUtil.isMobile(mobile)) {
                failed++;
                errors.add(JSONUtil.createObj().set("row", rowNum).set("message", "手机号格式错误：" + mobile));
                continue;
            }
            if (!dryRun) {
                BizStudentAddParam addParam = new BizStudentAddParam();
                addParam.setStudentNo(studentNo);
                addParam.setName(name);
                addParam.setGender(StrUtil.trimToNull(row.getGender()));
                addParam.setClassId(targetClass.getId());
                addParam.setMobile(mobile);
                addParam.setEmail(StrUtil.trimToNull(row.getEmail()));
                addParam.setEmergencyContactName(StrUtil.trimToNull(row.getEmergencyContactName()));
                addParam.setEmergencyContactMobile(StrUtil.trimToNull(row.getEmergencyContactMobile()));
                generatedAccounts.add(this.add(addParam));
            }
            success++;
        }

        return JSONUtil.createObj()
                .set("dryRun", dryRun)
                .set("total", rows.size())
                .set("success", success)
                .set("failed", failed)
                .set("errors", errors)
                .set("generatedAccounts", generatedAccounts);
    }

    @Override
    public List<JSONObject> orgTreeSelector(BizOrgSelectorTreeParam param) {
        return bizOrgService.orgTreeSelector(param);
    }

    private void validateStudentUniqueness(String studentNo, String mobile, String excludeId) {
        LambdaQueryWrapper<BizStudentProfile> noWrapper = new LambdaQueryWrapper<BizStudentProfile>()
                .eq(BizStudentProfile::getStudentNo, studentNo);
        if (StrUtil.isNotBlank(excludeId)) {
            noWrapper.ne(BizStudentProfile::getId, excludeId);
        }
        if (this.count(noWrapper) > 0) {
            throw new CommonException("学号已存在：{}", studentNo);
        }

        String trimmedMobile = StrUtil.trimToNull(mobile);
        if (trimmedMobile != null) {
            if (!PhoneUtil.isMobile(trimmedMobile)) {
                throw new CommonException("手机号格式不正确：{}", trimmedMobile);
            }
            LambdaQueryWrapper<BizStudentProfile> mobWrapper = new LambdaQueryWrapper<BizStudentProfile>()
                    .eq(BizStudentProfile::getMobile, CommonCryptogramUtil.doSm4CbcEncrypt(trimmedMobile));
            if (StrUtil.isNotBlank(excludeId)) {
                mobWrapper.ne(BizStudentProfile::getId, excludeId);
            }
            if (this.count(mobWrapper) > 0) {
                throw new CommonException("该手机号已被其他学生使用：{}", trimmedMobile);
            }
        }
    }

    private String resolveInputPasswordOrGenerate(String inputPassword) {
        if (StrUtil.isBlank(inputPassword)) {
            return generateStrongPassword();
        }
        String decrypted;
        try {
            decrypted = CommonCryptogramUtil.doSm2Decrypt(inputPassword);
        } catch (Exception e) {
            throw new CommonException("密码必须使用国密SM2公钥加密传输");
        }
        if (StrUtil.length(decrypted) < 8) {
            throw new CommonException("密码长度至少为8位");
        }
        return decrypted;
    }

    private String generateStrongPassword() {
        return "St@" + RandomUtil.randomString(PWD_CHARS, 7);
    }

    private void cleanStudentChildRecords(String studentId) {
        this.baseMapper.deleteNotificationReadsByStudentId(studentId);
        this.baseMapper.deleteWarningSnapshotsByStudentId(studentId);
        this.baseMapper.deleteWarningCurrentStatesByStudentId(studentId);
        this.baseMapper.deleteWarningsByStudentId(studentId);
        this.baseMapper.deleteWarningCasesByStudentId(studentId);
        this.baseMapper.deleteLeaveRequestsByStudentId(studentId);
        this.baseMapper.deleteMakeupRequestsByStudentId(studentId);
        this.baseMapper.deleteAppealsByStudentId(studentId);
        this.baseMapper.deleteAttendanceRecordsByStudentId(studentId);
        this.baseMapper.deleteDailyRecordsByStudentId(studentId);
        this.baseMapper.deleteWeeklySummariesByStudentId(studentId);
        this.baseMapper.deleteMonthlySummariesByStudentId(studentId);
        this.baseMapper.deleteTermSummariesByStudentId(studentId);
        this.baseMapper.deleteGradesByStudentId(studentId);
    }
}
