<template>
  <div class="permission-management">
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索权限名称或编码"
        style="width: 320px"
        clearable
        @keyup.enter="fetchPermissions"
      >
        <template #append>
          <el-button @click="fetchPermissions">
            <el-icon><Search /></el-icon>
          </el-button>
        </template>
      </el-input>

      <el-select
        v-model="filterResource"
        placeholder="资源类型"
        style="width: 180px"
        clearable
        @change="handleFilterChange"
      >
        <el-option
          v-for="item in resourceOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>

      <el-select
        v-model="filterAction"
        placeholder="操作类型"
        style="width: 180px"
        clearable
        @change="handleFilterChange"
      >
        <el-option
          v-for="item in actionOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>

      <el-button @click="resetFilters">重置</el-button>
      <el-button type="primary" @click="fetchPermissions">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-shell">
    <el-table
      v-loading="loading"
      :data="permissionsList"
      style="width: 100%; margin-top: 20px"
      stripe
      border
    >
      <el-table-column prop="code" label="权限编码" min-width="220" />
      <el-table-column prop="name" label="权限名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
      <el-table-column prop="resource" label="资源" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ formatResource(row.resource) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="action" label="操作" width="160">
        <template #default="{ row }">
          <el-tag size="small" type="success">{{ formatAction(row.action) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="role_count" label="关联角色数" width="120" />
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openPermissionDialog(row, false)">查看</el-button>
          <el-button size="small" type="primary" @click="openPermissionDialog(row, true)">编辑</el-button>
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

    <el-dialog
      v-model="permissionDialogVisible"
      :title="dialogEditable ? '编辑权限' : '权限详情'"
      width="640px"
      destroy-on-close
    >
      <el-form v-if="currentPermission" label-width="100px">
        <el-form-item label="权限编码">
          <el-input v-model="currentPermission.code" disabled />
        </el-form-item>
        <el-form-item label="权限名称">
          <el-input v-model="currentPermission.name" :disabled="!dialogEditable" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="currentPermission.description"
            type="textarea"
            :rows="3"
            :disabled="!dialogEditable"
          />
        </el-form-item>
        <el-form-item label="资源类型">
          <el-input :model-value="formatResource(currentPermission.resource)" disabled />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-input :model-value="formatAction(currentPermission.action)" disabled />
        </el-form-item>
        <el-form-item label="关联角色">
          <div v-if="currentPermission.roles?.length" class="role-tags">
            <el-tag
              v-for="role in currentPermission.roles"
              :key="role.id"
              size="small"
            >
              {{ role.name || role.role }}
            </el-tag>
          </div>
          <el-empty v-else description="暂无关联角色" :image-size="70" />
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="permissionDialogVisible = false">关闭</el-button>
          <el-button v-if="dialogEditable" type="primary" :loading="saving" @click="updatePermission">
            保存
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

interface PermissionItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  resource: string;
  action: string;
  role_count: number;
  created_at?: string;
  roles?: Array<{ id: string; role: string; name?: string }>;
}

const resourceOptions = [
  { label: '用户', value: 'user' },
  { label: '角色', value: 'role' },
  { label: '权限', value: 'permission' },
  { label: '组织', value: 'org' },
  { label: '班级', value: 'class' },
  { label: '课程', value: 'course' },
  { label: '预警', value: 'warning' },
  { label: '报表', value: 'report' },
  { label: '审计', value: 'audit' },
  { label: '通知', value: 'notification' },
  { label: '系统配置', value: 'config' },
  { label: '统计', value: 'stats' },
  { label: '请假', value: 'leave' },
  { label: '申诉', value: 'appeal' },
  { label: '教师', value: 'teacher' },
  { label: '学生', value: 'student' },
  { label: '考勤', value: 'attendance' },
  { label: '课表', value: 'schedule' },
];

const actionOptions = [
  { label: '查看', value: 'read' },
  { label: '创建', value: 'create' },
  { label: '更新', value: 'update' },
  { label: '删除', value: 'delete' },
  { label: '管理', value: 'manage' },
  { label: '班干名称配置', value: 'manage_monitor_titles' },
  { label: '导出', value: 'export' },
  { label: '审批', value: 'approve' },
  { label: '处理', value: 'handle' },
];

const loading = ref(false);
const saving = ref(false);
const permissionsList = ref<PermissionItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const searchKeyword = ref('');
const filterResource = ref('');
const filterAction = ref('');

const permissionDialogVisible = ref(false);
const dialogEditable = ref(false);
const currentPermission = ref<PermissionItem | null>(null);

const formatDate = (date?: string) => {
  if (!date) {
    return '-';
  }
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? '-' : value.toLocaleString('zh-CN');
};

const formatResource = (value?: string) => {
  return resourceOptions.find((item) => item.value === value)?.label || value || '-';
};

const formatAction = (value?: string) => {
  return actionOptions.find((item) => item.value === value)?.label || value || '-';
};

const fetchPermissions = async () => {
  loading.value = true;
  try {
    const params: Record<string, string | number> = {
      page: page.value,
      pageSize: pageSize.value,
    };
    if (searchKeyword.value.trim()) {
      params.search = searchKeyword.value.trim();
    }
    if (filterResource.value) {
      params.resource = filterResource.value;
    }
    if (filterAction.value) {
      params.action = filterAction.value;
    }

    const response = await api.get('/admin/permissions', { params });
    const data = response.data?.data || {};
    permissionsList.value = Array.isArray(data.list) ? data.list : [];
    total.value = Number(data.pagination?.total || permissionsList.value.length || 0);
  } catch (error) {
    console.error('获取权限列表失败:', error);
    permissionsList.value = [];
    total.value = 0;
    ElMessage.error((error as any)?.message || '获取权限列表失败');
  } finally {
    loading.value = false;
  }
};

const loadPermissionRoles = async (permissionId: string) => {
  try {
    const response = await api.get(`/admin/permissions/${permissionId}/roles`);
    return Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (error) {
    console.error('获取关联角色失败:', error);
    ElMessage.warning((error as any)?.message || '获取关联角色失败');
    return [];
  }
};

const openPermissionDialog = async (permission: PermissionItem, editable: boolean) => {
  dialogEditable.value = editable;
  currentPermission.value = {
    ...permission,
    roles: [],
  };
  permissionDialogVisible.value = true;
  currentPermission.value.roles = await loadPermissionRoles(permission.id);
};

const updatePermission = async () => {
  if (!currentPermission.value) {
    return;
  }

  saving.value = true;
  try {
    await api.put(`/admin/permissions/${currentPermission.value.id}`, {
      name: currentPermission.value.name,
      description: currentPermission.value.description,
    });
    ElMessage.success('权限更新成功');
    permissionDialogVisible.value = false;
    await fetchPermissions();
  } catch (error) {
    console.error('更新权限失败:', error);
    ElMessage.error((error as any)?.message || '更新权限失败');
  } finally {
    saving.value = false;
  }
};

const handleFilterChange = () => {
  page.value = 1;
  fetchPermissions();
};

const resetFilters = () => {
  searchKeyword.value = '';
  filterResource.value = '';
  filterAction.value = '';
  page.value = 1;
  fetchPermissions();
};

const handleSizeChange = (size: number) => {
  pageSize.value = size;
  page.value = 1;
  fetchPermissions();
};

const handleCurrentChange = (current: number) => {
  page.value = current;
  fetchPermissions();
};

onMounted(() => {
  fetchPermissions();
});
</script>

<style scoped>
.permission-management {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.pagination {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
</style>
