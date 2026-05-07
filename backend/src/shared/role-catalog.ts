import { PrismaService } from './prisma.service';

type RoleCatalogDraft = {
  code: string;
  name: string;
  description: string;
  default_scope: string;
  user_type: string;
  register_scope: string;
  registerable: boolean;
  student_position_options?: string[];
};

export type RoleCatalogItem = RoleCatalogDraft;

const DEFAULT_CLASS_MONITOR_POSITION_OPTIONS = [
  '班干',
  '班长',
  '副班长',
  '团支书',
  '副团支书',
  '班主任助理',
];

type RegisterableRole = {
  code: string;
  name: string;
  description: string;
  userType: string;
  scopeType: string;
};

export const ROLE_ALIAS_MAP: Record<string, string> = {
  monitor: 'class_monitor',
  dean: 'teaching_admin',
  admin: 'sys_admin',
};

const FALLBACK_USER_TYPE_BY_ROLE: Record<string, string> = {
  student: 'student',
  class_monitor: 'student',
  head_teacher: 'teacher',
  student_admin: 'staff',
  teaching_admin: 'teacher',
  vice_dean: 'teacher',
  sys_admin: 'admin',
  teacher: 'teacher',
};

const FALLBACK_SCOPE_BY_ROLE: Record<string, string> = {
  sys_admin: 'school',
  teaching_admin: 'school',
  teacher: 'class',
  head_teacher: 'class',
  vice_dean: 'org',
  student_admin: 'org',
  class_monitor: 'class',
  student: 'self',
};

const FALLBACK_REGISTER_SCOPE_BY_ROLE: Record<string, string> = {
  sys_admin: 'system',
  teaching_admin: 'school',
  teacher: 'self',
  head_teacher: 'class',
  vice_dean: 'college',
  student_admin: 'college',
  class_monitor: 'class',
  student: 'self',
};

export const DEFAULT_ROLE_CATALOG: RoleCatalogItem[] = [
  {
    code: 'student',
    name: '学生',
    description: '学生自助端角色',
    default_scope: 'self',
    user_type: 'student',
    register_scope: 'self',
    registerable: true,
  },
  {
    code: 'class_monitor',
    name: '班干',
    description: '拥有班级级别的学生协助权限',
    default_scope: 'class',
    user_type: 'student',
    register_scope: 'class',
    registerable: true,
    student_position_options: [...DEFAULT_CLASS_MONITOR_POSITION_OPTIONS],
  },
  {
    code: 'head_teacher',
    name: '班主任',
    description: '负责班级学生事务管理',
    default_scope: 'class',
    user_type: 'teacher',
    register_scope: 'class',
    registerable: true,
  },
  {
    code: 'student_admin',
    name: '学工管理员',
    description: '负责学院内学生事务管理',
    default_scope: 'org',
    user_type: 'staff',
    register_scope: 'college',
    registerable: true,
  },
  {
    code: 'teaching_admin',
    name: '教务管理员',
    description: '负责课程、课表和成绩管理',
    default_scope: 'school',
    user_type: 'teacher',
    register_scope: 'school',
    registerable: true,
  },
  {
    code: 'vice_dean',
    name: '副院长',
    description: '负责专项学业审批',
    default_scope: 'org',
    user_type: 'teacher',
    register_scope: 'college',
    registerable: true,
  },
  {
    code: 'sys_admin',
    name: '系统管理员',
    description: '拥有系统全部管理权限',
    default_scope: 'school',
    user_type: 'admin',
    register_scope: 'system',
    registerable: true,
  },
  {
    code: 'teacher',
    name: '教师',
    description: '负责授课班级和考勤管理',
    default_scope: 'class',
    user_type: 'teacher',
    register_scope: 'self',
    registerable: true,
  },
];

export const ROLE_CATALOG_SETTING_KEY = 'rbac_roles';

function cloneRoleCatalog(items: RoleCatalogItem[]): RoleCatalogItem[] {
  return items.map((item) => ({ ...item }));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') {
      return true;
    }
    if (lower === 'false') {
      return false;
    }
  }

  return fallback;
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => normalizeString(item))
        .filter(Boolean),
    ),
  );
}

function normalizeRoleEntry(input: unknown): RoleCatalogItem | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const code = normalizeRoleCode(normalizeString(raw.code));
  if (!code) {
    return null;
  }

  const fallbackDefaultScope = FALLBACK_SCOPE_BY_ROLE[code] || 'self';
  const fallbackUserType = FALLBACK_USER_TYPE_BY_ROLE[code] || 'student';
  const fallbackRegisterScope = FALLBACK_REGISTER_SCOPE_BY_ROLE[code] || fallbackDefaultScope;

  const defaultScope =
    normalizeString(raw.default_scope) ||
    normalizeString(raw.defaultScope) ||
    fallbackDefaultScope;
  const userType =
    normalizeString(raw.user_type) ||
    normalizeString(raw.userType) ||
    fallbackUserType;
  const registerScope =
    normalizeString(raw.register_scope) ||
    normalizeString(raw.registerScope) ||
    fallbackRegisterScope;
  const studentPositionOptions = normalizeStringArray(
    raw.student_position_options ?? raw.studentPositionOptions,
  );

  return {
    code,
    name: normalizeString(raw.name) || code,
    description: normalizeString(raw.description),
    default_scope: defaultScope,
    user_type: userType,
    register_scope: registerScope,
    registerable: normalizeBoolean(raw.registerable, true),
    student_position_options:
      code === 'class_monitor'
        ? studentPositionOptions.length > 0
          ? studentPositionOptions
          : [...DEFAULT_CLASS_MONITOR_POSITION_OPTIONS]
        : studentPositionOptions,
  };
}

function dedupeByCode(items: RoleCatalogItem[]): RoleCatalogItem[] {
  const map = new Map<string, RoleCatalogItem>();
  for (const item of items) {
    map.set(item.code, item);
  }
  return Array.from(map.values());
}

function mergeRoleCatalogWithDefaults(items: RoleCatalogItem[]): RoleCatalogItem[] {
  const merged = new Map<string, RoleCatalogItem>();

  for (const item of DEFAULT_ROLE_CATALOG) {
    merged.set(item.code, { ...item });
  }

  for (const item of items) {
    const current = merged.get(item.code);
    merged.set(item.code, {
      ...(current || {}),
      ...item,
      code: item.code,
      name: item.name || current?.name || item.code,
      description: item.description || current?.description || '',
      default_scope: item.default_scope || current?.default_scope || 'self',
      user_type: item.user_type || current?.user_type || 'student',
      register_scope:
        item.register_scope ||
        current?.register_scope ||
        item.default_scope ||
        current?.default_scope ||
        'self',
      registerable:
        typeof item.registerable === 'boolean'
          ? item.registerable
          : current?.registerable ?? true,
      student_position_options:
        item.code === 'class_monitor'
          ? normalizeStringArray(
              item.student_position_options ??
                current?.student_position_options ??
                DEFAULT_CLASS_MONITOR_POSITION_OPTIONS,
            )
          : normalizeStringArray(
              item.student_position_options ?? current?.student_position_options ?? [],
            ),
    });
  }

  return Array.from(merged.values());
}

export function normalizeRoleCode(roleCode: string): string {
  return ROLE_ALIAS_MAP[roleCode] || roleCode;
}

export function toRoleNameMap(roles: RoleCatalogItem[]): Record<string, string> {
  return roles.reduce(
    (acc, item) => {
      acc[item.code] = item.name;
      return acc;
    },
    {} as Record<string, string>,
  );
}

export function getClassMonitorPositionOptions(roles: RoleCatalogItem[]): string[] {
  const role = roles.find((item) => item.code === 'class_monitor');
  const options = normalizeStringArray(
    role?.student_position_options ?? DEFAULT_CLASS_MONITOR_POSITION_OPTIONS,
  );
  return options.length > 0 ? options : [...DEFAULT_CLASS_MONITOR_POSITION_OPTIONS];
}

export function toRegisterableRoles(roles: RoleCatalogItem[]): RegisterableRole[] {
  return roles
    .filter((item) => item.registerable !== false)
    .map((item) => ({
      code: item.code,
      name: item.name,
      description: item.description,
      userType: item.user_type,
      scopeType: item.register_scope || item.default_scope,
    }));
}

export async function saveRoleCatalog(
  prisma: PrismaService,
  roles: RoleCatalogItem[],
): Promise<RoleCatalogItem[]> {
  const normalized = dedupeByCode(
    roles
      .map((item) => normalizeRoleEntry(item))
      .filter((item): item is RoleCatalogItem => !!item),
  );

  const finalRoles = normalized.length > 0 ? normalized : cloneRoleCatalog(DEFAULT_ROLE_CATALOG);

  await prisma.system_settings.upsert({
    where: { setting_key: ROLE_CATALOG_SETTING_KEY },
    update: {
      setting_val: JSON.stringify(finalRoles),
    },
    create: {
      setting_key: ROLE_CATALOG_SETTING_KEY,
      setting_val: JSON.stringify(finalRoles),
    },
  });

  return cloneRoleCatalog(finalRoles);
}

export async function loadRoleCatalog(prisma: PrismaService): Promise<RoleCatalogItem[]> {
  const setting = await prisma.system_settings.findUnique({
    where: { setting_key: ROLE_CATALOG_SETTING_KEY },
    select: { setting_val: true },
  });

  if (!setting?.setting_val) {
    return saveRoleCatalog(prisma, DEFAULT_ROLE_CATALOG);
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(setting.setting_val);
  } catch {
    return saveRoleCatalog(prisma, DEFAULT_ROLE_CATALOG);
  }

  if (!Array.isArray(parsed)) {
    return saveRoleCatalog(prisma, DEFAULT_ROLE_CATALOG);
  }

  const normalized = dedupeByCode(
    parsed
      .map((item) => normalizeRoleEntry(item))
      .filter((item): item is RoleCatalogItem => !!item),
  );

  const merged = mergeRoleCatalogWithDefaults(normalized);
  const normalizedJson = JSON.stringify(merged);

  if (setting.setting_val !== normalizedJson) {
    await prisma.system_settings.update({
      where: { setting_key: ROLE_CATALOG_SETTING_KEY },
      data: { setting_val: normalizedJson },
    });
  }

  return cloneRoleCatalog(merged);
}
