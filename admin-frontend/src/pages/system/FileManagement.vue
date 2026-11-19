<template>
  <div class="file-management">
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索文件名"
        clearable
        style="width: 300px"
        @keyup.enter="fetchFiles"
      >
        <template #append>
          <el-button @click="fetchFiles">
            <el-icon><Search /></el-icon>
          </el-button>
        </template>
      </el-input>

      <el-select
        v-model="filterSource"
        placeholder="来源"
        clearable
        style="width: 160px"
        @change="fetchFiles"
      >
        <el-option label="上传" value="upload" />
        <el-option label="导出" value="export" />
        <el-option label="系统" value="system" />
      </el-select>

      <el-button @click="fetchFiles">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <el-alert
      v-if="loadError"
      type="warning"
      :closable="false"
      show-icon
      class="status-alert"
      title="文件管理接口当前未返回可用数据，页面不再显示演示文件。"
    />

    <div class="table-shell">
    <el-table v-loading="loading" :data="filesList" stripe style="width: 100%; margin-top: 20px">
      <el-table-column prop="file_name" label="文件名" min-width="260" show-overflow-tooltip />
      <el-table-column prop="file_size" label="大小" width="120">
        <template #default="{ row }">
          {{ formatFileSize(row.file_size) }}
        </template>
      </el-table-column>
      <el-table-column prop="mime_type" label="类型" min-width="180" show-overflow-tooltip />
      <el-table-column prop="source" label="来源" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ row.source || '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="downloadFile(row)">下载</el-button>
          <el-button size="small" type="danger" @click="deleteFile(row)">删除</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';

const loading = ref(false);
const loadError = ref(false);
const filesList = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const searchKeyword = ref('');
const filterSource = ref('');

const fetchFiles = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    const params: Record<string, string | number> = {
      page: page.value,
      pageSize: pageSize.value,
    };

    if (searchKeyword.value) {
      params.search = searchKeyword.value;
    }
    if (filterSource.value) {
      params.source = filterSource.value;
    }

    const response = await api.get('/admin/files', { params });
    const payload = response.data.data;
    filesList.value = payload.list || payload || [];
    total.value = payload.pagination?.total || filesList.value.length;
  } catch (error) {
    console.error('获取文件列表失败:', error);
    filesList.value = [];
    total.value = 0;
    loadError.value = true;
  } finally {
    loading.value = false;
  }
};

const downloadFile = async (file: any) => {
  try {
    const response = await api.get(`/admin/files/${file.id}/download`, {
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', file.file_name || 'download');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    ElMessage.success('下载成功');
  } catch (error: any) {
    console.error('下载失败:', error);
    ElMessage.error(error?.message || '下载失败');
  }
};

const deleteFile = async (file: any) => {
  try {
    await ElMessageBox.confirm(`确定删除文件 ${file.file_name} 吗？`, '提示', {
      type: 'warning',
    });
    await api.delete(`/admin/files/${file.id}`);
    ElMessage.success('删除成功');
    fetchFiles();
  } catch (error: any) {
    if (error === 'cancel') {
      return;
    }
    console.error('删除失败:', error);
    ElMessage.error(error?.message || '删除失败');
  }
};

const handleSizeChange = (size: number) => {
  pageSize.value = size;
  page.value = 1;
  fetchFiles();
};

const handleCurrentChange = (current: number) => {
  page.value = current;
  fetchFiles();
};

const formatFileSize = (size?: number | null) => {
  if (!size) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(size);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(2)} ${units[index]}`;
};

const formatDate = (date?: string) => {
  if (!date) {
    return '-';
  }
  return new Date(date).toLocaleString('zh-CN');
};

onMounted(() => {
  fetchFiles();
});
</script>

<style scoped>
.file-management {
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

.status-alert {
  margin-top: 16px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>
