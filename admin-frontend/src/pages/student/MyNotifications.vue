<template>
  <div class="page-container">
    <h2>班级通知</h2>
    
    <el-card>
      <div class="table-shell">
      <el-table :data="notifications" v-loading="loading" border style="width: 100%">
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag v-if="!row.is_read" type="danger" size="small">新</el-tag>
            <el-tag v-else type="info" size="small">已读</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="content" label="内容" min-width="300" show-overflow-tooltip />
        <el-table-column prop="publisher_name" label="发布人" width="100" />
        <el-table-column prop="created_at" label="发布时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewDetail(row)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
      <el-empty v-if="notifications.length === 0" description="暂无通知" />
    </el-card>

    <el-dialog v-model="showDetail" title="通知详情" width="600px">
      <div v-if="currentNotification" class="notification-detail">
        <h3>{{ currentNotification.title }}</h3>
        <div class="detail-meta">
          <span>发布人：{{ currentNotification.publisher_name }}</span>
          <span>发布时间：{{ formatDate(currentNotification.created_at) }}</span>
        </div>
        <div class="detail-content">
          {{ currentNotification.content }}
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const loading = ref(false);
const notifications = ref<any[]>([]);
const showDetail = ref(false);
const currentNotification = ref<any>(null);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
};

const loadNotifications = async () => {
  loading.value = true;
  try {
    const response = await api.get('/student/notifications?page=1&pageSize=50');
    if (response.data.code === 0) {
      notifications.value = response.data.data.list || [];
    }
  } catch (error) {
    console.error('加载通知失败:', error);
    ElMessage.error('加载通知失败');
  } finally {
    loading.value = false;
  }
};

const markAsRead = async (id: string) => {
  try {
    await api.post(`/student/notifications/${id}/read`, {});
  } catch (error) {
    console.error('标记已读失败:', error);
  }
};

const viewDetail = async (notification: any) => {
  currentNotification.value = notification;
  showDetail.value = true;
  
  if (!notification.is_read) {
    await markAsRead(notification.id);
    notification.is_read = true;
  }
};

onMounted(() => {
  loadNotifications();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.notification-detail h3 {
  margin: 0 0 16px 0;
  font-size: 20px;
  color: #303133;
}

.detail-meta {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #ebeef5;
  font-size: 14px;
  color: #909399;
}

.detail-content {
  line-height: 1.8;
  font-size: 15px;
  color: #303133;
  white-space: pre-wrap;
}
</style>
