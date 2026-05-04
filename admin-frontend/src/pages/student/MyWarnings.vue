<template>
  <div class="page-container">
    <h2>我的预警</h2>

    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">预警总数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card warning">
          <div class="stat-value">{{ stats.pending }}</div>
          <div class="stat-label">待确认</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card processing">
          <div class="stat-value">{{ stats.processing }}</div>
          <div class="stat-label">已确认</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card closed">
          <div class="stat-value">{{ stats.closed }}</div>
          <div class="stat-label">已关闭</div>
        </el-card>
      </el-col>
    </el-row>

    <div class="table-shell">
    <el-table :data="warnings" v-loading="loading" border>
      <el-table-column prop="warning_level" label="预警级别" width="110">
        <template #default="{ row }">
          <el-tag :color="getLevelColor(row.warning_level)" effect="dark" style="border: none;">
            {{ getLevelText(row.warning_level) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="course_name" label="课程" min-width="160" />
      <el-table-column prop="warning_reason" label="预警原因" min-width="260" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="发布时间" width="180" />
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <div class="action-group">
            <el-button
              v-if="row.status === 'open' || row.status === 'pending'"
              type="primary"
              size="small"
              @click="confirmWarning(row)"
            >
              确认
            </el-button>
            <el-button
              v-if="row.status !== 'closed'"
              type="success"
              size="small"
              @click="applyAppeal(row)"
            >
              申诉
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api';
import { getWarningLevelColor, getWarningLevelText } from '../../lib/warning-level';

const loading = ref(false);
const warnings = ref<any[]>([]);
const router = useRouter();
const stats = ref({
  total: 0,
  pending: 0,
  processing: 0,
  closed: 0,
});

const getLevelColor = getWarningLevelColor;

const getLevelText = (level: string) =>
  getWarningLevelText(level).replace('预警', '');

const getStatusType = (status: string) => {
  switch (status) {
    case 'open':
    case 'pending':
      return 'warning';
    case 'student_acknowledged':
    case 'acknowledged':
    case 'processing':
      return 'success';
    case 'closed':
      return 'info';
    default:
      return 'info';
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'open':
    case 'pending':
      return '待确认';
    case 'student_acknowledged':
    case 'acknowledged':
    case 'processing':
      return '已确认';
    case 'closed':
      return '已关闭';
    default:
      return status;
  }
};

const loadWarnings = async () => {
  loading.value = true;
  try {
    const response = await api.get('/student/warnings');
    if (response.data.code === 0) {
      const payload = response.data.data || {};
      const items = Array.isArray(payload.items)
        ? payload.items.map((item: any) => ({
            id: item.id,
            warning_level: item.warning_level || item.level,
            course_name: item.course_name,
            warning_reason: item.warning_reason || item.trigger_summary,
            status: item.status,
            created_at: item.created_at,
          }))
        : Array.isArray(payload.list)
          ? payload.list
          : [];

      warnings.value = items;
      stats.value = payload.stats || {
        total: Number(payload.total_count || items.length || 0),
        pending: Number(
          payload.open_count ||
            items.filter((item: any) => item.status === 'open' || item.status === 'pending').length,
        ),
        processing: items.filter(
          (item: any) =>
            item.status === 'student_acknowledged'
            || item.status === 'acknowledged'
            || item.status === 'processing',
        ).length,
        closed: items.filter((item: any) => item.status === 'closed').length,
      };
    }
  } catch (error) {
    console.error('获取预警列表失败:', error);
  } finally {
    loading.value = false;
  }
};

const confirmWarning = async (row: any) => {
  try {
    await api.post(`/student/warnings/${row.id}/confirm`);
    ElMessage.success('确认成功');
    loadWarnings();
  } catch {
    ElMessage.error('确认失败');
  }
};

const applyAppeal = (row: any) => {
  router.push({
    path: '/my-appeals',
    query: {
      action: 'create',
      warning_id: String(row.id || ''),
      course_name: String(row.course_name || ''),
      warning_reason: String(row.warning_reason || ''),
    },
  });
};

onMounted(() => {
  loadWarnings();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
}

.stat-card.warning .stat-value {
  color: #d4a017;
}

.stat-card.processing .stat-value {
  color: #409eff;
}

.stat-card.closed .stat-value {
  color: #67c23a;
}

.stat-label {
  margin-top: 10px;
  color: #909399;
}

.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
