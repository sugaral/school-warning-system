import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PinoLogger } from 'nestjs-pino';
import * as https from 'https';
import * as querystring from 'querystring';
import { randomBytes } from 'crypto';
import { AuthGuard, Public } from '../shared/auth.guard';
import {
  hashPassword,
  isBcryptHash,
  verifyPassword,
} from '../shared/password.util';
import {
  isValidMainlandMobile,
  isWeakPassword,
  normalizeMobile,
} from '../shared/account-security.util';
import {
  CHANGE_REQUEST_OPEN_PENDING_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';
import {
  normalizeFileIdList,
  parseOptionalFileIds,
} from '../shared/file.util';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { SummaryService } from '../warning/summary.service';
import { WarningSnapshotService } from '../warning/warning-snapshot.service';
import { Idempotent } from '../shared/idempotency.decorator';

class StudentLoginDto {
  student_no!: string;
  name!: string;
  password?: string;
  wx_code?: string;
}

class BindWechatDto {
  wx_code!: string;
}

class BindEmailDto {
  email!: string;
  ticket!: string;
}

class BindPhoneDto {
  mobile!: string;
  ticket?: string;
}

class ChangePasswordDto {
  ticket!: string;
  new_password!: string;
}

class CreateClassChangeRequestDto {
  target_class_id!: string;
  reason!: string;
  head_teacher_user_id?: string;
  evidence_file_id?: string;
  evidence_file_ids?: string[];
}

@Controller('student')
@UseGuards(AuthGuard)
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly logger: PinoLogger,
    private readonly summaryService: SummaryService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly warningSnapshotService?: WarningSnapshotService,
  ) {
    this.logger.setContext('StudentsController');
  }

  private async checkStudentLoginRateLimit(ip: string, studentNo: string) {
    if (!this.redis) {
      return false;
    }
    try {
      const key = `student:login:fail:${ip || 'unknown'}:${studentNo}`;
      const count = Number((await this.redis.get(key)) || 0);
      return count >= 10;
    } catch {
      return false;
    }
  }

  private async recordStudentLoginFailure(ip: string, studentNo: string) {
    if (!this.redis) {
      return;
    }
    try {
      const key = `student:login:fail:${ip || 'unknown'}:${studentNo}`;
      const next = await this.redis.incr(key);
      if (next === 1) {
        await this.redis.expire(key, 300);
      }
    } catch {
      // ignore redis errors
    }
  }

  private async clearStudentLoginFailure(ip: string, studentNo: string) {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.del(`student:login:fail:${ip || 'unknown'}:${studentNo}`);
    } catch {
      // ignore redis errors
    }
  }

  private getAuthenticatedUserId(req: any) {
    const rawUserId = req.user?.sub ?? req.user?.userId;
    if (
      rawUserId === undefined ||
      rawUserId === null ||
      String(rawUserId).trim() === ''
    ) {
      return null;
    }

    return String(rawUserId).trim();
  }

  private async getAuthenticatedStudentProfileId(req: any) {
    const rawStudentId = req.user?.student_id;
    if (
      rawStudentId !== undefined &&
      rawStudentId !== null &&
      String(rawStudentId).trim() !== ''
    ) {
      return String(rawStudentId).trim();
    }

    const userId = this.getAuthenticatedUserId(req);
    if (!userId) {
      return null;
    }

    const studentProfile = await this.prisma.student_profiles.findUnique({
      where: { user_id: BigInt(userId) },
      select: { id: true },
    });

    return studentProfile?.id?.toString() || null;
  }

  private encodeLeaveReason(leaveType: string, reason: string) {
    return `[${leaveType}] ${reason}`;
  }

  private decodeLeaveReason(rawReason: string | null | undefined) {
    const text = String(rawReason || '').trim();
    const matched = text.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!matched) {
      return {
        leaveType: '请假',
        reason: text,
      };
    }

    return {
      leaveType: matched[1] || '请假',
      reason: matched[2] || '',
    };
  }

  private async createStudentToken(student: {
    id: bigint;
    user_id?: bigint;
    wx_openid?: string | null;
    users?: { id: bigint; wx_openid?: string | null } | null;
  }) {
    const userId = student.user_id?.toString() || student.users?.id?.toString();
    if (!userId) {
      throw new BadRequestException('学生账号信息不完整');
    }

    const wxOpenid =
      String(student.wx_openid || student.users?.wx_openid || '').trim() || null;

    return this.jwtService.signAsync({
      sub: userId,
      user_type: 'student',
      student_id: student.id.toString(),
      wx_openid: wxOpenid,
      // 安全修复：显式 jti，登出/强制下线才有可吊销的标识（AuthGuard 按 jti 查黑名单）
      jti: randomBytes(16).toString('hex'),
    });
  }

  private normalizeEmailAddress(email: string) {
    return String(email || '').trim().toLowerCase();
  }

  private async isMobileInUse(
    mobile: string,
    excludeUserId?: bigint,
    excludeStudentId?: bigint,
  ): Promise<boolean> {
    const [existingUser, existingStudent] = await Promise.all([
      this.prisma.users.findFirst({
        where: {
          mobile,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.student_profiles.findFirst({
        where: {
          mobile,
          ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
        },
        select: { id: true },
      }),
    ]);

    return !!existingUser || !!existingStudent;
  }

  private isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.normalizeEmailAddress(email));
  }

  private parseChallengeTicket(ticket: string) {
    const match = /^ticket_(\d+)_\d+$/.exec(String(ticket || '').trim());
    if (!match) {
      throw new BadRequestException('无效的验证码票据');
    }
    return BigInt(match[1]);
  }

  private parseOptionalFileId(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('图片参数不合法');
    }

    return BigInt(normalized);
  }

  private mergeOptionalFileIds(value: unknown, legacyValue?: unknown) {
    return Array.from(
      new Map(
        [
          ...parseOptionalFileIds(value, '图片参数'),
          ...parseOptionalFileIds(legacyValue, '图片参数'),
        ].map((item) => [item.toString(), item]),
      ).values(),
    );
  }

  private async consumeStudentEmailTicket(
    student: {
      id: bigint;
      user_id: bigint;
      email?: string | null;
      users?: { email?: string | null } | null;
    },
    ticket: string,
    expectedPurpose: 'bind_email' | 'student_change_mobile' | 'student_change_password',
  ) {
    const challengeId = this.parseChallengeTicket(ticket);
    const challenge = await this.prisma.auth_challenges.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new BadRequestException('验证码票据不存在');
    }

    const targetEmail = this.normalizeEmailAddress(
      student.email || student.users?.email || '',
    );
    if (!this.isValidEmail(targetEmail)) {
      throw new BadRequestException('当前账号未绑定有效邮箱');
    }

    if (
      challenge.status !== 'verified' ||
      !challenge.verified_at ||
      challenge.expire_at.getTime() < Date.now() ||
      String(challenge.channel || '').toLowerCase() !== 'email' ||
      String(challenge.purpose || '').toLowerCase() !== expectedPurpose ||
      this.normalizeEmailAddress(challenge.target || '') !== targetEmail
    ) {
      throw new BadRequestException('验证码票据已失效，请重新验证');
    }

    return challenge;
  }

  private getStoredFileIds(value: unknown, legacyValue?: unknown) {
    return normalizeFileIdList(value, legacyValue);
  }

  private parseLeaveDateTime(value: unknown, endOfDay = false) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new Error('missing_leave_datetime');
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('invalid_leave_datetime');
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      if (endOfDay) {
        parsed.setHours(23, 59, 59, 999);
      } else {
        parsed.setHours(0, 0, 0, 0);
      }
    }

    return parsed;
  }

  private formatDateTime(value?: Date | null) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hours}:${minutes}`;
  }

  private getLevelText(level: string): string {
    const map: Record<string, string> = {
      yellow: '黄色预警',
      orange: '橙色预警',
      red: '红色预警',
      severe: '严重预警',
    };
    return map[level] || level;
  }

  private getWindowText(window: string): string {
    const map: Record<string, string> = {
      day: '日',
      week: '周',
      month: '月',
      term: '学期',
    };
    return map[window] || window;
  }

  private getWarningStatusText(status: string): string {
    const map: Record<string, string> = {
      open: '待确认',
      student_acknowledged: '已确认',
      acknowledged: '已确认',
      closed: '已关闭',
    };
    return map[status] || status;
  }

  private getLegacyWarningStatus(status: string) {
    if (status === 'open') {
      return 'pending';
    }
    if (status === 'acknowledged' || status === 'student_acknowledged') {
      return 'processing';
    }
    return 'closed';
  }

  private isStudentSelfAcknowledged(warning: {
    status?: string | null;
    acknowledged_at?: Date | null;
    updated_at?: Date | null;
    acknowledged_by?: bigint | null;
  }, studentUserId?: bigint | null) {
    if (!studentUserId || warning?.status === 'closed') {
      return false;
    }

    if (
      !warning?.acknowledged_by ||
      warning.acknowledged_by.toString() !== studentUserId.toString()
    ) {
      return false;
    }

    if (!warning.acknowledged_at) {
      return false;
    }

    if (!warning.updated_at) {
      return true;
    }

    return new Date(warning.updated_at).getTime() <= new Date(warning.acknowledged_at).getTime();
  }

  private serializeLoginStudent(student: any) {
    return {
      id: student.id.toString(),
      name: student.users?.name || '',
      student_no: student.student_no,
      class_name: student.classes?.class_name || '未绑定班级',
      gender: student.gender,
      wx_openid: student.wx_openid,
      mobile: student.mobile || '',
      email: student.email || '',
    };
  }

  private isPlaceholderStudentNo(value?: string | null) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^student_\d+$/.test(normalized) || /^user_\d+$/.test(normalized);
  }

  private resolveProfileAccount(student: any) {
    const studentNo = String(student?.student_no || '').trim();
    if (studentNo && !this.isPlaceholderStudentNo(studentNo)) {
      return studentNo;
    }

    const mobile = String(student?.users?.mobile || '').trim();
    if (mobile) {
      return mobile;
    }

    const email = String(student?.users?.email || '').trim();
    if (email) {
      return email;
    }

    return student?.users?.id ? `user_${student.users.id.toString()}` : '';
  }

  private resolveDisplayMobile(
    primaryValue?: string | null,
    fallbackValue?: string | null,
  ) {
    const primary = normalizeMobile(primaryValue) || '';
    if (primary && isValidMainlandMobile(primary)) {
      return primary;
    }

    const fallback = normalizeMobile(fallbackValue) || '';
    if (fallback && isValidMainlandMobile(fallback)) {
      return fallback;
    }

    return '';
  }

  private async findStudentProfileForLogin(account: string) {
    const normalizedAccount = String(account || '').trim();
    if (!normalizedAccount) {
      return null;
    }

    const normalizedEmail = this.normalizeEmailAddress(normalizedAccount);
    const directStudent = await this.prisma.student_profiles.findFirst({
      where: {
        OR: [
          { student_no: normalizedAccount },
          { mobile: normalizedAccount },
          ...(this.isValidEmail(normalizedEmail) ? [{ email: normalizedEmail }] : []),
        ],
      },
      include: {
        users: true,
        classes: true,
      },
    });

    if (directStudent) {
      return directStudent;
    }

    const matchedUser = await this.prisma.users.findFirst({
      where: {
        OR: [
          { mobile: normalizedAccount },
          ...(this.isValidEmail(normalizedEmail) ? [{ email: normalizedEmail }] : []),
        ],
      },
      select: { id: true },
    });

    if (!matchedUser) {
      return null;
    }

    return this.prisma.student_profiles.findUnique({
      where: { user_id: matchedUser.id },
      include: {
        users: true,
        classes: true,
      },
    });
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
      this.logger.warn('[微信] 缺少小程序 appId/appSecret（学生登录流程中获取 openid）');
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
                this.logger.warn('[微信] jscode2session 失败（学生流程）: 错误码=%d 错误信息=%s', result.errcode, result.errmsg || '');
              }
              resolve(result?.openid ? String(result.openid) : null);
            } catch (error) {
              this.logger.warn('[微信] 解析 jscode2session 响应失败（学生流程）: %s', String(error));
              resolve(null);
            }
          });
        });

      request.on('error', (error) => {
        this.logger.warn('[微信] jscode2session 请求错误（学生流程）: %s', String(error));
        resolve(null);
      });
      request.setTimeout(8000, () => {
        request.destroy();
        this.logger.warn('[微信] jscode2session 请求超时（学生流程）');
        resolve(null);
      });
    });
  }

  private async bindWechatOpenidForStudent(
    student: {
      id: bigint;
      user_id: bigint;
      wx_openid?: string | null;
      users?: { id: bigint; name?: string | null } | null;
      classes?: { class_name?: string | null } | null;
      student_no?: string | null;
      gender?: string | null;
      mobile?: string | null;
      email?: string | null;
    },
    openid: string,
    traceId?: string,
  ) {
    if (student.wx_openid && student.wx_openid !== openid) {
      return {
        code: 400,
        message: '该学生已绑定其他微信账号，请先在管理端解绑',
        data: null,
        trace_id: traceId,
      };
    }

    const existingStudentWithOpenid =
      await this.prisma.student_profiles.findFirst({
        where: {
          wx_openid: openid,
          id: { not: student.id },
        },
        select: { id: true },
      });

    if (existingStudentWithOpenid) {
      return {
        code: 400,
        message: '该微信账号已绑定其他学生，请先在管理端解绑',
        data: null,
        trace_id: traceId,
      };
    }

    let nextStudent = student;
    const shouldUpdateUserOpenid = !student.wx_openid;

    if (shouldUpdateUserOpenid) {
      await this.prisma.$transaction([
        this.prisma.student_profiles.update({
          where: { id: student.id },
          data: { wx_openid: openid },
        }),
        this.prisma.users.update({
          where: { id: student.user_id },
          data: { wx_openid: openid },
        }),
      ]);
      nextStudent = {
        ...student,
        wx_openid: openid,
      };
    }

    const token = await this.createStudentToken(nextStudent);

    return {
      code: 0,
      message: '微信绑定成功',
      data: {
        token,
        student: this.serializeLoginStudent(nextStudent),
      },
      trace_id: traceId,
    };
  }

  @Public()
  @Post('login')
  async login(@Body() dto: StudentLoginDto, @Req() req: any) {
    let openid: string | null = null;

    if (dto.wx_code) {
      openid = await this.getWeChatOpenid(dto.wx_code);

      if (openid) {
        const existingStudent = await this.prisma.student_profiles.findFirst({
          where: {
            wx_openid: openid,
            status: 'active',
          },
          include: {
            users: true,
            classes: true,
          },
        });

        if (existingStudent && !dto.student_no) {
          const token = await this.createStudentToken(existingStudent);

          // 登录轨迹（见下方说明：last_login_at 原先从未写入）
          await this.prisma.users
            .update({
              where: { id: existingStudent.user_id },
              data: { last_login_at: new Date() },
            })
            .catch(() => undefined);

          return {
            code: 0,
            message: '登录成功',
            data: {
              token,
              student: this.serializeLoginStudent(existingStudent),
            },
            trace_id: req.trace_id,
          };
        }
      }
    }

    if (!dto.student_no || !dto.name) {
      return {
        code: 400,
        message: '请输入学号或账号和姓名进行登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const normalizedStudentNo = String(dto.student_no).trim();
    const clientIp = String(req.ip || req.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    if (await this.checkStudentLoginRateLimit(clientIp, normalizedStudentNo)) {
      return {
        code: 429,
        message: '登录失败次数过多，请 5 分钟后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!dto.password) {
      return {
        code: 400,
        message: '请输入密码',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.findStudentProfileForLogin(normalizedStudentNo);

    if (!student) {
      await this.recordStudentLoginFailure(clientIp, normalizedStudentNo);
      return {
        code: 401,
        message: '学号、姓名或密码错误',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (student.status !== 'active' || student.users?.status !== 'active') {
      return {
        code: 403,
        message: '学生账号已被禁用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if ((student.users?.name || '').trim() !== String(dto.name || '').trim()) {
      await this.recordStudentLoginFailure(clientIp, normalizedStudentNo);
      return {
        code: 401,
        message: '学号、姓名或密码错误',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (student.users.password_hash) {
      const passwordOk = await verifyPassword(
        dto.password,
        student.users.password_hash,
      );

      if (!passwordOk) {
        await this.recordStudentLoginFailure(clientIp, normalizedStudentNo);
        return {
          code: 401,
          message: '学号、姓名或密码错误',
          data: null,
          trace_id: req.trace_id,
        };
      }

      await this.clearStudentLoginFailure(clientIp, normalizedStudentNo);

      const postLoginUpdates: any[] = [];
      // 登录轨迹：users.last_login_at 此前**从未被写入**（仓库级 0 引用），
      // 属需求 §4.1 明确要求落地的字段，这里在每次登录成功时更新。
      postLoginUpdates.push(
        this.prisma.users.update({
          where: { id: student.users.id },
          data: { last_login_at: new Date() },
        }),
      );
      if (!isBcryptHash(student.users.password_hash)) {
        postLoginUpdates.push(
          this.prisma.users.update({
            where: { id: student.users.id },
            data: {
              password_hash: await hashPassword(dto.password),
            },
          }),
        );
      }
      if (student.initial_password) {
        postLoginUpdates.push(
          this.prisma.student_profiles.update({
            where: { id: student.id },
            data: { initial_password: null },
          }),
        );
      }
      if (postLoginUpdates.length > 0) {
        await this.prisma.$transaction(postLoginUpdates);
      }
    } else if (student.initial_password) {
      if (dto.password !== student.initial_password) {
        await this.recordStudentLoginFailure(clientIp, normalizedStudentNo);
        return {
          code: 401,
          message: '学号、姓名或密码错误',
          data: null,
          trace_id: req.trace_id,
        };
      }

      await this.clearStudentLoginFailure(clientIp, normalizedStudentNo);

      await this.prisma.$transaction([
        this.prisma.users.update({
          where: { id: student.users.id },
          data: {
            password_hash: await hashPassword(dto.password),
          },
        }),
        this.prisma.student_profiles.update({
          where: { id: student.id },
          data: { initial_password: null },
        }),
      ]);
    } else {
      return {
        code: 401,
        message: '当前账号尚未设置密码，请联系管理员',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (openid) {
      const bindResult = await this.bindWechatOpenidForStudent(
        {
          ...student,
          user_id: student.user_id,
        },
        openid,
        req.trace_id,
      );

      if (bindResult.code !== 0) {
        return bindResult;
      }

      student.wx_openid = openid;
    }

    const token = await this.createStudentToken(student);

    return {
      code: 0,
      message: '登录成功',
      data: {
        token,
        student: this.serializeLoginStudent(student),
      },
      trace_id: req.trace_id,
    };
  }

  @Post('bind-wechat')
  async bindWechat(@Body() dto: BindWechatDto, @Req() req: any) {
    const userId = this.getAuthenticatedUserId(req);
    const userType = String(req.user?.user_type || '').trim();
    if (!userId || userType !== 'student') {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const wxCode = String(dto.wx_code || '').trim();
    if (!wxCode) {
      return {
        code: 400,
        message: '微信登录凭证不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const openid = await this.getWeChatOpenid(wxCode);
    if (!openid) {
      return {
        code: 400,
        message: '获取微信身份失败，请稍后重试',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { user_id: BigInt(userId) },
      include: {
        users: true,
        classes: true,
      },
    });

    if (student) {
      return this.bindWechatOpenidForStudent(
        {
          ...student,
          user_id: student.user_id,
        },
        openid,
        req.trace_id,
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: {
        id: true,
        name: true,
        mobile: true,
        email: true,
        status: true,
        user_type: true,
        wx_openid: true,
      },
    });

    if (!user || user.user_type !== 'student') {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (user.status !== 'active') {
      return {
        code: 403,
        message: '学生账号已被禁用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (user.wx_openid && user.wx_openid !== openid) {
      return {
        code: 400,
        message: '该学生已绑定其他微信账号，请先在管理端解绑',
        data: null,
        trace_id: req.trace_id,
      };
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
            id: { not: user.id },
          },
          select: { id: true },
        }),
      ]);

      if (existingStudentWithOpenid || existingUserWithOpenid) {
        return {
          code: 400,
          message: '该微信账号已绑定其他学生，请先在管理端解绑',
          data: null,
          trace_id: req.trace_id,
        };
      }

      await this.prisma.users.update({
        where: { id: user.id },
        data: { wx_openid: openid },
      });
    }

    const token = await this.jwtService.signAsync({
      sub: user.id.toString(),
      user_type: 'student',
      wx_openid: openid,
      jti: randomBytes(16).toString('hex'),
    });

    return {
      code: 0,
      message: '微信绑定成功',
      data: {
        token,
        student: {
          id: '',
          name: user.name,
          student_no: user.mobile || user.email || `user_${user.id.toString()}`,
          class_name: '未绑定班级',
          gender: '',
          wx_openid: openid,
          mobile: user.mobile || '',
          email: user.email || '',
        },
      },
      trace_id: req.trace_id,
    };
  }

  @Post('bind-email')
  async bindEmail(@Body() dto: BindEmailDto, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const email = this.normalizeEmailAddress(dto.email);
    const ticket = String(dto.ticket || '').trim();

    if (!this.isValidEmail(email)) {
      return {
        code: 400,
        message: '请输入有效的邮箱地址',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!ticket) {
      return {
        code: 400,
        message: '验证码票据不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const challengeId = this.parseChallengeTicket(ticket);
    const challenge = await this.prisma.auth_challenges.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      return {
        code: 400,
        message: '验证码票据不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      challenge.status !== 'verified' ||
      !challenge.verified_at ||
      String(challenge.channel || '').toLowerCase() !== 'email' ||
      String(challenge.purpose || '').toLowerCase() !== 'bind_email'
    ) {
      return {
        code: 400,
        message: '验证码票据已失效，请重新获取验证码',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (this.normalizeEmailAddress(challenge.target) !== email) {
      return {
        code: 400,
        message: '邮箱与验证码发送目标不一致',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (Date.now() - challenge.verified_at.getTime() > 10 * 60 * 1000) {
      return {
        code: 400,
        message: '验证码票据已过期，请重新获取验证码',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: {
        users: true,
      },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const [existingUser, existingStudent] = await Promise.all([
      this.prisma.users.findFirst({
        where: {
          email,
          id: { not: student.user_id },
        },
        select: { id: true },
      }),
      this.prisma.student_profiles.findFirst({
        where: {
          email,
          id: { not: student.id },
        },
        select: { id: true },
      }),
    ]);

    if (existingUser || existingStudent) {
      return {
        code: 400,
        message: '该邮箱已被其他账号绑定',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.$transaction([
      this.prisma.student_profiles.update({
        where: { id: student.id },
        data: { email },
      }),
      this.prisma.users.update({
        where: { id: student.user_id },
        data: { email },
      }),
      this.prisma.auth_challenges.update({
        where: { id: challengeId },
        data: { status: 'used' },
      }),
    ]);

    return {
      code: 0,
      message: '邮箱绑定成功',
      data: { email },
      trace_id: req.trace_id,
    };
  }

  @Get('today')
  async getTodayStatus(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayStartLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const dayEndLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      select: { class_id: true },
    });

    const [records, todaySchedulesCount] = await Promise.all([
      this.prisma.daily_records.findMany({
        where: {
          student_id: BigInt(studentId),
          record_date: todayUtc,
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      }),
      student?.class_id
        ? this.prisma.schedules.count({
            where: {
              class_id: student.class_id,
              status: 'active',
              session_start: {
                gte: dayStartLocal,
                lte: dayEndLocal,
              },
            },
          })
        : Promise.resolve(0),
    ]);

    const courseIds = Array.from(
      new Set(records.map((item) => item.course_id).filter((id): id is bigint => Boolean(id))),
    );
    const courses = courseIds.length
      ? await this.prisma.courses.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, course_name: true },
        })
      : [];
    const courseNameMap = new Map(courses.map((c) => [c.id.toString(), c.course_name]));

    const serializedRecords = records.map((item) => ({
      id: item.id.toString(),
      course_id: item.course_id?.toString() || '',
      course_name: item.course_id ? courseNameMap.get(item.course_id.toString()) || '' : '',
      record_date: dateKey,
      attendance_status: item.attendance_status || 'unknown',
      homework_status: item.homework_status || 'unknown',
      class_behavior: item.class_behavior || 'normal',
      remarks: item.remarks || '',
    }));

    const pickAttendance = () => {
      if (records.some((r) => r.attendance_status === 'absent')) return 'absent';
      if (records.some((r) => r.attendance_status === 'late')) return 'late';
      if (records.some((r) => r.attendance_status === 'early_leave')) return 'early_leave';
      if (records.some((r) => r.attendance_status === 'leave')) return 'leave';
      if (records.some((r) => r.attendance_status === 'on_time')) return 'on_time';
      return records[0]?.attendance_status || 'unknown';
    };

    const pickHomework = () => {
      if (records.some((r) => r.homework_status === 'not_submit')) return 'not_submit';
      if (records.some((r) => r.homework_status === 'late_submit')) return 'late_submit';
      if (records.some((r) => r.homework_status === 'submitted')) return 'submitted';
      return records[0]?.homework_status || 'unknown';
    };

    const attendanceStatus = pickAttendance();
    const homeworkStatus = pickHomework();
    const classBehavior = records.some((r) => r.class_behavior === 'disruptive')
      ? 'disruptive'
      : records[0]?.class_behavior || 'normal';
    const distinctCourses = new Set(
      records.map((r) => r.course_id?.toString()).filter(Boolean),
    ).size;

    return {
      code: 0,
      message: 'ok',
      data: {
        record_date: dateKey,
        attendance: attendanceStatus,
        attendance_status: attendanceStatus,
        homework_status: homeworkStatus,
        class_behavior: classBehavior,
        course_count: Math.max(todaySchedulesCount, distinctCourses),
        records: serializedRecords,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('weekly')
  async getWeeklyTrend(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const sevenDaysAgo = new Date(todayUtc);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);

    const records = await this.prisma.daily_records.findMany({
      where: {
        student_id: BigInt(studentId),
        record_date: {
          gte: sevenDaysAgo,
          lte: todayUtc,
        },
      },
      orderBy: { record_date: 'asc' },
    });

    const trend = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date(todayUtc);
      date.setUTCDate(date.getUTCDate() - i);
      const isoDay = date.toISOString().slice(0, 10);

      const dayRecords = records.filter(
        (item) => item.record_date.toISOString().slice(0, 10) === isoDay,
      );

      let attendance = 'unknown';
      if (dayRecords.some((r) => r.attendance_status === 'absent')) attendance = 'absent';
      else if (dayRecords.some((r) => r.attendance_status === 'late')) attendance = 'late';
      else if (dayRecords.some((r) => r.attendance_status === 'early_leave')) attendance = 'early_leave';
      else if (dayRecords.some((r) => r.attendance_status === 'leave')) attendance = 'leave';
      else if (dayRecords.some((r) => r.attendance_status === 'on_time')) attendance = 'on_time';
      else if (dayRecords[0]?.attendance_status) attendance = dayRecords[0].attendance_status;

      let homeworkStatus = 'unknown';
      if (dayRecords.some((r) => r.homework_status === 'not_submit')) homeworkStatus = 'not_submit';
      else if (dayRecords.some((r) => r.homework_status === 'late_submit')) homeworkStatus = 'late_submit';
      else if (dayRecords.some((r) => r.homework_status === 'submitted')) homeworkStatus = 'submitted';

      const classBehavior = dayRecords.some((r) => r.class_behavior === 'disruptive')
        ? 'disruptive'
        : dayRecords[0]?.class_behavior || 'normal';

      trend.push({
        date: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
        full_date: isoDay,
        attendance,
        homework_status: homeworkStatus,
        class_behavior: classBehavior,
        record_count: dayRecords.length,
      });
    }

    return {
      code: 0,
      message: 'ok',
      data: trend,
      trace_id: req.trace_id,
    };
  }

  @Get('summaries')
  async getMySummaries(
    @Req() req: any,
    @Query('weeks') weeks?: string,
    @Query('months') months?: string,
    @Query('term_code') termCode?: string,
  ) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    // 读的是 weekly/monthly/term_summaries 三张汇总表（由 SummaryService 落表），
    // 不再实时聚合 daily_records，避免每次打开「我的汇总」都全表扫描。
    const data = await this.summaryService.getStudentSummaries(BigInt(studentId), {
      weeks: weeks ? Number(weeks) : undefined,
      months: months ? Number(months) : undefined,
      termCode: termCode || undefined,
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('courses')
  async getStudentCourses(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const courseClasses = await this.prisma.course_classes.findMany({
      where: {
        class_id: student.class_id,
      },
      include: {
        courses: true,
      },
      orderBy: {
        course_id: 'asc',
      },
    });

    const courseMap = new Map<string, { id: string; course_name: string }>();
    for (const item of courseClasses) {
      const id = item.course_id.toString();
      if (!courseMap.has(id)) {
        courseMap.set(id, {
          id,
          course_name: item.courses?.course_name || '未命名课程',
        });
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: Array.from(courseMap.values()),
      trace_id: req.trace_id,
    };
  }

  @Get('warnings')
  async getStudentWarnings(
    @Query('course_id') courseId: string,
    @Query('level') level: string,
    @Query('status') status: string,
    @Query('id') id: string,
    @Req() req: any,
  ) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const whereCondition: any = {
      student_id: BigInt(studentId),
    };

    const normalizedId = String(id || '').trim();
    if (normalizedId && /^\d+$/.test(normalizedId)) {
      whereCondition.id = BigInt(normalizedId);
    }

    if (level) {
      whereCondition.level = String(level).trim();
    }

    const normalizedStatus = String(status || '').trim();

    if (!normalizedId) {
      whereCondition.status = {
        in: ['open', 'acknowledged'],
      };
    } else if (
      normalizedStatus &&
      normalizedStatus !== 'open' &&
      normalizedStatus !== 'student_acknowledged' &&
      normalizedStatus !== 'acknowledged'
    ) {
      whereCondition.status = normalizedStatus;
    } else {
      whereCondition.status = {
        in: ['open', 'acknowledged', 'closed'],
      };
    }

    const [warnings, student, currentStates] =
      await Promise.all([
        this.prisma.warnings.findMany({
          where: whereCondition,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.student_profiles.findUnique({
          where: { id: BigInt(studentId) },
          include: {
            users: true,
            classes: {
              include: {
                orgs: true,
              },
            },
          },
        }),
        (this.prisma as any).warning_current_states.findMany({
          where: { student_id: BigInt(studentId) },
          select: {
            metric: true,
            window: true,
            period_start: true,
            period_end: true,
            course_key: true,
            current_count: true,
          },
        }),
      ]);

    const currentCountMap = new Map<string, number>();
    for (const st of currentStates as any[]) {
      const pStart = st.period_start ? new Date(st.period_start).toISOString().slice(0, 10) : '';
      const pEnd = st.period_end ? new Date(st.period_end).toISOString().slice(0, 10) : '';
      const key = `${st.metric || ''}|${st.window || ''}|${pStart}|${pEnd}|${String(st.course_key || '').trim() || '__none__'}`;
      const prev = currentCountMap.get(key) || 0;
      const cur = Number(st.current_count || 0);
      if (cur > prev) {
        currentCountMap.set(key, cur);
      }
    }

    const dedupedWarnings = normalizedId
      ? warnings
      : (() => {
          const seen = new Set<string>();
          return warnings.filter((warning: any) => {
            const detail = (warning.trigger_detail_json as Record<string, any>) || {};
            const courseKey = String(warning.course_id || detail.course_id || '').trim() || '__none__';
            const periodStartKey = warning.period_start
              ? new Date(warning.period_start).toISOString().slice(0, 10)
              : '';
            const periodEndKey = warning.period_end
              ? new Date(warning.period_end).toISOString().slice(0, 10)
              : '';
            const bizKey = `${warning.metric || ''}|${warning.window || ''}|${periodStartKey}|${periodEndKey}|${courseKey}`;
            if (seen.has(bizKey)) {
              return false;
            }
            seen.add(bizKey);
            return true;
          });
        })();

    const items = dedupedWarnings.map((warning: any) => {
      const detail = (warning.trigger_detail_json as Record<string, any>) || {};
      const createdAt = this.formatDateTime(warning.created_at);
      const periodStart = this.formatDateTime(warning.period_start);
      const periodEnd = this.formatDateTime(warning.period_end);
      const courseKey = String(warning.course_id || detail.course_id || '').trim() || '__none__';
      const periodStartKey = warning.period_start
        ? new Date(warning.period_start).toISOString().slice(0, 10)
        : '';
      const periodEndKey = warning.period_end
        ? new Date(warning.period_end).toISOString().slice(0, 10)
        : '';
      const bizKey = `${warning.metric || ''}|${warning.window || ''}|${periodStartKey}|${periodEndKey}|${courseKey}`;
      const violationCount = Math.max(
        Number(currentCountMap.get(bizKey) || 0),
        Number(detail.violation_count || 0),
        Number(detail.count || 0),
      );
      const studentSelfAcknowledged = this.isStudentSelfAcknowledged(
        warning,
        student?.user_id || null,
      );
      const effectiveStatus = studentSelfAcknowledged
        ? 'student_acknowledged'
        : warning.status;
      const legacyStatus = this.getLegacyWarningStatus(effectiveStatus);

      return {
        id: warning.id.toString(),
        metric: warning.metric || 'absent',
        level: warning.level,
        level_text: this.getLevelText(warning.level),
        warning_level: warning.level,
        warning_level_text: this.getLevelText(warning.level),
        window: warning.window,
        window_text: this.getWindowText(warning.window),
        trigger_summary: warning.trigger_summary,
        warning_reason: warning.trigger_summary,
        trigger_detail_json: warning.trigger_detail_json || null,
        rule_snapshot_json: warning.rule_snapshot_json || null,
        course_name: detail.course_name || '',
        violation_type: detail.violation_type || '',
        violation_time: detail.violation_time || periodStart,
        violation_count: violationCount,
        status: effectiveStatus,
        status_text: this.getWarningStatusText(effectiveStatus),
        legacy_status: legacyStatus,
        org_name: student?.classes?.orgs?.name || '',
        class_name: student?.classes?.class_name || '',
        course_id: String(warning.course_id || detail.course_id || '').trim(),
        created_at: createdAt,
        created_at_raw: warning.created_at,
        period_start: periodStart,
        period_end: periodEnd,
        period_start_raw: warning.period_start,
        period_end_raw: warning.period_end,
        updated_at_raw: warning.updated_at,
        acknowledged_at: warning.acknowledged_at ? this.formatDateTime(warning.acknowledged_at) : '',
        acknowledged_at_raw: warning.acknowledged_at,
        close_note: warning.close_note || '',
        displayText: `${this.getLevelText(warning.level)} - ${
          detail.course_name || '未命名课程'
        } - ${periodStart}`,
      };
    });

    const courseFilteredItems =
      courseId && courseId !== 'all'
        ? items.filter((item) => String(item.course_id || '').trim() === String(courseId).trim())
        : items;

    const filteredItems = normalizedStatus
      ? courseFilteredItems.filter((item) => {
          if (normalizedStatus === 'acknowledged') {
            return item.status === 'acknowledged' || item.status === 'student_acknowledged';
          }
          return item.status === normalizedStatus;
        })
      : courseFilteredItems;
    const openCount = courseFilteredItems.filter((item) => item.status === 'open').length;
    const acknowledgedCount = courseFilteredItems.filter(
      (item) => item.status === 'acknowledged' || item.status === 'student_acknowledged',
    ).length;
    const closedCount = courseFilteredItems.filter((item) => item.status === 'closed').length;

    return {
      code: 0,
      message: 'ok',
      data: {
        items: filteredItems,
        total_count: courseFilteredItems.length,
        open_count: openCount,
        list: filteredItems,
        total: filteredItems.length,
        stats: {
          total: courseFilteredItems.length,
          pending: openCount,
          processing: acknowledgedCount,
          closed: closedCount,
        },
      },
      trace_id: req.trace_id,
    };
  }

  @Post('warnings/:id/confirm')
  async confirmStudentWarning(@Param('id') id: string, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const warning = await this.prisma.warnings.findFirst({
      where: {
        id: BigInt(id),
        student_id: BigInt(studentId),
      },
      select: {
        id: true,
        student_id: true,
        class_id: true,
        metric: true,
        window: true,
        period_start: true,
        period_end: true,
        trigger_detail_json: true,
        status: true,
        acknowledged_at: true,
        acknowledged_by: true,
        updated_at: true,
      },
    });

    if (!warning) {
      return {
        code: 404,
        message: '预警不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const studentUserId = BigInt(req.user.sub);

    if (warning.status === 'closed') {
      return {
        code: 400,
        message: '该预警已关闭，无法确认',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      warning.status === 'acknowledged' &&
      warning.acknowledged_by &&
      warning.acknowledged_by.toString() !== studentUserId.toString()
    ) {
      return {
        code: 0,
        message: '该预警已由老师确认',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      warning.status === 'acknowledged' &&
      this.isStudentSelfAcknowledged(warning, studentUserId)
    ) {
      return {
        code: 0,
        message: '确认成功',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const detail = (warning.trigger_detail_json as Record<string, any>) || {};
    const rawCourseId = detail.course_id ? String(detail.course_id).trim() : '';
    const courseKey = rawCourseId && /^\d+$/.test(rawCourseId) ? rawCourseId : '__none__';
    const ackedAt = warning.acknowledged_at || new Date();

    await this.prisma.$transaction(async (tx: any) => {
      await tx.warnings.update({
        where: { id: warning.id },
        data: {
          status: 'acknowledged',
          acknowledged_at: ackedAt,
          acknowledged_by: studentUserId,
          updated_at: ackedAt,
        },
      });

      await tx.warning_current_states.updateMany({
        where: {
          student_id: warning.student_id,
          metric: warning.metric,
          window: warning.window,
          period_start: warning.period_start,
          period_end: warning.period_end,
          course_key: courseKey,
          status: 'open',
        },
        data: {
          status: 'acknowledged',
          acknowledged_at: ackedAt,
          acknowledged_by: studentUserId,
        },
      });
    });

    await this.warningSnapshotService?.invalidateStudents(
      [warning.student_id],
      warning.class_id ? [warning.class_id] : [],
    );

    return {
      code: 0,
      message: '确认成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('teachers')
  async getTeachers(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: { classes: true },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!student.class_id) {
      return {
        code: 400,
        message: '学生未绑定班级',
        data: [],
        trace_id: req.trace_id,
      };
    }

    const teachers: Array<{ id: string; name: string; type: string }> = [];

    if (student.classes?.counselor_user_id) {
      const counselor = await this.prisma.users.findUnique({
        where: { id: student.classes.counselor_user_id },
        select: { id: true, name: true },
      });

      if (counselor) {
        teachers.push({
          id: counselor.id.toString(),
          name: counselor.name,
          type: '班主任',
        });
      }
    }

    const courseClasses = await this.prisma.course_classes.findMany({
      where: { class_id: student.class_id },
      include: {
        users: true,
      },
    });

    for (const item of courseClasses) {
      if (!item.users) {
        continue;
      }

      const exists = teachers.some(
        (teacher) => teacher.id === item.users.id.toString(),
      );
      if (!exists) {
        teachers.push({
          id: item.users.id.toString(),
          name: item.users.name,
          type: '授课老师',
        });
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: teachers,
      trace_id: req.trace_id,
    };
  }

  @Get('leave_requests')
  async getStudentLeaveRequests(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: { student_id: BigInt(studentId) },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        list: leaveRequests.map((item) => {
          const parsed = this.decodeLeaveReason(item.reason);
          const proofFileIds = this.getStoredFileIds(
            (item as any).proof_file_ids_json,
            item.proof_file_id,
          );
          return {
            id: item.id.toString(),
            leave_type: parsed.leaveType,
            start_date: item.from_date,
            end_date: item.to_date,
            reason: parsed.reason,
            proof_file_id: proofFileIds[0] || '',
            proof_file_ids: proofFileIds,
            status: item.status,
            reject_reason: item.reject_reason || '',
            created_at: item.created_at,
          };
        }),
      },
      trace_id: req.trace_id,
    };
  }

  @Post('leave_requests')
  async createStudentLeaveRequest(@Body() dto: any, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const leaveType = String(dto.leave_type || '').trim();
    let approverUserIdRaw = String(dto.approver_user_id || '').trim();
    const reason = String(dto.reason || '').trim();
    const proofFileIds = this.mergeOptionalFileIds(
      dto.proof_file_ids,
      dto.proof_file_id,
    );
    if (!leaveType || !dto.start_date || !dto.end_date || !reason) {
      return {
        code: 400,
        message: '请完整填写请假信息',
        data: null,
        trace_id: req.trace_id,
      };
    }

    let startDate: Date;
    let endDate: Date;

    try {
      startDate = this.parseLeaveDateTime(dto.start_date, false);
      endDate = this.parseLeaveDateTime(dto.end_date, true);
    } catch {
      return {
        code: 400,
        message: '请填写有效的请假时间',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!approverUserIdRaw) {
      const classInfo = student.class_id
        ? await this.prisma.classes.findUnique({
            where: { id: student.class_id },
            select: { counselor_user_id: true },
          })
        : null;
      approverUserIdRaw = classInfo?.counselor_user_id?.toString() || '';
    }

    if (!approverUserIdRaw) {
      return {
        code: 400,
        message: '当前班级未绑定审批老师',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (startDate.getTime() > endDate.getTime()) {
      return {
        code: 400,
        message: '结束时间不能早于开始时间',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!/^\d+$/.test(approverUserIdRaw)) {
      return {
        code: 400,
        message: '审批老师参数不合法',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const approver = await this.prisma.users.findFirst({
      where: {
        id: BigInt(approverUserIdRaw),
        user_type: 'teacher',
        status: 'active',
      },
      select: { id: true },
    });

    if (!approver) {
      return {
        code: 400,
        message: '审批老师不存在或不可用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const leaveRequest = await this.prisma.leave_requests.create({
      data: {
        student_id: student.id,
        class_id: student.class_id,
        from_date: startDate,
        to_date: endDate,
        reason: this.encodeLeaveReason(leaveType, reason),
        proof_file_id: proofFileIds[0] || null,
        proof_file_ids_json: proofFileIds.map((item) => item.toString()) as any,
        approver_user_id: approver.id,
        status: 'submitted',
      },
    });

    return {
      code: 0,
      message: '请假申请提交成功',
      data: { id: leaveRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('appeals')
  async getStudentAppeals(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const appeals = await this.prisma.appeals.findMany({
      where: { student_id: BigInt(studentId) },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        list: appeals.map((item) => {
          const evidenceFileIds = this.getStoredFileIds(
            (item as any).evidence_file_ids_json,
            item.evidence_file_id,
          );
          return {
            id: item.id.toString(),
            appeal_type: item.appeal_type,
            warning_course: item.related_type || '',
            appeal_reason: item.content,
            content: item.content,
            appeal_result: item.status,
            status: item.status,
            result_note: item.result_note || '',
            evidence_file_id: evidenceFileIds[0] || '',
            evidence_file_ids: evidenceFileIds,
            created_at: item.created_at,
          };
        }),
      },
      trace_id: req.trace_id,
    };
  }

  @Post('appeals')
  async createStudentAppeal(@Body() dto: any, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!dto.appeal_type || !dto.content) {
      return {
        code: 400,
        message: '请完整填写申诉内容',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const evidenceFileIds = this.mergeOptionalFileIds(
      dto.evidence_file_ids,
      dto.evidence_file_id,
    );

    const appeal = await this.prisma.appeals.create({
      data: {
        student_id: BigInt(studentId),
        appeal_type: String(dto.appeal_type).trim(),
        related_type: dto.related_type ? String(dto.related_type).trim() : null,
        related_id: dto.warning_id ? BigInt(dto.warning_id) : null,
        content: String(dto.content).trim(),
        evidence_file_id: evidenceFileIds[0] || null,
        evidence_file_ids_json: evidenceFileIds.map((item) => item.toString()) as any,
        status: 'submitted',
      },
    });

    return {
      code: 0,
      message: '申诉提交成功',
      data: { id: appeal.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('profile')
  async getProfile(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: {
        users: true,
        classes: {
          include: {
            orgs: true,
          },
        },
      },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentHeadTeacher = student.classes?.counselor_user_id
      ? await this.prisma.users.findUnique({
          where: { id: student.classes.counselor_user_id },
          select: { id: true, name: true },
        })
      : null;
    const resolvedOrgId = student.org_id || student.classes?.org_id || null;

    if (!student.org_id && student.class_id && student.classes?.org_id) {
      await this.prisma.student_profiles.update({
        where: { id: student.id },
        data: { org_id: student.classes.org_id },
      });
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        id: student.id.toString(),
        account: this.resolveProfileAccount(student),
        student_no: student.student_no,
        name: student.users.name,
        gender: student.gender,
        mobile: this.resolveDisplayMobile(student.mobile, student.users?.mobile),
        email: student.email,
        class_id: student.class_id?.toString(),
        class_name: student.classes?.class_name || '未绑定',
        org_id: resolvedOrgId?.toString(),
        org_name: student.classes?.orgs?.name || '未绑定',
        major: student.classes?.major || student.major || '',
        enroll_year: student.classes?.enroll_year || student.enroll_year || null,
        emergency_contact_name: student.emergency_contact_name,
        emergency_contact_mobile: student.emergency_contact_mobile,
        student_position: student.student_position,
        photo_file_id: student.photo_file_id ? student.photo_file_id.toString() : '',
        head_teacher_user_id: currentHeadTeacher?.id?.toString() || null,
        head_teacher_name: currentHeadTeacher?.name || '',
        is_bound: Boolean(student.class_id && resolvedOrgId),
        wx_openid: student.wx_openid,
      },
      trace_id: req.trace_id,
    };
  }

  @Put('profile')
  async updateProfile(@Body() dto: any, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const normalizedMobile =
      dto.mobile !== undefined ? normalizeMobile(dto.mobile) : undefined;
    if (normalizedMobile && !isValidMainlandMobile(normalizedMobile)) {
      return {
        code: 400,
        message: '请输入正确的手机号',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      normalizedMobile &&
      (await this.isMobileInUse(normalizedMobile, student.user_id, student.id))
    ) {
      return {
        code: 400,
        message: '该手机号已被其他账号使用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentMobile = normalizeMobile(student.mobile) || '';
    if (dto.mobile !== undefined && (normalizedMobile || '') !== currentMobile) {
      return {
        code: 400,
        message: '请使用手机号修改流程更新手机号',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentEmail = this.normalizeEmailAddress(student.email || '');
    const nextEmail =
      dto.email === undefined ? currentEmail : this.normalizeEmailAddress(dto.email || '');
    const isClearingEmail = dto.email !== undefined && !nextEmail;
    if (dto.email !== undefined && nextEmail !== currentEmail && !isClearingEmail) {
      return {
        code: 400,
        message: '请使用邮箱绑定流程修改邮箱',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {};
    if (dto.gender !== undefined) updateData.gender = dto.gender || null;
    if (dto.mobile !== undefined) updateData.mobile = normalizedMobile;
    if (dto.email !== undefined) updateData.email = nextEmail || null;
    if (dto.emergency_contact_name !== undefined) {
      updateData.emergency_contact_name = dto.emergency_contact_name || null;
    }
    if (dto.emergency_contact_mobile !== undefined) {
      updateData.emergency_contact_mobile = dto.emergency_contact_mobile || null;
    }
    if (dto.student_position !== undefined) {
      updateData.student_position = dto.student_position || null;
    }
    // 证件照：student_profiles.photo_file_id 此前**从未被写入**（仓库级 0 引用），
    // 属需求 §4.1 要求落地的字段。这里接收前端上传后返回的 files.id。
    if (dto.photo_file_id !== undefined) {
      if (dto.photo_file_id === null || dto.photo_file_id === '') {
        updateData.photo_file_id = null;
      } else {
        const fileIdRaw = String(dto.photo_file_id).trim();
        if (!/^\d+$/.test(fileIdRaw)) {
          return {
            code: 400,
            message: 'photo_file_id 必须为数字 id',
            data: null,
            trace_id: req.trace_id,
          };
        }
        const fileRow = await this.prisma.files.findUnique({
          where: { id: BigInt(fileIdRaw) },
          select: { id: true },
        });
        if (!fileRow) {
          return {
            code: 400,
            message: '证件照文件不存在，请先上传',
            data: null,
            trace_id: req.trace_id,
          };
        }
        updateData.photo_file_id = fileRow.id;
      }
    }

    if (dto.mobile !== undefined) {
      await this.prisma.$transaction([
        this.prisma.student_profiles.update({
          where: { id: student.id },
          data: updateData,
        }),
        this.prisma.users.update({
          where: { id: student.user_id },
          data: { mobile: normalizedMobile },
        }),
      ]);
    } else {
      await this.prisma.student_profiles.update({
        where: { id: student.id },
        data: updateData,
      });
    }

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('bind-phone')
  async bindPhone(@Body() dto: BindPhoneDto, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const mobile = normalizeMobile(dto.mobile);
    if (!mobile || !isValidMainlandMobile(mobile)) {
      return {
        code: 400,
        message: '请输入正确的手机号',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: {
        users: true,
      },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (await this.isMobileInUse(mobile, student.user_id, student.id)) {
      return {
        code: 400,
        message: '该手机号已被其他账号使用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentMobile = normalizeMobile(student.mobile);
    const needsVerification = Boolean(currentMobile && currentMobile !== mobile);
    let challengeId: bigint | null = null;
    if (needsVerification) {
      const ticket = String(dto.ticket || '').trim();
      if (!ticket) {
        return {
          code: 400,
          message: '请先完成邮箱验证码校验',
          data: null,
          trace_id: req.trace_id,
        };
      }

      try {
        const challenge = await this.consumeStudentEmailTicket(
          student,
          ticket,
          'student_change_mobile',
        );
        challengeId = challenge.id;
      } catch (error: any) {
        return {
          code: 400,
          message: error?.message || '验证码票据已失效，请重新验证',
          data: null,
          trace_id: req.trace_id,
        };
      }
    }

    const operations: any[] = [
      this.prisma.student_profiles.update({
        where: { id: student.id },
        data: { mobile },
      }),
    ];
    if (challengeId) {
      operations.push(
        this.prisma.auth_challenges.update({
          where: { id: challengeId },
          data: { status: 'used' },
        }),
      );
    }
    await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: '绑定成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const newPassword = String(dto.new_password || '').trim();
    const ticket = String(dto.ticket || '').trim();
    if (isWeakPassword(newPassword)) {
      return {
        code: 400,
        message: '新密码过于简单，请使用至少8位且包含两类字符的密码',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (!ticket) {
      return {
        code: 400,
        message: '请先完成邮箱验证码校验',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      include: {
        users: true,
      },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const targetEmail = this.normalizeEmailAddress(student.email || student.users?.email || '');
    if (!this.isValidEmail(targetEmail)) {
      return {
        code: 400,
        message: '当前账号未绑定有效邮箱，无法修改密码',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const challengeId = this.parseChallengeTicket(ticket);
    const challenge = await this.prisma.auth_challenges.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      return {
        code: 400,
        message: '验证码票据不存在或已失效',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      challenge.status !== 'verified' ||
      !challenge.verified_at ||
      challenge.expire_at.getTime() < Date.now() ||
      String(challenge.purpose || '').toLowerCase() !== 'student_change_password' ||
      String(challenge.channel || '').toLowerCase() !== 'email' ||
      this.normalizeEmailAddress(challenge.target || '') !== targetEmail
    ) {
      return {
        code: 400,
        message: '验证码票据已失效，请重新验证',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: student.user_id },
        data: { password_hash: newPasswordHash },
      }),
      this.prisma.student_profiles.update({
        where: { id: student.id },
        data: { initial_password: null },
      }),
      this.prisma.auth_challenges.update({
        where: { id: challenge.id },
        data: { status: 'used' },
      }),
    ]);

    return {
      code: 0,
      message: '密码修改成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('bind-class')
  async bindClass(@Body() dto: any, @Req() req: any) {
    const userId = this.getAuthenticatedUserId(req);
    if (!userId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const classIdRaw = String(dto.class_id ?? '').trim();
    if (!classIdRaw) {
      return {
        code: 400,
        message: '请选择班级',
        data: null,
        trace_id: req.trace_id,
      };
    }

    // 先做格式校验再 BigInt()：非数字会让 BigInt 抛 SyntaxError 变成 500
    if (!/^\d+$/.test(classIdRaw)) {
      return {
        code: 400,
        message: '班级 ID 无效',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const classInfo = await this.prisma.classes.findUnique({
      where: { id: BigInt(classIdRaw) },
      include: {
        orgs: true,
      },
    });

    if (!classInfo) {
      return {
        code: 404,
        message: '班级不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userRecord = await this.prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: {
        id: true,
        mobile: true,
        email: true,
        wx_openid: true,
      },
    });

    if (!userRecord) {
      return {
        code: 404,
        message: '学生账户不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingProfile = await this.prisma.student_profiles.findUnique({
      where: { user_id: BigInt(userId) },
    });

    // 安全修复：已绑定班级的学生不允许自行改绑。
    //
    // 原实现无条件 update class_id，并顺带把该用户 class_monitor 角色的
    // scope_id 改成目标班级 —— 任意学生发一次请求就能把自己挪进任何班级，
    // 并立刻获得该班班干的可见范围（/class-monitor/*），同时绕过
    // change_requests 的两级审批流。
    //
    // 现在只允许「首次绑定」（档案没有 class_id），转班必须走换班申请。
    if (existingProfile?.class_id) {
      return {
        code: 409,
        message: '已绑定班级，如需转班请提交「换班申请」由班主任审批',
        data: null,
        trace_id: req.trace_id,
      };
    }

    let boundProfile:
      | {
          id: bigint;
          user_id: bigint;
          wx_openid: string | null;
        }
      | null = null;

    if (existingProfile) {
      boundProfile = await this.prisma.student_profiles.update({
        where: { id: existingProfile.id },
        data: {
          class_id: classInfo.id,
          org_id: classInfo.org_id,
          major: classInfo.major || existingProfile.major,
          enroll_year: classInfo.enroll_year || existingProfile.enroll_year,
          major_id: classInfo.major_id || existingProfile.major_id,
          mobile: existingProfile.mobile || userRecord.mobile,
          email: existingProfile.email || userRecord.email,
          wx_openid: existingProfile.wx_openid || userRecord.wx_openid || null,
          status: 'active',
        },
        select: {
          id: true,
          user_id: true,
          wx_openid: true,
        },
      });
    } else {
      boundProfile = await this.prisma.student_profiles.create({
        data: {
          user_id: BigInt(userId),
          student_no:
            /^\d+$/.test(String(userRecord.mobile || '').trim())
              ? String(userRecord.mobile || '').trim()
              : `student_${userId}`,
          class_id: classInfo.id,
          org_id: classInfo.org_id,
          major: classInfo.major,
          enroll_year: classInfo.enroll_year,
          major_id: classInfo.major_id,
          mobile: userRecord.mobile,
          email: userRecord.email,
          wx_openid: userRecord.wx_openid,
          status: 'active',
        },
        select: {
          id: true,
          user_id: true,
          wx_openid: true,
        },
      });
    }

    if (!boundProfile) {
      return {
        code: 500,
        message: '绑定失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const token = await this.createStudentToken(boundProfile);

    return {
      code: 0,
      message: '绑定成功',
      data: {
        student_id: boundProfile.id.toString(),
        token,
        class_id: classInfo.id.toString(),
        class_name: classInfo.class_name,
        org_id: classInfo.org_id?.toString(),
        org_name: classInfo.orgs?.name || '',
      },
      trace_id: req.trace_id,
    };
  }

  @Get('available-classes')
  async getAvailableClasses(@Req() req: any) {
    const classes = await this.prisma.classes.findMany({
      include: {
        orgs: true,
      },
      where: {
        status: 'active',
      },
      orderBy: [{ org_id: 'asc' }, { class_name: 'asc' }],
    });

    const classIds = classes.map((item) => item.id);
    const counselorIds = classes
      .map((item) => item.counselor_user_id)
      .filter(Boolean) as bigint[];
    const scopedHeadTeacherRoles = classIds.length
      ? await this.prisma.user_roles.findMany({
          where: {
            role: 'head_teacher',
            scope_id: { in: classIds },
          },
          orderBy: { id: 'asc' },
        })
      : [];
    const fallbackHeadTeacherMap = new Map(
      scopedHeadTeacherRoles
        .filter((item: any) => item.scope_id && item.user_id)
        .map((item: any) => [item.scope_id.toString(), item.user_id]),
    );
    const headTeacherUserIds = Array.from(
      new Set([
        ...counselorIds.map((item) => item.toString()),
        ...scopedHeadTeacherRoles.map((item: any) => item.user_id.toString()),
      ]),
    ).map((item) => BigInt(item));
    const headTeachers = headTeacherUserIds.length
      ? await this.prisma.users.findMany({
          where: { id: { in: headTeacherUserIds } },
          select: { id: true, name: true },
        })
      : [];
    const headTeacherMap = new Map(
      headTeachers.map((item: any) => [item.id.toString(), item]),
    );

    return {
      code: 0,
      message: 'ok',
      data: classes.map((item) => {
        const headTeacherUserId =
          item.counselor_user_id || fallbackHeadTeacherMap.get(item.id.toString()) || null;
        const headTeacher = headTeacherUserId
          ? headTeacherMap.get(headTeacherUserId.toString())
          : null;

        return {
          id: item.id.toString(),
          class_name: item.class_name,
          org_id: item.org_id?.toString(),
          org_name: item.orgs?.name || '',
          head_teacher_user_id: headTeacherUserId?.toString() || null,
          head_teacher_name: headTeacher?.name || '',
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Get('class-change-requests')
  async listClassChangeRequests(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      select: {
        id: true,
        user_id: true,
      },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const requests = await this.prisma.change_requests.findMany({
      where: {
        requester_user_id: student.user_id,
        target_type: 'student_profile_class_change',
        target_id: student.id,
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: requests.map((item: any) => {
        const change = (item.change_json as any) || {};
        const evidenceFileIds = this.getStoredFileIds(
          change.evidence_file_ids,
          change.evidence_file_id,
        );
        return {
          id: item.id.toString(),
          status: normalizeChangeRequestStatus(item.status),
          reason: item.reason || '',
          current_class_name: change.current_class_name || '',
          target_class_name: change.target_class_name || '',
          target_org_name: change.target_org_name || '',
          requested_head_teacher_name: change.requested_head_teacher_name || '',
          evidence_file_id: evidenceFileIds[0] || '',
          evidence_file_ids: evidenceFileIds,
          reject_reason: item.reject_reason || '',
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Post('class-change-requests')
  async createClassChangeRequest(@Body() dto: CreateClassChangeRequestDto, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const reason = String(dto.reason || '').trim();
    const evidenceFileIds = this.mergeOptionalFileIds(
      dto.evidence_file_ids,
      dto.evidence_file_id,
    );
    if (!dto.target_class_id || !reason) {
      return {
        code: 400,
        message: '请完整填写目标班级和申请原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const [student, targetClass] = await Promise.all([
      this.prisma.student_profiles.findUnique({
        where: { id: BigInt(studentId) },
        include: {
          users: true,
          classes: {
            include: {
              orgs: true,
            },
          },
        },
      }),
      this.prisma.classes.findUnique({
        where: { id: BigInt(dto.target_class_id) },
        include: {
          orgs: true,
        },
      }),
    ]);

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!targetClass) {
      return {
        code: 404,
        message: '目标班级不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (student.class_id?.toString() === targetClass.id.toString()) {
      return {
        code: 400,
        message: '当前已在该班级，无需重复申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const pendingRequest = await this.prisma.change_requests.findFirst({
      where: {
        requester_user_id: student.user_id,
        target_type: 'student_profile_class_change',
        target_id: student.id,
        status: { in: [...CHANGE_REQUEST_OPEN_PENDING_STATUSES] },
      },
      orderBy: { created_at: 'desc' },
    });

    if (pendingRequest) {
      return {
        code: 409,
        message: '您已有待处理的换班申请，请勿重复提交',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentHeadTeacher = student.classes?.counselor_user_id
      ? await this.prisma.users.findUnique({
          where: { id: student.classes.counselor_user_id },
          select: { id: true, name: true },
        })
      : null;

    if (!currentHeadTeacher?.id) {
      return {
        code: 400,
        message: '当前班级暂未绑定班主任，无法提交换班申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const changeRequest = await this.prisma.change_requests.create({
      data: {
        requester_user_id: student.user_id,
        target_type: 'student_profile_class_change',
        target_id: student.id,
        reason,
        status: CHANGE_REQUEST_STATUS.PENDING_HEAD,
        change_json: {
          request_type: 'student_class_change',
          workflow_stage: 'head_teacher_review',
          student_name: student.users?.name || '',
          student_no: student.student_no,
          current_class_id: student.class_id?.toString() || null,
          current_class_name: student.classes?.class_name || '',
          current_org_id: student.org_id?.toString() || null,
          current_org_name: student.classes?.orgs?.name || '',
          current_head_teacher_user_id: currentHeadTeacher?.id?.toString() || null,
          current_head_teacher_name: currentHeadTeacher?.name || '',
          target_class_id: targetClass.id.toString(),
          target_class_name: targetClass.class_name,
          target_org_id: targetClass.org_id.toString(),
          target_org_name: targetClass.orgs?.name || '',
          target_major: targetClass.major || '',
          target_enroll_year: targetClass.enroll_year,
          target_major_id: targetClass.major_id?.toString() || null,
          requested_head_teacher_user_id: currentHeadTeacher.id.toString(),
          requested_head_teacher_name: currentHeadTeacher.name || '',
          evidence_file_id: evidenceFileIds[0]?.toString() || null,
          evidence_file_ids: evidenceFileIds.map((item) => item.toString()),
        } as any,
      },
    });

    return {
      code: 0,
      message: '换班申请已提交，等待当前班主任审核',
      data: { id: changeRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('preferences')
  async getPreferences(@Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const notifyPrefs = (student.notify_prefs_json as Record<string, any>) || {};
    const channels = Array.isArray(notifyPrefs.notification_channels)
      ? notifyPrefs.notification_channels
      : [
          ...(notifyPrefs.wechat !== false ? ['wechat'] : []),
          ...(notifyPrefs.sms !== false ? ['sms'] : []),
          ...(notifyPrefs.email === true ? ['email'] : []),
        ];
    const quietHours =
      notifyPrefs.quiet_hours && typeof notifyPrefs.quiet_hours === 'object'
        ? {
            start: String(notifyPrefs.quiet_hours.start || '22:00'),
            end: String(notifyPrefs.quiet_hours.end || '08:00'),
          }
        : { start: '22:00', end: '08:00' };

    const wechatEnabled =
      typeof notifyPrefs.wechat === 'boolean'
        ? notifyPrefs.wechat
        : channels.includes('wechat');
    const smsEnabled =
      typeof notifyPrefs.sms === 'boolean'
        ? notifyPrefs.sms
        : channels.includes('sms');
    const emailEnabled =
      typeof notifyPrefs.email === 'boolean'
        ? notifyPrefs.email
        : channels.includes('email');

    return {
      code: 0,
      message: 'ok',
      data: {
        notification_channels: channels,
        warning_reminder: notifyPrefs.warning_reminder !== false,
        wechat: wechatEnabled,
        sms: smsEnabled,
        email: emailEnabled,
        quiet_hours: quietHours,
        notify_prefs_json: {
          ...notifyPrefs,
          wechat: wechatEnabled,
          sms: smsEnabled,
          email: emailEnabled,
          quiet_hours: quietHours,
          warning_reminder: notifyPrefs.warning_reminder !== false,
          notification_channels: channels,
        },
      },
      trace_id: req.trace_id,
    };
  }

  @Put('preferences')
  async updatePreferences(@Body() dto: any, @Req() req: any) {
    const studentId = await this.getAuthenticatedStudentProfileId(req);
    if (!studentId) {
      return {
        code: 401,
        message: '未登录',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentPrefs = (student.notify_prefs_json as Record<string, any>) || {};
    const currentChannels: string[] = Array.isArray(currentPrefs.notification_channels)
      ? currentPrefs.notification_channels
      : ['wechat', 'sms', 'email'];

    const wechat =
      dto.wechat !== undefined
        ? Boolean(dto.wechat)
        : Array.isArray(dto.notification_channels)
          ? dto.notification_channels.includes('wechat')
          : typeof currentPrefs.wechat === 'boolean'
            ? currentPrefs.wechat
            : currentChannels.includes('wechat');
    const sms =
      dto.sms !== undefined
        ? Boolean(dto.sms)
        : Array.isArray(dto.notification_channels)
          ? dto.notification_channels.includes('sms')
          : typeof currentPrefs.sms === 'boolean'
            ? currentPrefs.sms
            : currentChannels.includes('sms');
    const email =
      dto.email !== undefined
        ? Boolean(dto.email)
        : Array.isArray(dto.notification_channels)
          ? dto.notification_channels.includes('email')
          : typeof currentPrefs.email === 'boolean'
            ? currentPrefs.email
            : currentChannels.includes('email');

    const channels = Array.isArray(dto.notification_channels)
      ? dto.notification_channels
      : [
          ...(wechat ? ['wechat'] : []),
          ...(sms ? ['sms'] : []),
          ...(email ? ['email'] : []),
        ];

    const rawQuietHours = dto.quiet_hours;
    const quietHours =
      rawQuietHours && typeof rawQuietHours === 'object'
        ? {
            start: String(rawQuietHours.start || currentPrefs.quiet_hours?.start || '22:00').trim(),
            end: String(rawQuietHours.end || currentPrefs.quiet_hours?.end || '08:00').trim(),
          }
        : currentPrefs.quiet_hours || { start: '22:00', end: '08:00' };

    const newPrefs = {
      ...currentPrefs,
      wechat,
      sms,
      email,
      quiet_hours: quietHours,
      notification_channels: channels,
      warning_reminder:
        dto.warning_reminder !== undefined
          ? Boolean(dto.warning_reminder)
          : currentPrefs.warning_reminder !== false,
    };

    await this.prisma.student_profiles.update({
      where: { id: student.id },
      data: {
        notify_prefs_json: newPrefs,
      },
    });

    return {
      code: 0,
      message: '保存成功',
      data: newPrefs,
      trace_id: req.trace_id,
    };
  }
}
