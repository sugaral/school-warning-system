import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * 标记接口需要幂等保护（P1-4）
 *
 * 用法：
 *   @Idempotent()
 *   @Post('checkin')
 *   async checkin(...) {}
 *
 * 客户端在请求头带 `Idempotency-Key`（建议 UUID）即可获得：
 *  - 同 key + 同请求体  → 直接回放首次响应，业务不重复执行
 *  - 同 key + 不同请求体 → 409 冲突
 *  - 并发同 key         → 只有一个真正执行，其余等待后回放
 *
 * 只对**写操作**（POST/PUT/PATCH/DELETE）生效，避免误伤查询。
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
