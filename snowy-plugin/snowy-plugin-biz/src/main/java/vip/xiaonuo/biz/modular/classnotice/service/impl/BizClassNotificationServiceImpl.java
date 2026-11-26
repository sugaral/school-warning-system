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
package vip.xiaonuo.biz.modular.classnotice.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.convert.Convert;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.auth.core.util.StpLoginUserUtil;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.classnotice.entity.BizClassNotification;
import vip.xiaonuo.biz.modular.classnotice.mapper.BizClassNotificationMapper;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationAddParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationEditParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationIdParam;
import vip.xiaonuo.biz.modular.classnotice.param.BizClassNotificationPageParam;
import vip.xiaonuo.biz.modular.classnotice.service.BizClassNotificationService;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;

import java.util.*;

/**
 * 班级公告Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizClassNotificationServiceImpl extends ServiceImpl<BizClassNotificationMapper, BizClassNotification>
        implements BizClassNotificationService {

    @Resource
    private BizClassService bizClassService;

    @Override
    public Page<BizClassNotification> page(BizClassNotificationPageParam param) {
        QueryWrapper<BizClassNotification> queryWrapper = new QueryWrapper<BizClassNotification>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizClassNotification::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getOrgId())) {
            queryWrapper.lambda().eq(BizClassNotification::getOrgId, param.getOrgId());
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizClassNotification::getClassId, param.getClassId());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizClassNotification::getTitle, param.getSearchKey())
                    .or().like(BizClassNotification::getContent, param.getSearchKey())
                    .or().like(BizClassNotification::getPublisherName, param.getSearchKey()));
        }
        queryWrapper.lambda().orderByDesc(BizClassNotification::getCreateTime);
        Page<BizClassNotification> page = this.page(CommonPageRequest.defaultPage(), queryWrapper);
        fillReadStats(page.getRecords());
        return page;
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizClassNotificationAddParam param) {
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "发布班级公告");
        BizClassNotification entity = BeanUtil.toBean(param, BizClassNotification.class);
        entity.setOrgId(cls.getOrgId());
        entity.setTitle(StrUtil.trim(param.getTitle()));
        entity.setPublisherId(StpUtil.getLoginIdAsString());
        entity.setPublisherName(StrUtil.blankToDefault(StpLoginUserUtil.getLoginUser().getName(), "管理员"));
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizClassNotificationEditParam param) {
        BizClassNotification existing = this.queryEntity(param.getId());
        BizScopeUtil.assertOrgInScope(existing.getOrgId(), "编辑班级公告");
        BizClass targetClass = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(targetClass.getOrgId(), "修改公告所属班级");
        BeanUtil.copyProperties(param, existing);
        existing.setOrgId(targetClass.getOrgId());
        existing.setTitle(StrUtil.trim(param.getTitle()));
        this.updateById(existing);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizClassNotificationIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizClassNotificationIdParam::getId);
        List<BizClassNotification> list = this.listByIds(ids);
        for (BizClassNotification item : list) {
            BizScopeUtil.assertOrgInScope(item.getOrgId(), "删除班级公告");
            this.baseMapper.deleteReadRecordsByNoticeId(item.getId());
        }
        this.removeByIds(ids);
    }

    @Override
    public BizClassNotification detail(BizClassNotificationIdParam idParam) {
        BizClassNotification entity = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(entity.getOrgId(), "查看班级公告");
        fillReadStats(Collections.singletonList(entity));
        return entity;
    }

    @Override
    public BizClassNotification queryEntity(String id) {
        BizClassNotification entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("班级公告不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public JSONObject readStats(BizClassNotificationIdParam idParam) {
        BizClassNotification notice = this.queryEntity(idParam.getId());
        BizScopeUtil.assertOrgInScope(notice.getOrgId(), "查看公告已读统计");
        fillReadStats(Collections.singletonList(notice));
        List<Map<String, Object>> readers = this.baseMapper.selectReadStudentsByNoticeId(notice.getId());
        long total = Optional.ofNullable(notice.getTotalStudents()).orElse(0L);
        long read = Optional.ofNullable(notice.getReadCount()).orElse(0L);
        return JSONUtil.createObj()
                .set("noticeId", notice.getId())
                .set("title", notice.getTitle())
                .set("totalStudents", total)
                .set("readCount", read)
                .set("unreadCount", Math.max(0L, total - read))
                .set("readers", readers);
    }

    private void fillReadStats(List<BizClassNotification> records) {
        if (ObjectUtil.isEmpty(records)) {
            return;
        }
        List<String> noticeIds = CollStreamUtil.toList(records, BizClassNotification::getId);
        List<String> classIds = CollStreamUtil.toList(records, BizClassNotification::getClassId);
        Map<String, Long> readMap = toCountMap(this.baseMapper.selectReadCountByNoticeIds(noticeIds), "noticeId");
        Map<String, Long> totalMap = toCountMap(this.baseMapper.selectClassStudentCountByClassIds(classIds), "classId");
        for (BizClassNotification n : records) {
            n.setReadCount(readMap.getOrDefault(n.getId(), 0L));
            n.setTotalStudents(totalMap.getOrDefault(n.getClassId(), 0L));
        }
    }

    private Map<String, Long> toCountMap(List<Map<String, Object>> rows, String keyCol) {
        Map<String, Long> map = new HashMap<>();
        if (ObjectUtil.isNotEmpty(rows)) {
            for (Map<String, Object> row : rows) {
                String k = Convert.toStr(row.get(keyCol));
                Long cnt = Convert.toLong(row.get("cnt"), 0L);
                if (k != null) {
                    map.put(k, cnt);
                }
            }
        }
        return map;
    }
}
