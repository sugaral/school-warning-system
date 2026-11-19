import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly authCacheTtlSeconds = 30;
  private readonly authL1Cache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly MAX_CACHE_SIZE = 5000;
  private lastSweepAt = 0;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private buildActiveUserCacheKey(userId: string, userType: string) {
    return `auth:active-user:${userId}:${userType}`;
  }

  private buildStudentSessionCacheKey(studentId: string, userId: string, wxOpenid: string | null) {
    return `auth:student-session:${studentId}:${userId}:${wxOpenid || 'none'}`;
  }

  private sweepExpired() {
    const now = Date.now();
    for (const [key, entry] of this.authL1Cache) {
      if (entry.expiresAt <= now) {
        this.authL1Cache.delete(key);
      }
    }
  }

  private async getCachedValue<T>(key: string): Promise<T | null> {
    const cached = this.authL1Cache.get(key);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.authL1Cache.delete(key);
      return null;
    }

    return cached.value as T;
  }

  private primeCache(key: string, value: unknown) {
    // Sweep expired entries periodically (every 60s)
    if (Date.now() - this.lastSweepAt > 60_000) {
      this.lastSweepAt = Date.now();
      this.sweepExpired();
      // If still over limit after sweep, evict oldest entries
      if (this.authL1Cache.size >= AuthGuard.MAX_CACHE_SIZE) {
        const entries = [...this.authL1Cache.entries()]
          .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
        const toEvict = entries.slice(0, Math.floor(AuthGuard.MAX_CACHE_SIZE * 0.2));
        for (const [key] of toEvict) {
          this.authL1Cache.delete(key);
        }
      }
    }

    this.authL1Cache.set(key, {
      value,
      expiresAt: Date.now() + this.authCacheTtlSeconds * 1000,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    // 🔍 性能诊断：记录 Guard 入口时间
    if (!request._guardEnterAt) {
      request._guardEnterAt = Date.now();
    }
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const token = authHeader.slice(7);

    // 🔍 性能诊断：记录 AuthGuard 总耗时
    const agStart = Date.now();

    try {
      // 解码 JWT 获取 jti 和 exp（不验证签名）
      const decoded = this.jwtService.decode(token) as any;
      if (decoded?.jti) {
        // 检查 Redis 黑名单
        const redisStart = Date.now();
        const isRevoked = await this.redis.get(`token:revoked:${decoded.jti}`);
        const redisDuration = Date.now() - redisStart;
        if (redisDuration > 200) {
          console.warn(`[AuthGuard] ⚠️ Redis 黑名单查询慢 ${redisDuration}ms`);
        }
        if (isRevoked) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      const jwtStart = Date.now();
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      const jwtDuration = Date.now() - jwtStart;
      if (jwtDuration > 100) {
        console.warn(`[AuthGuard] ⚠️ JWT 验证慢 ${jwtDuration}ms`);
      }

      const dbStart = Date.now();
      await this.validateActiveUserPayload(payload);
      const dbDuration = Date.now() - dbStart;
      if (dbDuration > 500) {
        console.warn(`[AuthGuard] ⚠️ 用户状态查询慢 ${dbDuration}ms, userId=${payload.sub}`);
      }

      if (payload.user_type === 'student') {
        await this.validateStudentPayload(payload);
      }

      const agDuration = Date.now() - agStart;
      if (agDuration > 1000) {
        console.warn(`[AuthGuard] ⚠️ AuthGuard 总耗时 ${agDuration}ms, userId=${payload.sub}`);
      }

      request.user = {
        sub: String(payload.sub),
        userId: String(payload.sub),
        user_type: payload.user_type,
        userType: payload.user_type,
        student_id:
          payload.student_id === undefined || payload.student_id === null
            ? undefined
            : String(payload.student_id),
      };

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private async validateActiveUserPayload(payload: any) {
    const userId = String(payload?.sub || '').trim();
    if (!userId) {
      throw new UnauthorizedException('Invalid user session');
    }

    const userType = String(payload?.user_type || '').trim();
    const cached = await this.getCachedValue<{ status: string; user_type: string }>(
      this.buildActiveUserCacheKey(userId, userType),
    );
    if (cached) {
      if (String(cached.user_type) !== userType) {
        throw new UnauthorizedException('User type mismatch');
      }
      if (cached.status !== 'active') {
        throw new UnauthorizedException('Account is disabled');
      }
      return;
    }

    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(userId) },
      select: {
        id: true,
        status: true,
        user_type: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User session has expired');
    }

    if (String(user.user_type) !== String(payload?.user_type || '')) {
      throw new UnauthorizedException('User type mismatch');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is disabled');
    }

    this.primeCache(this.buildActiveUserCacheKey(userId, userType), {
      status: user.status,
      user_type: user.user_type,
    });
  }

  private async validateStudentPayload(payload: any) {
    const studentId = String(payload.student_id || '').trim();
    if (!studentId) {
      return;
    }

    const userId = String(payload.sub || '').trim();
    const tokenWxOpenid =
      payload.wx_openid === undefined || payload.wx_openid === null
        ? null
        : String(payload.wx_openid);
    const cached = await this.getCachedValue<{ status: string }>(
      this.buildStudentSessionCacheKey(studentId, userId, tokenWxOpenid),
    );
    if (cached) {
      if (cached.status !== 'active') {
        throw new UnauthorizedException('Student account is disabled');
      }
      return;
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(studentId) },
      select: {
        id: true,
        user_id: true,
        status: true,
        wx_openid: true,
      },
    });

    if (!student || student.user_id.toString() !== String(payload.sub)) {
      throw new UnauthorizedException('Student session has expired');
    }

    if (student.status !== 'active') {
      throw new UnauthorizedException('Student account is disabled');
    }
    const currentWxOpenid = student.wx_openid ? String(student.wx_openid) : null;

    if (tokenWxOpenid !== currentWxOpenid) {
      throw new UnauthorizedException('WeChat binding has changed, please sign in again');
    }

    this.primeCache(this.buildStudentSessionCacheKey(studentId, userId, tokenWxOpenid), {
      status: student.status,
    });
  }
}
