<template>
  <div class="page-container">
    <h2>班级预警</h2>
    
    <div class="table-shell">
    <el-table :data="warnings" v-loading="loading" border>
      <el-table-column prop="student_no" label="学号" width="120" />
      <el-table-column prop="name" label="姓名" width="80" />
      <el-table-column prop="warning_level" label="预警级别" width="100">
        <template #default="{ row }">
          <el-tag :color="getLevelColor(row.warning_level)" effect="dark" style="border: none;">
            {{ getLevelText(row.warning_level) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="course_name" label="课程" />
      <el-table-column prop="warning_reason" label="预警原因" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag>{{ getStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../api';
import { getWarningLevelColor, getWarningLevelText } from '../../lib/warning-level';

const loading = ref(false);
const warnings = ref<any[]>([]);

const getLevelColor = getWarningLevelColor;

const getLevelText = (level: string) =>
  getWarningLevelText(level).replace('预警', '');

const getStatusText = (status: string) => {
  switch (status) {
    case 'open': return '待确认';
    case 'acknowledged': return '已确认';
    case 'pending': return '待确认';
    case 'processing': return '处理中';
    case 'closed': return '已关闭';
    default: return status;
  }
};

const loadWarnings = async () => {
  loading.value = true;
  try {
    const response = await api.get('/class-monitor/warnings');
    if (response.data.code === 0) {
      warnings.value = response.data.data.list || [];
    }
  } catch (error) {
    console.error('获取预警列表失败:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadWarnings();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}
</style>
