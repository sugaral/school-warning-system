<template>
  <div class="page-container">
    <h2>我的消息</h2>

    <el-card>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <!-- ============================================================
             个人消息（站内信）
             数据源：notification 表 / GET /student/inbox
             这里是"针对我个人的"预警与通知（红色预警、班级通知等），
             与下面「班级公告」是**两个不同的数据源**：
               - 个人消息：按 user_id 定向，只有我自己看得到
               - 班级公告：按 class_id 广播，全班共享
             历史上本页只有班级公告，个人预警只能靠邮件/短信，
             而这两个渠道默认未配置 —— 学生实际收不到任何提醒。
             ============================================================ -->
        <el-tab-pane name="inbox">
          <template #label>
            <span>
              个人消息
              <el-badge
                v-if="unreadCount > 0"
                :value="unreadCount"
                :max="99"
                class="tab-badge"
              />
            </span>
          </template>

          <div class="toolbar">
            <el-radio-group v-model="inboxFilter" size="small" @change="loadInbox">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="unread">未读</el-radio-button>
              <el-radio-button value="read">已读</el-radio-button>
            </el-radio-group>
            <div class="toolbar-right">
              <span class="unread-hint">未读 {{ unreadCount }} 条</span>
              <el-button
                type="primary"
                link
                size="small"
                :disabled="unreadCount === 0"
                @click="markAllRead"
              >
                全部标记已读
              </el-button>
              <el-button type="primary" link size="small" @click="loadInbox">刷新</el-button>
            </div>
          </div>

          <div class="table-shell">
            <el-table :data="inboxList" v-loading="inboxLoading" border style="width: 100%">
              <el-table-column label="状态" width="80">
                <template #default="{ row }">
                  <el-tag v-if="!row.is_read" type="danger" size="small">未读</el-tag>
                  <el-tag v-else type="info" size="small">已读</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="类型" width="110">
                <template #default="{ row }">
                  <el-tag :type="typeTagColor(row.type)" size="small" effect="plain">
                    {{ row.type_label || row.type }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="content" label="内容" min-width="360" show-overflow-tooltip />
              <el-table-column label="时间" width="180">
                <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button type="primary" link size="small" @click="viewInboxDetail(row)">
                    查看
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <el-empty v-if="inboxList.length === 0" description="暂无个人消息" />
        </el-tab-pane>

        <!-- 班级公告：数据源 class_notifications / GET /student/notifications -->
        <el-tab-pane label="班级公告" name="class">
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
              <el-table-column label="发布时间" width="180">
                <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
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
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 个人消息详情（正文可能含换行，用 pre-wrap 保留） -->
    <el-dialog v-model="showInboxDetail" title="消息详情" width="600px">
      <div v-if="currentInbox" class="notification-detail">
        <div class="detail-meta">
          <el-tag :type="typeTagColor(currentInbox.type)" size="small" effect="plain">
            {{ currentInbox.type_label || currentInbox.type }}
          </el-tag>
          <span>{{ formatDate(currentInbox.created_at) }}</span>
        </div>
        <div class="detail-content">{{ currentInbox.content }}</div>
      </div>
    </el-dialog>

    <el-dialog v-model="showDetail" title="通知详情" width="600px">
      <div v-if="currentNotification" class="notification-detail">
        <h3>{{ currentNotification.title }}</h3>
        <div class="detail-meta">
          <span>发布人：{{ currentNotification.publisher_name }}</span>
          <span>发布时间：{{ formatDate(currentNotification.created_at) }}</span>
        </div>
        <div class="detail-content">{{ currentNotification.content }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

const activeTab = ref('inbox');

// ---- 个人消息 ----
const inboxLoading = ref(false);
const inboxList = ref<any[]>([]);
const unreadCount = ref(0);
const inboxFilter = ref<'all' | 'unread' | 'read'>('all');
const showInboxDetail = ref(false);
const currentInbox = ref<any>(null);

// ---- 班级公告 ----
const loading = ref(false);
const notifications = ref<any[]>([]);
const showDetail = ref(false);
const currentNotification = ref<any>(null);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN');
};

/** 预警级别着色：红/橙/黄/严重 与系统配色一致 */
const typeTagColor = (type: string) => {
  const t = String(type || '');
  if (t === 'warning_red') return 'danger';
  if (t === 'warning_orange') return 'warning';
  if (t === 'warning_yellow') return 'success';
  if (t === 'warning_severe') return 'danger';
  if (t === 'class_notice') return 'primary';
  return 'info';
};

/** 拉取个人消息（列表 + 未读数一次拿全，减少往返） */
const loadInbox = async () => {
  inboxLoading.value = true;
  try {
    const qs = inboxFilter.value === 'all' ? '' : `&status=${inboxFilter.value}`;
    const response = await api.get(`/student/inbox?page=1&pageSize=50${qs}`);
    if (response.data.code === 0) {
      const data = response.data.data || {};
      inboxList.value = data.list || [];
      unreadCount.value = data.unread || 0;
    } else {
      ElMessage.error(response.data.message || '加载个人消息失败');
    }
  } catch (error) {
    console.error('加载个人消息失败:', error);
    ElMessage.error('加载个人消息失败');
  } finally {
    inboxLoading.value = false;
  }
};

const viewInboxDetail = async (row: any) => {
  currentInbox.value = row;
  showInboxDetail.value = true;

  if (!row.is_read) {
    try {
      const res = await api.post(`/student/inbox/${row.id}/read`, {});
      if (res.data.code === 0) {
        row.is_read = true;
        row.status = 'read';
        // 后端回传最新未读数，避免前端自行 -1 造成漂移
        unreadCount.value = res.data.data?.unread ?? Math.max(0, unreadCount.value - 1);
        if (inboxFilter.value === 'unread') {
          inboxList.value = inboxList.value.filter((item) => item.id !== row.id);
        }
      }
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  }
};

const markAllRead = async () => {
  try {
    const res = await api.post('/student/inbox/read-all', {});
    if (res.data.code === 0) {
      ElMessage.success(res.data.message || '已全部标记为已读');
      await loadInbox();
    }
  } catch (error) {
    console.error('全部已读失败:', error);
    ElMessage.error('操作失败');
  }
};

/** 班级公告 */
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

/** 切到某个页签时才加载，避免一次性打两个接口 */
const onTabChange = (name: any) => {
  if (name === 'inbox' && inboxList.value.length === 0) {
    loadInbox();
  }
  if (name === 'class' && notifications.value.length === 0) {
    loadNotifications();
  }
};

onMounted(() => {
  // 个人消息是默认页签，且包含未读提醒，优先进来
  loadInbox();
  loadNotifications();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.unread-hint {
  font-size: 13px;
  color: #f56c6c;
}

.tab-badge {
  margin-left: 4px;
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
  align-items: center;
}

.detail-content {
  line-height: 1.8;
  font-size: 15px;
  color: #303133;
  white-space: pre-wrap;
}
</style>
