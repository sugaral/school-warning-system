<template>
  <div class="two-factor-page">
    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <div>
            <div class="page-title">2FA 管理</div>
            <div class="page-subtitle">维护后台登录的邮箱验证码与图形验证码策略</div>
          </div>
          <div class="header-actions">
            <el-button @click="reloadConfig">重新加载</el-button>
            <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
          </div>
        </div>
      </template>

      <el-alert
        title="短信二次验证暂未接入真实登录链路，当前建议使用邮箱验证码。"
        type="warning"
        :closable="false"
        show-icon
        class="page-alert"
      />

      <el-alert
        v-if="config.security.secondFactorMode === 'email' && !emailServiceReady"
        title="当前已启用邮箱二次验证，但邮箱服务尚未配置完整，请先在系统配置中完成 SMTP 设置。"
        type="error"
        :closable="false"
        show-icon
        class="page-alert"
      />

      <el-alert
        v-else
        title="当前后台登录流程为：账号密码校验 -> 邮箱验证码校验 -> 完成登录。"
        type="success"
        :closable="false"
        show-icon
        class="page-alert"
      />

      <el-form :model="config.security" label-width="190px">
        <el-divider content-position="left">二次验证</el-divider>

        <el-form-item label="验证模式">
          <el-select v-model="config.security.secondFactorMode" style="width: 320px">
            <el-option label="关闭" value="none" />
            <el-option label="邮箱验证码" value="email" />
            <el-option label="短信验证码（待接入）" value="sms" disabled />
            <el-option label="邮箱 + 短信双重验证（待接入）" value="email_sms" disabled />
          </el-select>
          <span class="help-text">当前生产环境推荐使用邮箱验证码。</span>
        </el-form-item>

        <el-form-item label="验证码有效期（秒）">
          <el-input-number
            v-model="config.security.emailCodeExpireSeconds"
            :min="60"
            :max="1800"
          />
          <span class="help-text">
            邮件模板中可使用 <code>{expire_minutes}</code> 和 <code>{expire_seconds}</code>。
          </span>
        </el-form-item>

        <el-form-item label="发送冷却时间（秒）">
          <el-input-number
            v-model="config.security.emailCodeCooldownSeconds"
            :min="30"
            :max="600"
          />
          <span class="help-text">限制同一账号重新发送验证码的最短间隔。</span>
        </el-form-item>

        <el-form-item label="当前状态">
          <div class="status-row">
            <el-tag :type="config.security.secondFactorMode === 'none' ? 'info' : 'success'">
              {{ config.security.secondFactorMode === 'none' ? '未启用' : '已启用' }}
            </el-tag>
            <el-tag :type="emailServiceReady ? 'success' : 'warning'">
              邮件服务{{ emailServiceReady ? '已就绪' : '未就绪' }}
            </el-tag>
            <el-button link type="primary" @click="goToSystemConfig">前往系统配置</el-button>
          </div>
        </el-form-item>

        <el-divider content-position="left">图形验证码</el-divider>

        <el-form-item label="启用图形验证码">
          <el-switch v-model="config.security.loginCaptchaEnabled" />
          <span class="help-text">登录前需要先完成图形验证码校验。</span>
        </el-form-item>

        <el-form-item label="验证码长度">
          <el-input-number v-model="config.security.captchaLength" :min="4" :max="6" />
        </el-form-item>

        <el-form-item label="图形码有效期（秒）">
          <el-input-number
            v-model="config.security.captchaExpireSeconds"
            :min="60"
            :max="900"
          />
        </el-form-item>

        <el-form-item label="刷新上限（次数）">
          <el-input-number
            v-model="config.security.captchaRefreshLimit"
            :min="1"
            :max="200"
          />
          <span class="help-text">限制单个 IP 在统计窗口内可生成图形验证码的次数。</span>
        </el-form-item>

        <el-form-item label="刷新统计窗口（秒）">
          <el-input-number
            v-model="config.security.captchaRefreshWindowSeconds"
            :min="10"
            :max="3600"
          />
          <span class="help-text">超过刷新上限后，需要等待这个时间窗口结束。</span>
        </el-form-item>

        <el-form-item label="最大输错次数">
          <el-input-number
            v-model="config.security.captchaMaxVerifyAttempts"
            :min="1"
            :max="20"
          />
          <span class="help-text">达到上限后当前图形验证码将失效，需要重新获取。</span>
        </el-form-item>

        <el-form-item label="验证码预览">
          <div class="captcha-preview-card">
            <div v-if="config.security.loginCaptchaEnabled" class="captcha-preview-content">
              <button
                type="button"
                class="captcha-preview-button"
                :disabled="captchaLoading"
                @click="loadCaptchaPreview"
              >
                <img
                  v-if="captchaPreview.image"
                  :src="captchaPreview.image"
                  alt="captcha preview"
                  class="captcha-preview-image"
                />
                <span v-else>{{ captchaLoading ? '加载中...' : '点击生成预览' }}</span>
              </button>
              <div class="captcha-preview-meta">
                <div>预览基于系统当前实时配置生成。</div>
                <div>有效期：{{ captchaPreview.expireSeconds || config.security.captchaExpireSeconds }} 秒</div>
                <div>
                  刷新限制：{{ config.security.captchaRefreshWindowSeconds }} 秒内最多
                  {{ config.security.captchaRefreshLimit }} 次
                </div>
                <div>允许输错：单个验证码最多 {{ config.security.captchaMaxVerifyAttempts }} 次</div>
                <div class="muted-text">修改相关配置后请先保存，再重新生成预览查看效果。</div>
              </div>
            </div>
            <div v-else class="muted-text">已关闭图形验证码，登录页将不再展示图形验证码。</div>
          </div>
        </el-form-item>

        <el-divider content-position="left">流程说明</el-divider>

        <div class="flow-card">
          <div class="flow-step">
            <span class="flow-index">1</span>
            <div>
              <div class="flow-title">账号密码校验</div>
              <div class="flow-desc">先确认账号和密码正确，再允许发送邮箱验证码。</div>
            </div>
          </div>

          <div class="flow-step">
            <span class="flow-index">2</span>
            <div>
              <div class="flow-title">发送并校验邮箱验证码</div>
              <div class="flow-desc">验证码校验成功后，系统才会放行最终登录。</div>
            </div>
          </div>

          <div class="flow-step">
            <span class="flow-index">3</span>
            <div>
              <div class="flow-title">完成登录</div>
              <div class="flow-desc">登录页会自动保留冷却倒计时，切换页面后返回也不会清零。</div>
            </div>
          </div>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, getLoginCaptcha } from '../../api';

const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const captchaLoading = ref(false);

const createDefaultConfig = () => ({
  security: {
    enable2FA: true,
    secondFactorMode: 'email',
    loginCaptchaEnabled: true,
    captchaLength: 4,
    captchaExpireSeconds: 300,
    captchaRefreshLimit: 10,
    captchaRefreshWindowSeconds: 60,
    captchaMaxVerifyAttempts: 5,
    emailCodeExpireSeconds: 300,
    emailCodeCooldownSeconds: 60,
  },
  email: {
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    enabled: true,
  },
});

const config = ref(createDefaultConfig());
const captchaPreview = reactive({
  id: '',
  image: '',
  expireSeconds: 0,
});

const emailServiceReady = computed(() => {
  const email = config.value.email || {};
  return Boolean(
    email.enabled !== false &&
      email.smtpHost &&
      email.smtpPort &&
      email.smtpUser &&
      email.smtpPass &&
      (email.smtpFrom || email.smtpUser),
  );
});

const mergeConfig = (incoming: Record<string, any> = {}) => {
  const defaults = createDefaultConfig();
  const incomingSecurity = incoming.security || {};
  const secondFactorMode =
    incomingSecurity.secondFactorMode ||
    (incomingSecurity.enable2FA ? 'email' : 'none');

  return {
    ...defaults,
    ...incoming,
    security: {
      ...defaults.security,
      ...incomingSecurity,
      secondFactorMode,
      enable2FA: secondFactorMode !== 'none',
    },
    email: {
      ...defaults.email,
      ...(incoming.email || incoming.notification || {}),
    },
  };
};

const clearCaptchaPreview = () => {
  captchaPreview.id = '';
  captchaPreview.image = '';
  captchaPreview.expireSeconds = 0;
};

const loadCaptchaPreview = async () => {
  if (!config.value.security.loginCaptchaEnabled) {
    clearCaptchaPreview();
    return;
  }

  captchaLoading.value = true;
  try {
    const resp = await getLoginCaptcha();
    if (resp.code !== 0) {
      throw new Error(resp.message || '获取图形验证码预览失败');
    }
    captchaPreview.id = resp.data.captchaId;
    captchaPreview.image = resp.data.image;
    captchaPreview.expireSeconds = Number(resp.data.expireSeconds || 0);
  } catch (error: any) {
    ElMessage.error(error?.message || '获取图形验证码预览失败');
  } finally {
    captchaLoading.value = false;
  }
};

const fetchConfig = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/config');
    config.value = mergeConfig(response.data?.data || {});
    if (config.value.security.loginCaptchaEnabled) {
      await loadCaptchaPreview();
    } else {
      clearCaptchaPreview();
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取 2FA 配置失败');
  } finally {
    loading.value = false;
  }
};

const saveConfig = async () => {
  saving.value = true;
  try {
    if (
      config.value.security.secondFactorMode === 'sms' ||
      config.value.security.secondFactorMode === 'email_sms'
    ) {
      throw new Error('短信二次验证暂未接入真实登录服务，请改为邮箱验证码或关闭 2FA');
    }

    const securityPayload = {
      ...config.value.security,
      enable2FA: config.value.security.secondFactorMode !== 'none',
    };

    await api.post('/admin/config', {
      security: securityPayload,
    });
    config.value.security = securityPayload;
    ElMessage.success('2FA 配置已保存');

    if (config.value.security.loginCaptchaEnabled) {
      await loadCaptchaPreview();
    } else {
      clearCaptchaPreview();
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存 2FA 配置失败');
  } finally {
    saving.value = false;
  }
};

const reloadConfig = async () => {
  await fetchConfig();
  ElMessage.success('2FA 配置已重新加载');
};

const goToSystemConfig = () => {
  router.push({
    path: '/system-management',
    query: { tab: 'config' },
  });
};

onMounted(() => {
  fetchConfig();
});
</script>

<style scoped>
.two-factor-page {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
}

.page-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: #6b7280;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.page-alert {
  margin-bottom: 16px;
}

.help-text {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.captcha-preview-card {
  width: 100%;
  padding: 18px;
  border: 1px solid rgba(107, 140, 158, 0.16);
  border-radius: 18px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.66),
    rgba(247, 251, 252, 0.42)
  );
  box-shadow: 0 18px 40px rgba(34, 59, 78, 0.08);
  backdrop-filter: blur(18px);
}

.captcha-preview-content {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
}

.captcha-preview-button {
  width: 220px;
  min-height: 90px;
  border: 1px dashed rgba(107, 140, 158, 0.28);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48);
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
  color: #334155;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.captcha-preview-button:hover:not(:disabled) {
  border-color: rgba(15, 118, 110, 0.26);
  background: rgba(255, 255, 255, 0.76);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.56),
    0 12px 28px rgba(34, 59, 78, 0.08);
  transform: translateY(-1px);
}

.captcha-preview-button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.captcha-preview-image {
  max-width: 100%;
  display: block;
}

.captcha-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #334155;
  line-height: 1.6;
}

.muted-text {
  color: #64748b;
}

.flow-card {
  display: grid;
  gap: 14px;
}

.flow-step {
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.48);
  border: 1px solid rgba(107, 140, 158, 0.16);
  backdrop-filter: blur(14px);
}

.flow-index {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #1d4ed8;
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.flow-title {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
}

.flow-desc {
  margin-top: 6px;
  color: #475569;
  line-height: 1.6;
}
</style>
