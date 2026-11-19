import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj?.toNumber === 'function') {
      try {
        const numericValue = obj.toNumber();
        if (Number.isFinite(numericValue)) {
          return numericValue;
        }
      } catch {
        // Fall through to string/object serialization below.
      }
    }
    if (obj?.constructor?.name === 'Decimal') {
      try {
        return obj.toString();
      } catch {
        // Fall through to generic object serialization.
      }
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInt(v)])
    );
  }
  return obj;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const traceId =
      request.trace_id ||
      request.headers['x-trace-id'];

    return next.handle().pipe(
      map((data) => {
        const serializedData = serializeBigInt(data);

        if (serializedData && typeof serializedData === 'object' && 'code' in serializedData) {
          return serializedData;
        }

        return {
          code: 0,
          message: 'ok',
          data: serializedData,
          trace_id: traceId ?? null,
        };
      }),
    );
  }
}

