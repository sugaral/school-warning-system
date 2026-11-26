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
package vip.xiaonuo.biz.modular.msgtemplate.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.collection.CollStreamUtil;
import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vip.xiaonuo.biz.modular.msgtemplate.entity.BizMessageTemplate;
import vip.xiaonuo.biz.modular.msgtemplate.mapper.BizMessageTemplateMapper;
import vip.xiaonuo.biz.modular.msgtemplate.param.*;
import vip.xiaonuo.biz.modular.msgtemplate.service.BizMessageTemplateService;
import vip.xiaonuo.common.exception.CommonException;
import vip.xiaonuo.common.page.CommonPageRequest;
import vip.xiaonuo.dev.api.DevEmailApi;
import vip.xiaonuo.dev.api.DevSmsApi;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 消息模板Service实现类
 *
 * @author migration-bot
 * @date 2026/11/25
 */
@Service
public class BizMessageTemplateServiceImpl extends ServiceImpl<BizMessageTemplateMapper, BizMessageTemplate>
        implements BizMessageTemplateService {

    private static final Set<String> ALLOWED_CHANNELS = Set.of("email", "sms", "inbox", "wechat");

    @Resource
    private DevEmailApi devEmailApi;

    @Resource
    private DevSmsApi devSmsApi;

    @Override
    public Page<BizMessageTemplate> page(BizMessageTemplatePageParam param) {
        QueryWrapper<BizMessageTemplate> queryWrapper = new QueryWrapper<BizMessageTemplate>().checkSqlInjection();
        if (StrUtil.isNotBlank(param.getChannel())) {
            queryWrapper.lambda().eq(BizMessageTemplate::getChannel, param.getChannel());
        }
        if (StrUtil.isNotBlank(param.getStatus())) {
            queryWrapper.lambda().eq(BizMessageTemplate::getStatus, param.getStatus());
        }
        if (StrUtil.isNotBlank(param.getSearchKey())) {
            queryWrapper.lambda().and(q -> q.like(BizMessageTemplate::getTemplateCode, param.getSearchKey())
                    .or().like(BizMessageTemplate::getTitle, param.getSearchKey())
                    .or().like(BizMessageTemplate::getContent, param.getSearchKey()));
        }
        queryWrapper.lambda().orderByAsc(BizMessageTemplate::getChannel, BizMessageTemplate::getTemplateCode);
        return this.page(CommonPageRequest.defaultPage(), queryWrapper);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void add(BizMessageTemplateAddParam param) {
        String channel = StrUtil.trim(param.getChannel()).toLowerCase();
        if (!ALLOWED_CHANNELS.contains(channel)) {
            throw new CommonException("不支持的通知渠道：{}", channel);
        }
        String code = StrUtil.trim(param.getTemplateCode());
        if (this.count(new LambdaQueryWrapper<BizMessageTemplate>()
                .eq(BizMessageTemplate::getChannel, channel)
                .eq(BizMessageTemplate::getTemplateCode, code)) > 0) {
            throw new CommonException("渠道 {} 下模板编码 {} 已存在", channel, code);
        }
        BizMessageTemplate entity = BeanUtil.toBean(param, BizMessageTemplate.class);
        entity.setChannel(channel);
        entity.setTemplateCode(code);
        entity.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        entity.setCreatedBy(StpUtil.getLoginIdAsString());
        this.save(entity);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void edit(BizMessageTemplateEditParam param) {
        BizMessageTemplate existing = this.queryEntity(param.getId());
        String channel = StrUtil.trim(param.getChannel()).toLowerCase();
        if (!ALLOWED_CHANNELS.contains(channel)) {
            throw new CommonException("不支持的通知渠道：{}", channel);
        }
        String code = StrUtil.trim(param.getTemplateCode());
        if (this.count(new LambdaQueryWrapper<BizMessageTemplate>()
                .eq(BizMessageTemplate::getChannel, channel)
                .eq(BizMessageTemplate::getTemplateCode, code)
                .ne(BizMessageTemplate::getId, existing.getId())) > 0) {
            throw new CommonException("渠道 {} 下模板编码 {} 已存在", channel, code);
        }
        BeanUtil.copyProperties(param, existing);
        existing.setChannel(channel);
        existing.setTemplateCode(code);
        existing.setStatus(StrUtil.blankToDefault(param.getStatus(), "active"));
        this.updateById(existing);
    }

    @Transactional(rollbackFor = Exception.class)
    @Override
    public void delete(List<BizMessageTemplateIdParam> idParamList) {
        this.removeByIds(CollStreamUtil.toList(idParamList, BizMessageTemplateIdParam::getId));
    }

    @Override
    public BizMessageTemplate detail(BizMessageTemplateIdParam idParam) {
        return this.queryEntity(idParam.getId());
    }

    @Override
    public BizMessageTemplate queryEntity(String id) {
        BizMessageTemplate entity = this.getById(id);
        if (ObjectUtil.isEmpty(entity)) {
            throw new CommonException("消息模板不存在，id={}", id);
        }
        return entity;
    }

    @Override
    public JSONObject testSend(BizMessageTemplateTestSendParam param) {
        BizMessageTemplate tpl = this.queryEntity(param.getId());
        JSONObject vars = StrUtil.isNotBlank(param.getParamsJson())
                ? JSONUtil.parseObj(param.getParamsJson())
                : JSONUtil.createObj().set("system_name", "高校学业预警系统").set("student_name", "示例学生");
        String renderedTitle = renderVars(StrUtil.blankToDefault(tpl.getTitle(), ""), vars);
        String renderedContent = renderVars(tpl.getContent(), vars);
        boolean previewOnly = param.getPreviewOnly() == null || param.getPreviewOnly();

        if (!previewOnly) {
            if (StrUtil.isBlank(param.getTarget())) {
                throw new CommonException("实际调试发送必须提供接收目标(邮箱或手机号)");
            }
            if ("email".equals(tpl.getChannel())) {
                devEmailApi.sendDynamicHtmlEmail(param.getTarget(), renderedTitle, renderedContent);
            } else if ("sms".equals(tpl.getChannel())) {
                devSmsApi.sendDynamicSms(param.getTarget(), tpl.getTemplateCode(), vars);
            }
        }

        return JSONUtil.createObj()
                .set("channel", tpl.getChannel())
                .set("templateCode", tpl.getTemplateCode())
                .set("previewOnly", previewOnly)
                .set("renderedTitle", renderedTitle)
                .set("renderedContent", renderedContent);
    }

    private String renderVars(String raw, JSONObject vars) {
        if (StrUtil.isBlank(raw) || vars == null) {
            return raw;
        }
        String out = raw;
        for (Map.Entry<String, Object> entry : vars.entrySet()) {
            out = out.replace("{" + entry.getKey() + "}", String.valueOf(entry.getValue()));
        }
        return out;
    }
}
