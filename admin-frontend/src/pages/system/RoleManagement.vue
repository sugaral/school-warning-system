<template>
  <div class="role-management">
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索角色名称、编码或描述"
        style="width: 320px"
        clearable
      >
        <template #append>
          <el-button @click="fetchRoles">
            <el-icon><Search /></el-icon>
          </el-button>
        </template>
      </el-input>

      <el-button @click="resetSearch">重置</el-button>
      <el-button type="primary" @click="fetchRoles">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-shell">
    <el-table
      v-loading="loading"
      :data="filteredRolesList"
      style="width: 100%; margin-top: 20px"
      stripe
      border
    >
      <el-table-column prop="code" label="角色编码" min-width="160" />
      <el-table-column prop="name" label="角色名称" min-width="160" />
      <el-table-column prop="description" label="描述" min-width="260" show-overflow-tooltip />
      <el-table-column prop="default_scope" label="默认范围" width="120">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ formatScope(row.default_scope) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="viewRole(row)">查看</el-button>
          <el-button v-if="canEditRole(row)" size="small" type="primary" @click="editRole(row)">
            编辑
          </el-button>
          <el-button
            v-if="canManageAllRoles"
            size="small"
            type="warning"
            @click="managePermissions(row)"
          >
            权限配置
          </el-button>
          <el-button
            v-if="canManageAllRoles && row.code !== 'sys_admin'"
            size="small"
            type="danger"
            @click="deleteRole(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog v-model="roleDialogVisible" title="角色详情" width="600px" destroy-on-close>
      <el-form v-if="currentRole" label-width="100px">
        <el-form-item label="角色编码">
          <el-input v-model="currentRole.code" disabled />
        </el-form-item>
        <el-form-item label="角色名称">
          <el-input v-model="currentRole.name" disabled />
        </el-form-item>
        <el-form-item label="默认范围">
          <el-input :model-value="formatScope(currentRole.default_scope)" disabled />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="currentRole.description" type="textarea" :rows="4" disabled />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑角色" width="600px" destroy-on-close>
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="角色编码">
          <el-input v-model="editForm.code" disabled />
        </el-form-item>
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="editForm.name" maxlength="50" show-word-limit :disabled="!canManageAllRoles" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="editForm.description"
            type="textarea"
            :rows="4"
            maxlength="200"
            show-word-limit
            :disabled="!canManageAllRoles"
          />
        </el-form-item>
        <el-form-item v-if="editForm.code === 'class_monitor'" label="班干名称">
          <div class="position-editor">
            <div class="position-tags">
              <el-tag
                v-for="position in editForm.student_position_options"
                :key="position"
                :closable="canManageMonitorTitles"
                @close="removeStudentPosition(position)"
              >
                {{ position }}
              </el-tag>
            </div>
            <div class="position-input-row">
              <el-input
                v-model.trim="newStudentPosition"
                placeholder="输入新的班干名称，如：学习委员"
                :disabled="!canManageMonitorTitles"
                @keyup.enter="addStudentPosition"
              />
              <el-button type="primary" :disabled="!canManageMonitorTitles" @click="addStudentPosition">
                添加
              </el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingRole" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="permissionsDialogVisible" title="角色权限配置" width="860px" destroy-on-close>
      <div v-if="currentRole" class="permissions-panel">
        <div class="panel-header">
          <div class="panel-title">{{ currentRole.name }}（{{ currentRole.code }}）</div>
          <el-input
            v-model="permissionSearch"
            placeholder="搜索权限名称或编码"
            style="width: 280px"
            clearable
          />
        </div>

        <el-checkbox-group v-model="selectedPermissions" class="permission-grid">
          <el-checkbox
            v-for="permission in filteredPermissions"
            :key="permission.id"
            :label="permission.id"
          >
            {{ permission.name }}（{{ permission.code }}）
          </el-checkbox>
        </el-checkbox-group>

        <el-empty
          v-if="!filteredPermissions.length"
          description="没有匹配的权限"
          :image-size="80"
        />
      </div>
      <template #footer>
        <el-button @click="permissionsDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingPermissions" @click="savePermissions">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import { api } from '../../api';

interface RoleItem {
  code: string;
  name: string;
  description?: string;
  default_scope?: string;
  student_position_options?: string[];
}

interface PermissionItem {
  id: string;
  code: string;
  name: string;
  resource?: string;
  action?: string;
}

const loading = ref(false);
const savingRole = ref(false);
const savingPermissions = ref(false);
const rolesList = ref<RoleItem[]>([]);
const allPermissions = ref<PermissionItem[]>([]);
const currentPermissionCodes = ref<string[]>([]);
const currentRole = ref<RoleItem | null>(null);
const searchKeyword = ref('');
const permissionSearch = ref('');
const selectedPermissions = ref<string[]>([]);

const roleDialogVisible = ref(false);
const editDialogVisible = ref(false);
const permissionsDialogVisible = ref(false);
const editFormRef = ref<FormInstance>();
const editForm = ref({
  code: '',
  name: '',
  description: '',
  student_position_options: [] as string[],
});
const newStudentPosition = ref('');

const editRules: FormRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  description: [{ required: true, message: '请输入角色描述', trigger: 'blur' }],
};

const currentUserRoles = computed<string[]>(() => {
  try {
    const rolesStr = localStorage.getItem('admin_roles');
    return rolesStr ? JSON.parse(rolesStr) : [];
  } catch (error) {
    console.error('解析当前用户角色失败:', error);
    return [];
  }
});

const isSystemAdmin = computed(() => currentUserRoles.value.includes('sys_admin'));
const canManageAllRoles = computed(
  () => isSystemAdmin.value || currentPermissionCodes.value.includes('role:manage'),
);
const canManageMonitorTitles = computed(
  () =>
    canManageAllRoles.value
    || currentPermissionCodes.value.includes('role:manage_monitor_titles'),
);

const canEditRole = (role: RoleItem) =>
  canManageAllRoles.value || (canManageMonitorTitles.value && role.code === 'class_monitor');

const filteredRolesList = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  if (!keyword) {
    return rolesList.value;
  }
  return rolesList.value.filter((role) =>
    [role.name, role.code, role.description]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(keyword)),
  );
});

const filteredPermissions = computed(() => {
  const keyword = permissionSearch.value.trim().toLowerCase();
  if (!keyword) {
    return allPermissions.value;
  }
  return allPermissions.value.filter((permission) =>
    [permission.name, permission.code]
      .filter(Boolean)
      .some((text) => String(text).toLowerCase().includes(keyword)),
  );
});

const scopeLabelMap: Record<string, string> = {
  self: '本人',
  class: '班级',
  org: '学院',
  school: '全校',
  system: '全系统',
};

const formatScope = (value?: string) => scopeLabelMap[value || ''] || value || '-';

const fetchMyPermissions = async () => {
  try {
    const response = await api.get('/admin/permissions/my');
    currentPermissionCodes.value = Array.isArray(response.data?.data)
      ? response.data.data.map((item: unknown) => String(item || ''))
      : [];
  } catch (error) {
    console.error('获取当前权限失败:', error);
    currentPermissionCodes.value = [];
  }
};

const fetchRoles = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/roles');
    rolesList.value = Array.isArray(response.data?.data)
      ? response.data.data.map((role: any) => ({
          code: role.code || role.role,
          name: role.name,
          description: role.description || '',
          default_scope: role.default_scope,
          student_position_options: Array.isArray(role.student_position_options)
            ? role.student_position_options
            : [],
        }))
      : [];
  } catch (error) {
    console.error('获取角色列表失败:', error);
    rolesList.value = [];
    ElMessage.error((error as any)?.message || '获取角色列表失败');
  } finally {
    loading.value = false;
  }
};

const fetchPermissions = async () => {
  try {
    const response = await api.get('/admin/permissions', { params: { page: 1, pageSize: 500 } });
    const data = response.data?.data || {};
    allPermissions.value = Array.isArray(data.list) ? data.list : [];
  } catch (error) {
    console.error('获取权限列表失败:', error);
    allPermissions.value = [];
    ElMessage.warning((error as any)?.message || '权限列表加载失败');
  }
};

const fetchRolePermissions = async (roleCode: string) => {
  const response = await api.get(`/admin/roles/${roleCode}/permissions`);
  return Array.isArray(response.data?.data) ? response.data.data : [];
};

const viewRole = (role: RoleItem) => {
  currentRole.value = { ...role };
  roleDialogVisible.value = true;
};

const editRole = (role: RoleItem) => {
  currentRole.value = { ...role };
  editForm.value = {
    code: role.code,
    name: role.name,
    description: role.description || '',
    student_position_options: Array.isArray(role.student_position_options)
      ? [...role.student_position_options]
      : [],
  };
  newStudentPosition.value = '';
  editDialogVisible.value = true;
};

const addStudentPosition = () => {
  if (!canManageMonitorTitles.value) {
    return;
  }

  const value = newStudentPosition.value.trim();
  if (!value) {
    return;
  }
  if (!editForm.value.student_position_options.includes(value)) {
    editForm.value.student_position_options.push(value);
  }
  newStudentPosition.value = '';
};

const removeStudentPosition = (value: string) => {
  if (!canManageMonitorTitles.value) {
    return;
  }

  editForm.value.student_position_options = editForm.value.student_position_options.filter(
    (item) => item !== value,
  );
};

const saveRole = async () => {
  if (!currentRole.value) {
    return;
  }

  try {
    await editFormRef.value?.validate();
  } catch {
    return;
  }

  savingRole.value = true;
  try {
    await api.put(`/admin/roles/${currentRole.value.code}`, {
      name: editForm.value.name.trim(),
      description: editForm.value.description.trim(),
      student_position_options:
        editForm.value.code === 'class_monitor'
          ? editForm.value.student_position_options
          : undefined,
    });
    ElMessage.success('角色更新成功');
    editDialogVisible.value = false;
    await fetchRoles();
  } catch (error) {
    console.error('保存角色失败:', error);
    ElMessage.error((error as any)?.message || '保存角色失败');
  } finally {
    savingRole.value = false;
  }
};

const deleteRole = async (role: RoleItem) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除角色“${role.name}”吗？此操作不可恢复。`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
    await api.delete(`/admin/roles/${role.code}`);
    ElMessage.success('角色删除成功');
    await fetchRoles();
  } catch (error: any) {
    if (error === 'cancel' || error === 'close' || error?.message === 'cancel') {
      return;
    }
    console.error('删除角色失败:', error);
    ElMessage.error(error?.message || '删除角色失败');
  }
};

const managePermissions = async (role: RoleItem) => {
  currentRole.value = { ...role };
  permissionSearch.value = '';
  permissionsDialogVisible.value = true;
  try {
    const rolePermissions = await fetchRolePermissions(role.code);
    selectedPermissions.value = rolePermissions.map((item: PermissionItem) => String(item.id));
  } catch (error) {
    console.error('获取角色权限失败:', error);
    selectedPermissions.value = [];
    ElMessage.error((error as any)?.message || '获取角色权限失败');
  }
};

const savePermissions = async () => {
  if (!currentRole.value) {
    return;
  }

  savingPermissions.value = true;
  try {
    const currentRolePermissions = await fetchRolePermissions(currentRole.value.code);
    const currentIds = currentRolePermissions.map((item: PermissionItem) => String(item.id));
    const toAdd = selectedPermissions.value.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !selectedPermissions.value.includes(id));

    for (const permissionId of toAdd) {
      await api.post(`/admin/roles/${currentRole.value.code}/permissions`, {
        permission_id: permissionId,
      });
    }

    for (const permissionId of toRemove) {
      await api.delete(`/admin/roles/${currentRole.value.code}/permissions/${permissionId}`);
    }

    ElMessage.success('角色权限保存成功');
    permissionsDialogVisible.value = false;
  } catch (error) {
    console.error('保存角色权限失败:', error);
    ElMessage.error((error as any)?.message || '保存角色权限失败');
  } finally {
    savingPermissions.value = false;
  }
};

const resetSearch = () => {
  searchKeyword.value = '';
};

onMounted(async () => {
  await fetchMyPermissions();
  await fetchRoles();
  if (canManageAllRoles.value) {
    await fetchPermissions();
  }
});
</script>

<style scoped>
.role-management {
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

.permissions-panel {
  min-height: 240px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.permission-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
}

.permission-grid :deep(.el-checkbox) {
  margin-right: 0;
}

.position-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.position-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.position-input-row {
  display: flex;
  gap: 8px;
}
</style>
