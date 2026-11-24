<template>
  <div class="import-template-config" v-loading="loading">
    <el-alert
      title="导入文件模版设置"
      type="info"
      :closable="false"
      show-icon
      class="intro-alert"
      description="维护课程与开课班 CSV 导入表头。相关导入页面会按这里配置的列名读取文件内容。"
    />

    <el-tabs v-model="activeType" class="template-tabs">
      <el-tab-pane
        v-for="item in templateTabs"
        :key="item.type"
        :label="item.label"
        :name="item.type"
      >
        <div class="toolbar">
          <span class="toolbar-hint">{{ item.description }}</span>
          <div class="toolbar-actions">
            <el-button @click="reloadTemplates">重新加载</el-button>
            <el-button @click="resetCurrentTemplate(item.type)">重置当前修改</el-button>
            <el-button @click="downloadSample(item.type)">下载示例 CSV</el-button>
            <el-button
              type="primary"
              :loading="savingType === item.type"
              @click="saveCurrentTemplate(item.type)"
            >
              保存当前模板
            </el-button>
          </div>
        </div>

        <div class="table-shell">
        <el-table :data="editableTemplates[item.type].fields" border>
          <el-table-column prop="label" label="字段" width="140" />
          <el-table-column prop="description" label="说明" min-width="240" />
          <el-table-column label="启用" width="90">
            <template #default="{ row }">
              <el-switch v-model="row.enabled" />
            </template>
          </el-table-column>
          <el-table-column label="必填" width="90">
            <template #default="{ row }">
              <el-switch v-model="row.required" :disabled="!row.enabled" />
            </template>
          </el-table-column>
          <el-table-column label="CSV 列名" min-width="220">
            <template #default="{ row }">
              <el-input v-model.trim="row.columnName" placeholder="请输入 CSV 表头名称" />
            </template>
          </el-table-column>
        </el-table>
        </div>

        <div class="footer-tip">
          当前启用列：
          <span>{{ getEnabledHeadersText(item.type) }}</span>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getAdminImportTemplates,
  setAdminImportTemplate,
  type AdminImportTemplateType,
} from '../../api';

type ImportTemplateField = {
  key: string;
  label: string;
  columnName: string;
  enabled: boolean;
  required: boolean;
  description?: string;
};

type ImportTemplate = {
  delimiter: ',';
  fields: ImportTemplateField[];
};

const templateTabs = [
  {
    type: 'course_classes' as const,
    label: '课程与开课班导入',
    description: '适用于课程与开课班页面的 CSV 导入。',
  },
];

const activeType = ref<AdminImportTemplateType>('course_classes');
const loading = ref(false);
const savingType = ref<AdminImportTemplateType | ''>('');

const editableTemplates = reactive<Record<AdminImportTemplateType, ImportTemplate>>({
  course_classes: { delimiter: ',', fields: [] },
});

const originalTemplates = reactive<Record<AdminImportTemplateType, ImportTemplate>>({
  course_classes: { delimiter: ',', fields: [] },
});

const cloneTemplate = (template?: Partial<ImportTemplate>): ImportTemplate => ({
  delimiter: ',',
  fields: Array.isArray(template?.fields)
    ? template!.fields.map((field: any) => ({
        key: String(field.key || ''),
        label: String(field.label || field.key || ''),
        columnName: String(field.columnName || ''),
        enabled: field.enabled === true,
        required: field.required === true,
        description: String(field.description || ''),
      }))
    : [],
});

const getEnabledHeadersText = (type: AdminImportTemplateType) => {
  const fields = editableTemplates[type].fields.filter((field) => field.enabled);
  if (!fields.length) {
    return '暂无启用字段';
  }
  return fields.map((field) => `${field.label}:${field.columnName}`).join('，');
};

const buildSampleValue = (type: AdminImportTemplateType, key: string) => {
  const currentYear = new Date().getFullYear();
  const common: Record<string, string> = {
    org_name: '计算机学院',
    course_code: 'CS101',
    course_name: '高等数学',
    class_name: '计算机 2025-1 班',
    teacher_name: '张老师',
    term_code: `${currentYear}-${currentYear + 1}-1`,
  };

  const byType: Record<AdminImportTemplateType, Record<string, string>> = {
    course_classes: {
      ...common,
      credit: '3',
    },
  };

  return byType[type][key] ?? common[key] ?? '';
};

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const validateTemplate = (type: AdminImportTemplateType, template: ImportTemplate) => {
  const enabledFields = template.fields.filter((field) => field.enabled);
  if (!enabledFields.length) {
    throw new Error('至少启用一个字段');
  }

  const missingColumnName = enabledFields.find((field) => !String(field.columnName || '').trim());
  if (missingColumnName) {
    throw new Error(`${missingColumnName.label}的 CSV 列名不能为空`);
  }

  const duplicateNames = enabledFields
    .map((field) => String(field.columnName || '').trim().toLowerCase())
    .filter((name, index, list) => !!name && list.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    throw new Error('启用字段的 CSV 列名不能重复');
  }

  if (type !== 'course_classes') {
    return;
  }

  const hasCourseMatcher = enabledFields.some((field) =>
    ['course_code', 'course_name'].includes(field.key),
  );
  if (!hasCourseMatcher) {
    throw new Error('课程代码和课程名称至少启用一个');
  }
};

const applyTemplates = (payload: Partial<Record<AdminImportTemplateType, ImportTemplate>>) => {
  (Object.keys(editableTemplates) as AdminImportTemplateType[]).forEach((type) => {
    editableTemplates[type] = cloneTemplate(payload[type]);
    originalTemplates[type] = cloneTemplate(payload[type]);
  });
};

const reloadTemplates = async () => {
  loading.value = true;
  try {
    const response = await getAdminImportTemplates();
    if (response.code !== 0) {
      throw new Error(response.message || '加载导入模板失败');
    }
    applyTemplates(response.data || {});
  } catch (error: any) {
    ElMessage.error(error?.message || '加载导入模板失败');
  } finally {
    loading.value = false;
  }
};

const resetCurrentTemplate = (type: AdminImportTemplateType) => {
  editableTemplates[type] = cloneTemplate(originalTemplates[type]);
  ElMessage.success('已恢复当前模板的未保存修改');
};

const saveCurrentTemplate = async (type: AdminImportTemplateType) => {
  const template = cloneTemplate(editableTemplates[type]);
  try {
    validateTemplate(type, template);
  } catch (error: any) {
    ElMessage.warning(error?.message || '模板校验失败');
    return;
  }

  savingType.value = type;
  try {
    const response = await setAdminImportTemplate(type, {
      fields: template.fields.map((field) => ({
        key: field.key,
        label: field.label,
        columnName: field.columnName,
        enabled: field.enabled,
        required: field.required && field.enabled,
      })),
    });

    if (response.code !== 0) {
      throw new Error(response.message || '保存模板失败');
    }

    editableTemplates[type] = cloneTemplate(response.data);
    originalTemplates[type] = cloneTemplate(response.data);
    ElMessage.success('导入模板已保存');
  } catch (error: any) {
    ElMessage.error(error?.message || '保存模板失败');
  } finally {
    savingType.value = '';
  }
};

const downloadSample = (type: AdminImportTemplateType) => {
  const template = editableTemplates[type];
  const enabledFields = template.fields.filter((field) => field.enabled);
  if (!enabledFields.length) {
    ElMessage.warning('请先启用至少一个字段');
    return;
  }

  const headers = enabledFields.map((field) => field.columnName);
  const sampleRow = enabledFields.map((field) => escapeCsvCell(buildSampleValue(type, field.key)));
  const content = [headers.join(','), sampleRow.join(',')].join('\n');
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const label = templateTabs.find((item) => item.type === type)?.label || type;
  link.download = `${label}示例模板.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

onMounted(() => {
  reloadTemplates();
});
</script>

<style scoped>
.import-template-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.intro-alert {
  margin-bottom: 4px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.toolbar-hint {
  color: #606266;
  line-height: 1.6;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.footer-tip {
  margin-top: 12px;
  color: #606266;
  line-height: 1.6;
}

.template-tabs :deep(.el-tabs__content) {
  overflow: visible;
}
</style>
