<template>
  <div class="security-management">
    <div class="toolbar">
      <el-select
        v-model="filterAction"
        placeholder="操作类型"
        clearable
        style="width: 160px"
        @change="handleFilterChange"
      >
        <el-option label="登录" value="login" />
        <el-option label="登出" value="logout" />
        <el-option label="创建" value="create" />
        <el-option label="更新" value="update" />
        <el-option label="删除" value="delete" />
      </el-select>

      <el-select
        v-model="filterEntityType"
        placeholder="资源类型"
        clearable
        style="width: 160px"
        @change="handleFilterChange"
      >
        <el-option label="用户" value="user" />
        <el-option label="角色" value="role" />
        <el-option label="权限" value="permission" />
        <el-option label="组织" value="org" />
        <el-option label="规则" value="rule" />
      </el-select>

      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 320px"
        @change="handleFilterChange"
      />

      <el-button @click="fetchEvents">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>

      <el-button type="success" :loading="exporting" @click="exportEvents">
        <el-icon><Download /></el-icon>
        导出
      </el-button>
    </div>

    <div class="table-shell">
    <el-table v-loading="loading" :data="eventsList" stripe style="width: 100%; margin-top: 20px">
      <el-table-column prop="action" label="操作" width="120">
        <template #default="{ row }">
          <el-tag size="small" :type="getActionTagType(row.action)">
            {{ getActionName(row.action) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operator" label="操作人" min-width="120" />
      <el-table-column prop="resource" label="资源类型" width="130">
        <template #default="{ row }">
          <span>{{ row.resourceDesc || row.resource || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="entityId" label="资源ID" width="120" />
      <el-table-column prop="ip" label="IP地址" width="160" />
      <el-table-column prop="timestamp" label="时间" min-width="180">
        <template #default="{ row }">
          {{ formatDate(row.timestamp) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="viewDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <div class="pagination">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>

    <el-dialog v-model="detailDialogVisible" title="审计日志详情" width="680px">
      <el-skeleton v-if="detailLoading" :rows="6" animated />
      <el-descriptions v-else-if="currentEvent" :column="1" border>
        <el-descriptions-item label="事件ID">{{ currentEvent.id }}</el-descriptions-item>
        <el-descriptions-item label="操作">
          <el-tag :type="getActionTagType(currentEvent.action)">
            {{ getActionName(currentEvent.action) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="操作人">{{ currentEvent.operator || '-' }}</el-descriptions-item>
        <el-descriptions-item label="资源类型">
          {{ currentEvent.resourceDesc || currentEvent.resource || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="资源ID">{{ currentEvent.entityId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="IP地址">{{ currentEvent.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="User Agent">{{ currentEvent.userAgent || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作前数据">
          <pre>{{ formatJson(currentEvent.before) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="操作后数据">
          <pre>{{ formatJson(currentEvent.after) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatDate(currentEvent.timestamp) }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Download, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

type OperationLogRow = {
  id: string;
  operator?: string;
  action: string;
  actionDesc?: string | null;
  resource?: string;
  resourceDesc?: string | null;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: string;
  before?: any;
  after?: any;
};

const loading = ref(false);
const exporting = ref(false);
const detailLoading = ref(false);
const eventsList = ref<OperationLogRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const filterAction = ref('');
const filterEntityType = ref('');
const dateRange = ref<[string, string] | null>(null);
const detailDialogVisible = ref(false);
const currentEvent = ref<OperationLogRow | null>(null);

const buildParams = () => {
  const params: Record<string, string | number> = {
    page: page.value,
    pageSize: pageSize.value,
  };

  if (filterAction.value) {
    params.action = filterAction.value;
  }
  if (filterEntityType.value) {
    params.entityType = filterEntityType.value;
  }
  if (dateRange.value?.length === 2) {
    params.startDate = dateRange.value[0];
    params.endDate = dateRange.value[1];
  }

  return params;
};

const fetchEvents = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/audit/operations', {
      params: buildParams(),
    });
    eventsList.value = response.data.data.list || [];
    total.value = response.data.data.pagination?.total || 0;
  } catch (error: any) {
    console.error('获取审计日志失败:', error);
    eventsList.value = [];
    total.value = 0;
    ElMessage.error(error?.message || '获取审计日志失败');
  } finally {
    loading.value = false;
  }
};

const viewDetail = async (event: OperationLogRow) => {
  detailDialogVisible.value = true;
  detailLoading.value = true;
  try {
    const response = await api.get(`/admin/audit/operations/${event.id}`);
    currentEvent.value = response.data.data;
  } catch (error: any) {
    console.error('获取审计日志详情失败:', error);
    currentEvent.value = event;
    ElMessage.error(error?.message || '获取详情失败');
  } finally {
    detailLoading.value = false;
  }
};

const exportEvents = async () => {
  exporting.value = true;
  try {
    const params = {
      type: 'operations',
      ...(filterAction.value ? { action: filterAction.value } : {}),
      ...(filterEntityType.value ? { entityType: filterEntityType.value } : {}),
      ...(dateRange.value?.length === 2
        ? {
            startDate: dateRange.value[0],
            endDate: dateRange.value[1],
          }
        : {}),
    };

    const response = await api.post('/admin/audit/export', null, { params });
    const rows: OperationLogRow[] = response.data.data?.data || [];

    if (!rows.length) {
      ElMessage.warning('当前筛选条件下没有可导出的数据');
      return;
    }

    const headers = ['操作', '操作人', '资源类型', '资源ID', 'IP地址', '时间'];
    const csvRows = rows.map((item) => [
      getActionName(item.action),
      item.operator || '-',
      item.resourceDesc || item.resource || '-',
      item.entityId || '-',
      item.ip || '-',
      formatDate(item.timestamp),
    ]);

    const csvContent = [headers, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([`\ufeff${csvContent}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    ElMessage.success('导出成功');
  } catch (error: any) {
    console.error('导出审计日志失败:', error);
    ElMessage.error(error?.message || '导出失败');
  } finally {
    exporting.value = false;
  }
};

const handleFilterChange = () => {
  page.value = 1;
  fetchEvents();
};

const handleSizeChange = (size: number) => {
  pageSize.value = size;
  page.value = 1;
  fetchEvents();
};

const handleCurrentChange = (current: number) => {
  page.value = current;
  fetchEvents();
};

const getActionTagType = (action: string) => {
  const typeMap: Record<string, string> = {
    login: 'success',
    logout: 'info',
    create: 'success',
    update: 'warning',
    delete: 'danger',
  };
  return typeMap[action] || 'info';
};

const getActionName = (action: string) => {
  const nameMap: Record<string, string> = {
    login: '登录',
    logout: '登出',
    create: '创建',
    update: '更新',
    delete: '删除',
  };
  return nameMap[action] || action;
};

const formatDate = (date?: string) => {
  if (!date) {
    return '-';
  }
  return new Date(date).toLocaleString('zh-CN');
};

const formatJson = (value: any) => {
  if (!value) {
    return '-';
  }
  return JSON.stringify(value, null, 2);
};

onMounted(() => {
  fetchEvents();
});
</script>

<style scoped>
.security-management {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 10px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(107, 140, 158, 0.14);
  border-radius: 6px;
  font-size: 12px;
  backdrop-filter: blur(12px);
}
</style>
