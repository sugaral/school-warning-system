<template>
  <div class="page-container">
    <h2>班级通知</h2>
    
    <el-row :gutter="20">
      <el-col :span="8">
        <el-card>
          <template #header>
            <span class="header-title">发布新通知</span>
          </template>
          <el-form :model="form" label-width="60px">
            <el-form-item label="标题">
              <el-input v-model="form.title" placeholder="请输入通知标题" maxlength="100" show-word-limit />
            </el-form-item>
            <el-form-item label="内容">
              <el-input
                v-model="form.content"
                type="textarea"
                :rows="10"
                placeholder="请输入通知内容"
                maxlength="1000"
                show-word-limit
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="publishNotification" :loading="loading">
                发布通知
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      
      <el-col :span="16">
        <el-card>
          <template #header>
            <span class="header-title">已发布通知</span>
          </template>
          <div class="table-shell">
          <el-table :data="notifications" v-loading="tableLoading" border>
            <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
            <el-table-column prop="content" label="内容" min-width="300" show-overflow-tooltip />
            <el-table-column prop="publisher_name" label="发布人" width="100" />
            <el-table-column prop="created_at" label="发布时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
          </div>
          <el-empty v-if="notifications.length === 0" description="暂无通知" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const loading = ref(false);
const tableLoading = ref(false);
const notifications = ref<any[]>([]);
const form = ref({
  title: '',
  content: ''
});

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
};

const loadNotifications = async () => {
  tableLoading.value = true;
  try {
    const response = await api.get('/class-monitor/notifications?page=1&pageSize=50');
    if (response.data.code === 0) {
      notifications.value = response.data.data.list || [];
    }
  } catch (error) {
    console.error('加载通知失败:', error);
    ElMessage.error('加载通知失败');
  } finally {
    tableLoading.value = false;
  }
};

const publishNotification = async () => {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入通知标题');
    return;
  }
  if (!form.value.content.trim()) {
    ElMessage.warning('请输入通知内容');
    return;
  }

  loading.value = true;
  try {
    const response = await api.post('/class-monitor/notifications', form.value);
    if (response.data.code === 0) {
      ElMessage.success('发布成功');
      form.value = { title: '', content: '' };
      loadNotifications();
    } else {
      ElMessage.error(response.data.message || '发布失败');
    }
  } catch (error: any) {
    console.error('发布通知失败:', error);
    ElMessage.error(error?.message || '发布失败');
  } finally {
    loading.value = false;
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

.header-title {
  font-weight: 600;
}
</style>
