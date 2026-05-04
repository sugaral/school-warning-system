<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2 class="page-title">请假申请</h2>
        <p class="page-desc">提交请假信息，可选上传证明图片，管理端可直接预览。</p>
      </div>
      <el-button type="primary" @click="openCreateDialog">发起请假</el-button>
    </div>

    <div class="table-shell">
      <el-table :data="leaves" v-loading="loading" stripe>
        <el-table-column prop="leave_type" label="请假类型" width="120" />
        <el-table-column label="请假时间" min-width="220">
          <template #default="{ row }">
            {{ formatDateTime(row.start_date) }} 至 {{ formatDateTime(row.end_date) }}
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="请假原因" min-width="260" show-overflow-tooltip />
        <el-table-column label="证明图片" width="120" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.proof_file_ids?.length"
              link
              type="primary"
              @click="openPreview(row.proof_file_ids, '请假证明')"
            >
              查看图片
            </el-button>
            <span v-else class="muted-text">未上传</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reject_reason" label="处理说明" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.reject_reason || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showCreateDialog" title="发起请假申请" width="620px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="请假类型" prop="leave_type">
          <el-select v-model="form.leave_type" placeholder="请选择请假类型" style="width: 100%">
            <el-option label="事假" value="事假" />
            <el-option label="病假" value="病假" />
            <el-option label="公假" value="公假" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>

        <el-form-item label="审批老师" prop="approver_user_id">
          <el-select
            v-model="form.approver_user_id"
            placeholder="请选择审批老师"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="teacher in teachers"
              :key="teacher.id"
              :label="`${teacher.name}${teacher.type ? `（${teacher.type}）` : ''}`"
              :value="teacher.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="开始日期" prop="start_date">
          <el-date-picker
            v-model="form.start_date"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="请选择开始时间"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item label="结束日期" prop="end_date">
          <el-date-picker
            v-model="form.end_date"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="请选择结束时间"
            style="width: 100%"
          />
        </el-form-item>

        <el-form-item label="请假原因" prop="reason">
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="4"
            maxlength="255"
            show-word-limit
            placeholder="请填写请假原因"
          />
        </el-form-item>

        <el-form-item label="证明图片">
          <MultiImageUploadField
            v-model="form.proof_file_ids"
            v-model:file-urls="form.proof_file_urls"
            source="leave-request"
            placeholder="点击上传请假证明"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="submitLeave">
          提交申请
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
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import MultiImageUploadField from '../../components/MultiImageUploadField.vue';
import { api } from '../../api';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../../lib/uploaded-files';

const loading = ref(false);
const submitLoading = ref(false);
const showCreateDialog = ref(false);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref('');
const previewUrls = ref<string[]>([]);
const leaves = ref<any[]>([]);
const teachers = ref<any[]>([]);
const formRef = ref<FormInstance>();

const createInitialForm = () => ({
  leave_type: '',
  approver_user_id: '',
  start_date: '',
  end_date: '',
  reason: '',
  proof_file_ids: [] as string[],
  proof_file_urls: [] as string[],
});

const form = reactive(createInitialForm());

const validateDateRange = (_rule: any, _value: string, callback: (error?: Error) => void) => {
  if (!form.start_date || !form.end_date) {
    callback();
    return;
  }

  if (new Date(form.start_date).getTime() > new Date(form.end_date).getTime()) {
    callback(new Error('结束日期不能早于开始日期'));
    return;
  }

  callback();
};

const rules: FormRules = {
  leave_type: [{ required: true, message: '请选择请假类型', trigger: 'change' }],
  approver_user_id: [{ required: true, message: '请选择审批老师', trigger: 'change' }],
  start_date: [
    { required: true, message: '请选择开始日期', trigger: 'change' },
    { validator: validateDateRange, trigger: 'change' },
  ],
  end_date: [
    { required: true, message: '请选择结束日期', trigger: 'change' },
    { validator: validateDateRange, trigger: 'change' },
  ],
  reason: [
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        if (!String(value || '').trim()) {
          callback(new Error('请填写请假原因'));
          return;
        }
        callback();
      },
      trigger: ['blur', 'change'],
    },
  ],
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN');
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const getStatusType = (status: string) => {
  if (status === 'submitted') return 'warning';
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'info';
};

const getStatusText = (status: string) => {
  if (status === 'submitted') return '待审批';
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已驳回';
  return status || '-';
};

const resetForm = () => {
  Object.assign(form, createInitialForm());
  formRef.value?.clearValidate();
};

const openCreateDialog = () => {
  resetForm();
  showCreateDialog.value = true;
};

const loadTeachers = async () => {
  try {
    const response = await api.get('/student/teachers');
    if (response.data.code === 0) {
      teachers.value = Array.isArray(response.data.data) ? response.data.data : [];
    }
  } catch (error) {
    console.error('加载审批老师失败', error);
  }
};

const loadLeaves = async () => {
  loading.value = true;
  try {
    const response = await api.get('/student/leave_requests');
    if (response.data.code === 0) {
      leaves.value = response.data.data.list || response.data.data || [];
    } else {
      ElMessage.error(response.data.message || '加载请假记录失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载请假记录失败');
  } finally {
    loading.value = false;
  }
};

const submitLeave = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  submitLoading.value = true;
  try {
    const response = await api.post('/student/leave_requests', {
      leave_type: form.leave_type,
      approver_user_id: form.approver_user_id,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: String(form.reason || '').trim(),
      proof_file_id: form.proof_file_ids[0] || undefined,
      proof_file_ids: form.proof_file_ids.length ? form.proof_file_ids : undefined,
    });

    if (response.data.code !== 0) {
      throw new Error(response.data.message || '提交失败');
    }

    ElMessage.success('请假申请已提交');
    showCreateDialog.value = false;
    await loadLeaves();
  } catch (error: any) {
    ElMessage.error(error?.message || error?.response?.data?.message || '提交失败');
  } finally {
    submitLoading.value = false;
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

onMounted(() => {
  loadLeaves();
  loadTeachers();
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
