<template>
  <div class="import-csv">
    <div class="import-actions">
      <el-upload
        class="upload-demo"
        action="#"
        :auto-upload="false"
        :on-change="(file) => handleFileChange(file, 'csv')"
        :show-file-list="false"
        accept=".csv"
      >
        <el-button type="primary">选择 CSV 文件</el-button>
      </el-upload>
      <el-upload
        class="upload-demo"
        action="#"
        :auto-upload="false"
        :on-change="(file) => handleFileChange(file, 'xlsx')"
        :show-file-list="false"
        accept=".xlsx,.xls"
      >
        <el-button type="success">选择 XLSX 文件</el-button>
      </el-upload>
    </div>

    <div v-if="previewData.length > 0" class="preview-panel">
      <h4>数据预览</h4>
      <div class="table-shell">
      <el-table :data="previewData" border>
        <el-table-column
          v-for="(value, key) in previewData[0]"
          :key="key"
          :prop="key"
          :label="key"
        />
      </el-table>
      </div>
      <div class="preview-meta">预览 {{ previewData.length }} 条数据</div>
    </div>

    <div v-if="error" class="error-text">
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { parseSpreadsheetFile } from '../lib/spreadsheet';

const props = defineProps({
  maxPreview: {
    type: Number,
    default: 10,
  },
});

const emit = defineEmits(['file-selected', 'data-parsed']);

const importFile = ref<File | null>(null);
const previewData = ref<Array<Record<string, string>>>([]);
const error = ref('');

const handleFileChange = async (file: any, fileType: 'csv' | 'xlsx') => {
  importFile.value = file.raw || null;
  error.value = '';

  if (!file.raw) {
    error.value = '文件读取失败';
    previewData.value = [];
    return;
  }

  try {
    const parsed = await parseSpreadsheetFile(file.raw);
    if (!parsed.rows.length) {
      error.value = `${fileType.toUpperCase()} 文件为空或格式不正确`;
      previewData.value = [];
      return;
    }

    previewData.value = parsed.rows.slice(0, props.maxPreview);
    emit('data-parsed', parsed.rows);
    emit('file-selected', file.raw);
  } catch (err: any) {
    previewData.value = [];
    error.value = `解析失败: ${err?.message || '未知错误'}`;
  }
};

defineExpose({
  importFile,
  previewData,
  error,
  handleFileChange,
});
</script>

<style scoped>
.import-csv {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.import-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-panel h4 {
  margin: 0;
}

.preview-meta {
  color: #909399;
}

.error-text {
  color: #f56c6c;
}
</style>
