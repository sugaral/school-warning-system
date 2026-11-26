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
package vip.xiaonuo.biz.modular.teacherbinding.service.impl;

import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.core.util.BizScopeUtil;
import vip.xiaonuo.biz.modular.clazz.entity.BizClass;
import vip.xiaonuo.biz.modular.clazz.service.BizClassService;
import vip.xiaonuo.biz.modular.course.entity.BizCourse;
import vip.xiaonuo.biz.modular.course.service.BizCourseService;
import vip.xiaonuo.biz.modular.teacherbinding.entity.BizTeacherCourseBinding;
import vip.xiaonuo.biz.modular.teacherbinding.mapper.BizTeacherCourseBindingMapper;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingAddParam;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingIdParam;
import vip.xiaonuo.biz.modular.teacherbinding.param.BizTeacherCourseBindingPageParam;
import vip.xiaonuo.biz.modular.teacherbinding.service.BizTeacherCourseBindingService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;

import java.util.List;

/**
 * 教师授课绑定Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizTeacherCourseBindingServiceImpl extends ServiceImpl<BizTeacherCourseBindingMapper, BizTeacherCourseBinding>
        implements BizTeacherCourseBindingService {

    @Resource
    private BizCourseService bizCourseService;

    @Resource
    private BizClassService bizClassService;

    @Override
    public Page<BizTeacherCourseBinding> page(BizTeacherCourseBindingPageParam param) {
        QueryWrapper<BizTeacherCourseBinding> queryWrapper = new QueryWrapper<BizTeacherCourseBinding>().checkSqlInjection();
        if (!BizScopeUtil.applyOrgScope(queryWrapper.lambda(), BizTeacherCourseBinding::getOrgId)) {
            return new Page<>();
        }
        if (StrUtil.isNotBlank(param.getOrgId())) {
            queryWrapper.lambda().eq(BizTeacherCourseBinding::getOrgId, param.getOrgId());
        }
        if (StrUtil.isNotBlank(param.getTeacherId())) {
            queryWrapper.lambda().eq(BizTeacherCourseBinding::getTeacherId, param.getTeacherId());
        }
        if (StrUtil.isNotBlank(param.getCourseId())) {
            queryWrapper.lambda().eq(BizTeacherCourseBinding::getCourseId, param.getCourseId());
        }
        if (StrUtil.isNotBlank(param.getClassId())) {
            queryWrapper.lambda().eq(BizTeacherCourseBinding::getClassId, param.getClassId());
        }
        queryWrapper.lambda().orderByDesc(BizTeacherCourseBinding::getCreateTime);
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizTeacherCourseBindingAddParam param) {
        BizCourse course = bizCourseService.queryEntity(param.getCourseId());
        BizClass cls = bizClassService.queryEntity(param.getClassId());
        BizScopeUtil.assertOrgInScope(course.getOrgId(), "新增教师授课绑定");
        BizScopeUtil.assertOrgInScope(cls.getOrgId(), "绑定该班级");

        if (this.count(new LambdaQueryWrapper<BizTeacherCourseBinding>()
                .eq(BizTeacherCourseBinding::getTeacherId, param.getTeacherId())
                .eq(BizTeacherCourseBinding::getCourseId, param.getCourseId())
                .eq(BizTeacherCourseBinding::getClassId, param.getClassId())) > 0) {
            throw new CommonException("该教师、课程与班级的授课绑定已存在");
        }
        BizTeacherCourseBinding entity = new BizTeacherCourseBinding();
        entity.setTeacherId(param.getTeacherId());
        entity.setOrgId(course.getOrgId());
        entity.setCourseId(course.getId());
        entity.setClassId(cls.getId());
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizTeacherCourseBindingIdParam> idParamList) {
        List<String> ids = CollStreamUtil.toList(idParamList, BizTeacherCourseBindingIdParam::getId);
        List<BizTeacherCourseBinding> list = this.listByIds(ids);
        for (BizTeacherCourseBinding item : list) {
            BizScopeUtil.assertOrgInScope(item.getOrgId(), "删除教师授课绑定");
        }
        this.removeByIds(ids);
    }
}
