/**
 * JSON 序列化工具 —— 用于审计日志
 * 解决 Prisma BigInt / Date 无法直接 JSON.stringify 的问题
 * 同时对敏感字段做脱敏处理
 */

/** 敏感字段集合 */
const SENSITIVE_FIELDS = new Set([
  'password_hash',
  'code_hash',
  'salt',
  'wx_openid',
  'password',
  'token',
  'secret',
  'access_token',
]);

const REDACTED = '***REDACTED***';

/**
 * 递归序列化对象，处理 BigInt → string、Date → ISO string、敏感字段脱敏
 * 返回可安全 JSON.stringify 的纯对象
 */
export function serializeForAudit(value: unknown): any {
  if (value === null || value === undefined) return value;

  // BigInt → string
  if (typeof value === 'bigint') return value.toString();

  // Date → ISO string
  if (value instanceof Date) return value.toISOString();

  // 基本类型直接返回
  if (typeof value !== 'object') return value;

  // 数组递归处理
  if (Array.isArray(value)) return value.map((item) => serializeForAudit(item));

  // 普通对象递归处理
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = serializeForAudit(val);
    }
  }
  return result;
}
