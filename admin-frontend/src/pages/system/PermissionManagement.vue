<template>
  <div class="perm-page">
    <section class="perm-hero">
      <div class="perm-hero__copy">
        <p class="perm-hero__eyebrow">PER-USER ACCESS</p>
        <h2 class="perm-hero__title">按用户分配权限</h2>
        <p class="perm-hero__desc">
          选中用户后点「权限分配」，在弹窗里勾选该用户可用的全部权限；点确定立即同步并生效。
          勾选结果会覆盖角色默认权限，需要回到角色权限时点「恢复角色默认」。
        </p>
      </div>
      <div class="perm-hero__actions">
        <el-input
          v-model="keyword"
          class="perm-hero__search"
          placeholder="搜索姓名 / 手机号 / 账号"
          clearable
          @keyup.enter="reloadUsers"
          @clear="reloadUsers"
        />
        <el-select
          v-model="roleFilter"
          class="perm-hero__role"
          placeholder="按角色筛选"
          clearable
          @change="reloadUsers"
        >
          <el-option v-for="item in roleOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-button type="primary" :loading="loadingUsers" @click="reloadUsers">查询</el-button>
      </div>
    </section>

    <el-card class="perm-card" shadow="never">
      <template #header>
        <div class="perm-card__header">
          <span class="perm-card__title">用户列表</span>
          <span class="perm-card__meta">共 {{ total }} 人</span>
        </div>
      </template>

      <el-table v-loading="loadingUsers" :data="userList" style="width: 100%">
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="user-cell__name">{{ row.name || '未命名' }}</span>
              <span class="user-cell__account">{{ row.account || row.mobile || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <div class="role-tags">
              <el-tag v-for="role in row.roles || []" :key="role.id || role.role" size="small">
                {{ formatRole(role.role) }}
              </el-tag>
              <span v-if="!(row.roles || []).length" class="user-cell__muted">未分配角色</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="账号类型" width="120">
          <template #default="{ row }">{{ formatUserType(row.user_type) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openAssignDialog(row)">权限分配</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="perm-pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          :total="total"
          @size-change="reloadUsers"
          @current-change="loadUsers"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      class="perm-dialog"
      width="960px"
      top="6vh"
      destroy-on-close
    >
      <template #header>
        <div class="perm-dialog__header">
          <div>
            <span class="perm-dialog__title">权限分配</span>
            <span class="perm-dialog__user">
              {{ assignUser?.name || '' }}
              <em>{{ assignUser?.account || assignUser?.mobile || '' }}</em>
            </span>
          </div>
          <el-tag v-if="detail" size="small" :type="detail.mode === 'custom' ? 'warning' : 'info'">
            {{ detail.mode === 'custom' ? '自定义覆盖' : '角色默认' }}
          </el-tag>
        </div>
      </template>

      <div v-loading="loadingDetail" class="perm-dialog__body">
        <el-alert
          v-if="detail?.is_sys_admin"
          type="warning"
          :closable="false"
          show-icon
          title="超级管理员拥有全部权限，不支持单独分配"
        />
        <el-alert
          v-else-if="detail"
          type="info"
          :closable="false"
          show-icon
          :title="`当前生效 ${detail.effective_codes.length} 项；角色默认 ${detail.role_codes.length} 项`"
          :description="
            detail.mode === 'custom'
              ? '该用户已启用自定义权限，勾选结果即最终权限（不再叠加角色）。'
              : '该用户当前沿用角色默认权限，勾选并保存后将切换为自定义权限。'
          "
        />

        <div class="perm-toolbar">
          <span class="perm-toolbar__count">
            已选 <b>{{ selectedIds.length }}</b> / {{ allPermissions.length }}
          </span>
          <div class="perm-toolbar__actions">
            <el-button size="small" :disabled="isSysAdminTarget" @click="selectAll">全选</el-button>
            <el-button size="small" :disabled="isSysAdminTarget" @click="clearAll">清空</el-button>
            <el-button size="small" :disabled="isSysAdminTarget" @click="selectRoleDefault">
              填角色默认
            </el-button>
          </div>
        </div>

        <div class="perm-groups">
          <section v-for="group in groupedPermissions" :key="group.resource" class="perm-group">
            <header class="perm-group__header">
              <label class="perm-group__title">
                <el-checkbox
                  :model-value="isGroupChecked(group)"
                  :indeterminate="isGroupIndeterminate(group)"
                  :disabled="isSysAdminTarget"
                  @change="(value: any) => toggleGroup(group, value)"
                />
                <span>{{ group.label }}</span>
                <em>{{ group.selectedCount }} / {{ group.items.length }}</em>
              </label>
            </header>
            <div class="perm-group__items">
              <el-checkbox
                v-for="item in group.items"
                :key="item.id"
                :model-value="selectedIds.includes(item.id)"
                :disabled="isSysAdminTarget"
                class="perm-item"
                @change="(value: any) => togglePermission(item.id, value)"
              >
                <span class="perm-item__name">{{ item.name }}</span>
                <span class="perm-item__code">{{ item.code }}</span>
              </el-checkbox>
            </div>
          </section>
        </div>
      </div>

      <template #footer>
        <div class="perm-dialog__footer">
          <el-button
            :disabled="isSysAdminTarget || detail?.mode === 'role'"
            :loading="resetting"
            @click="resetToRoleDefault"
          >
            恢复角色默认
          </el-button>
          <span class="perm-dialog__spacer" />
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="isSysAdminTarget" @click="submitPermissions">
            确定并立即生效
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../api';

type PermissionItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  resource: string;
  action: string;
};

type PermissionDetail = {
  user_id: string;
  is_sys_admin: boolean;
  mode: 'role' | 'custom';
  role_codes: string[];
  custom_codes: string[];
  effective_codes: string[];
  permissions: PermissionItem[];
};

const RESOURCE_LABELS: Record<string, string> = {
  user: '用户',
  role: '角色',
  permission: '权限',
  org: '组织',
  class: '班级',
  course: '课程',
  warning: '预警',
  report: '报表',
  audit: '审计',
  notification: '通知',
  config: '系统配置',
  stats: '统计',
  leave: '请假',
  appeal: '申诉',
  teacher: '教师',
  student: '学生',
  attendance: '考勤',
  schedule: '课表',
  grade: '成绩',
  rule: '规则',
  file: '文件',
};

const USER_TYPE_LABELS: Record<string, string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
};

const ROLE_LABELS: Record<string, string> = {
  sys_admin: '超级管理员',
  student_admin: '学生管理员',
  teaching_admin: '教务管理员',
  dean: '院长',
  vice_dean: '副院长',
  teacher: '教师',
  head_teacher: '班主任',
  counselor: '辅导员',
  student: '学生',
};

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const keyword = ref('');
const roleFilter = ref('');
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const userList = ref<any[]>([]);
const loadingUsers = ref(false);

const dialogVisible = ref(false);
const assignUser = ref<any>(null);
const detail = ref<PermissionDetail | null>(null);
const selectedIds = ref<string[]>([]);
const loadingDetail = ref(false);
const saving = ref(false);
const resetting = ref(false);

const allPermissions = computed(() => detail.value?.permissions || []);
const isSysAdminTarget = computed(() => Boolean(detail.value?.is_sys_admin));

const groupedPermissions = computed(() => {
  const groups = new Map<string, PermissionItem[]>();
  for (const item of allPermissions.value) {
    const key = item.resource || 'other';
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .map(([resource, items]) => ({
      resource,
      label: RESOURCE_LABELS[resource] || resource,
      items: items.sort((left, right) =>
        String(left.code).localeCompare(String(right.code), 'en'),
      ),
      selectedCount: items.filter((item) => selectedIds.value.includes(item.id)).length,
    }))
    .sort((left, right) => right.items.length - left.items.length);
});

const formatRole = (role?: string) => ROLE_LABELS[String(role || '')] || role || '-';
const formatUserType = (type?: string) => USER_TYPE_LABELS[String(type || '')] || type || '-';

const loadUsers = async () => {
  loadingUsers.value = true;
  try {
    const params: Record<string, any> = { page: page.value, pageSize: pageSize.value };
    if (keyword.value.trim()) {
      params.search = keyword.value.trim();
    }
    if (roleFilter.value) {
      params.role = roleFilter.value;
    }
    const response = await api.get('/admin/users', { params });
    const data = response.data?.data || {};
    userList.value = Array.isArray(data.list) ? data.list : [];
    total.value = Number(data.pagination?.total || userList.value.length || 0);
  } catch (error: any) {
    userList.value = [];
    total.value = 0;
    ElMessage.error(error?.message || '加载用户列表失败');
  } finally {
    loadingUsers.value = false;
  }
};

const reloadUsers = () => {
  page.value = 1;
  return loadUsers();
};

const applyDetail = (data: PermissionDetail) => {
  detail.value = data;
  const codes = new Set(data.effective_codes || []);
  selectedIds.value = (data.permissions || [])
    .filter((item) => codes.has(item.code))
    .map((item) => item.id);
};

const openAssignDialog = async (user: any) => {
  assignUser.value = user;
  dialogVisible.value = true;
  detail.value = null;
  selectedIds.value = [];
  loadingDetail.value = true;
  try {
    const response = await api.get(`/admin/users/${user.id}/permissions`);
    applyDetail(response.data?.data as PermissionDetail);
  } catch (error: any) {
    ElMessage.error(error?.message || '加载权限失败');
    dialogVisible.value = false;
  } finally {
    loadingDetail.value = false;
  }
};

const togglePermission = (id: string, checked: boolean) => {
  if (checked) {
    if (!selectedIds.value.includes(id)) {
      selectedIds.value = [...selectedIds.value, id];
    }
    return;
  }
  selectedIds.value = selectedIds.value.filter((item) => item !== id);
};

const isGroupChecked = (group: { items: PermissionItem[] }) =>
  group.items.length > 0 && group.items.every((item) => selectedIds.value.includes(item.id));

const isGroupIndeterminate = (group: { items: PermissionItem[] }) => {
  const selected = group.items.filter((item) => selectedIds.value.includes(item.id)).length;
  return selected > 0 && selected < group.items.length;
};

const toggleGroup = (group: { items: PermissionItem[] }, checked: boolean) => {
  const ids = group.items.map((item) => item.id);
  if (checked) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...ids]));
    return;
  }
  selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id));
};

const selectAll = () => {
  selectedIds.value = allPermissions.value.map((item) => item.id);
};

const clearAll = () => {
  selectedIds.value = [];
};

const selectRoleDefault = () => {
  const codes = new Set(detail.value?.role_codes || []);
  selectedIds.value = allPermissions.value.filter((item) => codes.has(item.code)).map((item) => item.id);
};

const submitPermissions = async () => {
  if (!assignUser.value) {
    return;
  }
  saving.value = true;
  try {
    const response = await api.put(`/admin/users/${assignUser.value.id}/permissions`, {
      permission_ids: selectedIds.value,
    });
    if (response.data?.data) {
      applyDetail(response.data.data as PermissionDetail);
    }
    ElMessage.success(response.data?.message || '权限已同步，立即生效');
    dialogVisible.value = false;
  } catch (error: any) {
    ElMessage.error(error?.message || '保存权限失败');
  } finally {
    saving.value = false;
  }
};

const resetToRoleDefault = async () => {
  if (!assignUser.value) {
    return;
  }
  resetting.value = true;
  try {
    const response = await api.delete(`/admin/users/${assignUser.value.id}/permissions`);
    if (response.data?.data) {
      applyDetail(response.data.data as PermissionDetail);
    }
    ElMessage.success(response.data?.message || '已恢复角色默认权限');
  } catch (error: any) {
    ElMessage.error(error?.message || '恢复失败');
  } finally {
    resetting.value = false;
  }
};

onMounted(() => {
  loadUsers();
});
</script>

<style scoped>
.perm-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.perm-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 22px 26px;
  background: var(--dp-color-surface, #fffdf7);
  border: 1px solid rgba(56, 49, 57, 0.06);
  border-radius: var(--dp-radius-surface, 38px);
  box-shadow: var(--clay-shadow-tray, 0 18px 40px rgba(56, 49, 57, 0.12));
}

.perm-hero__eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: #3f8a5d;
  font-weight: 700;
}

.perm-hero__title {
  margin: 0 0 8px;
  font-size: 22px;
  color: var(--dp-color-ink, #383139);
}

.perm-hero__desc {
  margin: 0;
  max-width: 640px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dp-color-ink-secondary, #48404b);
}

.perm-hero__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.perm-hero__search {
  width: 240px;
}

.perm-hero__role {
  width: 170px;
}

.perm-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.perm-card__title {
  font-weight: 700;
  color: var(--dp-color-ink, #383139);
}

.perm-card__meta {
  font-size: 12px;
  color: var(--dp-color-ink-secondary, #48404b);
}

.user-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-cell__name {
  font-weight: 600;
  color: var(--dp-color-ink, #383139);
}

.user-cell__account,
.user-cell__muted {
  font-size: 12px;
  color: var(--dp-color-ink-secondary, #48404b);
}

.role-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.perm-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.perm-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.perm-dialog__title {
  font-size: 16px;
  font-weight: 700;
  color: var(--dp-color-ink, #383139);
}

.perm-dialog__user {
  margin-left: 10px;
  font-size: 13px;
  color: var(--dp-color-ink-secondary, #48404b);
}

.perm-dialog__user em {
  margin-left: 6px;
  font-style: normal;
  color: #3f8a5d;
}

.perm-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}

.perm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 18px;
  background: rgba(142, 211, 165, 0.22);
}

.perm-toolbar__count {
  font-size: 13px;
  color: var(--dp-color-ink, #383139);
}

.perm-toolbar__actions {
  display: flex;
  gap: 8px;
}

.perm-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.perm-group {
  border: 1px solid rgba(56, 49, 57, 0.07);
  border-radius: 22px;
  background: var(--dp-color-surface, #fffdf7);
  box-shadow: 0 8px 20px rgba(56, 49, 57, 0.06);
  padding: 12px 14px 8px;
}

.perm-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px dashed rgba(56, 49, 57, 0.1);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.perm-group__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 13px;
  color: var(--dp-color-ink, #383139);
}

.perm-group__title em {
  font-style: normal;
  font-weight: 500;
  font-size: 12px;
  color: #3f8a5d;
}

.perm-group__items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.perm-item {
  display: flex;
  align-items: center;
  height: 30px;
}

.perm-item__name {
  font-size: 13px;
  color: var(--dp-color-ink, #383139);
}

.perm-item__code {
  margin-left: 8px;
  font-size: 11px;
  color: #8a8291;
}

.perm-dialog__footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.perm-dialog__spacer {
  flex: 1;
}
</style>
