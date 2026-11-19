<template>
  <div class="user-management">
    <section class="users-hero">
      <div class="users-hero__copy">
        <span class="users-hero__eyebrow">Identity Control</span>
        <h2 class="users-hero__title">用户管理</h2>
        <p class="users-hero__desc">统一维护账号、用户身份、角色范围与密码重置流程。</p>
      </div>
      <div class="users-hero__actions">
        <div class="users-hero__meta">
          <span>当前页</span>
          <strong>{{ page }}</strong>
          <small>共 {{ total }} 个用户</small>
        </div>
        <el-button type="primary" @click="openCreateDialog">新增用户</el-button>
        <el-button @click="fetchUsers">刷新</el-button>
      </div>
    </section>

    <section class="users-overview">
      <article class="users-overview__card">
        <span class="users-overview__label">用户总量</span>
        <strong class="users-overview__value">{{ total }}</strong>
        <p class="users-overview__desc">当前筛选条件下的全部用户数</p>
      </article>
      <article class="users-overview__card">
        <span class="users-overview__label">当前页结果</span>
        <strong class="users-overview__value">{{ usersList.length }}</strong>
        <p class="users-overview__desc">当前分页展示的用户条数</p>
      </article>
      <article class="users-overview__card">
        <span class="users-overview__label">启用中</span>
        <strong class="users-overview__value">{{ activeUsersCount }}</strong>
        <p class="users-overview__desc">当前页处于启用状态的用户数</p>
      </article>
      <article class="users-overview__card">
        <span class="users-overview__label">角色分配</span>
        <strong class="users-overview__value">{{ assignedRoleCount }}</strong>
        <p class="users-overview__desc">当前页用户拥有的角色条目总数</p>
      </article>
    </section>

    <el-card class="users-toolbar-card">
      <div class="toolbar">
        <el-input
          v-model="searchKeyword"
          placeholder="按姓名、账号或邮箱搜索"
          style="width: 280px"
          clearable
          @keyup.enter="fetchUsers"
        />
        <el-select
          v-model="filterRole"
          placeholder="筛选角色"
          style="width: 180px"
          clearable
          @change="fetchUsers"
        >
          <el-option
            v-for="role in roleOptions"
            :key="role.code"
            :label="role.name"
            :value="role.code"
          />
        </el-select>
        <el-select
          v-model="filterStatus"
          placeholder="状态"
          style="width: 160px"
          clearable
          @change="fetchUsers"
        >
          <el-option label="启用" value="active" />
          <el-option label="未激活" value="inactive" />
          <el-option label="禁用" value="disabled" />
        </el-select>
      </div>
    </el-card>

    <el-card class="users-table-card">
      <template #header>
        <div class="users-table-card__header">
          <div>
            <span class="users-table-card__title">账号列表</span>
            <p class="users-table-card__desc">支持直接查看用户状态、组织归属、角色范围和常用操作入口。</p>
          </div>
          <el-tag type="primary" effect="plain">当前页 {{ usersList.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table v-loading="loading" :data="usersList" stripe>
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="name" label="姓名" min-width="120" />
        <el-table-column prop="account" label="账号" min-width="180" />
        <el-table-column prop="email" label="邮箱" min-width="220" />
        <el-table-column prop="user_type" label="用户类型" width="120">
          <template #default="{ row }">
            {{ getUserTypeLabel(row.user_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="getStatusTagType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="org_name" label="所属组织" min-width="180" />
        <el-table-column label="角色" min-width="280">
          <template #default="{ row }">
            <div class="role-cell">
              <el-tag
                v-for="role in row.roles || []"
                :key="role.id"
                size="small"
                class="role-tag"
              >
                {{ getRoleLabel(role.role) }}
                <span v-if="role.scope_type"> / {{ getScopeTypeLabel(role.scope_type) }}</span>
                <span v-if="role.scope_id">:{{ role.scope_id }}</span>
              </el-tag>
              <span v-if="!row.roles?.length" class="muted-text">未分配角色</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <div class="action-group">
              <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
              <el-button size="small" @click="openRoleDialog(row)">角色</el-button>
              <el-button size="small" type="warning" @click="openPasswordDialog(row)">密码</el-button>
              <el-button size="small" type="danger" @click="deleteUser(row)">删除</el-button>
            </div>
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
          @size-change="fetchUsers"
          @current-change="fetchUsers"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="userDialogVisible"
      :title="isCreateMode ? '新增用户' : '编辑用户'"
      width="720px"
      @closed="resetUserForm"
    >
      <el-form ref="userFormRef" :model="userForm" :rules="userRules" label-width="110px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model.trim="userForm.name" />
        </el-form-item>

        <el-form-item label="账号" prop="account">
          <el-input
            v-model.trim="userForm.account"
            placeholder="请输入手机号、工号或英文账号"
          />
        </el-form-item>

        <el-form-item label="邮箱" prop="email">
          <el-input v-model.trim="userForm.email" placeholder="可选，用于通知" />
        </el-form-item>

        <el-form-item v-if="isCreateMode" label="用户身份" prop="role">
          <el-select
            v-model="userForm.role"
            placeholder="请选择用户身份"
            style="width: 100%"
            filterable
            @change="handleCreateRoleChange"
          >
            <el-option
              v-for="role in createRoleOptions"
              :key="role.code"
              :label="role.name"
              :value="role.code"
            />
          </el-select>
          <div v-if="selectedCreateRole" class="role-card">
            <div class="role-card-title">{{ selectedCreateRole.name }}</div>
            <div class="role-card-desc">
              {{ selectedCreateRole.description || '该身份会在创建时自动分配对应角色。' }}
            </div>
            <div class="role-card-meta">
              <el-tag size="small" type="info">
                用户类型：{{ getUserTypeLabel(selectedCreateRole.user_type) }}
              </el-tag>
              <el-tag size="small" type="warning">
                默认范围：{{ getScopeTypeLabel(selectedCreateRole.register_scope || selectedCreateRole.default_scope) }}
              </el-tag>
            </div>
          </div>
        </el-form-item>

        <el-form-item v-else label="用户类型" prop="user_type">
          <el-select v-model="userForm.user_type" style="width: 100%">
            <el-option
              v-for="item in userTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          v-if="isCreateMode && createRoleRequiresClassScope"
          label="绑定班级"
          prop="class_id"
        >
          <el-select
            v-model="userForm.class_id"
            placeholder="请选择班级"
            filterable
            style="width: 100%"
            @change="handleCreateClassChange"
          >
            <el-option
              v-for="item in classesList"
              :key="item.id"
              :label="`${item.org_name || '未设置学院'} / ${item.class_name}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          v-if="!isCreateMode || createRoleShowsOrgSelector"
          :label="createRoleRequiresOrgScope ? '所属学院' : '所属组织'"
          prop="org_id"
        >
          <el-select
            v-model="userForm.org_id"
            placeholder="请选择所属组织"
            clearable
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="org in orgsList"
              :key="org.id"
              :label="org.org_name || org.name || org.id"
              :value="org.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-select v-model="userForm.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="未激活" value="inactive" />
            <el-option label="禁用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="userDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" title="角色管理" width="760px">
      <div v-if="currentUser">
        <div class="role-list">
          <el-tag
            v-for="role in currentUser.roles || []"
            :key="role.id"
            closable
            class="role-tag"
            @close="removeRole(role.id)"
          >
            {{ getRoleLabel(role.role) }} / {{ getScopeTypeLabel(role.scope_type) }}{{ role.scope_id ? `:${role.scope_id}` : '' }}
          </el-tag>
          <span v-if="!currentUser.roles?.length" class="muted-text">当前用户还没有分配角色</span>
        </div>

        <el-divider />

        <el-form :model="roleForm" label-width="110px">
          <el-form-item label="角色">
            <el-select
              v-model="roleForm.role"
              placeholder="请选择角色"
              style="width: 100%"
              @change="handleRoleFormRoleChange"
            >
              <el-option
                v-for="role in roleOptions"
                :key="role.code"
                :label="role.name"
                :value="role.code"
              />
            </el-select>
          </el-form-item>

          <el-form-item v-if="roleRequiresOrgScope" label="所属学院">
            <el-select
              v-model="roleForm.org_id"
              placeholder="请选择学院"
              filterable
              style="width: 100%"
            >
              <el-option
                v-for="org in orgsList"
                :key="org.id"
                :label="org.org_name || org.name || org.id"
                :value="org.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item v-if="roleRequiresClassScope" label="绑定班级">
            <el-select
              v-model="roleForm.class_id"
              placeholder="请选择班级"
              filterable
              style="width: 100%"
            >
              <el-option
                v-for="item in classesList"
                :key="item.id"
                :label="`${item.org_name || '未设置学院'} / ${item.class_name}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item v-if="showGenericScopeControls" label="范围类型">
            <el-select v-model="roleForm.scope_type" style="width: 100%">
              <el-option label="系统" value="system" />
              <el-option label="学校" value="school" />
              <el-option label="组织" value="org" />
              <el-option label="班级" value="class" />
              <el-option label="个人" value="self" />
            </el-select>
          </el-form-item>

          <el-form-item v-if="showGenericScopeControls" label="范围 ID">
            <el-input v-model.trim="roleForm.scope_id" placeholder="可选，填写数字 ID" />
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addRole">添加角色</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialogVisible" title="修改密码" width="520px">
      <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-width="120px">
        <el-form-item label="账号" prop="account">
          <el-input
            v-model.trim="passwordForm.account"
            placeholder="请输入新的登录账号"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="passwordForm.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { api } from '../../api';

type RoleOption = {
  code: string;
  name: string;
  description?: string;
  default_scope?: string;
  user_type?: string;
  register_scope?: string;
  registerable?: boolean;
};

const loading = ref(false);
const usersList = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const searchKeyword = ref('');
const filterRole = ref('');
const filterStatus = ref('');
const currentUser = ref<any>(null);
const orgsList = ref<any[]>([]);
const classesList = ref<any[]>([]);
const roleOptions = ref<RoleOption[]>([]);

const userDialogVisible = ref(false);
const roleDialogVisible = ref(false);
const passwordDialogVisible = ref(false);
const isCreateMode = ref(false);

const userFormRef = ref<FormInstance>();
const passwordFormRef = ref<FormInstance>();

const userTypeOptions = [
  { label: '管理员', value: 'admin' },
  { label: '教师', value: 'teacher' },
  { label: '职工', value: 'staff' },
  { label: '学生', value: 'student' },
];

const createInitialUserForm = () => ({
  account: '',
  name: '',
  email: '',
  user_type: 'teacher',
  role: '',
  scope_type: 'self',
  org_id: '',
  class_id: '',
  status: 'active',
});

const userForm = reactive(createInitialUserForm());

const roleForm = reactive({
  role: '',
  scope_type: 'self',
  scope_id: '',
  org_id: '',
  class_id: '',
});

const passwordForm = reactive({
  account: '',
  newPassword: '',
  confirmPassword: '',
});

const roleLabelMap = computed(() => {
  const map: Record<string, string> = {};
  for (const role of roleOptions.value) {
    map[role.code] = role.name;
  }
  return map;
});

const createRoleOptions = computed(() =>
  roleOptions.value.filter((role) => role.registerable !== false),
);

const selectedRoleOption = computed(
  () => roleOptions.value.find((item) => item.code === roleForm.role) || null,
);

const selectedCreateRole = computed(
  () => createRoleOptions.value.find((item) => item.code === userForm.role) || null,
);

const roleRequiresClassScope = computed(() => roleForm.role === 'head_teacher');
const roleRequiresOrgScope = computed(() =>
  ['student_admin', 'vice_dean'].includes(roleForm.role),
);
const createRoleRequiresClassScope = computed(() => userForm.role === 'head_teacher');
const createRoleRequiresOrgScope = computed(() =>
  ['student_admin', 'vice_dean'].includes(userForm.role),
);
const createRoleShowsOrgSelector = computed(() => createRoleRequiresOrgScope.value);
const showGenericScopeControls = computed(
  () => !roleRequiresClassScope.value && !roleRequiresOrgScope.value,
);
const activeUsersCount = computed(
  () => usersList.value.filter((item: any) => String(item.status || '') === 'active').length,
);
const assignedRoleCount = computed(
  () =>
    usersList.value.reduce(
      (sum: number, item: any) => sum + (Array.isArray(item.roles) ? item.roles.length : 0),
      0,
    ),
);

const isWeakPassword = (value?: string) => {
  const password = String(value || '').trim();
  if (password.length < 8) {
    return true;
  }

  const categoryCount =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password));

  return categoryCount < 2;
};

const userRules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  account: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  role: [{ required: true, message: '请选择用户身份', trigger: 'change' }],
  class_id: [
    {
      validator: (_rule, value, callback) => {
        if (createRoleRequiresClassScope.value && !String(value || '').trim()) {
          callback(new Error('请选择班级'));
          return;
        }
        callback();
      },
      trigger: 'change',
    },
  ],
  org_id: [
    {
      validator: (_rule, value, callback) => {
        if (createRoleRequiresOrgScope.value && !String(value || '').trim()) {
          callback(new Error('请选择学院'));
          return;
        }
        callback();
      },
      trigger: 'change',
    },
  ],
};

const passwordRules: FormRules = {
  account: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (isWeakPassword(value)) {
          callback(new Error('密码至少8位，且需包含两类字符'));
          return;
        }
        callback();
      },
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== passwordForm.newPassword) {
          callback(new Error('两次输入的密码不一致'));
          return;
        }
        callback();
      },
      trigger: 'blur',
    },
  ],
};

function getRoleLabel(roleCode: string) {
  return roleLabelMap.value[roleCode] || roleCode;
}

function getUserTypeLabel(userType: string) {
  const map: Record<string, string> = {
    admin: '管理员',
    teacher: '教师',
    staff: '职工',
    student: '学生',
  };
  return map[userType] || userType || '-';
}

function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    active: '启用',
    inactive: '未激活',
    disabled: '禁用',
  };
  return map[status] || status || '未知';
}

function getStatusTagType(status: string) {
  if (status === 'active') return 'success';
  if (status === 'disabled') return 'danger';
  return 'warning';
}

function getScopeTypeLabel(scopeType: string) {
  const map: Record<string, string> = {
    system: '系统',
    school: '学校',
    org: '组织',
    class: '班级',
    self: '个人',
    college: '学院',
  };
  return map[scopeType] || scopeType || '-';
}

function handleCreateRoleChange() {
  userForm.class_id = '';
  userForm.org_id = '';
  if (!selectedCreateRole.value) {
    return;
  }
  userForm.user_type = selectedCreateRole.value.user_type || 'teacher';
  userForm.scope_type =
    selectedCreateRole.value.register_scope ||
    selectedCreateRole.value.default_scope ||
    'self';
}

function handleCreateClassChange() {
  const selectedClass = classesList.value.find(
    (item: any) => String(item.id) === String(userForm.class_id),
  );
  if (selectedClass?.org_id) {
    userForm.org_id = String(selectedClass.org_id);
  }
}

function handleRoleFormRoleChange() {
  roleForm.scope_id = '';
  roleForm.org_id = '';
  roleForm.class_id = '';

  if (!selectedRoleOption.value) {
    roleForm.scope_type = 'self';
    return;
  }

  roleForm.scope_type =
    selectedRoleOption.value.register_scope ||
    selectedRoleOption.value.default_scope ||
    'self';
}

async function fetchRoles() {
  try {
    const response = await api.get('/admin/roles');
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '加载角色列表失败');
    }
    roleOptions.value = response.data.data || [];
  } catch (error) {
    console.error('加载角色列表失败', error);
    roleOptions.value = [];
  }
}

async function fetchOrgs() {
  try {
    const response = await api.get('/orgs');
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '加载组织列表失败');
    }
    orgsList.value = response.data.data || [];
  } catch (error) {
    console.error('加载组织列表失败', error);
    orgsList.value = [];
  }
}

async function fetchClasses() {
  try {
    const response = await api.get('/admin/classes', {
      params: { page: 1, pageSize: 2000 },
    });
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '加载班级列表失败');
    }
    classesList.value = response.data.data?.list || [];
  } catch (error) {
    console.error('加载班级列表失败', error);
    classesList.value = [];
  }
}

async function refreshCurrentUserDetail() {
  if (!currentUser.value?.id) {
    return;
  }

  const response = await api.get(`/admin/users/${currentUser.value.id}`);
  if (Number(response.data?.code) !== 0) {
    throw new Error(response.data?.message || '加载用户详情失败');
  }
  currentUser.value = response.data.data;
}

async function fetchUsers() {
  loading.value = true;
  try {
    const response = await api.get('/admin/users', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        search: searchKeyword.value || undefined,
        role: filterRole.value || undefined,
        status: filterStatus.value || undefined,
      },
    });
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '加载用户列表失败');
    }
    usersList.value = response.data.data.list || [];
    total.value = response.data.data.pagination?.total || 0;
  } catch (error) {
    console.error('加载用户列表失败', error);
    ElMessage.error('加载用户列表失败');
  } finally {
    loading.value = false;
  }
}

function resetUserForm() {
  Object.assign(userForm, createInitialUserForm());
  userForm.role = createRoleOptions.value[0]?.code || '';
  userForm.scope_type =
    createRoleOptions.value[0]?.register_scope ||
    createRoleOptions.value[0]?.default_scope ||
    'self';
  handleCreateRoleChange();
  userFormRef.value?.clearValidate();
}

function openCreateDialog() {
  isCreateMode.value = true;
  currentUser.value = null;
  resetUserForm();
  userDialogVisible.value = true;
}

function openEditDialog(user: any) {
  isCreateMode.value = false;
  currentUser.value = user;
  userForm.account = user.account || '';
  userForm.name = user.name || '';
  userForm.email = user.email || '';
  userForm.user_type = user.user_type || 'teacher';
  userForm.role = '';
  userForm.scope_type = 'self';
  userForm.org_id = user.org_id || '';
  userForm.class_id = '';
  userForm.status = user.status || 'active';
  userDialogVisible.value = true;
}

async function saveUser() {
  const valid = await userFormRef.value?.validate().catch(() => false);
  if (!valid) return;

  try {
    if (isCreateMode.value) {
      const payload: Record<string, any> = {
        account: userForm.account,
        name: userForm.name,
        email: userForm.email || undefined,
        user_type: userForm.user_type,
        role: userForm.role,
        scope_type: userForm.scope_type,
        org_id: userForm.org_id || undefined,
        class_id: userForm.class_id || undefined,
        status: userForm.status,
      };

      const response = await api.post('/admin/users', payload);
      if (Number(response.data?.code) !== 0) {
        throw new Error(response.data?.message || '用户创建失败');
      }

      page.value = 1;
      const accountText = response.data?.data?.account || userForm.account;
      const passwordText = response.data?.data?.initial_password || '未返回';
      ElMessage.success('用户创建成功');
      try {
        await ElMessageBox.alert(
          [`账号：${String(accountText || '-')}`, `初始密码：${String(passwordText || '-')}`].join('<br/>'),
          '请立即记录账号密码',
          {
            dangerouslyUseHTMLString: true,
            confirmButtonText: '我已记录',
          },
        );
      } catch {
        // closing alert should not be treated as creation failure
      }
    } else if (currentUser.value) {
      const response = await api.put(`/admin/users/${currentUser.value.id}`, {
        account: userForm.account,
        name: userForm.name,
        email: userForm.email || '',
        user_type: userForm.user_type,
        org_id: userForm.org_id || '',
        status: userForm.status,
      });
      if (Number(response.data?.code) !== 0) {
        throw new Error(response.data?.message || '用户更新失败');
      }
      ElMessage.success('用户更新成功');
    }
    userDialogVisible.value = false;
    await fetchUsers();
  } catch (error: any) {
    console.error('保存用户失败', error);
    ElMessage.error(error?.message || '保存用户失败');
  }
}

async function openRoleDialog(user: any) {
  currentUser.value = user;
  roleForm.role = '';
  roleForm.scope_type = 'self';
  roleForm.scope_id = '';
  roleForm.org_id = '';
  roleForm.class_id = '';
  try {
    await refreshCurrentUserDetail();
  } catch (error) {
    console.error('加载用户详情失败', error);
  }
  roleDialogVisible.value = true;
}

async function refreshRoleMutationViews(successMessage: string) {
  ElMessage.success(successMessage);

  try {
    await Promise.all([refreshCurrentUserDetail(), fetchUsers()]);
  } catch (error) {
    console.error('角色变更后刷新页面失败', error);
    ElMessage.warning('角色已写入成功，但列表刷新失败，请手动刷新页面查看最新结果');
  }
}

async function addRole() {
  if (!currentUser.value || !roleForm.role) {
    ElMessage.warning('请先选择角色');
    return;
  }

  try {
    const payload: Record<string, any> = {
      user_id: currentUser.value.id,
      role: roleForm.role,
    };

    if (roleRequiresClassScope.value) {
      if (!roleForm.class_id) {
        ElMessage.warning('请先选择班级');
        return;
      }
      const selectedClass = classesList.value.find(
        (item: any) => String(item.id) === String(roleForm.class_id),
      );
      payload.scope_type = 'class';
      payload.scope_id = roleForm.class_id;
      payload.class_id = roleForm.class_id;
      payload.org_id = selectedClass?.org_id;
    } else if (roleRequiresOrgScope.value) {
      if (!roleForm.org_id) {
        ElMessage.warning('请先选择学院');
        return;
      }
      payload.scope_type = 'org';
      payload.scope_id = roleForm.org_id;
      payload.org_id = roleForm.org_id;
    } else {
      payload.scope_type = roleForm.scope_type || undefined;
      payload.scope_id = roleForm.scope_id || undefined;
    }

    const response = await api.post('/admin/roles/assign', payload);
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '角色添加失败');
    }

    roleDialogVisible.value = false;
    await refreshRoleMutationViews('角色添加成功');
  } catch (error: any) {
    console.error('添加角色失败', error);
    ElMessage.error(error?.message || '添加角色失败');
  }
}

async function removeRole(userRoleId: string) {
  try {
    const response = await api.delete(`/admin/roles/assign/${userRoleId}`);
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '角色移除失败');
    }
    await refreshRoleMutationViews('角色移除成功');
  } catch (error: any) {
    console.error('移除角色失败', error);
    ElMessage.error(error?.message || '移除角色失败');
  }
}

function openPasswordDialog(user: any) {
  currentUser.value = user;
  passwordForm.account = user.account || '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  passwordDialogVisible.value = true;
}

async function savePassword() {
  const valid = await passwordFormRef.value?.validate().catch(() => false);
  if (!valid || !currentUser.value) return;

  try {
    const nextAccount = String(passwordForm.account || '').trim();
    if (!nextAccount) {
      throw new Error('请输入账号');
    }

    const currentAccount = String(currentUser.value.account || '').trim();
    if (nextAccount !== currentAccount) {
      const updateResp = await api.put(`/admin/users/${currentUser.value.id}`, {
        account: nextAccount,
        name: currentUser.value.name,
        email: currentUser.value.email || '',
        user_type: currentUser.value.user_type,
        org_id: currentUser.value.org_id || '',
        status: currentUser.value.status,
      });
      if (Number(updateResp.data?.code) !== 0) {
        throw new Error(updateResp.data?.message || '账号更新失败');
      }
    }

    const resp = await api.put(`/admin/users/${currentUser.value.id}/password`, {
      newPassword: passwordForm.newPassword,
    });
    if (Number(resp.data?.code) !== 0) {
      throw new Error(resp.data?.message || '修改密码失败');
    }

    passwordDialogVisible.value = false;
    await fetchUsers();
    ElMessage.success('密码修改成功');
  } catch (error: any) {
    console.error('修改密码失败', error);
    ElMessage.error(error?.message || '修改密码失败');
  }
}

async function deleteUser(user: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除用户 ${user.name} 吗？此操作不可恢复。`,
      '提示',
      { type: 'warning' },
    );
    const response = await api.delete(`/admin/users/${user.id}`);
    if (Number(response.data?.code) !== 0) {
      throw new Error(response.data?.message || '删除用户失败');
    }
    ElMessage.success('用户删除成功');
    await fetchUsers();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      console.error('删除用户失败', error);
      ElMessage.error(error?.message || '删除用户失败');
    }
  }
}

onMounted(async () => {
  await Promise.all([fetchRoles(), fetchOrgs(), fetchClasses()]);
  resetUserForm();
  await fetchUsers();
});
</script>

<style scoped>
.user-management {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.users-hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 18px;
  flex-wrap: wrap;
  padding: 24px 26px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 24px 48px rgba(34, 59, 78, 0.1);
}

.users-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.users-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.users-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.users-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.users-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.users-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.users-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.users-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.users-overview__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88),
    rgba(247, 251, 252, 0.8)
  );
  box-shadow: 0 18px 36px rgba(34, 59, 78, 0.08);
}

.users-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.users-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.users-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.users-toolbar-card,
.users-table-card {
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.users-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.users-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.users-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.pagination {
  display: flex;
  justify-content: flex-end;
}

.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.role-cell,
.role-list {
  min-height: 32px;
}

.role-tag {
  margin-right: 6px;
  margin-bottom: 6px;
}

.muted-text {
  color: #909399;
}

.role-card {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.16);
  backdrop-filter: blur(14px);
}

.role-card-title {
  font-weight: 600;
  color: #111827;
  margin-bottom: 4px;
}

.role-card-desc {
  color: #6b7280;
  line-height: 1.6;
}

.role-card-meta {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 1200px) {
  .users-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .users-hero {
    padding: 20px;
  }

  .users-overview {
    grid-template-columns: 1fr;
  }

  .users-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .users-hero__actions > * {
    width: 100%;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar :deep(.el-input),
  .toolbar :deep(.el-select) {
    width: 100% !important;
  }

  .pagination {
    justify-content: flex-start;
  }
}
</style>
