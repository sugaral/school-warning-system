<template>
  <div class="page-container">
    <h2>班级概览</h2>

    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon">
            <el-icon :size="40" color="#409eff"><User /></el-icon>
          </div>
          <div class="stat-value">{{ stats.totalStudents }}</div>
          <div class="stat-label">班级总人数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card warning" shadow="hover">
          <div class="stat-icon">
            <el-icon :size="40" color="#d4a017"><Warning /></el-icon>
          </div>
          <div class="stat-value">{{ stats.warningCount }}</div>
          <div class="stat-label">预警人数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card danger" shadow="hover">
          <div class="stat-icon">
            <el-icon :size="40" color="#dc2626"><Bell /></el-icon>
          </div>
          <div class="stat-value">{{ stats.redWarning }}</div>
          <div class="stat-label">红色预警</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card info" shadow="hover">
          <div class="stat-icon">
            <el-icon :size="40" color="#909399"><Document /></el-icon>
          </div>
          <div class="stat-value">{{ stats.leaveCount }}</div>
          <div class="stat-label">请假人数</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">近期预警</span>
              <el-button type="primary" link @click="goToWarnings">查看全部</el-button>
            </div>
          </template>
          <div class="table-shell">
          <el-table :data="recentWarnings" style="width: 100%" size="small">
            <el-table-column prop="student_no" label="学号" width="120" />
            <el-table-column prop="name" label="姓名" width="90" />
            <el-table-column prop="warning_level" label="级别" width="100">
              <template #default="{ row }">
                <el-tag :color="getLevelColor(row.warning_level)" effect="dark" style="border: none;" size="small">
                  {{ getLevelText(row.warning_level) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="warning_reason" label="预警原因" show-overflow-tooltip />
            <el-table-column prop="created_at" label="时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
          </div>
          <el-empty v-if="recentWarnings.length === 0" description="暂无预警数据" />
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">班级动态</span>
            </div>
          </template>
          <div class="class-activities">
            <div
              v-for="(activity, index) in classActivities"
              :key="index"
              class="activity-item"
            >
              <div class="activity-dot" :style="{ background: activity.color || '#409eff' }"></div>
              <div class="activity-content">
                <div class="activity-title">{{ activity.title }}</div>
                <div class="activity-time">{{ formatDate(activity.created_at) }}</div>
              </div>
            </div>
            <el-empty v-if="classActivities.length === 0" description="暂无班级动态" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Bell, Document, User, Warning } from '@element-plus/icons-vue';
import { api } from '../../api';
import { getWarningLevelColor, getWarningLevelText } from '../../lib/warning-level';

const router = useRouter();
const loading = ref(false);
const stats = ref({
  totalStudents: 0,
  warningCount: 0,
  redWarning: 0,
  leaveCount: 0,
});
const recentWarnings = ref<any[]>([]);
const classActivities = ref<any[]>([]);

const getLevelText = (level: string) =>
  getWarningLevelText(level).replace('预警', '') || '-';

const getLevelColor = getWarningLevelColor;

const formatDate = (value: string) => {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN');
};

const loadStats = async () => {
  loading.value = true;
  try {
    const response = await api.get('/class-monitor/stats');
    if (response.data.code === 0) {
      stats.value = response.data.data || stats.value;
    }
  } finally {
    loading.value = false;
  }
};

const loadRecentWarnings = async () => {
  const response = await api.get('/class-monitor/warnings?page=1&pageSize=20');
  if (response.data.code === 0) {
    recentWarnings.value = response.data.data.list || [];
  }
};

const loadClassActivities = async () => {
  const response = await api.get('/class-monitor/activities');
  if (response.data.code === 0) {
    classActivities.value = response.data.data || [];
  }
};

const goToWarnings = () => {
  router.push('/class-warnings');
};

onMounted(async () => {
  await Promise.all([loadStats(), loadRecentWarnings(), loadClassActivities()]);
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
  transition: transform 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
}

.stat-icon {
  margin-bottom: 10px;
}

.stat-value {
  font-size: 36px;
  font-weight: bold;
  color: #409eff;
}

.stat-card.warning .stat-value {
  color: #d4a017;
}

.stat-card.danger .stat-value {
  color: #dc2626;
}

.stat-card.info .stat-value {
  color: #909399;
}

.stat-label {
  margin-top: 10px;
  color: #909399;
  font-size: 14px;
}

.section-card {
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-weight: 600;
  font-size: 16px;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.activity-item:last-child {
  border-bottom: none;
}

.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 12px;
  margin-top: 6px;
  flex-shrink: 0;
}

.activity-content {
  flex: 1;
}

.activity-title {
  font-size: 14px;
  color: #303133;
  margin-bottom: 4px;
}

.activity-time {
  font-size: 12px;
  color: #909399;
}
</style>
