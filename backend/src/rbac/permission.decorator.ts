import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

// 权限装饰器 - 用于标记需要特定权限才能访问的接口
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// 数据范围装饰器 - 用于标记需要数据范围过滤的接口
export const DATA_SCOPE_KEY = 'data_scope';

export interface DataScopeOptions {
  entity: string;  // 实体名称：student, class, warning等
  field: string;   // 字段名：student_id, class_id, org_id等
}

export const DataScope = (options: DataScopeOptions) =>
  SetMetadata(DATA_SCOPE_KEY, options);
