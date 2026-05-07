<template>
  <div class="page-container">
    <h2>特殊审批</h2>

    <el-alert
      title="审批说明"
      type="info"
      :closable="false"
      description="这里统一处理需要教学副院长审批的申请，包括成绩修正、学籍变更、学生换班与教师学院变更。"
      class="page-alert"
    />

    <div class="table-shell">
    <el-table :data="approvals" v-loading="loading" border>
      <el-table-column label="申请类型" width="160">
        <template #default="{ row }">
          <el-tag>{{ getTypeText(row.apply_type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="subject_name" label="申请对象" width="140" />
      <el-table-column prop="subject_no" label="编号/联系方式" width="180" />
      <el-table-column prop="current_value" label="当前信息" min-width="180" show-overflow-tooltip />
      <el-table-column prop="target_value" label="目标信息" min-width="180" show-overflow-tooltip />
      <el-table-column prop="requested_head_teacher_name" label="班主任" width="140" />
      <el-table-column prop="apply_reason" label="申请原因" min-width="220" show-overflow-tooltip />
      <el-table-column label="班主任意见" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          {{ formatHeadTeacherReview(row.head_teacher_review) }}
        </template>
      </el-table-column>
      <el-table-column label="申请时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.apply_time) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button type="success" size="small" @click="handleApprove(row)" :loading="approvingId === row.id + '_approve'">批准</el-button>
          <el-button type="danger" size="small" @click="handleReject(row)" :loading="approvingId === row.id + '_reject'">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';
import { formatDateTime } from '../../lib/format';

const loading = ref(false);
const approvingId = ref<string | null>(null);
const approvals = ref<any[]>([]);

const getTypeText = (type: string) => {
  const map: Record<string, string> = {
    grade_change: '成绩修正',
    status_change: '学籍变更',
    student_class_change: '学生换班',
    teacher_org_change: '教师改学院',
  };
  return map[type] || type || '-';
};



const formatHeadTeacherReview = (review: any) => {
  if (!review) {
    return '-';
  }

  const reviewerName = review.reviewer_name || '班主任';
  const decision = review.approved ? '同意转交' : '驳回';
  const note = review.note ? `：${review.note}` : '';
  return `${reviewerName}${decision}${note}`;
};

const loadApprovals = async () => {
  loading.value = true;
  try {
    const response = await api.get('/vice-dean/special-approvals');
    approvals.value =
      response.data.code === 0 && Array.isArray(response.data.data?.list)
        ? response.data.data.list
        : [];
  } catch (error: any) {
    ElMessage.error(error?.message || '加载审批列表失败');
  } finally {
    loading.value = false;
  }
};

const handleApprove = async (row: any) => {
  try {
    if (approvingId.value) return;
    approvingId.value = row.id + '_approve';
    await ElMessageBox.confirm('确认批准该申请吗？批准后将直接修改系统数据。', '确认审批', {
      type: 'warning',
    });
    await api.post(`/vice-dean/approvals/${row.id}/approve`);
    ElMessage.success('审批通过');
    await loadApprovals();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '操作失败');
    }
  } finally {
    approvingId.value = null;
  }
};

const handleReject = async (row: any) => {
  try {
    if (approvingId.value) return;
    approvingId.value = row.id + '_reject';
    const { value: reason } = await ElMessageBox.prompt('请输入驳回原因', '驳回申请', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请填写驳回原因',
    });

    await api.post(`/vice-dean/approvals/${row.id}/reject`, { reason });
    ElMessage.success('已驳回');
    await loadApprovals();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '操作失败');
    }
  } finally {
    approvingId.value = null;
  }
};

onMounted(loadApprovals);
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-alert {
  margin-bottom: 0;
}
</style>
