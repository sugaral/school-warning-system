import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly ignorable404Patterns = [
    /^\/heartbeat(?:\?|$)/,
    /^\/system\/systemConfigs\/getCustomerServiceLink(?:\?|$)/,
    /^\/app\/appsetting\/link\/indexLink(?:\?|$)/,
  ];
  private readonly sensitiveKeys = new Set([
    'password',
    'pass',
    'token',
    'authorization',
    'captcha_code',
    'email_ticket',
    'sms_ticket',
    'mobile',
    'email',
  ]);

  private sanitizeValue(value: unknown, depth = 0): unknown {
    if (depth > 4) {
      return '[Truncated]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, depth + 1));
    }

    if (value && typeof value === 'object') {
      const source = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(source)) {
        if (this.sensitiveKeys.has(key.toLowerCase())) {
          result[key] = '[REDACTED]';
          continue;
        }
        result[key] = this.sanitizeValue(item, depth + 1);
      }
      return result;
    }

    return value;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const responseBody =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: '服务器内部错误' };

    let message =
      typeof responseBody === 'object' && (responseBody as any).message
        ? (responseBody as any).message
        : exception instanceof Error
          ? exception.message
          : '服务器内部错误';

    if (!message) {
      if (status === HttpStatus.FORBIDDEN) {
        message = '权限不足';
      } else if (status === HttpStatus.UNAUTHORIZED) {
        message = '未登录或登录已失效';
      } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        message = '服务器内部错误';
      }
    }

    const traceId = (request as any).trace_id || 'unknown';
    const sanitizedBody = this.sanitizeValue(responseBody);
    const baseLogMessage = `${request.method} ${request.url} - status=${status} trace_id=${traceId}`;
    const isIgnorable404 =
      status === HttpStatus.NOT_FOUND &&
      this.ignorable404Patterns.some((pattern) => pattern.test(String(request.url || '').trim()));

    if (isIgnorable404) {
      this.logger.debug(`${baseLogMessage} 详情=${JSON.stringify(sanitizedBody)}`);
    } else if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
      this.logger.warn(`${baseLogMessage} 详情=${JSON.stringify(sanitizedBody)}`);
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${baseLogMessage} 详情=${JSON.stringify(sanitizedBody)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${baseLogMessage} 详情=${JSON.stringify(sanitizedBody)}`);
    }

    response.status(status).json({
      code: status,
      message,
      data: responseBody,
      trace_id: traceId,
    });
  }
}
