<template>
  <div class="bind-container">
    <el-card class="bind-card">
      <div class="bind-header">
        <el-icon :size="48" color="#409eff"><InfoFilled /></el-icon>
        <h2>请先绑定班级</h2>
        <p class="description">您当前尚未绑定学院和班级，请先完成绑定以便使用完整功能</p>
      </div>

      <el-form :model="form" label-width="100px" class="bind-form">
        <el-form-item label="选择学院">
          <el-select v-model="form.org_id" placeholder="请选择学院" @change="handleOrgChange">
            <el-option
              v-for="org in orgList"
              :key="org.id"
              :label="org.org_name"
              :value="org.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="选择班级">
          <el-select v-model="form.class_id" placeholder="请先选择学院">
            <el-option
              v-for="cls in filteredClasses"
              :key="cls.id"
              :label="cls.class_name"
              :value="cls.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleBind" :loading="loading" style="width: 100%">
            确认绑定
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { InfoFilled } from '@element-plus/icons-vue';
import { api } from '../../api';
import { setStudentBoundState, updateStoredRoleScope } from '../../lib/binding';

const router = useRouter();
const loading = ref(false);

const form = ref({
  org_id: '',
  class_id: ''
});

const orgList = ref<any[]>([]);
const classList = ref<any[]>([]);

const filteredClasses = computed(() => {
  if (!form.value.org_id) return [];
  const orgId = String(form.value.org_id);
  return classList.value.filter(c => String(c.org_id) === orgId);
});

const loadData = async () => {
  try {
    const classRes = await api.get('/student/available-classes');
    
    if (classRes.data.code === 0) {
      const classes = classRes.data.data || [];
      classList.value = classes;
      
      // 从班级列表中提取唯一的学院列表
      const orgMap = new Map();
      classes.forEach((cls: any) => {
        if (cls.org_id && cls.org_name && !orgMap.has(cls.org_id)) {
          orgMap.set(cls.org_id, { id: cls.org_id, org_name: cls.org_name });
        }
      });
      orgList.value = Array.from(orgMap.values());
    }
  } catch (error: any) {
    console.error('加载数据失败:', error);
  }
};

const handleOrgChange = () => {
  form.value.class_id = '';
};

const getPostBindRedirectPath = () => {
  try {
    const roles = JSON.parse(localStorage.getItem('admin_roles') || '[]');
    if (Array.isArray(roles) && roles.includes('class_monitor')) {
      return '/class-overview';
    }
  } catch (error: any) {
    console.error('读取角色信息失败', error);
  }

  return '/my-warnings';
};

const handleBind = async () => {
  if (!form.value.org_id) {
    ElMessage.warning('请选择学院');
    return;
  }
  if (!form.value.class_id) {
    ElMessage.warning('请选择班级');
    return;
  }

  loading.value = true;
  try {
    const response = await api.post('/student/bind-class', {
      class_id: form.value.class_id
    });
    
    if (response.data.code === 0) {
      ElMessage.success('绑定成功');
      if (response.data.data?.token) {
        localStorage.setItem('admin_token', response.data.data.token);
      }
      if (response.data.data?.student_id) {
        localStorage.setItem('student_id', response.data.data.student_id);
      }
      {
        const roles = JSON.parse(localStorage.getItem('admin_roles') || '[]');
        if (Array.isArray(roles) && roles.includes('class_monitor')) {
          updateStoredRoleScope('class_monitor', form.value.class_id || null);
        }
      }
      setStudentBoundState(true);
      const redirectPath = getPostBindRedirectPath();
      try {
        await router.replace(redirectPath);
      } catch (navigationError) {
        console.warn('bind success but redirect failed', navigationError);
        window.location.assign(redirectPath);
      }
    } else {
      ElMessage.error(response.data.message || '绑定失败');
    }
  } catch (error) {
    ElMessage.error('绑定失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.bind-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
  background: transparent;
}

.bind-card {
  width: 500px;
}

.bind-header {
  text-align: center;
  margin-bottom: 30px;
}

.bind-header h2 {
  margin: 20px 0 10px;
  color: #303133;
}

.description {
  color: #909399;
  font-size: 14px;
}

.bind-form {
  margin-top: 20px;
}
</style>
