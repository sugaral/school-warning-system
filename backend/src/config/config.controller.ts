import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import dayjs from 'dayjs';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { AuthGuard } from '../shared/auth.guard';
import { normalizeEmailConfig, sendEmail } from '../shared/email.util';
import {
  listImportTemplateTypes,
  loadImportTemplate,
  saveImportTemplate,
  type ImportTemplateField,
  type ImportTemplateType,
} from '../shared/import-template.util';
import { PrismaService } from '../shared/prisma.service';
import { normalizeSmsConfig, sendSms } from '../shared/sms.util';
import { renderTemplate } from '../shared/template.util';
import { ConfigService } from './config.service';

class TestEmailDto {
  to!: string;
}

class TestSmsDto {
  mobile!: string;
  content?: string;
}

class UpsertTemplateDto {
  channel!: string;
  template_code!: string;
  title?: string;
  content!: string;
  status!: string;
}

class UpdateImportTemplateDto {
  fields!: ImportTemplateField[];
}

class CreateCalendarExclusionDto {
  scope!: string;
  scope_id?: string | null;
  exclusion_date!: string;
  reason?: string;
}

const DEFAULT_MESSAGE_TEMPLATES = [
  {
    channel: 'email',
    template_code: 'AUTH_VERIFY_CODE',
    title: '邮箱验证码',
    content:
      '您的验证码为 {code}，{expire_minutes} 分钟内有效。如非本人操作，请忽略本邮件。',
    legacyContents: ['您的验证码为 {code}，5 分钟内有效。如非本人操作，请忽略本邮件。'],
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'AUTH_BIND_EMAIL_CODE',
    title: '邮箱绑定验证码',
    content:
      '您正在绑定邮箱 {email}，验证码为 {code}，{expire_minutes} 分钟内有效。如非本人操作，请忽略本邮件。',
    legacyContents: [
      '您正在绑定邮箱 {email}，验证码为 {code}，5 分钟内有效。如非本人操作，请忽略本邮件。',
    ],
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'ADMIN_LOGIN_VERIFY_CODE',
    title: '管理端登录验证码',
    content:
      '您正在登录管理端，验证码为 {code}，{expire_minutes} 分钟内有效。如非本人操作，请立即修改密码。',
    legacyContents: [
      '您正在登录管理端，验证码为 {code}，5 分钟内有效。如非本人操作，请立即修改密码。',
    ],
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'PASSWORD_RESET_EMAIL_CODE',
    title: '密码重置验证码',
    content:
      '您正在找回账号密码，验证码为 {code}，{expire_minutes} 分钟内有效。若非本人操作，请立即修改密码并联系管理员。',
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'SYSTEM_TEST_EMAIL',
    title: '{system_name} 邮件服务测试',
    content:
      '这是一封来自 {system_name} 的测试邮件。\n接收邮箱：{email}\n发送时间：{timestamp}\n如果您收到此邮件，说明系统邮件服务配置正常。',
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'WARNING_NOTIFICATION',
    title: '{system_name} 预警通知',
    content:
      '系统检测到新的预警信息。\n预警级别：{warning_level}\n预警内容：{warning_reason}\n请尽快登录系统查看详情。',
    status: 'active',
  },
  {
    channel: 'email',
    template_code: 'ABSENT_THRESHOLD_EMAIL',
    title: '{system_name} 缺课提醒',
    content:
      '您好，{student_name} 当前{warning_window}缺课已达到 {absent_count} 次。\n预警级别：{warning_level}\n触发说明：{trigger_summary}\n请尽快登录系统查看详情并及时处理。',
    status: 'active',
  },
  {
    channel: 'sms',
    template_code: 'AUTH_VERIFY_CODE',
    title: null,
    content: '【{system_name}】验证码 {code}，{expire_minutes} 分钟内有效。',
    status: 'active',
  },
  {
    channel: 'sms',
    template_code: 'PASSWORD_RESET_SMS_CODE',
    title: null,
    content: '【{system_name}】您正在找回账号密码，验证码 {code}，{expire_minutes} 分钟内有效。',
    status: 'active',
  },
  {
    channel: 'sms',
    template_code: 'SYSTEM_TEST_SMS',
    title: null,
    content: '【{system_name}】短信服务测试成功，发送时间：{timestamp}。',
    status: 'active',
  },
  {
    channel: 'sms',
    template_code: 'WARNING_NOTIFICATION',
    title: null,
    content: '【{system_name}】您有新的预警通知：{warning_reason}。',
    status: 'active',
  },
  {
    channel: 'wechat',
    template_code: 'WARNING_NOTIFICATION',
    title: '预警通知',
    content: '您有一条新的预警通知：{warning_reason}',
    status: 'active',
  },
];

@Controller('admin/config')
@UseGuards(AuthGuard, PermissionGuard)
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private getOperatorId(req: any) {
    const raw = req.user?.sub || req.user?.userId;
    return BigInt(raw);
  }

  private serializeTemplate(item: any) {
    return {
      id: item.id.toString(),
      channel: item.channel,
      template_code: item.template_code,
      title: item.title,
      content: item.content,
      status: item.status,
      created_by: item.created_by.toString(),
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  }

  private normalizeCalendarScope(scope?: string) {
    const normalized = String(scope || 'school').trim().toLowerCase();
    if (normalized === 'college') {
      return 'org';
    }
    if (normalized === 'org' || normalized === 'school') {
      return normalized;
    }
    return 'school';
  }

  private formatDateOnly(value: Date | string) {
    return dayjs(value).format('YYYY-MM-DD');
  }

  private async ensureDefaultTemplates(operatorId: bigint, overwriteExisting = false) {
    const templates = await Promise.all(
      DEFAULT_MESSAGE_TEMPLATES.map(async (item) => {
        const existing = await this.prisma.message_templates.findUnique({
          where: {
            channel_template_code: {
              channel: item.channel,
              template_code: item.template_code,
            },
          },
        });

        if (!existing) {
          return this.prisma.message_templates.create({
            data: {
              channel: item.channel,
              template_code: item.template_code,
              title: item.title || null,
              content: item.content,
              status: item.status,
              created_by: operatorId,
            },
          });
        }

        if (!overwriteExisting) {
          const shouldUpgradeLegacyTemplate =
            Array.isArray((item as any).legacyContents) &&
            (item as any).legacyContents.includes(existing.content);

          if (!shouldUpgradeLegacyTemplate) {
            return existing;
          }

          return this.prisma.message_templates.update({
            where: { id: existing.id },
            data: {
              title: item.title || null,
              content: item.content,
              status: item.status,
              updated_at: new Date(),
            },
          });
        }

        return this.prisma.message_templates.update({
          where: { id: existing.id },
          data: {
            title: item.title || null,
            content: item.content,
            status: item.status,
            updated_at: new Date(),
          },
        });
      }),
    );

    return templates.map((item) => this.serializeTemplate(item));
  }

  private serializeCalendarExclusion(item: any, orgNameMap = new Map<string, string>()) {
    const scope = this.normalizeCalendarScope(item.scope);
    const scopeId = item.scope_id?.toString() || null;

    return {
      id: item.id.toString(),
      scope,
      scope_id: scopeId,
      scope_name:
        scope === 'school'
          ? '全校'
          : orgNameMap.get(scopeId || '') || scopeId || '学院',
      exclusion_date: this.formatDateOnly(item.exclusion_date),
      reason: item.reason || '',
      created_by: item.created_by?.toString?.() || null,
      created_at: item.created_at,
    };
  }

  private async saveSetting(key: string, value: any) {
    const valueStr =
      typeof value === 'string' ? value : JSON.stringify(value ?? null);

    await this.prisma.system_settings.upsert({
      where: { setting_key: key },
      update: { setting_val: valueStr },
      create: { setting_key: key, setting_val: valueStr },
    });
  }

  private async getEmailSectionConfig(defaultValue: any = {}) {
    return this.configService.getSectionConfig('email', defaultValue, ['notification']);
  }

  private async getSmsSectionConfig(defaultValue: any = {}) {
    return this.configService.getSectionConfig('sms', defaultValue);
  }

  @Get()
  @Permissions('config:view')
  async getConfig(@Req() req: any) {
    await this.prisma.ensureConnected();

    const settings = await this.prisma.system_settings.findMany();
    const config: Record<string, any> = {};

    for (const setting of settings) {
      try {
        config[setting.setting_key] = JSON.parse(setting.setting_val);
      } catch {
        config[setting.setting_key] = setting.setting_val;
      }
    }

    if (!config.email && config.notification) {
      config.email = config.notification;
    }

    if (!config.notification && config.email) {
      config.notification = config.email;
    }

    if (!config.sms) {
      config.sms = {};
    }

    config.warning = {
      maxWarningEmailsPerHour: 60,
      ...(config.warning || {}),
    };

    return {
      code: 0,
      message: 'ok',
      data: config,
      trace_id: req.trace_id,
    };
  }

  @Post()
  @Permissions('config:update')
  async setConfig(@Body() config: Record<string, any>, @Req() req: any) {
    await this.prisma.ensureConnected();

    for (const [key, value] of Object.entries(config || {})) {
      await this.saveSetting(key, value);

      // Keep the legacy "notification" section in sync with the new email section
      // so existing readers can continue working during the migration.
      if (key === 'email') {
        await this.saveSetting('notification', value);
      }

      if (key === 'notification') {
        await this.saveSetting('email', value);
      }
    }

    this.configService.clearCache();

    return {
      code: 0,
      message: '保存成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('email')
  @Permissions('config:view')
  async getEmailConfig(@Req() req: any) {
    await this.prisma.ensureConnected();

    return {
      code: 0,
      message: 'ok',
      data: await this.getEmailSectionConfig({}),
      trace_id: req.trace_id,
    };
  }

  @Put('email')
  @Permissions('config:update')
  async setEmailConfig(@Body() emailConfig: Record<string, any>, @Req() req: any) {
    await this.prisma.ensureConnected();

    await this.saveSetting('email', emailConfig || {});
    await this.saveSetting('notification', emailConfig || {});
    this.configService.clearCache();

    return {
      code: 0,
      message: '邮箱设置保存成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('sms')
  @Permissions('config:view')
  async getSmsConfig(@Req() req: any) {
    await this.prisma.ensureConnected();

    return {
      code: 0,
      message: 'ok',
      data: await this.getSmsSectionConfig({}),
      trace_id: req.trace_id,
    };
  }

  @Put('sms')
  @Permissions('config:update')
  async setSmsConfig(@Body() smsConfig: Record<string, any>, @Req() req: any) {
    await this.prisma.ensureConnected();

    await this.saveSetting('sms', smsConfig || {});
    this.configService.clearCache();

    return {
      code: 0,
      message: '短信设置保存成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('import-templates')
  @Permissions('config:view')
  async getImportTemplates(@Req() req: any) {
    await this.prisma.ensureConnected();

    const entries = await Promise.all(
      listImportTemplateTypes().map(async (type) => [type, await loadImportTemplate(this.prisma, type)]),
    );

    return {
      code: 0,
      message: 'ok',
      data: Object.fromEntries(entries),
      trace_id: req.trace_id,
    };
  }

  @Put('import-templates/:type')
  @Permissions('config:update')
  async setImportTemplate(
    @Param('type') type: ImportTemplateType,
    @Body() dto: UpdateImportTemplateDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();

    try {
      const template = await saveImportTemplate(this.prisma, type, dto);
      return {
        code: 0,
        message: '保存成功',
        data: template,
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      throw new BadRequestException(error?.message || '导入模板配置不合法');
    }
  }

  @Post('test-email')
  @Post('email/test')
  @Permissions('config:update')
  async testEmail(@Body() dto: TestEmailDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const to = String(dto.to || '').trim();
    if (!to) {
      throw new BadRequestException('测试邮箱不能为空');
    }

    await this.ensureDefaultTemplates(this.getOperatorId(req));

    const notificationConfig = await this.getEmailSectionConfig({});
    const basicConfig = await this.configService.getConfig('basic', {});
    const emailConfig = normalizeEmailConfig(notificationConfig);
    const now = new Date();
    const payload = {
      system_name: basicConfig?.systemName || '学业预警系统',
      timestamp: now.toLocaleString('zh-CN'),
      email: to,
    };

    const template = await this.prisma.message_templates.findFirst({
      where: {
        channel: 'email',
        template_code: 'SYSTEM_TEST_EMAIL',
        status: 'active',
      },
    });

    const fallbackTitle = '{system_name} 邮件服务测试';
    const fallbackContent =
      '这是一封来自 {system_name} 的测试邮件。\n接收邮箱：{email}\n发送时间：{timestamp}\n如果您收到此邮件，说明系统邮件服务配置正常。';

    await sendEmail(emailConfig, {
      to,
      subject: renderTemplate(template?.title || fallbackTitle, payload),
      text: renderTemplate(template?.content || fallbackContent, payload),
      html: renderTemplate(template?.content || fallbackContent, payload).replace(/\n/g, '<br />'),
    });

    return {
      code: 0,
      message: '测试邮件发送成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('calendar-exclusions')
  @Permissions('config:view')
  async getCalendarExclusions(
    @Query('month') month: string,
    @Query('date') date: string,
    @Query('scope') scope: string,
    @Query('scopeId') scopeId: string,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();

    const normalizedScope = scope ? this.normalizeCalendarScope(scope) : '';
    const where: any = {};

    if (normalizedScope) {
      where.scope = normalizedScope;
    }

    if (normalizedScope === 'org' && scopeId) {
      where.scope_id = BigInt(scopeId);
    }

    if (date) {
      const targetDate = dayjs(date);
      if (!targetDate.isValid()) {
        throw new BadRequestException('日期格式不正确');
      }
      where.exclusion_date = {
        gte: targetDate.startOf('day').toDate(),
        lt: targetDate.add(1, 'day').startOf('day').toDate(),
      };
    } else {
      const targetMonth = month ? dayjs(`${month}-01`) : dayjs().startOf('month');
      if (!targetMonth.isValid()) {
        throw new BadRequestException('月份格式不正确');
      }
      where.exclusion_date = {
        gte: targetMonth.startOf('month').toDate(),
        lt: targetMonth.add(1, 'month').startOf('month').toDate(),
      };
    }

    const exclusions = await this.prisma.calendar_exclusions.findMany({
      where,
      orderBy: [{ exclusion_date: 'asc' }, { id: 'asc' }],
    });

    const orgIds = exclusions
      .map((item) => item.scope_id)
      .filter((value): value is bigint => Boolean(value));
    const orgs = orgIds.length
      ? await this.prisma.orgs.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgNameMap = new Map(orgs.map((item) => [item.id.toString(), item.name]));

    return {
      code: 0,
      message: 'ok',
      data: exclusions.map((item) => this.serializeCalendarExclusion(item, orgNameMap)),
      trace_id: req.trace_id,
    };
  }

  @Post('test-sms')
  @Post('sms/test')
  @Permissions('config:update')
  async testSms(@Body() dto: TestSmsDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const mobile = String(dto.mobile || '').trim();
    if (!mobile) {
      throw new BadRequestException('测试手机号不能为空');
    }

    await this.ensureDefaultTemplates(this.getOperatorId(req));

    const smsSectionConfig = await this.getSmsSectionConfig({});
    const basicConfig = await this.configService.getConfig('basic', {});
    const smsConfig = normalizeSmsConfig(smsSectionConfig);
    const now = new Date();
    const templateParams = {
      system_name: basicConfig?.systemName || '学业预警系统',
      timestamp: now.toLocaleString('zh-CN'),
    };

    const template = await this.prisma.message_templates.findFirst({
      where: {
        channel: 'sms',
        template_code: 'SYSTEM_TEST_SMS',
        status: 'active',
      },
    });

    const content = String(dto.content || '').trim() ||
      renderTemplate(
        template?.content || '【{system_name}】短信服务测试成功，发送时间：{timestamp}。',
        templateParams,
      );

    const result = await sendSms(smsConfig, {
      mobiles: [mobile],
      content,
      templateCode: 'SYSTEM_TEST_SMS',
      params: templateParams,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || '测试短信发送失败');
    }

    return {
      code: 0,
      message: '测试短信发送成功',
      data: {
        provider: result.provider,
        message_id: result.msgId || null,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('calendar-exclusions')
  @Permissions('config:update')
  async createCalendarExclusion(@Body() dto: CreateCalendarExclusionDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const scope = this.normalizeCalendarScope(dto.scope);
    const targetDate = dayjs(dto.exclusion_date);
    if (!targetDate.isValid()) {
      throw new BadRequestException('排除日期格式不正确');
    }

    let scopeBigInt: bigint | null = null;
    if (scope === 'org') {
      if (!dto.scope_id) {
        throw new BadRequestException('学院范围必须指定 scope_id');
      }
      scopeBigInt = BigInt(dto.scope_id);

      const org = await this.prisma.orgs.findUnique({
        where: { id: scopeBigInt },
        select: { id: true },
      });
      if (!org) {
        throw new BadRequestException('学院不存在');
      }
    }

    const duplicate = await this.prisma.calendar_exclusions.findFirst({
      where: {
        scope,
        scope_id: scopeBigInt,
        exclusion_date: targetDate.startOf('day').toDate(),
      },
    });

    if (duplicate) {
      throw new BadRequestException('该日期已存在排除配置');
    }

    const created = await this.prisma.calendar_exclusions.create({
      data: {
        scope,
        scope_id: scopeBigInt,
        exclusion_date: targetDate.startOf('day').toDate(),
        reason: dto.reason?.trim() || null,
        created_by: this.getOperatorId(req),
      },
    });

    const orgNameMap = new Map<string, string>();
    if (scopeBigInt) {
      const org = await this.prisma.orgs.findUnique({
        where: { id: scopeBigInt },
        select: { id: true, name: true },
      });
      if (org) {
        orgNameMap.set(org.id.toString(), org.name);
      }
    }

    return {
      code: 0,
      message: '创建成功',
      data: this.serializeCalendarExclusion(created, orgNameMap),
      trace_id: req.trace_id,
    };
  }

  @Delete('calendar-exclusions/:id')
  @Permissions('config:update')
  async deleteCalendarExclusion(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    await this.prisma.calendar_exclusions.delete({
      where: { id: BigInt(id) },
    });

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('templates')
  @Permissions('config:view')
  async getTemplates(
    @Query('channel') channel: string,
    @Query('keyword') keyword: string,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    await this.ensureDefaultTemplates(this.getOperatorId(req));

    const where: any = {};
    if (channel) {
      where.channel = String(channel).trim().toLowerCase();
    }
    if (keyword) {
      where.OR = [
        { template_code: { contains: keyword } },
        { title: { contains: keyword } },
        { content: { contains: keyword } },
      ];
    }

    const templates = await this.prisma.message_templates.findMany({
      where,
      orderBy: [{ channel: 'asc' }, { template_code: 'asc' }],
    });

    return {
      code: 0,
      message: 'ok',
      data: templates.map((item) => this.serializeTemplate(item)),
      trace_id: req.trace_id,
    };
  }

  @Post('templates/bootstrap')
  @Permissions('config:update')
  async bootstrapTemplates(@Req() req: any) {
    await this.prisma.ensureConnected();

    const templates = await this.ensureDefaultTemplates(this.getOperatorId(req), true);

    return {
      code: 0,
      message: '默认模板初始化成功',
      data: templates,
      trace_id: req.trace_id,
    };
  }

  @Post('templates')
  @Permissions('config:update')
  async createTemplate(@Body() dto: UpsertTemplateDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    if (!dto.channel || !dto.template_code || !dto.content) {
      throw new BadRequestException('渠道、模板编码和模板内容不能为空');
    }

    const template = await this.prisma.message_templates.create({
      data: {
        channel: String(dto.channel).trim().toLowerCase(),
        template_code: String(dto.template_code).trim(),
        title: dto.title?.trim() || null,
        content: dto.content,
        status: dto.status || 'active',
        created_by: this.getOperatorId(req),
      },
    });

    return {
      code: 0,
      message: '创建成功',
      data: { id: template.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Put('templates/:id')
  @Permissions('config:update')
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: UpsertTemplateDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();

    if (!dto.channel || !dto.template_code || !dto.content) {
      throw new BadRequestException('渠道、模板编码和模板内容不能为空');
    }

    const template = await this.prisma.message_templates.update({
      where: { id: BigInt(id) },
      data: {
        channel: String(dto.channel).trim().toLowerCase(),
        template_code: String(dto.template_code).trim(),
        title: dto.title?.trim() || null,
        content: dto.content,
        status: dto.status || 'active',
        updated_at: new Date(),
      },
    });

    return {
      code: 0,
      message: '更新成功',
      data: { id: template.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Delete('templates/:id')
  @Permissions('config:update')
  async deleteTemplate(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    await this.prisma.message_templates.delete({
      where: { id: BigInt(id) },
    });

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }
}
