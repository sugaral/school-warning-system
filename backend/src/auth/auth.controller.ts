import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PinoLogger } from 'nestjs-pino';
import * as https from 'https';
import * as querystring from 'querystring';
import { randomBytes, createHash } from 'crypto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AuthGuard, Public } from '../shared/auth.guard';
import {
  isEmailConfigReady,
  normalizeEmailDisplayText,
  normalizeEmailConfig,
  sendEmail,
} from '../shared/email.util';
import {
  isSmsConfigReady,
  normalizeSmsConfig,
  sendSms,
} from '../shared/sms.util';
import {
  hashPassword,
  isBcryptHash,
  verifyPassword,
} from '../shared/password.util';
import { renderTemplate } from '../shared/template.util';
import {
  isValidMainlandMobile,
  isWeakPassword,
  normalizeMobile,
} from '../shared/account-security.util';
import {
  loadRoleCatalog,
  normalizeRoleCode,
  toRegisterableRoles,
  toRoleNameMap,
} from '../shared/role-catalog';

class SendCodeDto {
  purpose!: string;
  channel!: string;
  target!: string;
}

class VerifyCodeDto {
  challenge_id!: bigint | number;
  code!: string;
}

class LoginAdminDto {
  account!: string;
  password!: string;
  name?: string;
  sms_ticket?: string;
  email_ticket?: string;
  captcha_id?: string;
  captcha_code?: string;
  wx_code?: string;
}

class RegisterDto {
  account!: string;
  email?: string;
  password!: string;
  name!: string;
  user_type!: string;
  role?: string;
  scope_type?: string;
  org_id?: string;
  class_id?: string;
}

class SendLoginCodeDto {
  account!: string;
  password!: string;
  captcha_id?: string;
  captcha_code?: string;
}

class RecoveryOptionsDto {
  account!: string;
}

class SendRecoveryEmailCodeDto {
  account!: string;
  email!: string;
}

class SendRecoverySmsCodeDto {
  account!: string;
  mobile!: string;
}

class ResetPasswordDto {
  account!: string;
  channel?: string;
  email?: string;
  mobile?: string;
  ticket!: string;
  new_password!: string;
}

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AuthController');
  }

  private normalizeChannel(channel?: string) {
    return String(channel || '').trim().toLowerCase();
  }

  private isAllowedPublicVerificationPurpose(purpose?: string) {
    const normalized = String(purpose || '').trim().toLowerCase();
    return [
      'bind_email',
      'student_change_mobile',
      'student_change_password',
    ].includes(normalized);
  }

  private normalizeEmail(email?: string) {
    return String(email || '').trim().toLowerCase();
  }

  private isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.normalizeEmail(email));
  }

  private maskEmail(email?: string) {
    const normalized = this.normalizeEmail(email);
    if (!this.isValidEmail(normalized)) {
      return '';
    }

    const [localPart, domainPart] = normalized.split('@');
    const visibleLocal = localPart.slice(0, Math.min(3, localPart.length));
    return `${visibleLocal}${'X'.repeat(Math.max(0, localPart.length - visibleLocal.length))}@${domainPart}`;
  }

  private maskMobile(mobile?: string | null) {
    const normalized = String(normalizeMobile(mobile) || '').trim();
    if (!isValidMainlandMobile(normalized)) {
      return '';
    }
    return `${normalized.slice(0, 3)}XXXX${normalized.slice(-4)}`;
  }

  private getRecoveryEmail(user: any) {
    const normalized = this.normalizeEmail(
      user?.student_profile?.email || user?.email || '',
    );
    return this.isValidEmail(normalized) ? normalized : '';
  }

  private getRecoveryMobile(user: any) {
    const normalized = String(
      normalizeMobile(user?.student_profile?.mobile || user?.mobile) || '',
    ).trim();
    return isValidMainlandMobile(normalized) ? normalized : '';
  }

  private async getAuthenticatedStudentVerificationContext(req: any) {
    const userId = String(req.user?.sub || '').trim();
    const studentId = String(req.user?.student_id || '').trim();
    const userType = String(req.user?.user_type || '').trim();

    if (!userId || !studentId || userType !== 'student') {
      throw new ForbiddenException('仅已登录学生可发送该验证码');
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: {
        users: true,
      },
    });

    if (!student || student.user_id.toString() !== userId) {
      throw new ForbiddenException('当前学生身份无效，请重新登录');
    }

    return student;
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  private async loadWeChatMiniappConfig() {
    const envAppId = process.env.WECHAT_MINIAPP_APP_ID || process.env.WX_APP_ID;
    const envAppSecret =
      process.env.WECHAT_MINIAPP_APP_SECRET || process.env.WX_APP_SECRET;

    if (envAppId && envAppSecret) {
      return {
        appId: envAppId,
        appSecret: envAppSecret,
      };
    }

    const rows = await this.prisma.system_settings.findMany({
      where: {
        setting_key: {
          in: ['wechat', 'miniapp', 'mini_program', 'basic'],
        },
      },
    });

    const merged: Record<string, any> = {};
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.setting_val);
        if (parsed && typeof parsed === 'object') {
          Object.assign(merged, parsed);
        }
      } catch {
        // ignore invalid JSON rows
      }
    }

    return {
      appId: String(
        merged.wechatAppId ||
          merged.wxAppId ||
          merged.miniappAppId ||
          merged.miniProgramAppId ||
          merged.appId ||
          '',
      ).trim(),
      appSecret: String(
        merged.wechatAppSecret ||
          merged.wxAppSecret ||
          merged.miniappAppSecret ||
          merged.miniProgramAppSecret ||
          merged.appSecret ||
          '',
      ).trim(),
    };
  }

  private async getWeChatOpenid(code: string): Promise<string | null> {
    const cleanCode = String(code || '').trim();
    if (!cleanCode) {
      return null;
    }

    const { appId, appSecret } = await this.loadWeChatMiniappConfig();
    if (!appId || !appSecret) {
      this.logger.warn('[微信] 缺少小程序 appId/appSecret（认证登录流程中获取 openid）');
      return null;
    }

    return new Promise((resolve) => {
      const params = querystring.stringify({
        appid: appId,
        secret: appSecret,
        js_code: cleanCode,
        grant_type: 'authorization_code',
      });

      const url = `https://api.weixin.qq.com/sns/jscode2session?${params}`;
      const request = https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result?.errcode) {
              this.logger.warn('[微信] jscode2session 失败（认证流程）: 错误码=%d 错误信息=%s', result.errcode, result.errmsg || '');
            }
            resolve(result?.openid ? String(result.openid) : null);
          } catch (error) {
            this.logger.warn('[微信] 解析 jscode2session 响应失败（认证流程）: %s', String(error));
            resolve(null);
          }
        });
      });

      request.on('error', (error) => {
        this.logger.warn('[微信] jscode2session 请求错误（认证流程）: %s', String(error));
        resolve(null);
      });
      request.setTimeout(8000, () => {
        request.destroy();
        this.logger.warn('[微信] jscode2session 请求超时（认证流程）');
        resolve(null);
      });
    });
  }

  private async bindStudentWechatIfNeeded(userId: bigint, openid: string | null) {
    if (!openid) {
      return null;
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        wx_openid: true,
      },
    });

    if (!user) {
      return null;
    }

    const student = await this.prisma.student_profiles.findFirst({
      where: { user_id: userId },
      select: {
        id: true,
        wx_openid: true,
      },
    });

    if (!student) {
      if (user.wx_openid && user.wx_openid !== openid) {
        throw new BadRequestException('该学生已绑定其他微信账号，请先在管理端解绑');
      }

      if (!user.wx_openid) {
        const [existingStudentWithOpenid, existingUserWithOpenid] = await Promise.all([
          this.prisma.student_profiles.findFirst({
            where: { wx_openid: openid },
            select: { id: true },
          }),
          this.prisma.users.findFirst({
            where: {
              wx_openid: openid,
              id: { not: userId },
            },
            select: { id: true },
          }),
        ]);

        if (existingStudentWithOpenid || existingUserWithOpenid) {
          throw new BadRequestException('该微信账号已绑定其他学生，请先在管理端解绑');
        }

        await this.prisma.users.update({
          where: { id: userId },
          data: { wx_openid: openid },
        });
      }

      return null;
    }

    if (student.wx_openid && student.wx_openid !== openid) {
      throw new BadRequestException('该学生已绑定其他微信账号，请先在管理端解绑');
    }

    if (!student.wx_openid) {
      const existingStudentWithOpenid = await this.prisma.student_profiles.findFirst({
        where: {
          wx_openid: openid,
          id: { not: student.id },
        },
        select: { id: true },
      });

      if (existingStudentWithOpenid) {
        throw new BadRequestException('该微信账号已绑定其他学生，请先在管理端解绑');
      }

      await this.prisma.$transaction([
        this.prisma.student_profiles.update({
          where: { id: student.id },
          data: { wx_openid: openid },
        }),
        this.prisma.users.update({
          where: { id: userId },
          data: { wx_openid: openid },
        }),
      ]);
    }

    return student.id.toString();
  }

  private isValidNumericAccount(account: string) {
    return /^\d{6,20}$/.test(String(account || '').trim());
  }

  private isValidUsernameAccount(account: string) {
    return /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(
      String(account || '').trim(),
    );
  }

  private normalizeAccountIdentifier(account: string) {
    const normalized = String(account || '').trim();
    if (!normalized) {
      return '';
    }

    if (this.isValidEmail(normalized)) {
      return this.normalizeEmail(normalized);
    }

    if (this.isValidNumericAccount(normalized)) {
      return isValidMainlandMobile(normalized) ? normalizeMobile(normalized) : normalized;
    }

    if (this.isValidUsernameAccount(normalized)) {
      return normalized;
    }

    return '';
  }

  private requireNonEmailAccount(
    account: string,
    options?: {
      requiredMessage?: string;
      emailMessage?: string;
    },
  ) {
    const normalized = String(account || '').trim();
    if (!normalized) {
      throw new BadRequestException(options?.requiredMessage || '请输入账号');
    }
    if (this.isValidEmail(normalized)) {
      throw new BadRequestException(
        options?.emailMessage || '请使用账号登录，不支持邮箱登录',
      );
    }
    return normalized;
  }

  private getEmailCodeExpireSeconds(rawSecurity: any) {
    return this.clampNumber(
      rawSecurity?.emailCodeExpireSeconds ?? rawSecurity?.verificationExpireSeconds,
      300,
      60,
      1800,
    );
  }

  private getEmailCodeCooldownSeconds(rawSecurity: any) {
    return this.clampNumber(
      rawSecurity?.emailCodeCooldownSeconds ?? rawSecurity?.verificationCooldownSeconds,
      60,
      30,
      600,
    );
  }

  private getCaptchaRefreshLimit(rawSecurity: any) {
    return this.clampNumber(rawSecurity?.captchaRefreshLimit, 10, 1, 200);
  }

  private getCaptchaRefreshWindowSeconds(rawSecurity: any) {
    return this.clampNumber(rawSecurity?.captchaRefreshWindowSeconds, 60, 10, 3600);
  }

  private getCaptchaMaxVerifyAttempts(rawSecurity: any) {
    return this.clampNumber(rawSecurity?.captchaMaxVerifyAttempts, 5, 1, 20);
  }

  private async getRegisterConfig() {
    const accountConfig = await this.configService.getConfig('account', {});
    const rawOpenRegistration = accountConfig?.openRegistration;
    const normalizedOpenRegistration =
      typeof rawOpenRegistration === 'string'
        ? rawOpenRegistration.trim().toLowerCase()
        : rawOpenRegistration;
    const openRegistration = !(
      rawOpenRegistration === false ||
      rawOpenRegistration === 0 ||
      normalizedOpenRegistration === '0' ||
      normalizedOpenRegistration === 'false' ||
      normalizedOpenRegistration === 'off' ||
      normalizedOpenRegistration === 'no'
    );

    return {
      openRegistration,
    };
  }

  private async getRegisterableRoles() {
    const registerConfig = await this.getRegisterConfig();
    if (!registerConfig.openRegistration) {
      return [];
    }
    const roleCatalog = await loadRoleCatalog(this.prisma);
    return toRegisterableRoles(roleCatalog).filter(
      (item) => String(item.scopeType || '').trim().toLowerCase() === 'self',
    );
  }

  private async getRoleNameMap() {
    const roleCatalog = await loadRoleCatalog(this.prisma);
    return toRoleNameMap(roleCatalog);
  }

  private normalizeLoginSecurityConfig(
    rawSecurity: any,
    emailServiceReady: boolean,
    smsServiceReady: boolean,
  ) {
    const mode = String(rawSecurity?.secondFactorMode || '')
      .trim()
      .toLowerCase();
    const legacyEnable2FA =
      rawSecurity?.enable2FA === true ||
      String(rawSecurity?.enable2FA || '').trim().toLowerCase() === 'true';
    const secondFactorMode: 'none' | 'email' | 'sms' | 'email_sms' =
      mode === 'email' || mode === 'sms' || mode === 'email_sms' || mode === 'none'
        ? (mode as any)
        : legacyEnable2FA
          ? 'email'
          : 'none';

    return {
      secondFactorMode,
      captchaEnabled:
        rawSecurity?.loginCaptchaEnabled === true ||
        String(rawSecurity?.loginCaptchaEnabled || '').toLowerCase() === 'true',
      captchaLength: this.clampNumber(rawSecurity?.captchaLength, 4, 4, 6),
      captchaExpireSeconds: this.clampNumber(rawSecurity?.captchaExpireSeconds, 300, 60, 900),
      captchaRefreshLimit: this.getCaptchaRefreshLimit(rawSecurity),
      captchaRefreshWindowSeconds: this.getCaptchaRefreshWindowSeconds(rawSecurity),
      captchaMaxVerifyAttempts: this.getCaptchaMaxVerifyAttempts(rawSecurity),
      emailCodeExpireSeconds: this.getEmailCodeExpireSeconds(rawSecurity),
      emailCodeCooldownSeconds: this.getEmailCodeCooldownSeconds(rawSecurity),
      emailServiceReady,
      smsServiceReady,
    };
  }

  private async getLoginSecurityConfig() {
    const rawSecurity = await this.configService.getConfig('security', {});
    const rawNotification = await this.configService.getSectionConfig('email', {}, ['notification']);
    const rawSms = await this.configService.getSectionConfig('sms', {});
    const emailConfig = normalizeEmailConfig(rawNotification);
    const smsConfig = normalizeSmsConfig(rawSms);
    return this.normalizeLoginSecurityConfig(
      rawSecurity,
      isEmailConfigReady(emailConfig),
      isSmsConfigReady(smsConfig),
    );
  }

  private async getLoginPromptConfig() {
    const rawPrompt = await this.configService.getSectionConfig(
      'loginPrompt',
      {},
      ['login_prompt'],
    );
    const enabled =
      rawPrompt?.enabled === true ||
      String(rawPrompt?.enabled || '').trim().toLowerCase() === 'true';
    const title = String(rawPrompt?.title || '').trim() || '系统提示';
    const content = String(rawPrompt?.content || '').trim();

    return {
      enabled,
      title,
      content,
    };
  }

  private parseChallengeId(rawValue: unknown, fieldName: string) {
    try {
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        throw new Error('empty');
      }
      return BigInt(rawValue as any);
    } catch {
      throw new BadRequestException(`${fieldName} 无效`);
    }
  }

  private parseChallengeTicket(ticket: string, fieldName = 'ticket') {
    const match = /^ticket_(\d+)_\d+$/.exec(String(ticket || '').trim());
    if (!match) {
      throw new BadRequestException(`${fieldName} 无效`);
    }
    return BigInt(match[1]);
  }

  private createChallengeCode(length: number, charset: string) {
    let result = '';
    const safeLength = Math.max(1, Math.floor(length));
    for (let i = 0; i < safeLength; i += 1) {
      result += charset[Math.floor(Math.random() * charset.length)];
    }
    return result;
  }

  private hashChallengeCode(code: string, salt: string) {
    return createHash('sha256').update(salt + code).digest('hex');
  }

  private async createChallenge(input: {
    userId?: bigint | null;
    purpose: string;
    channel: string;
    target: string;
    code: string;
    expireSeconds: number;
  }) {
    const salt = randomBytes(8).toString('hex');
    return this.prisma.auth_challenges.create({
      data: {
        user_id: input.userId ?? null,
        purpose: input.purpose,
        channel: input.channel,
        target: input.target,
        code_hash: this.hashChallengeCode(input.code, salt),
        salt,
        status: 'sent',
        expire_at: new Date(Date.now() + input.expireSeconds * 1000),
        try_count: 0,
      },
    });
  }

  private async ensureChallengeRateLimit(input: {
    purpose: string;
    channel: string;
    target: string;
    windowMs: number;
    maxCount: number;
    message: string;
  }) {
    // 优先使用 Redis 滑动窗口计数（多实例友好）
    const redisKey = `challenge:ratelimit:${input.purpose}:${input.channel}:${input.target}`;
    const windowSec = Math.ceil(input.windowMs / 1000);
    const now = Date.now();
    const windowStart = now - input.windowMs;

    try {
      // 使用 Redis 有序集合实现滑动窗口
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
      pipeline.zadd(redisKey, now, `${now}:${Math.random()}`);
      pipeline.zcard(redisKey);
      pipeline.expire(redisKey, windowSec + 10);
      const results = await pipeline.exec();

      const count = (results?.[2]?.[1] as number) || 0;
      if (count >= input.maxCount) {
        throw new BadRequestException(input.message);
      }
      return;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Redis 不可用时降级到数据库查询
      this.logger.warn('[频率限制] Redis 不可用，降级为数据库查询');
    }

    const count = await this.prisma.auth_challenges.count({
      where: {
        purpose: input.purpose,
        channel: input.channel,
        target: input.target,
        created_at: {
          gte: new Date(windowStart),
        },
      },
    });
    if (count >= input.maxCount) {
      throw new BadRequestException(input.message);
    }
  }

  private async getUserByAccount(account: string) {
    const normalizedAccount = String(account || '').trim();
    if (!normalizedAccount) {
      return null;
    }

    let user = await this.prisma.users.findFirst({
      where: {
        OR: [
          { mobile: normalizedAccount },
          { email: this.normalizeEmail(normalizedAccount) },
        ],
      },
      include: {
        student_profile: true,
      },
    });

    if (!user) {
      const student = await this.prisma.student_profiles.findFirst({
        where: {
          OR: [
            { student_no: normalizedAccount },
            { email: this.normalizeEmail(normalizedAccount) },
            { mobile: normalizedAccount },
          ],
        },
        include: {
          users: {
            include: {
              student_profile: true,
            },
          },
        },
      });
      if (student?.users) {
        user = {
          ...student.users,
          student_profile: student.users.student_profile || student,
        } as any;
      }
    }

    return user;
  }

  private async ensurePasswordUpgraded(userId: bigint, plainPassword: string, hash: string) {
    if (isBcryptHash(hash)) {
      return;
    }

    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: await hashPassword(plainPassword) },
    });
  }

  private async verifyAccountPassword(account: string, password: string) {
    const user = await this.getUserByAccount(account);
    if (!user?.password_hash) {
      return null;
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return null;
    }

    await this.ensurePasswordUpgraded(user.id, password, user.password_hash);
    return user;
  }

  private async verifyCaptcha(challengeIdRaw: unknown, captchaCode: string) {
    const loginSecurity = await this.getLoginSecurityConfig();
    const challengeId = this.parseChallengeId(challengeIdRaw, 'captcha_id');
    const normalizedCode = String(captchaCode || '').trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException('请输入图形验证码');
    }

    const challenge = await this.prisma.auth_challenges.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) {
      throw new BadRequestException('图形验证码不存在或已失效');
    }
    if (
      challenge.status !== 'sent' ||
      challenge.channel !== 'captcha' ||
      challenge.purpose !== 'admin_login_captcha' ||
      challenge.expire_at.getTime() < Date.now()
    ) {
      throw new BadRequestException('图形验证码已失效，请刷新后重试');
    }

    const candidateHash = this.hashChallengeCode(normalizedCode, challenge.salt);
    if (candidateHash !== challenge.code_hash) {
      const tryCount = challenge.try_count + 1;
      const maxVerifyAttempts = loginSecurity.captchaMaxVerifyAttempts;
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          try_count: tryCount,
          status: tryCount >= maxVerifyAttempts ? 'locked' : challenge.status,
        },
      });
      throw new BadRequestException(
        tryCount >= maxVerifyAttempts
          ? '图形验证码错误次数过多，请刷新后重试'
          : '图形验证码错误',
      );
    }

    await this.prisma.auth_challenges.update({
      where: { id: challenge.id },
      data: { status: 'verified', verified_at: new Date() },
    });
  }

  private async consumeVerifiedTicket(input: {
    ticket: string;
    expectedPurpose: string;
    expectedChannel: string;
    expectedTarget?: string;
    expectedUserId?: bigint;
    fieldName?: string;
  }) {
    const challengeId = this.parseChallengeTicket(input.ticket, input.fieldName || 'ticket');
    const challenge = await this.prisma.auth_challenges.findUnique({
      where: { id: challengeId },
    });
    if (!challenge) {
      throw new BadRequestException(`${input.fieldName || 'ticket'} 不存在或已失效`);
    }
    if (
      challenge.status !== 'verified' ||
      !challenge.verified_at ||
      challenge.expire_at.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        `${input.fieldName || 'ticket'} 已过期，请重新获取验证码`,
      );
    }
    if (
      challenge.purpose !== input.expectedPurpose ||
      challenge.channel !== input.expectedChannel
    ) {
      throw new BadRequestException(`${input.fieldName || 'ticket'} 类型不匹配`);
    }
    if (
      input.expectedTarget &&
      String(challenge.target || '').trim().toLowerCase() !==
        String(input.expectedTarget || '').trim().toLowerCase()
    ) {
      throw new BadRequestException(`${input.fieldName || 'ticket'} 与当前账号不匹配`);
    }
    if (
      input.expectedUserId &&
      challenge.user_id &&
      challenge.user_id.toString() !== input.expectedUserId.toString()
    ) {
      throw new BadRequestException(`${input.fieldName || 'ticket'} 与当前账号不匹配`);
    }

    await this.prisma.auth_challenges.update({
      where: { id: challenge.id },
      data: { status: 'used' },
    });
  }

  private createCaptchaSvg(code: string) {
    const charCount = Math.max(1, code.length);
    const width = Math.max(132, 36 + charCount * 24);
    const height = 44;
    const background = ['#f8fafc', '#eef2ff', '#fef3c7', '#dcfce7'][Math.floor(Math.random() * 4)];
    const step = charCount > 1 ? Math.min(26, (width - 36) / (charCount - 1)) : 0;
    const startX = charCount > 1 ? Math.max(18, (width - step * (charCount - 1)) / 2) : width / 2;

    const chars = code
      .split('')
      .map((char, index) => {
        const x = Math.round(startX + index * step);
        const y = 28 + Math.floor(Math.random() * 6);
        const rotate = Math.floor(Math.random() * 40) - 20;
        const color = ['#1f2937', '#7c2d12', '#1d4ed8', '#166534'][Math.floor(Math.random() * 4)];
        return `<text x="${x}" y="${y}" font-size="24" font-family="Arial" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
      })
      .join('');

    const lines = Array.from({ length: 4 })
      .map(() => {
        const x1 = Math.floor(Math.random() * width);
        const y1 = Math.floor(Math.random() * height);
        const x2 = Math.floor(Math.random() * width);
        const y2 = Math.floor(Math.random() * height);
        const stroke = ['#cbd5e1', '#fecaca', '#bfdbfe', '#bbf7d0'][Math.floor(Math.random() * 4)];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1" />`;
      })
      .join('');

    const dots = Array.from({ length: 18 })
      .map(() => {
        const cx = Math.floor(Math.random() * width);
        const cy = Math.floor(Math.random() * height);
        const fill = ['#94a3b8', '#f59e0b', '#60a5fa', '#4ade80'][Math.floor(Math.random() * 4)];
        return `<circle cx="${cx}" cy="${cy}" r="1.1" fill="${fill}" />`;
      })
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="8" fill="${background}" />${lines}${dots}${chars}</svg>`;
  }

  private async loadVerifyEmailTemplate(
    purpose: string,
    code: string,
    target: string,
    expireSeconds: number,
  ) {
    const normalizedPurpose = String(purpose || '').trim().toLowerCase();
    const templateCode =
      normalizedPurpose === 'bind_email'
        ? 'AUTH_BIND_EMAIL_CODE'
        : normalizedPurpose === 'admin_login'
          ? 'ADMIN_LOGIN_VERIFY_CODE'
          : normalizedPurpose === 'password_reset'
            ? 'PASSWORD_RESET_EMAIL_CODE'
          : 'AUTH_VERIFY_CODE';

    const template = await this.prisma.message_templates.findFirst({
      where: {
        channel: 'email',
        template_code: templateCode,
        status: 'active',
      },
    });

    const params = {
      code,
      email: target,
      target,
      purpose,
      expire_seconds: expireSeconds,
      expireSeconds,
      expire_minutes: Math.max(1, Math.ceil(expireSeconds / 60)),
      expireMinutes: Math.max(1, Math.ceil(expireSeconds / 60)),
    };

    const fallbackSubject =
      normalizedPurpose === 'bind_email'
        ? '邮箱绑定验证码'
        : normalizedPurpose === 'admin_login'
          ? '管理端登录验证码'
          : normalizedPurpose === 'password_reset'
            ? '密码重置验证码'
          : '邮箱验证码通知';
    const fallbackText =
      normalizedPurpose === 'bind_email'
        ? '您正在绑定邮箱 {email}，验证码为 {code}，{expire_minutes} 分钟内有效。'
        : normalizedPurpose === 'admin_login'
          ? '您正在登录管理端，验证码为 {code}，{expire_minutes} 分钟内有效。'
          : normalizedPurpose === 'password_reset'
            ? '您正在重置账号密码，验证码为 {code}，{expire_minutes} 分钟内有效。如非本人操作，请立即修改密码并联系管理员。'
          : '您的验证码为 {code}，{expire_minutes} 分钟内有效。';

    const subject = renderTemplate(
      normalizeEmailDisplayText(template?.title, fallbackSubject),
      params,
    );
    const text = renderTemplate(template?.content || fallbackText, params);
    return {
      subject,
      text,
      html: text.replace(/\n/g, '<br />'),
    };
  }

  private async loadVerifySmsContent(
    purpose: string,
    code: string,
    target: string,
    expireSeconds: number,
  ) {
    const normalizedPurpose = String(purpose || '').trim().toLowerCase();
    const templateCode =
      normalizedPurpose === 'password_reset' ? 'PASSWORD_RESET_SMS_CODE' : 'AUTH_VERIFY_CODE';

    const template = await this.prisma.message_templates.findFirst({
      where: {
        channel: 'sms',
        template_code: templateCode,
        status: 'active',
      },
    });

    const basicConfig = await this.configService.getConfig('basic', {});
    const params = {
      system_name: basicConfig?.systemName || '学业预警系统',
      code,
      mobile: target,
      target,
      purpose,
      expire_seconds: expireSeconds,
      expireSeconds,
      expire_minutes: Math.max(1, Math.ceil(expireSeconds / 60)),
      expireMinutes: Math.max(1, Math.ceil(expireSeconds / 60)),
    };

    const fallbackContent =
      normalizedPurpose === 'password_reset'
        ? '【{system_name}】您正在找回账号密码，验证码 {code}，{expire_minutes} 分钟内有效。'
        : '【{system_name}】验证码 {code}，{expire_minutes} 分钟内有效。';

    return renderTemplate(template?.content || fallbackContent, params);
  }

  private async ensureSysAdmin(userId: bigint) {
    const role = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role: { in: ['sys_admin', 'admin'] },
      },
    });

    if (!role) {
      throw new ForbiddenException('仅系统管理员可管理注册配置');
    }
  }

  @Public()
  @Get('login-security')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getAdminLoginSecurity(@Req() req: any) {
    const loginSecurity = await this.getLoginSecurityConfig();
    return {
      code: 0,
      message: 'ok',
      data: {
        secondFactorMode: loginSecurity.secondFactorMode,
        captchaEnabled: loginSecurity.captchaEnabled,
        captchaLength: loginSecurity.captchaLength,
        captchaExpireSeconds: loginSecurity.captchaExpireSeconds,
        captchaRefreshLimit: loginSecurity.captchaRefreshLimit,
        captchaRefreshWindowSeconds: loginSecurity.captchaRefreshWindowSeconds,
        captchaMaxVerifyAttempts: loginSecurity.captchaMaxVerifyAttempts,
        emailCodeExpireSeconds: loginSecurity.emailCodeExpireSeconds,
        emailCodeCooldownSeconds: loginSecurity.emailCodeCooldownSeconds,
        emailServiceReady: loginSecurity.emailServiceReady,
        smsServiceReady: loginSecurity.smsServiceReady,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Get('captcha')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async getLoginCaptcha(@Req() req: any) {
    const loginSecurity = await this.getLoginSecurityConfig();
    const ipTag = String(req.ip || 'anonymous').trim().toLowerCase();

    await this.ensureChallengeRateLimit({
      purpose: 'admin_login_captcha',
      channel: 'captcha',
      target: ipTag,
      windowMs: loginSecurity.captchaRefreshWindowSeconds * 1000,
      maxCount: loginSecurity.captchaRefreshLimit,
      message: `图形验证码刷新过于频繁，请在 ${loginSecurity.captchaRefreshWindowSeconds} 秒后再试`,
    });

    const captchaCode = this.createChallengeCode(
      loginSecurity.captchaLength,
      '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
    );
    const challenge = await this.createChallenge({
      purpose: 'admin_login_captcha',
      channel: 'captcha',
      target: ipTag,
      code: captchaCode,
      expireSeconds: loginSecurity.captchaExpireSeconds,
    });
    const svg = this.createCaptchaSvg(captchaCode);

    return {
      code: 0,
      message: 'ok',
      data: {
        captchaId: challenge.id.toString(),
        image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        expireSeconds: loginSecurity.captchaExpireSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('recovery/options')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getRecoveryOptions(@Body() dto: RecoveryOptionsDto, @Req() req: any) {
    const account = this.requireNonEmailAccount(dto.account, {
      requiredMessage: '请输入账号（学号）',
      emailMessage: '请使用账号（学号）查找，不支持直接输入邮箱',
    });

    const user = await this.getUserByAccount(account);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_lookup_failed',
          detail_json: {
            reason: 'account_not_found',
            account,
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      throw new BadRequestException('账号不存在');
    }

    const loginSecurity = await this.getLoginSecurityConfig();
    const recoveryEmail = this.getRecoveryEmail(user);
    const recoveryMobile = this.getRecoveryMobile(user);

    return {
      code: 0,
      message: 'ok',
      data: {
        account,
        email: {
          bound: Boolean(recoveryEmail),
          masked: recoveryEmail ? this.maskEmail(recoveryEmail) : '',
          enabled: Boolean(recoveryEmail) && loginSecurity.emailServiceReady,
          reason: recoveryEmail
            ? loginSecurity.emailServiceReady
              ? ''
              : '邮件服务暂未配置完成'
            : '当前账号未绑定邮箱',
        },
        sms: {
          bound: Boolean(recoveryMobile),
          masked: recoveryMobile ? this.maskMobile(recoveryMobile) : '',
          enabled: Boolean(recoveryMobile) && loginSecurity.smsServiceReady,
          reason: recoveryMobile
            ? loginSecurity.smsServiceReady
              ? ''
              : '短信服务暂未配置完成'
            : '当前账号未绑定手机号',
        },
        cooldown_seconds: loginSecurity.emailCodeCooldownSeconds,
        expire_seconds: loginSecurity.emailCodeExpireSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('send_code')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sendCode(@Body() dto: SendCodeDto, @Req() req: any) {
    const purpose = String(dto.purpose || '').trim();
    const channel = this.normalizeChannel(dto.channel);
    const target = String(dto.target || '').trim();
    const loginSecurity = await this.getLoginSecurityConfig();
    const expireSeconds = loginSecurity.emailCodeExpireSeconds;
    const cooldownSeconds = loginSecurity.emailCodeCooldownSeconds;

    if (!purpose || !channel || !target) {
      throw new BadRequestException('purpose、channel、target 不能为空');
    }
    if (!this.isAllowedPublicVerificationPurpose(purpose)) {
      throw new BadRequestException('当前用途不支持发送验证码');
    }
    if (channel !== 'email') {
      throw new BadRequestException(`暂不支持该验证码渠道: ${channel}`);
    }
    if (!this.isValidEmail(target)) {
      throw new BadRequestException('请输入有效的邮箱地址');
    }

    const normalizedTarget = this.normalizeEmail(target);
    const student = await this.getAuthenticatedStudentVerificationContext(req);
    const normalizedPurpose = purpose.toLowerCase();
    if (
      normalizedPurpose === 'student_change_mobile' ||
      normalizedPurpose === 'student_change_password'
    ) {
      const recoveryEmail = this.getRecoveryEmail(student);
      if (!recoveryEmail) {
        throw new BadRequestException('当前账号未绑定有效邮箱');
      }
      if (normalizedTarget !== recoveryEmail) {
        throw new BadRequestException('验证码发送目标与当前绑定邮箱不一致');
      }
    }
    await this.ensureChallengeRateLimit({
      purpose,
      channel,
      target: normalizedTarget,
      windowMs: cooldownSeconds * 1000,
      maxCount: 1,
      message: `请在 ${cooldownSeconds} 秒后再试`,
    });

    const code = this.createChallengeCode(6, '0123456789');
    const challenge = await this.createChallenge({
      purpose,
      channel,
      target: normalizedTarget,
      code,
      expireSeconds,
    });

    let provider = 'smtp';
    let messageId: string | null = null;
    try {
      const rawNotificationConfig = await this.configService.getSectionConfig('email', {}, ['notification']);
      const emailConfig = normalizeEmailConfig(rawNotificationConfig);
      const template = await this.loadVerifyEmailTemplate(purpose, code, target, expireSeconds);
      const result = await sendEmail(emailConfig, {
        to: target,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });

      provider = emailConfig.provider || 'smtp';
      messageId = result.messageId || null;
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          send_provider: provider,
          send_msg_id: messageId,
        },
      });
    } catch (error: any) {
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          status: 'failed',
          send_provider: 'smtp',
          send_msg_id: null,
        },
      });
      await this.prisma.security_events.create({
        data: {
          event_type: 'mfa_send_failed',
          detail_json: {
            challenge_id: challenge.id.toString(),
            purpose,
            channel,
            target: normalizedTarget,
            error: error?.message || 'send_failed',
          } as any,
          ip: req.ip,
          user_id: student.user_id,
        },
      });
      throw new BadRequestException(error?.message || '验证码发送失败');
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'mfa_send_email',
        detail_json: {
          challenge_id: challenge.id.toString(),
          purpose,
          channel,
          provider,
        } as any,
        ip: req.ip,
        user_id: student.user_id,
      },
    });

    return {
      code: 0,
      message: '验证码已发送',
      data: {
        challenge_id: challenge.id.toString(),
        expire_seconds: expireSeconds,
        cooldown_seconds: cooldownSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('recovery/send-email-code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sendRecoveryEmailCode(@Body() dto: SendRecoveryEmailCodeDto, @Req() req: any) {
    const account = this.requireNonEmailAccount(dto.account, {
      requiredMessage: '请输入账号（学号）',
      emailMessage: '请使用账号（学号）找回密码，不支持直接输入邮箱',
    });
    const providedEmail = this.normalizeEmail(dto.email);
    if (!providedEmail || !this.isValidEmail(providedEmail)) {
      throw new BadRequestException('请输入正确的邮箱');
    }

    const loginSecurity = await this.getLoginSecurityConfig();
    if (!loginSecurity.emailServiceReady) {
      throw new BadRequestException('邮件服务暂未配置完成，暂时无法通过邮箱找回密码');
    }

    const user = await this.getUserByAccount(account);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: 'account_not_found',
            account,
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      throw new BadRequestException('账号不存在');
    }

    const targetEmail = this.getRecoveryEmail(user);
    if (!targetEmail) {
      throw new BadRequestException('当前账号未绑定可用邮箱');
    }
    if (providedEmail !== targetEmail) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: 'email_mismatch',
            account,
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      throw new BadRequestException('输入的邮箱与账号绑定邮箱不一致');
    }

    const expireSeconds = loginSecurity.emailCodeExpireSeconds;
    const cooldownSeconds = loginSecurity.emailCodeCooldownSeconds;
    await this.ensureChallengeRateLimit({
      purpose: 'password_reset',
      channel: 'email',
      target: targetEmail,
      windowMs: cooldownSeconds * 1000,
      maxCount: 1,
      message: `请在 ${cooldownSeconds} 秒后再试`,
    });

    const code = this.createChallengeCode(6, '0123456789');
    const challenge = await this.createChallenge({
      userId: user.id,
      purpose: 'password_reset',
      channel: 'email',
      target: targetEmail,
      code,
      expireSeconds,
    });

    try {
      const rawNotificationConfig = await this.configService.getSectionConfig('email', {}, ['notification']);
      const emailConfig = normalizeEmailConfig(rawNotificationConfig);
      const template = await this.loadVerifyEmailTemplate(
        'password_reset',
        code,
        targetEmail,
        expireSeconds,
      );
      const result = await sendEmail(emailConfig, {
        to: targetEmail,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });

      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          send_provider: emailConfig.provider || 'smtp',
          send_msg_id: result.messageId || null,
        },
      });
    } catch (error: any) {
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          status: 'failed',
          send_provider: 'smtp',
          send_msg_id: null,
        },
      });
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: error?.message || 'send_failed',
            account,
            challenge_id: challenge.id.toString(),
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      throw new BadRequestException(error?.message || '验证码发送失败');
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'password_reset_send_email',
        detail_json: {
          account,
          challenge_id: challenge.id.toString(),
        } as any,
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: '验证码已发送',
      data: {
        challenge_id: challenge.id.toString(),
        target: this.maskEmail(targetEmail),
        expire_seconds: expireSeconds,
        cooldown_seconds: cooldownSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('recovery/send-sms-code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sendRecoverySmsCode(@Body() dto: SendRecoverySmsCodeDto, @Req() req: any) {
    const account = this.requireNonEmailAccount(dto.account, {
      requiredMessage: '请输入账号（学号）',
      emailMessage: '请使用账号（学号）找回密码，不支持直接输入邮箱',
    });
    const providedMobile = String(normalizeMobile(dto.mobile) || '').trim();
    if (!isValidMainlandMobile(providedMobile)) {
      throw new BadRequestException('请输入正确的手机号');
    }

    const loginSecurity = await this.getLoginSecurityConfig();
    if (!loginSecurity.smsServiceReady) {
      throw new BadRequestException('短信服务暂未配置完成，暂时无法通过短信找回密码');
    }

    const user = await this.getUserByAccount(account);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: 'account_not_found',
            account,
            channel: 'sms',
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      throw new BadRequestException('账号不存在');
    }

    const targetMobile = this.getRecoveryMobile(user);
    if (!targetMobile) {
      throw new BadRequestException('当前账号未绑定可用手机号');
    }
    if (providedMobile !== targetMobile) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: 'mobile_mismatch',
            account,
            channel: 'sms',
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      throw new BadRequestException('输入的手机号与账号绑定手机号不一致');
    }

    const expireSeconds = loginSecurity.emailCodeExpireSeconds;
    const cooldownSeconds = loginSecurity.emailCodeCooldownSeconds;
    await this.ensureChallengeRateLimit({
      purpose: 'password_reset',
      channel: 'sms',
      target: targetMobile,
      windowMs: cooldownSeconds * 1000,
      maxCount: 1,
      message: `请在 ${cooldownSeconds} 秒后再试`,
    });

    const code = this.createChallengeCode(6, '0123456789');
    const challenge = await this.createChallenge({
      userId: user.id,
      purpose: 'password_reset',
      channel: 'sms',
      target: targetMobile,
      code,
      expireSeconds,
    });

    try {
      const rawSmsConfig = await this.configService.getSectionConfig('sms', {});
      const smsConfig = normalizeSmsConfig(rawSmsConfig);
      const content = await this.loadVerifySmsContent(
        'password_reset',
        code,
        targetMobile,
        expireSeconds,
      );
      const result = await sendSms(smsConfig, {
        mobiles: [targetMobile],
        content,
        templateCode: 'PASSWORD_RESET_SMS_CODE',
        params: {
          code,
          mobile: targetMobile,
          expire_seconds: expireSeconds,
          expire_minutes: Math.max(1, Math.ceil(expireSeconds / 60)),
        },
      });

      if (!result.success) {
        throw new Error(result.error || '短信验证码发送失败');
      }

      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          send_provider: result.provider || smsConfig.provider || 'custom_http',
          send_msg_id: result.msgId || null,
        },
      });
    } catch (error: any) {
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          status: 'failed',
          send_provider: 'sms',
          send_msg_id: null,
        },
      });
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_send_failed',
          detail_json: {
            reason: error?.message || 'send_failed',
            account,
            channel: 'sms',
            challenge_id: challenge.id.toString(),
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      throw new BadRequestException(error?.message || '验证码发送失败');
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'password_reset_send_sms',
        detail_json: {
          account,
          channel: 'sms',
          challenge_id: challenge.id.toString(),
        } as any,
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: '验证码已发送',
      data: {
        challenge_id: challenge.id.toString(),
        target: this.maskMobile(targetMobile),
        expire_seconds: expireSeconds,
        cooldown_seconds: cooldownSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('send_login_code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async sendLoginCode(@Body() dto: SendLoginCodeDto, @Req() req: any) {
    const account = this.requireNonEmailAccount(dto.account, {
      requiredMessage: '请输入账号后再发送验证码',
      emailMessage: '请使用账号登录，不支持邮箱登录',
    });
    const password = String(dto.password || '');
    if (!password) {
      throw new BadRequestException('请输入账号和密码后再发送验证码');
    }

    const loginSecurity = await this.getLoginSecurityConfig();
    const expireSeconds = loginSecurity.emailCodeExpireSeconds;
    const cooldownSeconds = loginSecurity.emailCodeCooldownSeconds;
    if (loginSecurity.secondFactorMode === 'none') {
      throw new BadRequestException('当前未启用二次验证');
    }
    if (
      loginSecurity.secondFactorMode === 'sms' ||
      loginSecurity.secondFactorMode === 'email_sms'
    ) {
      throw new BadRequestException('当前系统未接入短信服务，请改用邮箱验证');
    }
    if (!loginSecurity.emailServiceReady) {
      throw new BadRequestException(
        '邮件服务尚未配置完整，请先在系统配置中完成 SMTP 配置',
      );
    }

    const user = await this.verifyAccountPassword(account, password);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'mfa_failed',
          detail_json: {
            reason: 'account_or_password_invalid',
            account,
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      throw new BadRequestException('账号或密码错误');
    }

    if (loginSecurity.captchaEnabled) {
      await this.verifyCaptcha(dto.captcha_id, dto.captcha_code || '');
    }

    const targetEmail = this.getRecoveryEmail(user);
    if (!targetEmail || !this.isValidEmail(targetEmail)) {
      throw new BadRequestException('当前账号未绑定有效邮箱，无法发送登录验证码');
    }

    await this.ensureChallengeRateLimit({
      purpose: 'admin_login',
      channel: 'email',
      target: targetEmail,
      windowMs: cooldownSeconds * 1000,
      maxCount: 1,
      message: `请在 ${cooldownSeconds} 秒后再试`,
    });

    const code = this.createChallengeCode(6, '0123456789');
    const challenge = await this.createChallenge({
      userId: user.id,
      purpose: 'admin_login',
      channel: 'email',
      target: targetEmail,
      code,
      expireSeconds,
    });

    try {
      const rawNotificationConfig = await this.configService.getSectionConfig('email', {}, ['notification']);
      const emailConfig = normalizeEmailConfig(rawNotificationConfig);
      const template = await this.loadVerifyEmailTemplate(
        'admin_login',
        code,
        targetEmail,
        expireSeconds,
      );
      const result = await sendEmail(emailConfig, {
        to: targetEmail,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });

      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          send_provider: emailConfig.provider || 'smtp',
          send_msg_id: result.messageId || null,
        },
      });
    } catch (error: any) {
      await this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: {
          status: 'failed',
          send_provider: 'smtp',
          send_msg_id: null,
        },
      });
      throw new BadRequestException(error?.message || '登录验证码发送失败');
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'mfa_send_email',
        detail_json: {
          challenge_id: challenge.id.toString(),
          purpose: 'admin_login',
          account,
          user_id: user.id.toString(),
        } as any,
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: '验证码已发送',
      data: {
        challenge_id: challenge.id.toString(),
        target: this.maskEmail(targetEmail),
        expire_seconds: expireSeconds,
        cooldown_seconds: cooldownSeconds,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('verify_code')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async verifyCode(@Body() dto: VerifyCodeDto, @Req() req: any) {
    const loginSecurity = await this.getLoginSecurityConfig();
    const id = this.parseChallengeId(dto.challenge_id, 'challenge_id');
    const record = await this.prisma.auth_challenges.findUnique({
      where: { id },
    });

    if (!record) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'mfa_failed',
          detail_json: {
            reason: 'not_found',
            challenge_id: String(dto.challenge_id),
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      return { code: 4001, message: '验证码记录不存在', data: null, trace_id: req.trace_id };
    }

    if (record.status === 'locked') {
      return {
        code: 4002,
        message: '验证码已锁定，请重新发送验证码后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (record.status !== 'sent' || record.expire_at < new Date()) {
      return { code: 4002, message: '验证码已过期', data: null, trace_id: req.trace_id };
    }

    const candidateHash = this.hashChallengeCode(String(dto.code || '').trim(), record.salt);
    if (candidateHash !== record.code_hash) {
      const newTryCount = record.try_count + 1;
      const shouldLock = newTryCount >= loginSecurity.captchaMaxVerifyAttempts;
      await this.prisma.auth_challenges.update({
        where: { id },
        data: {
          try_count: newTryCount,
          ...(shouldLock ? { status: 'locked' } : {}),
        },
      });
      await this.prisma.security_events.create({
        data: {
          event_type: 'mfa_failed',
          detail_json: {
            reason: shouldLock ? 'locked_too_many_attempts' : 'code_mismatch',
            challenge_id: String(dto.challenge_id),
            try_count: newTryCount,
          } as any,
          ip: req.ip,
          user_id: record.user_id || null,
        },
      });
      return {
        code: 4003,
        message: shouldLock ? '尝试次数过多，验证码已锁定' : '验证码错误',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.auth_challenges.update({
      where: { id },
      data: { status: 'verified', verified_at: new Date() },
    });

    return {
      code: 0,
      message: 'ok',
      data: { ticket: `ticket_${record.id}_${Date.now()}` },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('recovery/reset-password')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: any) {
    const account = this.requireNonEmailAccount(dto.account, {
      requiredMessage: '请输入账号（学号）',
      emailMessage: '请使用账号（学号）找回密码，不支持直接输入邮箱',
    });
    const recoveryChannel = this.normalizeChannel(dto.channel) === 'sms' ? 'sms' : 'email';
    const providedEmail = this.normalizeEmail(dto.email);
    const providedMobile = String(normalizeMobile(dto.mobile) || '').trim();
    const ticket = String(dto.ticket || '').trim();
    const newPassword = String(dto.new_password || '');

    if (!ticket || !newPassword) {
      throw new BadRequestException('请填写完整的找回信息');
    }
    if (recoveryChannel === 'email' && !this.isValidEmail(providedEmail)) {
      throw new BadRequestException('请输入正确的邮箱');
    }
    if (recoveryChannel === 'sms' && !isValidMainlandMobile(providedMobile)) {
      throw new BadRequestException('请输入正确的手机号');
    }
    if (isWeakPassword(newPassword)) {
      throw new BadRequestException('新密码强度过低，请至少使用 8 位并混合两种字符类型');
    }

    const user = await this.getUserByAccount(account);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_failed',
          detail_json: {
            reason: 'account_not_found',
            account,
            channel: recoveryChannel,
          } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      throw new BadRequestException('账号不存在');
    }

    let expectedChannel: 'email' | 'sms' = 'email';
    let expectedTarget = '';

    if (recoveryChannel === 'sms') {
      const targetMobile = this.getRecoveryMobile(user);
      if (!targetMobile) {
        throw new BadRequestException('当前账号未绑定可用手机号');
      }
      if (providedMobile !== targetMobile) {
        throw new BadRequestException('输入的手机号与账号绑定手机号不一致');
      }
      expectedChannel = 'sms';
      expectedTarget = targetMobile;
    } else {
      const targetEmail = this.getRecoveryEmail(user);
      if (!targetEmail) {
        throw new BadRequestException('当前账号未绑定可用邮箱');
      }
      if (providedEmail !== targetEmail) {
        throw new BadRequestException('输入的邮箱与账号绑定邮箱不一致');
      }
      expectedChannel = 'email';
      expectedTarget = targetEmail;
    }
    if (user.password_hash && (await verifyPassword(newPassword, user.password_hash))) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    try {
      await this.consumeVerifiedTicket({
        ticket,
        expectedPurpose: 'password_reset',
        expectedChannel,
        expectedTarget,
        expectedUserId: user.id,
      });
    } catch (error: any) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'password_reset_failed',
          detail_json: {
            reason: error?.message || 'ticket_invalid',
            account,
            channel: recoveryChannel,
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      throw error;
    }

    const resetOperations: any[] = [
      this.prisma.users.update({
        where: { id: user.id },
        data: {
          password_hash: await hashPassword(newPassword),
          updated_at: new Date(),
        },
      }),
    ];

    if (user.user_type === 'student') {
      resetOperations.push(
        this.prisma.student_profiles.updateMany({
          where: { user_id: user.id },
          data: { initial_password: null },
        }),
      );
    }

    await this.prisma.$transaction(resetOperations);

    await this.prisma.security_events.create({
      data: {
        event_type: 'password_reset_success',
        detail_json: {
          account,
          via: recoveryChannel,
        } as any,
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: '密码已重置，请使用新密码登录',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('login_admin')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async loginAdmin(@Body() dto: LoginAdminDto, @Req() req: any) {
    let account = '';
    try {
      account = this.requireNonEmailAccount(dto.account, {
        requiredMessage: '请输入账号',
        emailMessage: '请使用账号登录，不支持邮箱登录',
      });
    } catch (error: any) {
      return {
        code: 4010,
        message: error?.message || '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const password = String(dto.password || '');
    if (!password) {
      return {
        code: 4010,
        message: '请输入密码',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const user = await this.verifyAccountPassword(account, password);
    if (!user) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'login_failed',
          detail_json: { reason: 'account_or_password_invalid', account } as any,
          ip: req.ip,
          user_id: null,
        },
      });
      return {
        code: 4010,
        message: '账号或密码错误',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const providedName = String(dto.name || '').trim();
    if (
      user.user_type === 'student' &&
      providedName &&
      String(user.name || '').trim() !== providedName
    ) {
      return {
        code: 4010,
        message: '姓名不匹配',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const loginSecurity = await this.getLoginSecurityConfig();
    try {
      if (loginSecurity.secondFactorMode === 'sms') {
        throw new BadRequestException('当前系统未接入短信服务，请改用邮箱验证');
      }
      if (loginSecurity.secondFactorMode === 'email_sms') {
        throw new BadRequestException('当前系统未接入短信服务，暂不支持短信与邮箱双重验证');
      }

      if (loginSecurity.secondFactorMode === 'email') {
        if (!dto.email_ticket) {
          throw new BadRequestException('请输入邮箱验证码并完成校验');
        }
        const targetEmail = this.getRecoveryEmail(user);
        if (!targetEmail) {
          throw new BadRequestException('当前账号未绑定邮箱，无法完成二次验证');
        }
        await this.consumeVerifiedTicket({
          ticket: dto.email_ticket,
          expectedPurpose: 'admin_login',
          expectedChannel: 'email',
          expectedTarget: targetEmail,
          expectedUserId: user.id,
          fieldName: 'email_ticket',
        });
      } else if (loginSecurity.captchaEnabled) {
        await this.verifyCaptcha(dto.captcha_id, dto.captcha_code || '');
      }
    } catch (error: any) {
      await this.prisma.security_events.create({
        data: {
          event_type: 'mfa_failed',
          detail_json: {
            reason: error?.message || 'login_security_check_failed',
            account,
          } as any,
          ip: req.ip,
          user_id: user.id,
        },
      });
      return {
        code: 4011,
        message: error?.message || '登录校验失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    let studentProfileId: string | null = null;
    if (user.user_type === 'student') {
      const wxOpenid = dto.wx_code
        ? await this.getWeChatOpenid(dto.wx_code)
        : null;
      studentProfileId = await this.bindStudentWechatIfNeeded(user.id, wxOpenid);

      if (!studentProfileId) {
        const studentProfile = await this.prisma.student_profiles.findFirst({
          where: { user_id: user.id },
          select: { id: true },
        });
        studentProfileId = studentProfile?.id.toString() || null;
      }
    }

    const payload: Record<string, string> = {
      sub: user.id.toString(),
      user_type: user.user_type,
    };
    if (studentProfileId) {
      payload.student_id = studentProfileId;
    }
    if (user.user_type === 'student') {
      const studentWxOpenid = String(
        user?.student_profile?.wx_openid || user?.wx_openid || '',
      ).trim();
      if (studentWxOpenid) {
        payload.wx_openid = studentWxOpenid;
      }
    }

    const token = await this.jwtService.signAsync(payload);

    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: user.id },
    });
    const [roleNameMap, loginPrompt] = await Promise.all([
      this.getRoleNameMap(),
      this.getLoginPromptConfig(),
    ]);
    const normalizedRoles = userRoles.map((item) => ({
      ...item,
      role: normalizeRoleCode(item.role),
    }));

    await this.prisma.security_events.create({
      data: {
        event_type: 'login_success',
        detail_json: {
          account,
          user_type: user.user_type,
          second_factor_mode: loginSecurity.secondFactorMode,
          captcha_enabled: loginSecurity.captchaEnabled,
        } as any,
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        token,
        user_type: user.user_type,
        student_id: studentProfileId,
        roles: normalizedRoles.map((item) => ({
          role: item.role,
          role_name: roleNameMap[item.role] || item.role,
          scope_type: item.scope_type,
          scope_id: item.scope_id,
        })),
        role_names: normalizedRoles
          .map((item) => roleNameMap[item.role])
          .filter(Boolean),
        login_prompt:
          loginPrompt.enabled && loginPrompt.content
            ? {
                title: loginPrompt.title,
                content: loginPrompt.content,
              }
            : null,
        user: {
          id: user.id.toString(),
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          user_type: user.user_type,
        },
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Get('register-status')
  async getRegisterStatus(@Req() req: any) {
    const registerConfig = await this.getRegisterConfig();
    return {
      code: 0,
      message: 'ok',
      data: registerConfig,
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: any) {
    const registerConfig = await this.getRegisterConfig();
    if (!registerConfig.openRegistration) {
      return {
        code: 4031,
        message: '当前系统未开放注册',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const roleCode = normalizeRoleCode(dto.role || '');
    const registerableRoles = await this.getRegisterableRoles();
    const roleConfig = registerableRoles.find((item) => item.code === roleCode);
    if (!roleConfig) {
      return {
        code: 4001,
        message: '所选角色不可注册',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const rawEmail = String(dto.email || '').trim();
    const normalizedEmail = rawEmail ? this.normalizeEmail(rawEmail) : '';
    const accountInput = String(dto.account || '').trim() || normalizedEmail;
    const normalizedAccount = this.normalizeAccountIdentifier(accountInput);
    if (!normalizedAccount) {
      return {
        code: 4001,
        message: '账号格式不正确',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const accountEmail = this.isValidEmail(normalizedAccount) ? normalizedAccount : null;
    const storedAccount = accountEmail ? null : normalizedAccount;
    const effectiveEmail = normalizedEmail || accountEmail;

    if (!effectiveEmail || !this.isValidEmail(effectiveEmail)) {
      return {
        code: 4001,
        message: '邮箱格式不正确',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (accountEmail && accountEmail !== effectiveEmail) {
      return {
        code: 4001,
        message: '账号邮箱与联系邮箱不一致',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (isWeakPassword(dto.password)) {
      return {
        code: 4001,
        message: '密码强度过低',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingUser = await this.prisma.users.findFirst({
      where: {
        OR: [
          ...(storedAccount ? [{ mobile: storedAccount }] : []),
          ...(effectiveEmail ? [{ email: effectiveEmail }] : []),
        ],
      },
    });
    if (existingUser) {
      return {
        code: 4001,
        message: '账号已存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingStudent = await this.prisma.student_profiles.findFirst({
      where: {
        OR: [
          ...(storedAccount && /^\d+$/.test(storedAccount)
            ? [{ student_no: storedAccount }]
            : []),
          ...(storedAccount ? [{ mobile: storedAccount }] : []),
          ...(effectiveEmail ? [{ email: effectiveEmail }] : []),
        ],
      },
      select: { id: true },
    });
    if (existingStudent) {
      return {
        code: 4001,
        message: '账号已存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.users.create({
        data: {
          user_type: roleConfig.userType,
          name: dto.name,
          mobile: storedAccount,
          email: effectiveEmail,
          status: 'active',
          password_hash: passwordHash,
        },
      });

      let scopeId: bigint | null = null;
      const normalizedClassId = String(dto.class_id || '').trim();
      const normalizedOrgId = String(dto.org_id || '').trim();
      let resolvedOrgId: bigint | null = null;
      if (
        roleConfig.userType === 'student' &&
        (roleCode === 'student' || roleCode === 'class_monitor') &&
        /^\d+$/.test(normalizedClassId)
      ) {
        const classInfo = await tx.classes.findUnique({
          where: { id: BigInt(normalizedClassId) },
          select: {
            id: true,
            org_id: true,
            major: true,
            major_id: true,
            enroll_year: true,
          },
        });

        if (classInfo) {
          scopeId = classInfo.id;
          resolvedOrgId = classInfo.org_id;
          await tx.users.update({
            where: { id: createdUser.id },
            data: {
              org_id: classInfo.org_id,
            },
          });

          await tx.student_profiles.create({
            data: {
              user_id: createdUser.id,
              student_no:
                /^\d+$/.test(normalizedAccount) ? normalizedAccount : `student_${createdUser.id.toString()}`,
              class_id: classInfo.id,
              org_id: classInfo.org_id,
              major: classInfo.major,
              major_id: classInfo.major_id,
              enroll_year: classInfo.enroll_year,
              mobile: storedAccount,
              email: effectiveEmail,
              status: 'active',
            },
          });
        }
      }

      if (!scopeId && /^\d+$/.test(normalizedClassId) && roleConfig.scopeType === 'class') {
        const classInfo = await tx.classes.findUnique({
          where: { id: BigInt(normalizedClassId) },
          select: { id: true, org_id: true },
        });
        if (classInfo) {
          scopeId = classInfo.id;
          resolvedOrgId = classInfo.org_id;
        }
      }

      if (
        !scopeId &&
        /^\d+$/.test(normalizedOrgId) &&
        ['org', 'college'].includes(String(roleConfig.scopeType || ''))
      ) {
        scopeId = BigInt(normalizedOrgId);
        resolvedOrgId = BigInt(normalizedOrgId);
      }

      if (!resolvedOrgId && /^\d+$/.test(normalizedOrgId)) {
        resolvedOrgId = BigInt(normalizedOrgId);
      }

      if (resolvedOrgId) {
        await tx.users.update({
          where: { id: createdUser.id },
          data: {
            org_id: resolvedOrgId,
          },
        });
      }

      await tx.user_roles.create({
        data: {
          user_id: createdUser.id,
          role: roleCode,
          scope_type: roleConfig.scopeType,
          scope_id: scopeId,
        },
      });

      if (roleCode === 'head_teacher') {
        const teacherRole = await tx.user_roles.findFirst({
          where: {
            user_id: createdUser.id,
            role: 'teacher',
          },
          select: { id: true },
        });

        if (!teacherRole) {
          await tx.user_roles.create({
            data: {
              user_id: createdUser.id,
              role: 'teacher',
              scope_type: 'self',
              scope_id: null,
            },
          });
        }
      }

      return createdUser;
    });

    await this.prisma.security_events.create({
      data: {
        event_type: 'register_success',
        detail_json: { account: dto.account, name: dto.name, role: roleCode },
        ip: req.ip,
        user_id: user.id,
      },
    });

    return {
      code: 0,
      message: '注册成功',
      data: {
        user_id: user.id.toString(),
        name: user.name,
        account: normalizedAccount,
      },
      trace_id: req.trace_id,
    };
  }

  @Public()
  @Get('roles')
  async getRolesForRegister(@Req() req: any) {
    const registerableRoles = await this.getRegisterableRoles();
    return {
      code: 0,
      message: 'ok',
      data: registerableRoles,
      trace_id: req.trace_id,
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@Req() req: any) {
    const userId = BigInt(req.user.sub);
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        orgs: true,
      },
    });

    if (!user) {
      return { code: 404, message: 'User not found', data: null, trace_id: req.trace_id };
    }

    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        user_type: user.user_type,
        org_id: user.org_id?.toString(),
        org_name: user.orgs?.name,
        roles: roles.map((item) => ({
          id: item.id.toString(),
          role: normalizeRoleCode(item.role),
          scope_type: item.scope_type,
          scope_id: item.scope_id?.toString(),
        })),
      },
      trace_id: req.trace_id,
    };
  }

  /**
   * 登出 - 将当前 Token 加入黑名单
   */
  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: any) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        // 解码获取 jti 和 exp
        const decoded = this.jwtService.decode(token) as any;
        if (decoded?.jti) {
          // 计算剩余有效期（秒）
          const now = Math.floor(Date.now() / 1000);
          const ttl = Math.max(1, (decoded.exp || now + 604800) - now);
          // 加入 Redis 黑名单，TTL = token 剩余有效期
          await this.redis.setex(`token:revoked:${decoded.jti}`, ttl, '1');
        }
      } catch {
        // ignore decode errors
      }
    }

    await this.prisma.security_events.create({
      data: {
        event_type: 'logout',
        ip: req.ip,
        user_id: BigInt(req.user.sub),
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: null,
      trace_id: req.trace_id,
    };
  }

  /**
   * 改密码后吊销所有旧 Token
   */
  @Post('revoke-all-tokens')
  @UseGuards(AuthGuard)
  async revokeAllTokens(@Req() req: any) {
    const userId = req.user.sub;
    // 使用用户 ID 作为前缀，吊销所有该用户的 Token
    // 简单做法：改密码时记录版本号，但这里用时间戳作为标记
    const revokeMarker = `revoke:${userId}:${Date.now()}`;
    // 设为长期有效（7天），后续可在 auth.guard 中检查
    await this.redis.set(`user:token_version:${userId}`, revokeMarker, 'EX', 604800);

    await this.prisma.security_events.create({
      data: {
        event_type: 'revoke_all_tokens',
        detail_json: { user_id: userId } as any,
        ip: req.ip,
        user_id: BigInt(userId),
      },
    });

    return {
      code: 0,
      message: '所有 Token 已吊销，下次登录将获得新 Token',
      data: null,
      trace_id: req.trace_id,
    };
  }
}

