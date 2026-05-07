﻿﻿﻿<template>
  <div class="page-container">
    <h2>本班概览</h2>
    
    <el-alert
      v-if="loading"
      title="正在加载数据..."
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 20px;"
    />
    
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
      <el-col :span="16">
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
            <el-table-column prop="name" label="姓名" width="80" />
            <el-table-column prop="warning_level" label="级别" width="80">
              <template #default="{ row }">
                <el-tag :color="getLevelColor(row.warning_level)" effect="dark" style="border: none;">
                  {{ getLevelText(row.warning_level) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="warning_reason" label="预警原因" show-overflow-tooltip />
            <el-table-column prop="created_at" label="时间" width="160">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
          </div>
          <el-empty v-if="recentWarnings.length === 0" description="暂无预警数据" />
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <el-card class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">待办事项</span>
            </div>
          </template>
          <el-timeline>
            <el-timeline-item
              v-for="(item, index) in todoList"
              :key="index"
              :timestamp="item.time"
              :type="item.type"
              :color="item.color"
            >
              {{ item.content }}
            </el-timeline-item>
          </el-timeline>
          <el-empty v-if="todoList.length === 0" description="暂无待办事项" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card class="section-card">
          <template #header>
            <div class="card-header">
              <span class="header-title">快捷操作</span>
            </div>
          </template>
          <div class="quick-actions">
            <el-button
              v-if="hasTeacherRole"
              type="primary"
              class="action-btn"
              @click="goToAttendance"
            >
              <el-icon><Edit /></el-icon>
              生成签到
            </el-button>
            <el-button type="danger" class="action-btn" @click="goToInterventions">
              <el-icon><Bell /></el-icon>
              高风险干预
            </el-button>
            <el-button type="success" class="action-btn" @click="goToApprovals">
              <el-icon><Document /></el-icon>
              处理审批
            </el-button>
            <el-button type="warning" class="action-btn" @click="goToExport">
              <el-icon><Download /></el-icon>
              导出数据
            </el-button>
          </div>
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
            <div v-for="(activity, index) in classActivities" :key="index" class="activity-item">
              <div class="activity-dot"></div>
              <div class="activity-content">
                <div class="activity-title">{{ activity.title }}</div>
                <div class="activity-time">{{ activity.time }}</div>
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
import {
  User,
  Warning,
  Bell,
  Document,
  Download,
  Edit,
} from '@element-plus/icons-vue';
import { getHeadTeacherLeaveRequests, getHeadTeacherStats, getHeadTeacherWarnings } from '../../api';
import { getWarningLevelColor, getWarningLevelText } from '../../lib/warning-level';

const router = useRouter();
const loading = ref(false);
const stats = ref({
  totalStudents: 0,
  warningCount: 0,
  redWarning: 0,
  leaveCount: 0
});
const recentWarnings = ref<any[]>([]);
const todoList = ref<any[]>([]);
const classActivities = ref<any[]>([]);
const hasTeacherRole = ref(false);
const leaveRequests = ref<any[]>([]);

const getLevelText = (level: string) =>
  getWarningLevelText(level).replace('预警', '');

const getLevelColor = getWarningLevelColor;

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
};

const loadStats = async () => {
  loading.value = true;
  try {
    const resp = await getHeadTeacherStats();
    if (resp.code === 0) {
      stats.value = resp.data;
    } else {
      console.error('获取班级统计失败:', resp.message);
    }
  } catch (error) {
    console.error('获取班级统计失败:', error);
  } finally {
    loading.value = false;
  }
};

const loadRecentWarnings = async () => {
  try {
    const resp = await getHeadTeacherWarnings({ page: 1, pageSize: 10 });
    if (resp.code === 0) {
      recentWarnings.value = resp.data.list || [];
    } else {
      console.error('获取预警列表失败:', resp.message);
    }
  } catch (error) {
    console.error('获取预警列表失败:', error);
  }
};

const rebuildDashboardBlocks = () => {
  const nextTodoList: any[] = [];
  const nextActivities: any[] = [];

  const pendingLeaveCount = leaveRequests.value.filter((item) => item.status === 'submitted').length;
  const activeWarningCount = Number(stats.value.warningCount || 0);
  const redWarningCount = Number(stats.value.redWarning || 0);

  if (redWarningCount > 0) {
    nextTodoList.push({
      content: `本班有 ${redWarningCount} 条红色预警需要优先处理`,
      time: '当前',
      type: 'danger',
      color: '#dc2626',
    });
  }

  if (pendingLeaveCount > 0) {
    nextTodoList.push({
      content: `本班有 ${pendingLeaveCount} 条请假申请待审批`,
      time: '当前',
      type: 'primary',
      color: '#409eff',
    });
  }

  if (activeWarningCount > 0) {
    nextTodoList.push({
      content: `本班当前共有 ${activeWarningCount} 条预警待跟进`,
      time: '当前',
      type: 'warning',
      color: '#d4a017',
    });
  }

  recentWarnings.value.slice(0, 3).forEach((warning: any) => {
    nextActivities.push({
      title: `${warning.name || '学生'} 触发了 ${warning.warning_reason || '预警'}`,
      time: formatDate(warning.created_at),
    });
  });

  leaveRequests.value.slice(0, 3).forEach((item: any) => {
    nextActivities.push({
      title: `${item.student_name || '学生'} 提交了请假申请`,
      time: formatDate(item.created_at),
    });
  });

  todoList.value = nextTodoList;
  classActivities.value = nextActivities.slice(0, 6);
};

const loadLeaveRequests = async () => {
  try {
    const resp = await getHeadTeacherLeaveRequests();
    if (resp.code === 0) {
      leaveRequests.value = Array.isArray(resp.data) ? resp.data : [];
      rebuildDashboardBlocks();
    }
  } catch (error) {
    console.error('获取班主任请假列表失败:', error);
  }
};

const goToWarnings = () => {
  router.push('/warnings');
};

const goToApprovals = () => {
  router.push('/approvals');
};

const goToInterventions = () => {
  router.push('/intervention-cases');
};

const goToExport = () => {
  router.push('/class-export');
};

const goToAttendance = () => {
  router.push('/teacher-attendance');
};

onMounted(() => {
  try {
    const rolesFull = JSON.parse(localStorage.getItem('admin_roles_full') || '[]');
    if (Array.isArray(rolesFull) && rolesFull.length > 0) {
      hasTeacherRole.value = rolesFull.some((item: any) => item?.role === 'teacher');
    } else {
      const roles = JSON.parse(localStorage.getItem('admin_roles') || '[]');
      hasTeacherRole.value = Array.isArray(roles) && roles.includes('teacher');
    }
  } catch {
    hasTeacherRole.value = false;
  }
  Promise.all([loadStats(), loadRecentWarnings(), loadLeaveRequests()]).then(() => {
    rebuildDashboardBlocks();
  });
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
  transform: translateY(-5px);
}

.stat-icon {
  margin-bottom: 10px;
}

.stat-value {
  font-size: 36px;
  font-weight: bold;
  color: #409eff;
}

.stat-card.warning .stat-value { color: #d4a017; }
.stat-card.danger .stat-value { color: #dc2626; }
.stat-card.info .stat-value { color: #909399; }

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

.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: minmax(88px, auto);
  gap: 12px;
  align-items: stretch;
}

.action-btn {
  width: 100%;
  height: 100%;
  min-height: 88px;
  margin: 0;
}

.action-btn :deep(span) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  line-height: 1.4;
  white-space: normal;
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
  background: #409eff;
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
