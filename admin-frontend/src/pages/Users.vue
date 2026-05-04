<template>
  <div class="users-page">
    <h2 class="page-title">用户管理</h2>
    
    <!-- 搜索和筛选 -->
    <div class="search-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索用户名、邮箱或手机号"
        style="width: 300px; margin-right: 10px"
        @keyup.enter="fetchUsers"
      >
        <template #append>
          <el-button @click="fetchUsers">
            <el-icon><Search /></el-icon>
          </el-button>
        </template>
      </el-input>
      
      <el-button type="primary" @click="fetchUsers">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 用户列表 -->
    <div class="table-shell">
    <el-table
      v-loading="loading"
      :data="usersList"
      style="width: 100%; margin-top: 20px"
    >
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="姓名" />
      <el-table-column prop="email" label="邮箱" />
      <el-table-column prop="mobile" label="手机号" />
      <el-table-column prop="user_type" label="用户类型" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="scope">
          <el-tag :type="scope.row.status === 'active' ? 'success' : 'danger'">
            {{ scope.row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="org_name" label="所属组织" />
      <el-table-column label="角色" width="200">
        <template #default="scope">
          <div>
            <el-tag
              v-for="role in scope.row.roles"
              :key="role.id"
              size="small"
              style="margin-right: 5px; margin-bottom: 5px"
            >
              {{ role.role }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="scope">
          <el-button
            size="small"
            @click="viewUser(scope.row)"
            style="margin-right: 5px"
          >
            查看
          </el-button>
          <el-button
            size="small"
            type="warning"
            @click="manageRoles(scope.row)"
            style="margin-right: 5px"
          >
            角色
          </el-button>
          <el-button
            size="small"
            :type="scope.row.status === 'active' ? 'danger' : 'success'"
            @click="toggleStatus(scope.row)"
            style="margin-right: 5px"
          >
            {{ scope.row.status === 'active' ? '禁用' : '启用' }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="deleteUser(scope.row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination" style="margin-top: 20px">
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

    <!-- 用户详情对话框 -->
    <el-dialog
      v-model="userDialogVisible"
      title="用户详情"
      width="600px"
    >
      <el-form v-if="currentUser" label-width="100px">
        <el-form-item label="ID">
          <el-input v-model="currentUser.id" disabled />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="currentUser.name" disabled />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="currentUser.email" disabled />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="currentUser.mobile" disabled />
        </el-form-item>
        <el-form-item label="用户类型">
          <el-input v-model="currentUser.user_type" disabled />
        </el-form-item>
        <el-form-item label="状态">
          <el-input v-model="currentUser.status" disabled />
        </el-form-item>
        <el-form-item label="所属组织">
          <el-input v-model="currentUser.org_name" disabled />
        </el-form-item>
        <el-form-item label="学生信息">
          <div v-if="currentUser.student_info">
            <p>学号: {{ currentUser.student_info.student_no }}</p>
            <p>班级: {{ currentUser.student_info.class_name }}</p>
          </div>
          <p v-else>无学生信息</p>
        </el-form-item>
        <el-form-item label="角色">
          <div>
            <el-tag
              v-for="role in currentUser.roles"
              :key="role.id"
              size="small"
              style="margin-right: 5px; margin-bottom: 5px"
            >
              {{ role.role }} ({{ role.scope_type }})
            </el-tag>
          </div>
        </el-form-item>
        <el-form-item label="权限">
          <div>
            <el-tag
              v-for="permission in userPermissions"
              :key="permission"
              size="small"
              style="margin-right: 5px; margin-bottom: 5px"
            >
              {{ permission }}
            </el-tag>
          </div>
        </el-form-item>
      </el-form>
    </el-dialog>

    <!-- 角色管理对话框 -->
    <el-dialog
      v-model="rolesDialogVisible"
      title="管理角色"
      width="500px"
    >
      <div v-if="currentUser">
        <h3>{{ currentUser.name }} 的角色</h3>
        
        <div style="margin: 20px 0">
          <h4>现有角色：</h4>
          <div v-if="currentUser.roles.length > 0">
            <el-tag
              v-for="role in currentUser.roles"
              :key="role.id"
              closable
              style="margin-right: 5px; margin-bottom: 5px"
              @close="removeRole(role.id)"
            >
              {{ role.role }} ({{ role.scope_type }})
            </el-tag>
          </div>
          <p v-else>暂无角色</p>
        </div>

        <div>
          <h4>添加角色：</h4>
          <el-form :model="roleForm" label-width="80px">
            <el-form-item label="角色">
              <el-select v-model="roleForm.role" placeholder="选择角色">
                <el-option
                  v-for="role in predefinedRoles"
                  :key="role.code"
                  :label="role.name"
                  :value="role.code"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="作用域类型">
              <el-select v-model="roleForm.scope_type" placeholder="选择作用域类型">
                <el-option label="系统" value="system" />
                <el-option label="学院" value="org" />
                <el-option label="班级" value="class" />
                <el-option label="个人" value="self" />
              </el-select>
            </el-form-item>
            <el-form-item label="作用域ID">
              <el-input v-model="roleForm.scope_id" placeholder="可选，根据作用域类型填写" />
            </el-form-item>
          </el-form>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="rolesDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="addRole">添加角色</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Search, Refresh } from '@element-plus/icons-vue';
import { api } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';

// 状态
const loading = ref(false);
const usersList = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const searchKeyword = ref('');

// 对话框状态
const userDialogVisible = ref(false);
const rolesDialogVisible = ref(false);
const currentUser = ref<any>(null);
const userPermissions = ref<string[]>([]);

// 角色表单
const roleForm = ref({
  role: '',
  scope_type: 'self',
  scope_id: '',
});

// 预定义角色
const predefinedRoles = ref([
  { code: 'student', name: '学生' },
  { code: 'class_monitor', name: '班干' },
  { code: 'head_teacher', name: '班主任' },
  { code: 'student_admin', name: '学工管理员' },
  { code: 'teaching_admin', name: '教务管理员' },
  { code: 'vice_dean', name: '教学副院长' },
  { code: 'sys_admin', name: '系统管理员' },
]);

// 获取用户列表
const fetchUsers = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/users', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        search: searchKeyword.value,
      },
    });
    usersList.value = response.data.data.list;
    total.value = response.data.data.pagination.total;
  } catch (error) {
    console.error('获取用户列表失败:', error);
  } finally {
    loading.value = false;
  }
};

// 查看用户详情
const viewUser = async (user: any) => {
  currentUser.value = user;
  userDialogVisible.value = true;
  
  // 获取用户权限
  try {
    const response = await api.get(`/admin/users/${user.id}/permissions`);
    userPermissions.value = response.data.data;
  } catch (error) {
    console.error('获取用户权限失败:', error);
    userPermissions.value = [];
  }
};

// 管理角色
const manageRoles = (user: any) => {
  currentUser.value = user;
  rolesDialogVisible.value = true;
  roleForm.value = {
    role: '',
    scope_type: 'self',
    scope_id: '',
  };
};

// 添加角色
const addRole = async () => {
  if (!currentUser.value || !roleForm.value.role) {
    return;
  }

  try {
    await api.post('/admin/roles/assign', {
      user_id: currentUser.value.id,
      role: roleForm.value.role,
      scope_type: roleForm.value.scope_type,
      scope_id: roleForm.value.scope_id || undefined,
    });
    
    // 重新获取用户信息
    const response = await api.get(`/admin/users/${currentUser.value.id}`);
    currentUser.value = response.data.data;
    
    // 重新获取用户列表
    fetchUsers();
    
    // 重置表单
    roleForm.value = {
      role: '',
      scope_type: 'self',
      scope_id: '',
    };
  } catch (error) {
    console.error('添加角色失败:', error);
  }
};

// 移除角色
const removeRole = async (userRoleId: string) => {
  try {
    await api.delete(`/admin/roles/assign/${userRoleId}`);
    
    // 重新获取用户信息
    const response = await api.get(`/admin/users/${currentUser.value.id}`);
    currentUser.value = response.data.data;
    
    // 重新获取用户列表
    fetchUsers();
  } catch (error) {
    console.error('移除角色失败:', error);
  }
};

// 切换用户状态
const toggleStatus = async (user: any) => {
  try {
    if (user.status === 'active') {
      await api.put(`/admin/users/${user.id}/disable`);
    } else {
      await api.put(`/admin/users/${user.id}/enable`);
    }
    
    // 重新获取用户列表
    fetchUsers();
  } catch (error) {
    console.error('切换状态失败:', error);
  }
};

// 删除用户
const deleteUser = async (user: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户 "${user.name}" 吗？此操作将同时删除该用户的所有角色关联，无法恢复！`, 
      '删除确认', 
      { type: 'warning' }
    );

    await api.delete(`/admin/users/${user.id}`);
    ElMessage.success('删除成功');
    fetchUsers();
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除用户失败:', error);
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

// 分页处理
const handleSizeChange = (size: number) => {
  pageSize.value = size;
  fetchUsers();
};

const handleCurrentChange = (current: number) => {
  page.value = current;
  fetchUsers();
};

// 初始化
onMounted(() => {
  fetchUsers();
});
</script>

<style scoped>
.users-page {
  padding: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 20px;
  color: #333;
}

.search-bar {
  margin-bottom: 20px;
}

.pagination {
  text-align: right;
}
</style>
