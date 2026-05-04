<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>绑定学院</span>
        </div>
      </template>
      
      <div class="bind-content">
        <el-alert
          title="温馨提示"
          type="warning"
          :closable="false"
          style="margin-bottom: 20px;"
        >
          请选择您负责的学院，绑定后才能查看和管理该学院的相关信息。
        </el-alert>
        
        <el-form :model="form" label-width="100px" style="max-width: 500px;">
          <el-form-item label="选择学院">
            <el-select v-model="form.orgId" placeholder="请选择学院" style="width: 100%;">
              <el-option
                v-for="org in orgList"
                :key="org.id"
                :label="org.name || org.org_name"
                :value="org.id"
              />
            </el-select>
          </el-form-item>
          
          <el-form-item>
            <el-button type="primary" @click="onBind" :loading="loading">
              绑定学院
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { listOrgs, studentAdminBindOrg } from '../../api';

const router = useRouter();
const loading = ref(false);
const orgList = ref<any[]>([]);

const form = reactive({
  orgId: '',
});

const loadOrgs = async () => {
  try {
    const resp = await listOrgs();
    if (resp.code === 0) {
      orgList.value = resp.data || [];
    }
  } catch (e) {
    console.error('加载学院列表失败:', e);
  }
};

const onBind = async () => {
  if (!form.orgId) {
    ElMessage.warning('请选择学院');
    return;
  }
  
  loading.value = true;
  try {
    const resp = await studentAdminBindOrg(form.orgId);
    if (resp.code === 0) {
      const selectedOrg = orgList.value.find((item) => String(item.id) === String(form.orgId));
      if (resp.data) {
        localStorage.setItem('admin_roles_full', JSON.stringify(resp.data));
        
        const roles = resp.data.map((r: any) => r.role);
        localStorage.setItem('admin_roles', JSON.stringify(roles));
      }
      
      const currentUserStr = localStorage.getItem('admin_user');
      if (currentUserStr) {
        const currentUser = JSON.parse(currentUserStr);
        currentUser.org_id = form.orgId;
        currentUser.org_name = selectedOrg?.name || selectedOrg?.org_name || '';
        localStorage.setItem('admin_user', JSON.stringify(currentUser));
      }
      
      ElMessage.success('绑定成功');
      router.push('/college-dashboard');
    } else {
      ElMessage.error(resp.message || '绑定失败');
    }
  } catch (e: any) {
    console.error('绑定失败:', e);
    ElMessage.error(e?.message || '绑定失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadOrgs();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bind-content {
  padding: 20px 0;
}
</style>
