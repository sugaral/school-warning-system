<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>绑定班级</span>
        </div>
      </template>

      <div class="bind-content">
        <el-alert
          title="操作说明"
          type="info"
          :closable="false"
          class="bind-alert"
        >
          请选择您要负责的班级。绑定完成后，系统会按该班级范围展示预警与干预数据。
        </el-alert>

        <el-alert
          v-if="boundClasses.length"
          title="当前已负责的班级"
          type="success"
          :closable="false"
          class="bind-alert"
        >
          {{ boundClasses.map((item) => item.class_name).join('、') }}
        </el-alert>

        <el-form :model="form" label-width="100px" class="bind-form">
          <el-form-item label="所属学院">
            <el-select
              v-model="form.orgId"
              placeholder="请选择学院"
              style="width: 100%"
              @change="onOrgChange"
            >
              <el-option
                v-for="org in orgList"
                :key="org.id"
                :label="org.org_name || org.name"
                :value="org.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="班级">
            <el-select
              v-model="form.classId"
              placeholder="请选择班级"
              style="width: 100%"
              :disabled="!form.orgId"
              filterable
            >
              <el-option
                v-for="clazz in classList"
                :key="clazz.id"
                :label="formatClassLabel(clazz)"
                :value="clazz.id"
                :disabled="!clazz.bindable"
              />
            </el-select>
            <div class="form-tip">
              置灰的班级表示已绑定其他班主任，仅展示供查看。
            </div>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" @click="onBind">
              保存绑定
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
import {
  getHeadTeacherBindingStatus,
  getHeadTeacherClasses,
  getHeadTeacherOrgs,
  headTeacherBindClass,
} from '../../api';
import { setHeadTeacherBoundState, updateStoredRoleScope } from '../../lib/binding';

const router = useRouter();
const loading = ref(false);
const orgList = ref<any[]>([]);
const classList = ref<any[]>([]);
const boundClasses = ref<any[]>([]);

const form = reactive({
  orgId: '',
  classId: '',
});

const formatClassLabel = (clazz: any) => {
  if (clazz.bindable) {
    return clazz.class_name;
  }
  const owner = String(clazz.counselor_name || '其他班主任').trim();
  return `${clazz.class_name}（已绑定 ${owner}）`;
};

const loadOrgs = async () => {
  try {
    const resp = await getHeadTeacherOrgs();
    if (resp.code === 0) {
      orgList.value = Array.isArray(resp.data) ? resp.data : [];
    }
  } catch (error) {
    console.error('加载班主任可绑定学院失败', error);
  }
};

const loadClasses = async () => {
  if (!form.orgId) {
    classList.value = [];
    return;
  }

  try {
    const resp = await getHeadTeacherClasses(form.orgId);
    if (resp.code === 0) {
      classList.value = Array.isArray(resp.data) ? resp.data : [];
    } else {
      classList.value = [];
      ElMessage.error(resp.message || '加载班级失败');
    }
  } catch (error: any) {
    classList.value = [];
    ElMessage.error(error?.message || '加载班级失败');
  }
};

const syncBindingStatus = async () => {
  try {
    const resp = await getHeadTeacherBindingStatus();
    if (resp.code !== 0 || !resp.data) {
      setHeadTeacherBoundState(false);
      updateStoredRoleScope('head_teacher', null);
      return;
    }

    boundClasses.value = Array.isArray(resp.data.bound_classes) ? resp.data.bound_classes : [];

    if (resp.data.bound_org?.id) {
      form.orgId = String(resp.data.bound_org.id);
      await loadClasses();
    }

    if (resp.data.bound_class?.id) {
      form.classId = String(resp.data.bound_class.id);
    }

    const hasBoundClass = Boolean(resp.data.bound_class?.id);
    setHeadTeacherBoundState(hasBoundClass);
    updateStoredRoleScope('head_teacher', resp.data.bound_class?.id || null);
  } catch (error) {
    console.error('加载班主任绑定状态失败', error);
  }
};

const onOrgChange = async () => {
  form.classId = '';
  await loadClasses();
};

const onBind = async () => {
  if (!form.classId) {
    ElMessage.warning('请选择班级');
    return;
  }

  const selectedClass = classList.value.find((item) => String(item.id) === String(form.classId));
  if (selectedClass && !selectedClass.bindable) {
    ElMessage.warning('该班级已绑定其他班主任，当前无法重复绑定');
    return;
  }

  loading.value = true;
  try {
    const resp = await headTeacherBindClass(form.classId);
    if (resp.code !== 0) {
      ElMessage.error(resp.message || '绑定失败');
      return;
    }

    setHeadTeacherBoundState(true);
    updateStoredRoleScope('head_teacher', form.classId);
    ElMessage.success('绑定成功');
    await syncBindingStatus();
    await router.replace('/teacher-bind-courses');
  } catch (error: any) {
    ElMessage.error(error?.message || '绑定失败');
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await loadOrgs();
  await syncBindingStatus();
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

.bind-alert {
  margin-bottom: 20px;
}

.bind-form {
  max-width: 520px;
}

.form-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}
</style>
