<template>
  <div class="page-container head-teacher-leaves-page">
    <h2 class="page-title">请假名单</h2>

    <el-card>
      <div class="toolbar">
        <div class="toolbar-copy">显示本班学生的请假时间段、理由和当前状态。</div>
        <div class="toolbar-actions">
          <el-button @click="loadLeaves">刷新</el-button>
        </div>
      </div>

      <div class="table-shell">
        <el-table v-loading="loading" :data="leaveList" stripe>
          <el-table-column prop="student_no" label="学号" min-width="150" />
          <el-table-column prop="student_name" label="姓名" min-width="120" />
          <el-table-column label="请假时间段" min-width="280">
            <template #default="{ row }">
              {{ formatDateTime(row.from_date) }} - {{ formatDateTime(row.to_date) }}
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="理由" min-width="220" show-overflow-tooltip />
          <el-table-column label="状态" width="130" fixed="right">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.display_status)">
                {{ getStatusText(row.display_status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getHeadTeacherLeaveRequests } from '../../api';

const loading = ref(false);
const leaveList = ref<any[]>([]);

const loadLeaves = async () => {
  loading.value = true;
  try {
    const response = await getHeadTeacherLeaveRequests();
    if (response.code === 0) {
      leaveList.value = response.data || [];
    } else {
      ElMessage.error(response.message || '获取请假名单失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取请假名单失败');
  } finally {
    loading.value = false;
  }
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const getStatusType = (status: string) => {
  if (status === 'pending') return 'warning';
  if (status === 'ongoing') return 'success';
  if (status === 'finished') return 'info';
  if (status === 'rejected') return 'danger';
  return 'info';
};

const getStatusText = (status: string) => {
  if (status === 'pending') return '待审批';
  if (status === 'ongoing') return '请假中';
  if (status === 'finished') return '请假结束';
  if (status === 'rejected') return '已驳回';
  if (status === 'approved') return '已批准';
  return status || '-';
};

onMounted(() => {
  loadLeaves();
});
</script>

<style scoped>
.head-teacher-leaves-page {
  padding: 20px;
}

.toolbar-copy {
  color: #607384;
}
</style>
