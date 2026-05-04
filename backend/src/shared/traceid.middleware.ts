import { Injectable, NestMiddleware } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = (req.headers['x-trace-id'] as string) || uuidv4();
    (req as any).trace_id = incoming;
    (res as any).trace_id = incoming;
    (global as any).currentTraceId = incoming;
    res.setHeader('x-trace-id', incoming);
    next();
  }
}

