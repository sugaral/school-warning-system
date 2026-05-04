<template>
  <div class="register-page">
    <el-card class="register-card" v-loading="loadingPage">
      <div class="register-header">
        <h2>用户注册</h2>
        <p>支持学生、班干部以及其他开放注册角色。账号可使用邮箱、学号、工号或英文账号。</p>
      </div>

      <el-alert
        v-if="!registerEnabled"
        type="warning"
        :closable="false"
        show-icon
        title="当前系统未开放注册，请联系管理员。"
      />

      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
      >
        <el-form-item label="账号" prop="account">
          <el-input
            v-model.trim="form.account"
            placeholder="请输入邮箱、学号、工号或英文账号"
            @blur="autofillEmailFromAccount"
          />
        </el-form-item>

        <el-form-item label="联系邮箱" prop="email">
          <el-input
            v-model.trim="form.email"
            placeholder="请输入常用邮箱，用于验证码和通知"
          />
        </el-form-item>

        <el-form-item label="姓名" prop="name">
          <el-input v-model.trim="form.name" placeholder="请输入姓名" />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            placeholder="请再次输入密码"
          />
        </el-form-item>

        <el-form-item label="注册角色" prop="role">
          <el-select
            v-model="form.role"
            placeholder="请选择角色"
            style="width: 100%"
            filterable
          >
            <el-option
              v-for="role in allRoles"
              :key="role.code"
              :label="role.name"
              :value="role.code"
            />
          </el-select>
          <div v-if="currentRole" class="role-card">
            <div class="role-name">{{ currentRole.name }}</div>
            <div class="role-desc">{{ currentRole.description || '暂无角色说明' }}</div>
            <div class="role-meta">
              <el-tag size="small" type="info">用户类型：{{ currentRoleUserType }}</el-tag>
              <el-tag size="small" type="warning">数据范围：{{ currentRoleScopeType }}</el-tag>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="action-row">
            <el-button type="primary" :loading="loading" @click="onSubmit">
              注册
            </el-button>
            <el-button @click="goToLogin">返回登录</el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { getRegisterStatus, getRolesForRegister, register } from '../api';

type RegisterRole = {
  code: string;
  name: string;
  description: string;
  userType: string;
  scopeType: string;
};

const router = useRouter();

const loading = ref(false);
const loadingPage = ref(false);
const formRef = ref<FormInstance>();
const registerEnabled = ref(false);
const allRoles = ref<RegisterRole[]>([]);

const form = reactive({
  account: '',
  email: '',
  name: '',
  password: '',
  confirmPassword: '',
  role: '',
});

const currentRole = computed(() => allRoles.value.find((item) => item.code === form.role) || null);

const currentRoleUserType = computed(() => {
  const map: Record<string, string> = {
    admin: '管理员',
    teacher: '教师',
    staff: '职工',
    student: '学生',
  };
  return map[currentRole.value?.userType || ''] || currentRole.value?.userType || '-';
});

const currentRoleScopeType = computed(() => {
  const map: Record<string, string> = {
    system: '全系统',
    school: '全校',
    college: '学院',
    org: '学院',
    class: '班级',
    self: '本人',
  };
  return map[currentRole.value?.scopeType || ''] || currentRole.value?.scopeType || '-';
});

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidNumericAccount = (value: string) => /^\d{6,20}$/.test(value);
const isValidUsernameAccount = (value: string) =>
  /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(value);

const loadRegisterMeta = async () => {
  loadingPage.value = true;
  try {
    const [statusResp, rolesResp] = await Promise.all([
      getRegisterStatus(),
      getRolesForRegister(),
    ]);

    if (statusResp.code !== 0) {
      throw new Error(statusResp.message || '获取注册状态失败');
    }
    registerEnabled.value = statusResp.data?.openRegistration !== false;

    if (rolesResp.code !== 0) {
      throw new Error(rolesResp.message || '获取注册角色失败');
    }

    allRoles.value = Array.isArray(rolesResp.data) ? rolesResp.data : [];
    if (!form.role && allRoles.value.length > 0) {
      form.role = allRoles.value[0].code;
    }
  } catch (error: any) {
    registerEnabled.value = false;
    allRoles.value = [];
    ElMessage.error(error?.message || '加载注册信息失败');
  } finally {
    loadingPage.value = false;
  }
};

const autofillEmailFromAccount = () => {
  const normalizedAccount = String(form.account || '').trim();
  if (!form.email && isValidEmail(normalizedAccount)) {
    form.email = normalizedAccount;
  }
};

const validateAccount = (_rule: any, value: string, callback: (error?: Error) => void) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    callback(new Error('请输入账号'));
    return;
  }

  if (
    !isValidEmail(normalized) &&
    !isValidNumericAccount(normalized) &&
    !isValidUsernameAccount(normalized)
  ) {
    callback(new Error('账号仅支持邮箱、6-20 位数字账号或英文账号'));
    return;
  }

  callback();
};

const validatePassword = (_rule: any, value: string, callback: (error?: Error) => void) => {
  const normalized = String(value || '');
  if (!normalized) {
    callback(new Error('请输入密码'));
    return;
  }
  if (normalized.length < 6) {
    callback(new Error('密码至少 6 位'));
    return;
  }
  callback();
};

const validateConfirmPassword = (_rule: any, value: string, callback: (error?: Error) => void) => {
  if (!value) {
    callback(new Error('请再次输入密码'));
    return;
  }
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'));
    return;
  }
  callback();
};

const rules: FormRules = {
  account: [{ validator: validateAccount, trigger: 'blur' }],
  email: [
    { required: true, message: '请输入联系邮箱', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: (error?: Error) => void) => {
        if (!isValidEmail(String(value || '').trim())) {
          callback(new Error('邮箱格式不正确'));
          return;
        }
        callback();
      },
      trigger: ['blur', 'change'],
    },
  ],
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度需在 2 到 20 个字符之间', trigger: 'blur' },
  ],
  password: [{ validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: 'blur' }],
  role: [{ required: true, message: '请选择注册角色', trigger: 'change' }],
};

const onSubmit = async () => {
  if (!registerEnabled.value) {
    ElMessage.warning('当前系统未开放注册');
    return;
  }

  autofillEmailFromAccount();
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  const role = currentRole.value;
  if (!role) {
    ElMessage.error('当前角色无效，请重新选择');
    return;
  }

  loading.value = true;
  try {
    const resp = await register({
      account: form.account.trim(),
      email: form.email.trim(),
      password: form.password,
      name: form.name.trim(),
      user_type: role.userType,
      role: role.code,
      scope_type: role.scopeType,
    });

    if (resp.code !== 0) {
      throw new Error(resp.message || '注册失败');
    }

    ElMessage.success('注册成功，请返回登录');
    router.push('/login');
  } catch (error: any) {
    ElMessage.error(error?.message || '注册失败');
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => {
  router.push('/login');
};

onMounted(() => {
  loadRegisterMeta();
});
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top, rgba(250, 204, 21, 0.18), transparent 34%),
    linear-gradient(140deg, #fff7ed 0%, #f8fafc 48%, #e0f2fe 100%);
}

.register-card {
  width: 520px;
  border-radius: 18px;
}

.register-header {
  margin-bottom: 20px;
}

.register-header h2 {
  margin: 0 0 8px;
  color: #111827;
}

.register-header p {
  margin: 0;
  color: #6b7280;
  line-height: 1.6;
}

.role-card {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.16);
  backdrop-filter: blur(14px);
}

.role-name {
  font-weight: 600;
  color: #111827;
}

.role-desc {
  margin-top: 6px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}

.role-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.action-row {
  display: flex;
  gap: 12px;
}

@media (max-width: 640px) {
  .register-card {
    width: 100%;
  }

  .action-row {
    width: 100%;
    flex-direction: column;
  }
}
</style>
