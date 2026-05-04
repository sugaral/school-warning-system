import { PrismaService } from './prisma.service';

export type ImportTemplateType = 'grades' | 'course_classes' | 'schedules';

export type ImportTemplateField = {
  key: string;
  label: string;
  columnName: string;
  enabled: boolean;
  required: boolean;
  description?: string;
};

export type ImportTemplate = {
  delimiter: ',';
  fields: ImportTemplateField[];
};

type ImportTemplateDefinition = {
  settingKey: string;
  title: string;
  fields: ImportTemplateField[];
  validate?: (fields: ImportTemplateField[]) => void;
};

const IMPORT_TEMPLATE_DEFINITIONS: Record<ImportTemplateType, ImportTemplateDefinition> = {
  grades: {
    settingKey: 'grades_import_template',
    title: '成绩导入模板',
    fields: [
      {
        key: 'student_no',
        label: '学号',
        columnName: '学号',
        enabled: true,
        required: true,
        description: '用于唯一识别学生，必填',
      },
      {
        key: 'student_name',
        label: '姓名',
        columnName: '姓名',
        enabled: true,
        required: false,
        description: '可选，用于人工核对',
      },
      {
        key: 'class_name',
        label: '班级',
        columnName: '班级',
        enabled: true,
        required: false,
        description: '可选，用于人工核对',
      },
      {
        key: 'course_code',
        label: '课程代码',
        columnName: '课程代码',
        enabled: true,
        required: false,
        description: '推荐填写，可优先用于匹配课程',
      },
      {
        key: 'course_name',
        label: '课程名称',
        columnName: '课程名称',
        enabled: true,
        required: true,
        description: '课程代码未提供时将使用课程名称匹配',
      },
      {
        key: 'term_code',
        label: '学期',
        columnName: '学期',
        enabled: true,
        required: true,
        description: '例如 2026-SPRING',
      },
      {
        key: 'score',
        label: '成绩',
        columnName: '成绩',
        enabled: true,
        required: true,
        description: '0-100 的数值',
      },
    ],
    validate(fields) {
      const hasCourseMatcher = fields.some(
        (field) =>
          field.enabled === true &&
          (field.key === 'course_code' || field.key === 'course_name'),
      );

      if (!hasCourseMatcher) {
        throw new Error('课程代码和课程名称至少启用一个');
      }
    },
  },
  course_classes: {
    settingKey: 'course_classes_import_template',
    title: '课程与开课班导入模板',
    fields: [
      {
        key: 'org_name',
        label: '学院',
        columnName: '学院',
        enabled: true,
        required: false,
        description: '可选，用于限定学院范围或自动创建课程时补全学院',
      },
      {
        key: 'course_code',
        label: '课程代码',
        columnName: '课程代码',
        enabled: true,
        required: false,
        description: '推荐填写，优先按课程代码匹配课程',
      },
      {
        key: 'course_name',
        label: '课程名称',
        columnName: '课程名称',
        enabled: true,
        required: false,
        description: '课程代码缺失时可按课程名称匹配；自动创建课程时必填',
      },
      {
        key: 'credit',
        label: '学分',
        columnName: '学分',
        enabled: true,
        required: false,
        description: '可选，自动创建课程时可写入学分',
      },
      {
        key: 'class_name',
        label: '开课班级',
        columnName: '开课班级',
        enabled: true,
        required: true,
        description: '用于匹配班级，必填',
      },
      {
        key: 'teacher_name',
        label: '任课教师',
        columnName: '任课教师',
        enabled: true,
        required: true,
        description: '用于匹配教师，必填',
      },
      {
        key: 'term_code',
        label: '学期',
        columnName: '学期',
        enabled: true,
        required: true,
        description: '例如 2026-SPRING',
      },
    ],
    validate(fields) {
      const hasCourseMatcher = fields.some(
        (field) =>
          field.enabled === true &&
          (field.key === 'course_code' || field.key === 'course_name'),
      );

      if (!hasCourseMatcher) {
        throw new Error('课程代码和课程名称至少启用一个');
      }
    },
  },
  schedules: {
    settingKey: 'schedules_import_template',
    title: '课表导入模板',
    fields: [
      {
        key: 'org_name',
        label: '学院',
        columnName: '学院',
        enabled: true,
        required: false,
        description: '可选，用于限定班级所属学院',
      },
      {
        key: 'term_code',
        label: '学期',
        columnName: '学期',
        enabled: true,
        required: true,
        description: '例如 2026-SPRING',
      },
      {
        key: 'course_code',
        label: '课程代码',
        columnName: '课程代码',
        enabled: true,
        required: false,
        description: '推荐填写，优先按课程代码匹配课程',
      },
      {
        key: 'course_name',
        label: '课程名称',
        columnName: '课程名称',
        enabled: true,
        required: false,
        description: '课程代码缺失时可按课程名称匹配',
      },
      {
        key: 'class_name',
        label: '班级名称',
        columnName: '班级名称',
        enabled: true,
        required: true,
        description: '用于匹配班级，必填',
      },
      {
        key: 'teacher_name',
        label: '教师名称',
        columnName: '教师名称',
        enabled: true,
        required: true,
        description: '用于匹配教师，必填',
      },
      {
        key: 'session_start',
        label: '上课开始时间',
        columnName: '上课开始时间',
        enabled: true,
        required: true,
        description: '建议格式 YYYY/MM/DD HH:mm',
      },
      {
        key: 'session_end',
        label: '下课时间',
        columnName: '下课时间',
        enabled: true,
        required: true,
        description: '建议格式 YYYY/MM/DD HH:mm',
      },
      {
        key: 'expire_minutes',
        label: '过期分钟数',
        columnName: '过期分钟数',
        enabled: true,
        required: true,
        description: '签到或课表记录的过期分钟数',
      },
    ],
    validate(fields) {
      const hasCourseMatcher = fields.some(
        (field) =>
          field.enabled === true &&
          (field.key === 'course_code' || field.key === 'course_name'),
      );

      if (!hasCourseMatcher) {
        throw new Error('课程代码和课程名称至少启用一个');
      }
    },
  },
};

function cloneTemplate(template: ImportTemplate): ImportTemplate {
  return {
    delimiter: template.delimiter,
    fields: template.fields.map((field) => ({ ...field })),
  };
}

function ensureImportTemplateType(type: string): ImportTemplateType {
  if (type === 'grades' || type === 'course_classes' || type === 'schedules') {
    return type;
  }
  throw new Error('不支持的导入模板类型');
}

function buildDefaultTemplate(type: ImportTemplateType): ImportTemplate {
  const definition = IMPORT_TEMPLATE_DEFINITIONS[type];
  return {
    delimiter: ',',
    fields: definition.fields.map((field) => ({ ...field })),
  };
}

function validateDuplicateColumnNames(fields: ImportTemplateField[]) {
  const duplicateColumnNames = fields
    .filter((field) => field.enabled)
    .map((field) => String(field.columnName || '').trim().toLowerCase())
    .filter((name, index, list) => !!name && list.indexOf(name) !== index);

  if (duplicateColumnNames.length > 0) {
    throw new Error('导入模板中的列名不能重复');
  }
}

export function listImportTemplateTypes(): ImportTemplateType[] {
  return ['grades', 'course_classes', 'schedules'];
}

export function getImportTemplateDefinition(type: ImportTemplateType) {
  return IMPORT_TEMPLATE_DEFINITIONS[type];
}

export function getImportTemplateTitle(type: ImportTemplateType) {
  return getImportTemplateDefinition(type).title;
}

export function getImportTemplateSettingKey(type: ImportTemplateType) {
  return getImportTemplateDefinition(type).settingKey;
}

export function getDefaultImportTemplate(type: ImportTemplateType): ImportTemplate {
  return cloneTemplate(buildDefaultTemplate(type));
}

export function normalizeImportTemplate(
  typeInput: ImportTemplateType | string,
  payload: any,
): ImportTemplate {
  const type = ensureImportTemplateType(String(typeInput));
  const defaultTemplate = buildDefaultTemplate(type);
  const definition = getImportTemplateDefinition(type);
  const defaultMap = new Map(defaultTemplate.fields.map((field) => [field.key, field]));
  const incomingFields = Array.isArray(payload?.fields) ? payload.fields : [];

  const fields = defaultTemplate.fields.map((defaultField) => {
    const incoming =
      incomingFields.find((item: any) => String(item?.key || '') === defaultField.key) || {};
    const enabled =
      incoming.enabled !== undefined ? incoming.enabled === true : defaultField.enabled;
    const required =
      enabled && incoming.required !== undefined
        ? incoming.required === true
        : enabled && defaultField.required;
    const columnName = String(incoming.columnName || defaultField.columnName).trim();

    return {
      ...defaultField,
      columnName: columnName || defaultField.columnName,
      enabled,
      required,
    };
  });

  validateDuplicateColumnNames(fields);
  definition.validate?.(fields);

  return {
    delimiter: ',',
    fields: fields.map((field) => ({
      ...defaultMap.get(field.key),
      ...field,
    })),
  };
}

export async function loadImportTemplate(
  prisma: PrismaService,
  typeInput: ImportTemplateType | string,
): Promise<ImportTemplate> {
  const type = ensureImportTemplateType(String(typeInput));
  const saved = await prisma.system_settings.findUnique({
    where: { setting_key: getImportTemplateSettingKey(type) },
    select: { setting_val: true },
  });

  if (!saved?.setting_val) {
    return getDefaultImportTemplate(type);
  }

  try {
    return normalizeImportTemplate(type, JSON.parse(saved.setting_val));
  } catch {
    return getDefaultImportTemplate(type);
  }
}

export async function saveImportTemplate(
  prisma: PrismaService,
  typeInput: ImportTemplateType | string,
  payload: any,
): Promise<ImportTemplate> {
  const type = ensureImportTemplateType(String(typeInput));
  const template = normalizeImportTemplate(type, payload);

  await prisma.system_settings.upsert({
    where: { setting_key: getImportTemplateSettingKey(type) },
    update: { setting_val: JSON.stringify(template) },
    create: {
      setting_key: getImportTemplateSettingKey(type),
      setting_val: JSON.stringify(template),
    },
  });

  return template;
}

export function getTemplateHeaderMap(template: ImportTemplate) {
  return new Map(
    template.fields
      .filter((field) => field.enabled)
      .map((field) => [field.key, String(field.columnName || '').trim()]),
  );
}

export function getTemplateRequiredFields(template: ImportTemplate) {
  return template.fields.filter((field) => field.enabled && field.required);
}

export function getTemplateValue(row: Record<string, any>, template: ImportTemplate, key: string) {
  const headerMap = getTemplateHeaderMap(template);
  const columnName = headerMap.get(key) || '';
  const directValue =
    row?.[columnName] ??
    row?.[key] ??
    row?.[String(columnName || '').trim().toLowerCase()] ??
    row?.[String(key || '').trim().toLowerCase()];
  return String(directValue ?? '').trim();
}
