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
          type="info"
          :closable="false"
          style="margin-bottom: 20px;"
        >
          请选择您所属的学院，绑定后才能管理该学院的课程和班级。
        </el-alert>

        <el-form :model="form" label-width="100px" style="max-width: 500px;">
          <el-form-item label="选择学院">
            <el-select v-model="form.orgId" placeholder="请选择学院" style="width: 100%;">
              <el-option
                v-for="org in orgList"
                :key="org.id"
                :label="org.name"
                :value="org.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" @click="onBind" :loading="loading">
              保存
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { getTeacherBindingStatus, getTeacherOrgs, teacherBindOrg } from '../../api';
import { setTeacherBindingState } from '../../lib/binding';

const router = useRouter();
const loading = ref(false);
const orgList = ref<any[]>([]);

const form = reactive({
  orgId: '',
});

const loadOrgs = async () => {
  try {
    const resp = await getTeacherOrgs();
    if (resp.code === 0) {
      orgList.value = resp.data || [];
    }
  } catch (error) {
    console.error('加载学院列表失败:', error);
  }
};

const loadBindingStatus = async () => {
  try {
    const resp = await getTeacherBindingStatus();
    if (resp.code === 0 && resp.data) {
      if (resp.data.org_id) {
        form.orgId = String(resp.data.org_id);
      }
      setTeacherBindingState({
        hasBoundOrg: Boolean(resp.data.has_bound_org),
        hasBoundCourses: Boolean(resp.data.has_bound_courses),
      });
      if (resp.data.has_bound_org && resp.data.has_bound_courses) {
        router.replace('/teacher-attendance');
        return;
      }
      if (resp.data.has_bound_org) {
        router.replace('/teacher-bind-courses');
      }
    }
  } catch (error) {
    console.error('加载绑定状态失败:', error);
  }
};

const onBind = async () => {
  if (!form.orgId) {
    ElMessage.warning('请选择学院');
    return;
  }

  loading.value = true;
  try {
    const resp = await teacherBindOrg(form.orgId);
    if (resp.code === 0) {
      const selectedOrg = orgList.value.find((item) => String(item.id) === String(form.orgId));
      const currentUserStr = localStorage.getItem('admin_user');
      if (currentUserStr) {
        try {
          const currentUser = JSON.parse(currentUserStr);
          currentUser.org_id = form.orgId;
          currentUser.org_name = selectedOrg?.name || selectedOrg?.org_name || '';
          localStorage.setItem('admin_user', JSON.stringify(currentUser));
        } catch {
          // Ignore invalid cached user info.
        }
      }

      setTeacherBindingState({
        hasBoundOrg: true,
        hasBoundCourses: false,
      });
      ElMessage.success('绑定成功');
      router.push('/teacher-bind-courses');
    } else {
      ElMessage.error(resp.message || '绑定失败');
    }
  } catch (error: any) {
    console.error('绑定失败:', error);
    ElMessage.error(error?.message || '绑定失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadOrgs();
  loadBindingStatus();
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
