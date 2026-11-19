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

      <div class="pagination-wrap" style="margin-top: 16px; display: flex; justify-content: flex-end;">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getHeadTeacherLeaveRequests } from '../../api';
import { formatDateTime } from '../../lib/format';

const loading = ref(false);
const leaveList = ref<any[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const allLeaves = ref<any[]>([]);

const loadLeaves = async () => {
  loading.value = true;
  try {
    const response = await getHeadTeacherLeaveRequests();
    if (response.code === 0) {
      allLeaves.value = response.data || [];
      total.value = allLeaves.value.length;
      applyPage();
    } else {
      ElMessage.error(response.message || '获取请假名单失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取请假名单失败');
  } finally {
    loading.value = false;
  }
};

const applyPage = () => {
  const start = (page.value - 1) * pageSize.value;
  leaveList.value = allLeaves.value.slice(start, start + pageSize.value);
};

const handlePageChange = (p: number) => {
  page.value = p;
  applyPage();
};

const handleSizeChange = (s: number) => {
  pageSize.value = s;
  page.value = 1;
  applyPage();
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
