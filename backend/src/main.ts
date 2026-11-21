import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import { ResponseInterceptor } from './shared/response.interceptor';
import { TraceIdMiddleware } from './shared/traceid.middleware';
import { HttpExceptionFilter } from './shared/http-exception.filter';
import { AuditInterceptor } from './shared/audit.interceptor';
import { PrismaService } from './shared/prisma.service';
import { RedisService } from './shared/redis.service';
import { AdminResponseCacheInterceptor } from './shared/admin-response-cache.interceptor';
import { getUploadRootCandidates } from './shared/upload-path.util';
import { PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';

function normalizeOriginValue(origin?: string | null) {
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return null;
  }
}

function extractHostname(value?: string | null) {
  if (!value) {
    return '';
  }

  const normalized = value
    .split(',')[0]
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

  return normalized.split(':')[0].trim().toLowerCase();
}

function isLocalDevHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

function buildAllowedOriginSet() {
  const candidates = [
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.ADMIN_FRONTEND_URL,
    process.env.FRONTEND_URL,
    process.env.WEB_URL,
    process.env.APP_URL,
    process.env.VITE_ADMIN_APP_URL,
    process.env.VITE_FRONTEND_URL,
  ]
    .filter(Boolean)
    .flatMap((item) => String(item).split(','))
    .map((item) => normalizeOriginValue(item.trim()))
    .filter((item): item is string => Boolean(item));

  return new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    ...candidates,
  ]);
}

async function bootstrap() {
  // 使用默认 Logger，PinoLogger 仍用于 AuditInterceptor
  const app = await NestFactory.create(AppModule);
  const trustProxyEnv = String(process.env.TRUST_PROXY || '').trim();
  const trustProxySetting =
    trustProxyEnv === 'true'
      ? true
      : trustProxyEnv === 'false'
        ? false
        : /^\d+$/.test(trustProxyEnv)
          ? Number(trustProxyEnv)
          : 1;
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxySetting);

  const allowedOrigins = buildAllowedOriginSet();

  // 安全加固：启用 Helmet
  app.use(helmet());

  // 允许本地开发、同主机部署和显式配置的前端来源跨域访问
  app.enableCors((req: any, callback: any) => {
    const origin = String(req.header('origin') || '').trim();
    const normalizedOrigin = normalizeOriginValue(origin);
    const originHost = extractHostname(origin);
    const forwardedHost = extractHostname(req.header('x-forwarded-host'));
    const requestHost = extractHostname(req.header('host'));
    const currentHost = forwardedHost || requestHost;

    const allow =
      !origin ||
      (normalizedOrigin !== null &&
        (allowedOrigins.has(normalizedOrigin) ||
          (originHost && isLocalDevHostname(originHost)) ||
          (originHost && currentHost && originHost === currentHost) ||
          (originHost === 'localhost' && currentHost === '127.0.0.1') ||
          (originHost === '127.0.0.1' && currentHost === 'localhost')));

    if (!allow && origin) {
      // 使用 NestJS 内置 Logger 避免在回调中使用 resolve
      const { Logger } = require('@nestjs/common');
      new Logger('CORS').warn(`[跨域拦截] 已拒绝来源: ${origin}`);
    }

    callback(null, {
      origin: allow,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type,Authorization,x-student-id',
      credentials: true,
    });
  });

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );

  // 获取 PrismaService 和 PinoLogger 实例
  const prismaService = app.get(PrismaService);
  const redisService = app.get(RedisService);
  const pinoLogger = await app.resolve(PinoLogger);

  app.useGlobalInterceptors(
    new AdminResponseCacheInterceptor(redisService),
    new ResponseInterceptor(),
    new AuditInterceptor(prismaService, pinoLogger),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  for (const uploadRoot of getUploadRootCandidates(process.cwd())) {
    app.use('/uploads', express.static(uploadRoot));
  }

  // 确保 JSON 接口默认使用 UTF-8，静态资源保持原始类型
  app.use((req: any, res: any, next: any) => {
    if (!String(req.path || '').startsWith('/uploads')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    next();
  });

  await app.listen(process.env.PORT || 3000);
}

bootstrap().catch((err) => {
  // 直接输出到 stderr，确保能看到错误
  console.error('========== BOOTSTRAP ERROR ==========');
  console.error(err);
  console.error('Stack:', err?.stack);
  console.error('Message:', err?.message);
  console.error('=====================================');
  process.exit(1);
});
