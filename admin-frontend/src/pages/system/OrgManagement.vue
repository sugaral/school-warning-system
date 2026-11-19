<template>
  <div class="org-management">
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索组织名称"
        clearable
        style="width: 320px"
        @keyup.enter="fetchOrgs"
      >
        <template #append>
          <el-button @click="fetchOrgs">
            <el-icon><Search /></el-icon>
          </el-button>
        </template>
      </el-input>

      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon>
        新增组织
      </el-button>

      <el-button @click="fetchOrgs">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-shell">
    <el-table v-loading="loading" :data="filteredOrgsList" stripe style="width: 100%; margin-top: 20px">
      <el-table-column prop="org_name" label="组织名称" min-width="220" />
      <el-table-column prop="org_code" label="类型" width="120">
        <template #default="{ row }">
          <el-tag size="small">{{ getOrgKindName(row.org_code) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="editOrg(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="deleteOrg(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog v-model="orgDialogVisible" :title="isEditMode ? '编辑组织' : '新增组织'" width="520px">
      <el-form ref="orgFormRef" :model="orgForm" :rules="orgRules" label-width="100px">
        <el-form-item label="组织名称" prop="org_name">
          <el-input v-model="orgForm.org_name" placeholder="请输入组织名称" />
        </el-form-item>
        <el-form-item label="组织类型" prop="org_code">
          <el-select v-model="orgForm.org_code" placeholder="请选择组织类型" style="width: 100%">
            <el-option label="学校" value="school" />
            <el-option label="学院" value="college" />
            <el-option label="系部" value="department" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="orgForm.status">
            <el-radio value="active">启用</el-radio>
            <el-radio value="inactive">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="orgDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveOrg">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';

const loading = ref(false);
const orgsList = ref<any[]>([]);
const searchKeyword = ref('');
const orgDialogVisible = ref(false);
const isEditMode = ref(false);
const orgFormRef = ref();
const currentOrgId = ref('');

const orgForm = ref({
  org_name: '',
  org_code: 'college',
  status: 'active',
});

const orgRules = {
  org_name: [{ required: true, message: '请输入组织名称', trigger: 'blur' }],
  org_code: [{ required: true, message: '请选择组织类型', trigger: 'change' }],
};

const filteredOrgsList = computed(() => {
  if (!searchKeyword.value) {
    return orgsList.value;
  }
  const search = searchKeyword.value.toLowerCase();
  return orgsList.value.filter(
    (org) =>
      org.org_name?.toLowerCase().includes(search) ||
      org.org_code?.toLowerCase().includes(search),
  );
});

const fetchOrgs = async () => {
  loading.value = true;
  try {
    const response = await api.get('/orgs');
    orgsList.value = Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (error) {
    console.error('获取组织列表失败:', error);
    orgsList.value = [];
    ElMessage.error('获取组织列表失败');
  } finally {
    loading.value = false;
  }
};

const showCreateDialog = () => {
  isEditMode.value = false;
  currentOrgId.value = '';
  orgForm.value = {
    org_name: '',
    org_code: 'college',
    status: 'active',
  };
  orgDialogVisible.value = true;
};

const editOrg = (org: any) => {
  isEditMode.value = true;
  currentOrgId.value = org.id;
  orgForm.value = {
    org_name: org.org_name,
    org_code: org.org_code || 'college',
    status: org.status,
  };
  orgDialogVisible.value = true;
};

const saveOrg = async () => {
  try {
    await orgFormRef.value.validate();

    if (isEditMode.value) {
      await api.put(`/orgs/${currentOrgId.value}`, orgForm.value);
      ElMessage.success('组织更新成功');
    } else {
      await api.post('/orgs', orgForm.value);
      ElMessage.success('组织创建成功');
    }

    orgDialogVisible.value = false;
    fetchOrgs();
  } catch (error: any) {
    if (error !== false) {
      console.error(isEditMode.value ? '更新组织失败:' : '创建组织失败:', error);
      ElMessage.error(isEditMode.value ? '更新组织失败' : '创建组织失败');
    }
  }
};

const deleteOrg = async (org: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除组织“${org.org_name}”吗？`, '确认操作', { type: 'warning' });

    await api.delete(`/orgs/${org.id}`);
    ElMessage.success('删除组织成功');
    fetchOrgs();
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除组织失败:', error);
      ElMessage.error('删除组织失败');
    }
  }
};

const getOrgKindName = (kind: string) => {
  const kindMap: Record<string, string> = {
    school: '学校',
    college: '学院',
    department: '系部',
  };
  return kindMap[kind] || kind;
};

const formatDate = (date: string) => new Date(date).toLocaleString('zh-CN');

onMounted(() => {
  fetchOrgs();
});
</script>

<style scoped>
.org-management {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
