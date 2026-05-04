<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">申诉记录</h2>
        <p class="page-desc">查看申诉处理进度，也可以直接发起新的申诉。</p>
      </div>
      <el-button type="primary" @click="openCreateDialog">发起申诉</el-button>
    </div>

    <div class="table-shell">
      <el-table :data="appeals" v-loading="loading" stripe>
        <el-table-column prop="appeal_type" label="申诉类型" width="140" />
        <el-table-column prop="warning_course" label="关联类型" width="160" />
        <el-table-column prop="appeal_reason" label="申诉内容" min-width="320" show-overflow-tooltip />
        <el-table-column label="凭证图片" width="120" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.evidence_file_ids?.length"
              link
              type="primary"
              @click="openPreview(row.evidence_file_ids, '申诉凭证')"
            >
              查看图片
            </el-button>
            <span v-else class="muted-text">未上传</span>
          </template>
        </el-table-column>
        <el-table-column label="处理状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getResultType(row.appeal_result)">
              {{ getResultText(row.appeal_result) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="result_note" label="处理说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="提交时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="createDialogVisible" title="发起申诉" width="620px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="申诉类型" prop="appeal_type">
          <el-select v-model="form.appeal_type" placeholder="请选择申诉类型" style="width: 100%">
            <el-option label="预警申诉" value="预警申诉" />
            <el-option label="考勤申诉" value="考勤申诉" />
            <el-option label="成绩申诉" value="成绩申诉" />
            <el-option label="其他申诉" value="其他申诉" />
          </el-select>
        </el-form-item>

        <el-form-item label="关联信息">
          <el-input
            v-model="form.related_type"
            placeholder="例如：课程名、预警来源等"
            maxlength="64"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="申诉内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            maxlength="1000"
            show-word-limit
            placeholder="请填写申诉说明"
          />
        </el-form-item>

        <el-form-item label="凭证图片">
          <MultiImageUploadField
            v-model="form.evidence_file_ids"
            v-model:file-urls="form.evidence_file_urls"
            source="appeal"
            placeholder="点击上传申诉凭证"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitAppeal">
          提交申诉
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="previewTitle" width="720px">
      <div v-loading="previewLoading" class="preview-wrapper">
        <div v-if="previewUrls.length" class="preview-grid">
          <el-image
            v-for="(url, index) in previewUrls"
            :key="`${url}-${index}`"
            :src="url"
            fit="contain"
            :preview-src-list="previewUrls"
            :initial-index="index"
            preview-teleported
            class="preview-image"
          />
        </div>
        <el-empty v-else description="暂无图片" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import MultiImageUploadField from '../../components/MultiImageUploadField.vue';
import { api } from '../../api';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../../lib/uploaded-files';

const loading = ref(false);
const submitting = ref(false);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref('');
const previewUrls = ref<string[]>([]);
const appeals = ref<any[]>([]);
const createDialogVisible = ref(false);
const formRef = ref<FormInstance>();
const route = useRoute();
const router = useRouter();

const createInitialForm = () => ({
  appeal_type: '预警申诉',
  related_type: '',
  warning_id: '',
  content: '',
  evidence_file_ids: [] as string[],
  evidence_file_urls: [] as string[],
});

const form = reactive(createInitialForm());

const rules: FormRules = {
  appeal_type: [{ required: true, message: '请选择申诉类型', trigger: 'change' }],
  content: [
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        if (!String(value || '').trim()) {
          callback(new Error('请填写申诉内容'));
          return;
        }
        callback();
      },
      trigger: ['blur', 'change'],
    },
  ],
};

const getResultType = (result: string) => {
  if (result === 'submitted') return 'warning';
  if (result === 'resolved') return 'success';
  if (result === 'rejected') return 'danger';
  return 'info';
};

const getResultText = (result: string) => {
  if (result === 'submitted') return '待处理';
  if (result === 'resolved') return '已受理';
  if (result === 'rejected') return '已驳回';
  return result || '-';
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const resetForm = () => {
  Object.assign(form, createInitialForm());
  formRef.value?.clearValidate();
};

const openCreateDialog = () => {
  resetForm();
  createDialogVisible.value = true;
};

const applyRoutePrefill = async () => {
  if (route.query.action !== 'create') {
    return;
  }

  resetForm();
  form.warning_id = String(route.query.warning_id || '').trim();
  form.related_type = String(route.query.course_name || '').trim();
  const warningReason = String(route.query.warning_reason || '').trim();
  if (warningReason) {
    form.content = `针对当前预警提出申诉：${warningReason}`;
  }
  createDialogVisible.value = true;

  await router.replace({
    path: route.path,
    query: {},
  });
};

const loadAppeals = async () => {
  loading.value = true;
  try {
    const response = await api.get('/student/appeals');
    if (response.data.code === 0) {
      appeals.value = response.data.data.list || [];
    } else {
      ElMessage.error(response.data.message || '加载申诉记录失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载申诉记录失败');
  } finally {
    loading.value = false;
  }
};

const submitAppeal = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  submitting.value = true;
  try {
    const response = await api.post('/student/appeals', {
      appeal_type: form.appeal_type,
      related_type: form.related_type || undefined,
      warning_id: form.warning_id || undefined,
      content: String(form.content || '').trim(),
      evidence_file_id: form.evidence_file_ids[0] || undefined,
      evidence_file_ids: form.evidence_file_ids.length ? form.evidence_file_ids : undefined,
    });

    if (response.data.code !== 0) {
      throw new Error(response.data.message || '申诉提交失败');
    }

    ElMessage.success('申诉提交成功');
    createDialogVisible.value = false;
    await loadAppeals();
  } catch (error: any) {
    ElMessage.error(error?.message || '申诉提交失败');
  } finally {
    submitting.value = false;
  }
};

const openPreview = async (fileIds: string[] | string, title: string) => {
  previewVisible.value = true;
  previewLoading.value = true;
  previewTitle.value = title;
  revokeObjectUrls(previewUrls.value);
  previewUrls.value = [];

  try {
    previewUrls.value = await loadUploadedFileObjectUrls(fileIds);
  } catch (error: any) {
    previewVisible.value = false;
    ElMessage.error(error?.message || '加载图片失败');
  } finally {
    previewLoading.value = false;
  }
};

watch(
  () => route.fullPath,
  () => {
    void applyRoutePrefill();
  },
);

onMounted(async () => {
  await loadAppeals();
  await applyRoutePrefill();
});

onBeforeUnmount(() => {
  revokeObjectUrls(previewUrls.value);
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.page-desc {
  margin: 6px 0 0;
  color: #66798a;
  line-height: 1.6;
}

.table-shell {
  overflow-x: auto;
}

.muted-text {
  color: #8b98a7;
}

.preview-wrapper {
  min-height: 240px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.preview-image {
  width: 100%;
  min-height: 260px;
}
</style>
