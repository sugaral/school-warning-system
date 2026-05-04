<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2>通知策略</h2>
        <p>配置学院预警触发后通知谁、何时通知，以及使用哪些渠道发送。</p>
      </div>
      <el-button @click="loadStrategy" :loading="loading">刷新</el-button>
    </div>

    <el-alert
      title="配置说明"
      type="info"
      :closable="false"
      description="启用后，至少要选择一个通知时机、一个通知对象和一个通知渠道，避免保存后策略无法真正触发。"
      style="margin-bottom: 20px"
    />

    <el-card v-loading="loading">
      <el-form ref="formRef" :model="notificationStrategy" :rules="rules" label-width="140px">
        <el-form-item label="启用自动通知" prop="enabled">
          <el-switch v-model="notificationStrategy.enabled" />
        </el-form-item>

        <template v-if="notificationStrategy.enabled">
          <el-divider content-position="left">通知时机</el-divider>
          <el-form-item label="触发时机" prop="triggerModes">
            <el-checkbox-group v-model="triggerModes">
              <el-checkbox value="create">生成预警时</el-checkbox>
              <el-checkbox value="upgrade">预警升级时</el-checkbox>
              <el-checkbox value="close">预警关闭时</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <el-divider content-position="left">通知对象</el-divider>
          <el-form-item label="通知对象" prop="targetModes">
            <el-checkbox-group v-model="targetModes">
              <el-checkbox value="student">学生本人</el-checkbox>
              <el-checkbox value="headTeacher">班主任</el-checkbox>
              <el-checkbox value="counselor">辅导员</el-checkbox>
              <el-checkbox value="parents">家长</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <el-divider content-position="left">通知渠道</el-divider>
          <el-form-item label="发送渠道" prop="channels">
            <el-checkbox-group v-model="notificationStrategy.channels">
              <el-checkbox value="email">邮件</el-checkbox>
              <el-checkbox value="sms">短信</el-checkbox>
              <el-checkbox value="wechat">微信</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </template>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveStrategy">保存策略</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { getStudentAdminNotificationStrategy, setStudentAdminNotificationStrategy } from '../../api';

const loading = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();

const notificationStrategy = reactive({
  enabled: true,
  notifyOnCreate: true,
  notifyOnUpgrade: true,
  notifyOnClose: false,
  notifyStudent: true,
  notifyHeadTeacher: true,
  notifyCounselor: true,
  notifyParents: false,
  channels: ['email'] as string[],
});

const triggerModes = computed({
  get: () => {
    const values: string[] = [];
    if (notificationStrategy.notifyOnCreate) values.push('create');
    if (notificationStrategy.notifyOnUpgrade) values.push('upgrade');
    if (notificationStrategy.notifyOnClose) values.push('close');
    return values;
  },
  set: (values: string[]) => {
    const normalized = Array.isArray(values) ? values : [];
    notificationStrategy.notifyOnCreate = normalized.includes('create');
    notificationStrategy.notifyOnUpgrade = normalized.includes('upgrade');
    notificationStrategy.notifyOnClose = normalized.includes('close');
  },
});

const targetModes = computed({
  get: () => {
    const values: string[] = [];
    if (notificationStrategy.notifyStudent) values.push('student');
    if (notificationStrategy.notifyHeadTeacher) values.push('headTeacher');
    if (notificationStrategy.notifyCounselor) values.push('counselor');
    if (notificationStrategy.notifyParents) values.push('parents');
    return values;
  },
  set: (values: string[]) => {
    const normalized = Array.isArray(values) ? values : [];
    notificationStrategy.notifyStudent = normalized.includes('student');
    notificationStrategy.notifyHeadTeacher = normalized.includes('headTeacher');
    notificationStrategy.notifyCounselor = normalized.includes('counselor');
    notificationStrategy.notifyParents = normalized.includes('parents');
  },
});

const validateTriggerModes = (_rule: any, _value: any, callback: (error?: Error) => void) => {
  if (!notificationStrategy.enabled || triggerModes.value.length > 0) {
    callback();
    return;
  }
  callback(new Error('请至少选择一个通知时机'));
};

const validateTargetModes = (_rule: any, _value: any, callback: (error?: Error) => void) => {
  if (!notificationStrategy.enabled || targetModes.value.length > 0) {
    callback();
    return;
  }
  callback(new Error('请至少选择一个通知对象'));
};

const validateChannels = (_rule: any, value: string[], callback: (error?: Error) => void) => {
  if (!notificationStrategy.enabled || (Array.isArray(value) && value.length > 0)) {
    callback();
    return;
  }
  callback(new Error('请至少选择一个通知渠道'));
};

const rules: FormRules = {
  triggerModes: [{ validator: validateTriggerModes, trigger: 'change' }],
  targetModes: [{ validator: validateTargetModes, trigger: 'change' }],
  channels: [{ validator: validateChannels, trigger: 'change' }],
};

const loadStrategy = async () => {
  loading.value = true;
  try {
    const response = await getStudentAdminNotificationStrategy();
    if (response.code !== 0) {
      throw new Error(response.message || '加载通知策略失败');
    }

    Object.assign(notificationStrategy, {
      enabled: response.data?.enabled ?? true,
      notifyOnCreate: response.data?.notifyOnCreate ?? true,
      notifyOnUpgrade: response.data?.notifyOnUpgrade ?? true,
      notifyOnClose: response.data?.notifyOnClose ?? false,
      notifyStudent: response.data?.notifyStudent ?? true,
      notifyHeadTeacher: response.data?.notifyHeadTeacher ?? true,
      notifyCounselor: response.data?.notifyCounselor ?? true,
      notifyParents: response.data?.notifyParents ?? false,
      channels: Array.isArray(response.data?.channels) ? response.data.channels : ['email'],
    });
  } catch (error: any) {
    ElMessage.error(error?.message || '加载通知策略失败');
  } finally {
    loading.value = false;
  }
};

const saveStrategy = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  saving.value = true;
  try {
    const response = await setStudentAdminNotificationStrategy({ ...notificationStrategy });
    if (response.code !== 0) {
      throw new Error(response.message || '保存失败');
    }
    ElMessage.success('通知策略已保存');
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  loadStrategy();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0 0 8px;
}

.page-header p {
  margin: 0;
  color: #606266;
  line-height: 1.6;
}
</style>
