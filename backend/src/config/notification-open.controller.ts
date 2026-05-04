import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { normalizeEmailConfig, sendEmail } from '../shared/email.util';
import { PrismaService } from '../shared/prisma.service';
import { normalizeSmsConfig, sendSms } from '../shared/sms.util';
import { renderTemplate } from '../shared/template.util';
import { ConfigService } from './config.service';

class OpenEmailSendDto {
  to!: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  content?: string;
  template_code?: string;
  params?: Record<string, any>;
}

class OpenSmsSendDto {
  mobile?: string;
  mobiles?: string[];
  content?: string;
  template_code?: string;
  params?: Record<string, any>;
}

@Controller('admin/config/open')
export class NotificationOpenController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getRequestApiKey(req: any) {
    const headerApiKey = String(req.headers?.['x-api-key'] || '').trim();
    if (headerApiKey) {
      return headerApiKey;
    }

    const authHeader = String(req.headers?.authorization || '').trim();
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    return bearerMatch ? bearerMatch[1].trim() : '';
  }

  private async assertChannelAccess(channel: 'email' | 'sms', req: any) {
    const rawConfig =
      channel === 'email'
        ? await this.configService.getSectionConfig('email', {}, ['notification'])
        : await this.configService.getSectionConfig('sms', {});

    if (!rawConfig?.openApiEnabled) {
      throw new UnauthorizedException(`${channel} 开放接口未启用`);
    }

    const expectedApiKey = String(rawConfig?.openApiKey || '').trim();
    const providedApiKey = this.getRequestApiKey(req);
    if (!expectedApiKey || !providedApiKey || expectedApiKey !== providedApiKey) {
      throw new UnauthorizedException('API Key 无效');
    }

    return rawConfig;
  }

  private normalizeEmailReceivers(input: string | string[]) {
    const values = Array.isArray(input) ? input : [input];
    const receivers = Array.from(
      new Set(
        values
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );

    if (receivers.length === 0) {
      throw new BadRequestException('收件邮箱不能为空');
    }

    return receivers;
  }

  private normalizeSmsReceivers(dto: OpenSmsSendDto) {
    const candidates = [
      ...(Array.isArray(dto.mobiles) ? dto.mobiles : []),
      ...(dto.mobile ? [dto.mobile] : []),
    ];

    const receivers = Array.from(
      new Set(
        candidates
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );

    if (receivers.length === 0) {
      throw new BadRequestException('手机号不能为空');
    }

    return receivers;
  }

  private async resolveEmailMessage(dto: OpenEmailSendDto) {
    const params = dto.params && typeof dto.params === 'object' ? dto.params : {};
    const templateCode = String(dto.template_code || '').trim();

    if (templateCode) {
      const template = await this.prisma.message_templates.findFirst({
        where: {
          channel: 'email',
          template_code: templateCode,
          status: 'active',
        },
      });

      if (!template) {
        throw new BadRequestException('邮件模板不存在或未启用');
      }

      const subject = renderTemplate(template.title || String(dto.subject || '系统通知'), params);
      const text = renderTemplate(template.content || '', params);
      return {
        subject,
        text,
        html: text.replace(/\n/g, '<br />'),
      };
    }

    const subject = String(dto.subject || '').trim();
    const text = String(dto.text || dto.content || '').trim();
    const html = String(dto.html || '').trim();

    if (!subject) {
      throw new BadRequestException('邮件主题不能为空');
    }

    if (!text && !html) {
      throw new BadRequestException('邮件正文不能为空');
    }

    return {
      subject,
      text: text || html.replace(/<br\s*\/?>/gi, '\n'),
      html: html || text.replace(/\n/g, '<br />'),
    };
  }

  private async resolveSmsContent(dto: OpenSmsSendDto) {
    const params = dto.params && typeof dto.params === 'object' ? dto.params : {};
    const templateCode = String(dto.template_code || '').trim();

    if (templateCode) {
      const template = await this.prisma.message_templates.findFirst({
        where: {
          channel: 'sms',
          template_code: templateCode,
          status: 'active',
        },
      });

      if (!template) {
        throw new BadRequestException('短信模板不存在或未启用');
      }

      return {
        content: renderTemplate(template.content || '', params),
        templateCode,
        params,
      };
    }

    const content = String(dto.content || '').trim();
    if (!content) {
      throw new BadRequestException('短信内容不能为空');
    }

    return {
      content,
      templateCode: '',
      params,
    };
  }

  @Post('email/send')
  async sendOpenEmail(@Body() dto: OpenEmailSendDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const rawConfig = await this.assertChannelAccess('email', req);
    const emailConfig = normalizeEmailConfig(rawConfig);
    const receivers = this.normalizeEmailReceivers(dto.to);
    const message = await this.resolveEmailMessage(dto);

    const result = await sendEmail(emailConfig, {
      to: receivers,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    await this.prisma.security_events.create({
      data: {
        event_type: 'open_email_send',
        detail_json: {
          receivers,
          subject: message.subject,
          template_code: String(dto.template_code || '').trim() || null,
        } as any,
        ip: req.ip,
        user_agent: req.headers?.['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : null,
      },
    });

    return {
      code: 0,
      message: '邮件发送成功',
      data: {
        provider: emailConfig.provider || 'smtp',
        message_id: result.messageId || null,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('sms/send')
  async sendOpenSms(@Body() dto: OpenSmsSendDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const rawConfig = await this.assertChannelAccess('sms', req);
    const smsConfig = normalizeSmsConfig(rawConfig);
    const receivers = this.normalizeSmsReceivers(dto);
    const message = await this.resolveSmsContent(dto);

    const result = await sendSms(smsConfig, {
      mobiles: receivers,
      content: message.content,
      templateCode: message.templateCode,
      params: message.params,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || '短信发送失败');
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'open_sms_send',
        detail_json: {
          receivers,
          content: message.content,
          template_code: message.templateCode || null,
        } as any,
        ip: req.ip,
        user_agent: req.headers?.['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : null,
      },
    });

    return {
      code: 0,
      message: '短信发送成功',
      data: {
        provider: result.provider || 'custom_http',
        message_id: result.msgId || null,
      },
      trace_id: req.trace_id,
    };
  }
}
