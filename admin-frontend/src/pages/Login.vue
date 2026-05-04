<template>
  <div
    class="judge-shell"
    :class="[
      layoutModeClass,
      {
        'is-booting': loginBooting,
        'is-boot-complete': loginBootComplete,
        'is-feature-frozen': featureSlotsFrozen,
        'is-seeding': loginSeeding,
        'is-activating': loginActivating,
        'is-login-ready': loginReady,
      },
    ]"
  >
    <div class="aurora aurora--left" aria-hidden="true"></div>
    <div class="aurora aurora--right" aria-hidden="true"></div>
    <div class="aurora aurora--bottom" aria-hidden="true"></div>
    <div class="beam beam--a" aria-hidden="true"></div>
    <div class="beam beam--b" aria-hidden="true"></div>
    <div class="grid-haze" aria-hidden="true"></div>

    <main class="judge-stage" :style="orbitLayoutStyle">
      <div class="stage-badge">WARNSYS / STARTUP CONSOLE</div>

      <section ref="featureCloudRef" class="feature-cloud" aria-label="系统特点展示">
        <article
          v-for="item in orbitHighlights"
          :key="item.index"
          class="feature-slot"
          :class="`feature-slot--${item.position}`"
          :style="item.style"
          aria-hidden="true"
        >
          <section class="feature-card">
            <span class="feature-card__index">{{ item.index }}</span>
            <span class="feature-card__eyebrow">{{ item.eyebrow }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <span class="feature-card__tag">{{ item.tag }}</span>
          </section>
        </article>
      </section>

      <section class="center-stage">
        <section ref="loginCardRef" class="login-card">
          <div class="seed-frame" aria-hidden="true"></div>
          <div class="scan-beam" aria-hidden="true"></div>

          <div class="preflight-panel">
            <div class="preflight-panel__intro">
              <p class="preflight-panel__eyebrow">SYSTEM BOOT</p>
              <h1>学业预警系统</h1>
              <p class="preflight-panel__copy">
                统一连接预警识别、审批处置、通知触达与审计留痕，构成一体化学业风险治理闭环。
              </p>
            </div>

            <div class="preflight-status">
              <span v-for="item in preflightStatusItems" :key="item">{{ item }}</span>
            </div>

            <div class="preflight-panel__footer">
              <p class="preflight-note">
                从风险识别到审批处置，所有关键流程都在同一控制台内连续完成。
              </p>
              <button
                ref="activateButtonRef"
                class="activate-button"
                type="button"
                :disabled="loginActivating || loginReady"
                @click="activateLogin"
              >
                立即使用
              </button>
            </div>
          </div>

          <div class="login-core">
            <div class="login-header form-fragment frag-1">
              <p class="eyebrow">WARNSYS ADMIN</p>
              <h2>账号登录</h2>
              <p class="login-desc">
                仅支持账号登录，不支持邮箱直接登录。学生请填写学号；如启用二次验证，
                还需完成图形验证码或邮箱验证码校验。
              </p>
            </div>

            <form class="login-form" autocomplete="on" @submit.prevent="onSubmit">
              <div class="login-layout-grid">
                <section class="login-main-panel form-fragment frag-2">
                  <label class="form-item">
                    <span>账号</span>
                    <input
                      ref="accountInputRef"
                      v-model.trim="form.account"
                      name="username"
                      autocomplete="username"
                      type="text"
                      placeholder="请输入学号"
                      @input="handleAccountChange"
                    />
                  </label>

                  <label class="form-item">
                    <span>密码</span>
                    <input
                      v-model="form.password"
                      name="current-password"
                      autocomplete="current-password"
                      type="password"
                      placeholder="请输入密码"
                      @input="handlePasswordChange"
                    />
                  </label>

                  <div class="remember-row">
                    <label class="remember-check">
                      <input
                        v-model="rememberPassword"
                        type="checkbox"
                        @change="handleRememberPasswordChange"
                      />
                      <span>记住密码</span>
                    </label>
                  </div>
                </section>

                <section
                  v-if="showSmsWarning || security.captchaEnabled || requiresEmailCode"
                  class="verify-panel form-fragment frag-3"
                >
                  <div v-if="showSmsWarning" class="login-alert login-alert--danger">
                    当前系统启用了短信类二次验证，但登录页暂不支持短信登录校验，请先在系统配置中改为邮箱验证或关闭二次验证。
                  </div>
                  <div
                    v-else-if="requiresEmailCode && !security.emailServiceReady"
                    class="login-alert login-alert--warning"
                  >
                    当前已启用邮箱二次验证，但邮箱服务未配置完整，请先完善 SMTP 配置。
                  </div>

                  <label v-if="security.captchaEnabled" class="form-item">
                    <span>图形码</span>
                    <div class="verify-row">
                      <input
                        v-model.trim="form.captcha_code"
                        maxlength="6"
                        placeholder="请输入图形验证码"
                      />
                      <button
                        type="button"
                        class="captcha-button"
                        :disabled="captchaLoading"
                        @click="refreshCaptcha"
                      >
                        <img
                          v-if="captcha.image"
                          :src="captcha.image"
                          alt="captcha"
                          class="captcha-image"
                        />
                        <span v-else>{{ captchaLoading ? '加载中...' : '刷新验证码' }}</span>
                      </button>
                    </div>
                  </label>

                  <label v-if="requiresEmailCode" class="form-item">
                    <span>邮箱验证码</span>
                    <div class="verify-stack">
                      <div class="verify-row">
                        <input
                          v-model.trim="form.emailCode"
                          maxlength="6"
                          placeholder="请输入邮箱验证码"
                          @input="resetEmailTicketOnly"
                        />
                        <button
                          type="button"
                          class="secondary-button"
                          :disabled="countdown > 0 || !canSendCode || sendingCode"
                          @click="onSendCode"
                        >
                          {{ sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码' }}
                        </button>
                      </div>
                      <div class="verify-status">
                        <span class="verify-hint">{{ emailStatusText }}</span>
                      </div>
                    </div>
                  </label>
                </section>
              </div>

              <div class="action-block form-fragment frag-4">
                <div class="action-row">
                  <button
                    class="primary-button"
                    type="submit"
                    :disabled="loading || securityLoading || showSmsWarning || (requiresEmailCode && !security.emailServiceReady)"
                  >
                    {{ loading || securityLoading ? '登录中...' : '登录' }}
                  </button>
                  <button v-if="registerEnabled" class="ghost-button" type="button" @click="goToRegister">注册</button>
                </div>
                <button type="button" class="link-button" @click="openRecoveryDialog">
                  无法登录？点这里找回密码
                </button>
              </div>
            </form>
          </div>
        </section>
      </section>
    </main>


    <el-dialog v-model="recovery.visible" title="找回密码" width="680px">
      <div class="recovery-body">
        <p class="recovery-intro">
          先输入账号（学号），系统会检测该账号当前可用的找回方式。验证码只会发送到账号已绑定的邮箱或手机号。
        </p>

        <el-form label-width="96px" @submit.prevent>
          <el-form-item label="账号">
            <div class="recovery-inline">
              <el-input
                v-model.trim="recovery.account"
                placeholder="请输入学号"
                @input="handleRecoveryAccountChange"
              />
              <el-button
                type="primary"
                :loading="recovery.optionsLoading"
                @click="loadRecoveryOptions()"
              >
                查询方式
              </el-button>
            </div>
          </el-form-item>
        </el-form>

        <el-alert
          v-if="recovery.queryError"
          :title="recovery.queryError"
          type="error"
          :closable="false"
          show-icon
          class="login-alert"
        />

        <div v-if="recovery.optionsLoaded" class="channel-grid">
          <button
            type="button"
            class="channel-card"
            :class="{
              active: recovery.selectedChannel === 'email',
              disabled: !recovery.email.bound || !recovery.email.enabled,
            }"
            :disabled="!recovery.email.bound"
            @click="selectRecoveryChannel('email')"
          >
            <div class="channel-title">邮箱找回</div>
            <div class="channel-value">{{ recovery.email.masked || '未绑定邮箱' }}</div>
            <p>
              {{
                recovery.email.bound
                  ? recovery.email.enabled
                    ? '通过邮箱验证码重置密码'
                    : recovery.email.reason || '当前不可用'
                  : '当前账号未绑定邮箱'
              }}
            </p>
          </button>

          <button
            type="button"
            class="channel-card"
            :class="{
              active: recovery.selectedChannel === 'sms',
              disabled: !recovery.sms.bound || !recovery.sms.enabled,
            }"
            :disabled="!recovery.sms.bound"
            @click="selectRecoveryChannel('sms')"
          >
            <div class="channel-title">短信找回</div>
            <div class="channel-value">{{ recovery.sms.masked || '未绑定手机号' }}</div>
            <p>
              {{
                recovery.sms.bound
                  ? recovery.sms.enabled
                    ? '通过短信验证码重置密码'
                    : recovery.sms.reason || '当前不可用'
                  : '当前账号未绑定手机号'
              }}
            </p>
          </button>
        </div>

        <el-alert
          v-if="recovery.optionsLoaded && selectedRecoveryChannelState.bound && !selectedRecoveryChannelState.enabled"
          :title="selectedRecoveryChannelState.reason || '当前找回方式不可用'"
          type="warning"
          :closable="false"
          show-icon
          class="login-alert"
        />
        <el-alert
          v-if="recovery.optionsLoaded && !hasAnyRecoveryChannel"
          title="当前账号未绑定可用邮箱或手机号，暂时无法使用找回密码功能。"
          type="info"
          :closable="false"
          show-icon
          class="login-alert"
        />

        <template
          v-if="recovery.optionsLoaded && recovery.selectedChannel === 'email' && recovery.email.bound"
        >
          <el-divider content-position="left">邮箱验证</el-divider>
          <el-form label-width="96px" @submit.prevent>
            <el-form-item label="绑定邮箱">
              <div class="recovery-static">{{ recovery.email.masked || '-' }}</div>
            </el-form-item>
            <el-form-item label="完整邮箱">
              <el-input
                v-model.trim="recovery.emailInput"
                placeholder="请输入完整绑定邮箱"
                @input="handleRecoveryEmailInput"
              />
            </el-form-item>
            <el-form-item label="邮箱验证码">
              <div class="verify-stack">
                <div class="recovery-inline">
                  <el-input
                    v-model.trim="recovery.emailCode"
                    maxlength="6"
                    placeholder="请输入邮箱验证码"
                    @input="handleRecoveryCodeInput"
                  />
                  <el-button
                    type="primary"
                    plain
                    :loading="recovery.sending"
                    :disabled="recovery.countdown > 0 || !canSendRecoveryCode"
                    @click="onSendRecoveryCode"
                  >
                    {{ recovery.countdown > 0 ? `${recovery.countdown}s` : '发送验证码' }}
                  </el-button>
                </div>
                <div class="verify-status">
                  <span class="verify-hint">{{ recoveryStatusDisplayText }}</span>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="新密码">
              <el-input
                v-model="recovery.newPassword"
                type="password"
                show-password
                placeholder="不少于 8 位，建议包含字母、数字或符号"
              />
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input
                v-model="recovery.confirmPassword"
                type="password"
                show-password
                placeholder="请再次输入新密码"
                @keyup.enter="onResetPassword"
              />
            </el-form-item>
          </el-form>
        </template>

        <template
          v-if="recovery.optionsLoaded && recovery.selectedChannel === 'sms' && recovery.sms.bound"
        >
          <el-divider content-position="left">短信验证</el-divider>
          <el-form label-width="96px" @submit.prevent>
            <el-form-item label="绑定手机">
              <div class="recovery-static">{{ recovery.sms.masked || '-' }}</div>
            </el-form-item>
            <el-form-item label="完整手机">
              <el-input
                v-model.trim="recovery.smsInput"
                maxlength="11"
                placeholder="请输入完整绑定手机号"
                @input="handleRecoverySmsInput"
              />
            </el-form-item>
            <el-form-item label="短信验证码">
              <div class="verify-stack">
                <div class="recovery-inline">
                  <el-input
                    v-model.trim="recovery.smsCode"
                    maxlength="6"
                    placeholder="请输入短信验证码"
                    @input="handleRecoveryCodeInput"
                  />
                  <el-button
                    type="primary"
                    plain
                    :loading="recovery.sending"
                    :disabled="recovery.countdown > 0 || !canSendRecoveryCode"
                    @click="onSendRecoveryCode"
                  >
                    {{ recovery.countdown > 0 ? `${recovery.countdown}s` : '发送验证码' }}
                  </el-button>
                </div>
                <div class="verify-status">
                  <span class="verify-hint">{{ recoveryStatusDisplayText }}</span>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="新密码">
              <el-input
                v-model="recovery.newPassword"
                type="password"
                show-password
                placeholder="不少于 8 位，建议包含字母、数字或符号"
              />
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input
                v-model="recovery.confirmPassword"
                type="password"
                show-password
                placeholder="请再次输入新密码"
                @keyup.enter="onResetPassword"
              />
            </el-form-item>
          </el-form>
        </template>
      </div>

      <template #footer>
        <el-button @click="recovery.visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="recovery.resetting"
          :disabled="!canSubmitRecovery"
          @click="onResetPassword"
        >
          提交重置
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  api,
  getLoginCaptcha,
  getLoginSecurityConfig,
  getPasswordRecoveryOptions,
  getRegisterStatus,
  getTeacherBindingStatus,
  loginAdmin,
  resetPasswordByChannel,
  sendAdminLoginCode,
  sendPasswordRecoveryEmailCode,
  sendPasswordRecoverySmsCode,
  verifyCode,
} from '../api';
import {
  clearBindingStateCache,
  setHeadTeacherBoundState,
  setStudentAdminBoundState,
  setStudentBoundState,
  setTeacherBindingState,
} from '../lib/binding';

type SecondFactorMode = 'none' | 'email' | 'sms' | 'email_sms';
type RecoveryChannelType = 'email' | 'sms';

type RecoveryChannelState = {
  bound: boolean;
  masked: string;
  enabled: boolean;
  reason: string;
};

type PersistedRecoveryChallenge = {
  challengeId: string;
  target: string;
  account: string;
  channel: RecoveryChannelType;
  email?: string;
  mobile?: string;
  cooldownUntil: number;
  expireAt: number;
};

type OrbitHighlight = {
  index: string;
  position:
    | 'top-left'
    | 'top'
    | 'top-right'
    | 'middle-left'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom'
    | 'bottom-right';
  eyebrow: string;
  title: string;
  description: string;
  tag: string;
  style: string;
};

const router = useRouter();
const LOGIN_EMAIL_CHALLENGE_KEY = 'admin_login_email_challenge';
const LOGIN_PROMPT_SESSION_KEY = 'admin_login_prompt';
const PASSWORD_RESET_RECOVERY_CHALLENGE_KEY = 'admin_password_reset_recovery_challenge';
const REMEMBER_PASSWORD_PREFERENCE_KEY = 'admin_login_remember_password_enabled';
const REMEMBERED_ACCOUNT_KEY = 'admin_login_remembered_account';
const REMEMBERED_PASSWORD_KEY = 'admin_login_remembered_password';

const loading = ref(false);
const sendingCode = ref(false);
const captchaLoading = ref(false);
const securityLoading = ref(false);
const registerEnabled = ref(false);
const countdown = ref(0);
const rememberPassword = ref(false);
const featureCloudRef = ref<HTMLElement | null>(null);
const loginCardRef = ref<any>(null);
const activateButtonRef = ref<HTMLButtonElement | null>(null);
const accountInputRef = ref<any>(null);
const loginBooting = ref(false);
const loginBootComplete = ref(false);
const featureSlotsFrozen = ref(false);
const featureCloudFrozen = ref(false);
const loginSeeding = ref(false);
const loginReady = ref(false);
const loginActivating = ref(false);
const viewportWidth = ref(
  typeof window !== 'undefined' ? window.innerWidth : 1440,
);
const viewportHeight = ref(
  typeof window !== 'undefined' ? window.innerHeight : 960,
);

let countdownTimer: ReturnType<typeof setInterval> | null = null;
let recoveryCountdownTimer: ReturnType<typeof setInterval> | null = null;
let loginActivationTimer: ReturnType<typeof setTimeout> | null = null;
let loginBootTimer: ReturnType<typeof setTimeout> | null = null;

const security = reactive({
  secondFactorMode: 'none' as SecondFactorMode,
  captchaEnabled: false,
  captchaLength: 4,
  captchaExpireSeconds: 300,
  captchaRefreshLimit: 10,
  captchaRefreshWindowSeconds: 60,
  captchaMaxVerifyAttempts: 5,
  emailCodeExpireSeconds: 300,
  emailCodeCooldownSeconds: 60,
  emailServiceReady: false,
  smsServiceReady: false,
});

const captcha = reactive({
  id: '',
  image: '',
});

const form = reactive({
  account: '',
  password: '',
  captcha_code: '',
  emailCode: '',
  emailChallengeId: '',
  emailChallengeTarget: '',
  email_ticket: '',
});

const orbitHighlights: OrbitHighlight[] = [
  {
    index: '01',
    position: 'top-left',
    eyebrow: 'Warning Hub',
    title: '预警中心',
    description: '课堂、成绩、行为信号统一汇聚，风险变化在一个入口里完成识别。',
    tag: 'Unified warning desk',
    style: '--orbit-angle: -135deg; --delay: 0.10s; --scatter-x: -420px; --scatter-y: -260px; --scatter-rotate: -14deg;',
  },
  {
    index: '02',
    position: 'top',
    eyebrow: 'Approval Center',
    title: '审批中心',
    description: '审批流集中在一条主线，评委一眼就能理解系统闭环。',
    tag: 'Single approval queue',
    style: '--orbit-angle: -90deg; --delay: 0.22s; --scatter-x: 0px; --scatter-y: -330px; --scatter-rotate: -5deg;',
  },
  {
    index: '03',
    position: 'top-right',
    eyebrow: 'Notify Ready',
    title: '通知能力',
    description: '邮件、短信、二次验证与提醒链路都预留了自然扩展位。',
    tag: 'Email + SMS ready',
    style: '--orbit-angle: -45deg; --delay: 0.34s; --scatter-x: 420px; --scatter-y: -260px; --scatter-rotate: 14deg;',
  },
  {
    index: '04',
    position: 'middle-left',
    eyebrow: 'Feedback Loop',
    title: '反馈闭环',
    description: '问题提交、认领、跟进与回执形成可追踪的后台链路。',
    tag: 'Claim and track',
    style: '--orbit-angle: 180deg; --delay: 0.46s; --scatter-x: -500px; --scatter-y: -24px; --scatter-rotate: -16deg;',
  },
  {
    index: '05',
    position: 'middle-right',
    eyebrow: 'Config Layer',
    title: '配置扩展',
    description: '通知、规则、模板、找回密码都能继续模块化接入。',
    tag: 'Configurable modules',
    style: '--orbit-angle: 0deg; --delay: 0.58s; --scatter-x: 500px; --scatter-y: -24px; --scatter-rotate: 16deg;',
  },
  {
    index: '06',
    position: 'bottom-left',
    eyebrow: 'Role Matrix',
    title: '角色协同',
    description: '系统管理员、教师、学生、审批角色共享统一操作体验。',
    tag: 'Consistent access',
    style: '--orbit-angle: 135deg; --delay: 0.70s; --scatter-x: -420px; --scatter-y: 270px; --scatter-rotate: -14deg;',
  },
  {
    index: '07',
    position: 'bottom',
    eyebrow: 'Audit Trail',
    title: '审计留痕',
    description: '关键动作可追踪、可回放，利于测试、演示与后续交接。',
    tag: 'Traceable operations',
    style: '--orbit-angle: 90deg; --delay: 0.82s; --scatter-x: 0px; --scatter-y: 340px; --scatter-rotate: 5deg;',
  },
  {
    index: '08',
    position: 'bottom-right',
    eyebrow: 'Console Feel',
    title: '管理体验',
    description: '登录入口先建立控制台气质，让评委先记住系统的第一印象。',
    tag: 'Premium first touch',
    style: '--orbit-angle: 45deg; --delay: 0.94s; --scatter-x: 420px; --scatter-y: 270px; --scatter-rotate: 14deg;',
  },
];

const createRecoveryChannel = (): RecoveryChannelState => ({
  bound: false,
  masked: '',
  enabled: false,
  reason: '',
});


const recovery = reactive({
  visible: false,
  optionsLoading: false,
  optionsLoaded: false,
  sending: false,
  resetting: false,
  account: '',
  queryError: '',
  selectedChannel: 'email' as RecoveryChannelType,
  email: createRecoveryChannel(),
  sms: {
    bound: false,
    masked: '',
    enabled: false,
    reason: '短信找回暂不可用',
  } as RecoveryChannelState,
  emailInput: '',
  emailCode: '',
  emailChallengeId: '',
  emailTicket: '',
  smsInput: '',
  smsCode: '',
  smsChallengeId: '',
  smsTicket: '',
  newPassword: '',
  confirmPassword: '',
  countdown: 0,
  cooldownSeconds: 60,
  expireSeconds: 300,
});


const getErrorMessage = (error: any, fallback: string) => {
  const message = error?.response?.data?.message || error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
};

const persistRememberPasswordPreference = () => {
  if (rememberPassword.value) {
    localStorage.setItem(REMEMBER_PASSWORD_PREFERENCE_KEY, '1');
    return;
  }
  localStorage.removeItem(REMEMBER_PASSWORD_PREFERENCE_KEY);
};

const restoreRememberPasswordPreference = () => {
  rememberPassword.value = localStorage.getItem(REMEMBER_PASSWORD_PREFERENCE_KEY) === '1';
};

const clearRememberedCredentials = () => {
  localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
  localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
};

const persistRememberedCredentials = () => {
  persistRememberPasswordPreference();
  if (!rememberPassword.value) {
    clearRememberedCredentials();
    return;
  }

  localStorage.setItem(REMEMBERED_ACCOUNT_KEY, form.account.trim());
  localStorage.setItem(REMEMBERED_PASSWORD_KEY, form.password);
};

const restoreRememberedCredentials = () => {
  restoreRememberPasswordPreference();
  if (!rememberPassword.value) {
    clearRememberedCredentials();
    return;
  }

  form.account = localStorage.getItem(REMEMBERED_ACCOUNT_KEY) || '';
  form.password = localStorage.getItem(REMEMBERED_PASSWORD_KEY) || '';
};

const handleRememberPasswordChange = () => {
  persistRememberPasswordPreference();
  if (!rememberPassword.value) {
    clearRememberedCredentials();
  }
};

const requiresEmailCode = computed(() => security.secondFactorMode === 'email');

const showSmsWarning = computed(
  () => security.secondFactorMode === 'sms' || security.secondFactorMode === 'email_sms',
);

const requiresVerificationLayout = computed(
  () => showSmsWarning.value || security.captchaEnabled || requiresEmailCode.value,
);

const layoutModeClass = computed(() => {
  return requiresVerificationLayout.value ? 'mode-verified' : 'mode-basic';
});

const preflightStatusItems = computed(() => {
  const items = ['风险信号聚合', '审批链路就绪'];

  if (showSmsWarning.value) {
    items.push('短信二次验证待调整');
    return items;
  }

  if (security.captchaEnabled && requiresEmailCode.value) {
    items.push('图形码 + 邮箱码');
    return items;
  }

  if (security.captchaEnabled) {
    items.push('图形验证码开启');
    return items;
  }

  if (requiresEmailCode.value) {
    items.push('邮箱二次验证开启');
    return items;
  }

  items.push('无需附加验证码');
  return items;
});

const canSendCode = computed(() => {
  if (!requiresEmailCode.value || !security.emailServiceReady) {
    return false;
  }
  if (!form.account.trim() || !form.password) {
    return false;
  }
  if (security.captchaEnabled && (!captcha.id || !form.captcha_code.trim())) {
    return false;
  }
  return true;
});


const emailStatusText = computed(() => {
  if (!requiresEmailCode.value) {
    return '';
  }
  if (form.emailChallengeTarget && countdown.value > 0) {
    return `验证码已发送至 ${form.emailChallengeTarget}，${countdown.value}s 后可重新发送。`;
  }
  if (form.emailChallengeTarget && form.emailChallengeId) {
    return `验证码已发送至 ${form.emailChallengeTarget}。`;
  }
  return '请输入邮箱验证码后再登录。';
});


const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveLoginCardElement = () => {
  const target = loginCardRef.value;
  if (!target) {
    return null;
  }
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target.$el instanceof HTMLElement) {
    return target.$el as HTMLElement;
  }
  return null;
};

const resolveActivateButtonElement = () => activateButtonRef.value;
const resolveFeatureCloudElement = () => featureCloudRef.value;
const resolveFeatureSlotElements = () =>
  Array.from(document.querySelectorAll('.feature-slot')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const updateViewportSize = () => {
  if (typeof window === 'undefined') {
    return;
  }
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
};

const clearFeatureSlotSnapshot = () => {
  featureSlotsFrozen.value = false;
  for (const element of resolveFeatureSlotElements()) {
    element.style.removeProperty('--feature-current-opacity');
    element.style.removeProperty('--feature-current-transform');
    element.style.removeProperty('--feature-current-filter');
  }
};

const clearFeatureCloudSnapshot = () => {
  featureCloudFrozen.value = false;
  resolveFeatureCloudElement()?.style.removeProperty('--feature-cloud-current-transform');
};

const captureFeatureSlotSnapshot = () => {
  for (const element of resolveFeatureSlotElements()) {
    const computed = getComputedStyle(element);
    element.style.setProperty('--feature-current-opacity', computed.opacity || '0');
    element.style.setProperty(
      '--feature-current-transform',
      computed.transform && computed.transform !== 'none'
        ? computed.transform
        : 'translate3d(0, 0, 0) scale(1) rotate(0deg)',
    );
    element.style.setProperty(
      '--feature-current-filter',
      computed.filter && computed.filter !== 'none' ? computed.filter : 'blur(0px)',
    );
  }
  featureSlotsFrozen.value = true;
};

const captureFeatureCloudSnapshot = () => {
  const element = resolveFeatureCloudElement();
  if (!element) {
    return;
  }

  const computed = getComputedStyle(element);
  element.style.setProperty(
    '--feature-cloud-current-transform',
    computed.transform && computed.transform !== 'none'
      ? computed.transform
      : 'translate3d(0, 0, 0)',
  );
  featureCloudFrozen.value = true;
};

const activateLogin = async () => {
  if (loginReady.value || loginActivating.value || loginSeeding.value) {
    return;
  }

  await nextTick();
  captureFeatureSlotSnapshot();
  captureFeatureCloudSnapshot();
  clearLoginBootTimer();
  loginBooting.value = false;
  loginBootComplete.value = false;
  await nextTick();
  await waitForNextFrame();

  const cardElement = resolveLoginCardElement();
  const buttonElement = resolveActivateButtonElement();

  if (cardElement && buttonElement) {
    const cardRect = cardElement.getBoundingClientRect();
    const buttonRect = buttonElement.getBoundingClientRect();

    cardElement.style.setProperty('--seed-left', `${buttonRect.left - cardRect.left}px`);
    cardElement.style.setProperty('--seed-top', `${buttonRect.top - cardRect.top}px`);
    cardElement.style.setProperty('--seed-width', `${buttonRect.width}px`);
    cardElement.style.setProperty('--seed-height', `${buttonRect.height}px`);
  }

  loginSeeding.value = true;
  await waitForNextFrame();
  loginSeeding.value = false;
  loginActivating.value = true;
  clearLoginActivationTimer();
  loginActivationTimer = window.setTimeout(async () => {
    loginReady.value = true;
    loginActivating.value = false;
    clearFeatureSlotSnapshot();
    clearFeatureCloudSnapshot();
    await nextTick();
    accountInputRef.value?.focus?.();
  }, 300);
};

const bootCards = () => {
  clearFeatureSlotSnapshot();
  clearFeatureCloudSnapshot();
  loginBooting.value = false;
  loginBootComplete.value = false;
  requestAnimationFrame(() => {
    loginBooting.value = true;
    clearLoginBootTimer();
    loginBootTimer = window.setTimeout(() => {
      loginBootComplete.value = true;
    }, 1800);
  });
};

const orbitLayoutStyle = computed<Record<string, string>>(() => {
  const width = viewportWidth.value || 1440;
  const height = viewportHeight.value || 960;
  const usableWidth = Math.max(width - (width <= 640 ? 32 : 48), 320);
  const usableHeight = Math.max(height - (width <= 640 ? 32 : 48), 520);

  const idleSize = clampNumber(
    Math.round(
      Math.min(
        usableWidth * (width <= 640 ? 0.9 : width <= 920 ? 0.62 : 0.34),
        usableHeight * (width <= 640 ? 0.58 : 0.48),
      ),
    ),
    320,
    450,
  );

  const basicWidth = clampNumber(
    Math.round(Math.min(usableWidth * (width <= 640 ? 0.94 : 0.82), 560)),
    360,
    560,
  );
  const basicHeight = clampNumber(
    Math.round(Math.min(usableHeight * (width <= 640 ? 0.76 : 0.72), 580)),
    420,
    580,
  );

  const verifiedSize = clampNumber(
    Math.round(
      Math.min(
        usableWidth * (width <= 640 ? 0.94 : width <= 920 ? 0.92 : 0.78),
        usableHeight * (width <= 640 ? 0.9 : 0.84),
      ),
    ),
    420,
    760,
  );

  const sideWidth = clampNumber(
    Math.round(
      usableWidth * (width <= 640 ? 0.24 : width <= 920 ? 0.2 : width <= 1360 ? 0.18 : 0.17),
    ),
    150,
    300,
  );
  const sideHeight = clampNumber(
    Math.round(
      usableHeight * (width <= 640 ? 0.18 : width <= 920 ? 0.2 : width <= 1360 ? 0.22 : 0.23),
    ),
    150,
    248,
  );
  const gapX = clampNumber(
    Math.round(Math.min(sideWidth * 0.22, usableWidth * 0.03)),
    16,
    42,
  );
  const gapY = clampNumber(
    Math.round(Math.min(sideHeight * 0.26, usableHeight * 0.035)),
    18,
    44,
  );
  const orbitRadius = clampNumber(
    Math.round(
      idleSize / 2 +
      sideHeight / 2 +
      Math.max(gapY, 24) +
      Math.min(sideHeight * 0.22, usableHeight * 0.05),
    ),
    250,
    520,
  );
  const uiScale = clampNumber(
    Math.min(width / 1440, height / 960),
    0.76,
    1,
  );

  const ringOuter = Math.round(idleSize + sideWidth * 2 + 96);

  return {
    '--login-ui-scale': `${uiScale}`,
    '--login-orbit-side-width': `${sideWidth}px`,
    '--login-orbit-side-height': `${sideHeight}px`,
    '--login-orbit-gap-x': `${gapX}px`,
    '--login-orbit-gap-y': `${gapY}px`,
    '--login-orbit-radius': `${orbitRadius}px`,
    '--login-card-idle-size': `${idleSize}px`,
    '--login-card-basic-width': `${basicWidth}px`,
    '--login-card-basic-height': `${basicHeight}px`,
    '--login-card-verified-size': `${verifiedSize}px`,
    '--login-orbit-ring-outer': `${ringOuter}px`,
    '--login-orbit-ring-inner': `${Math.max(ringOuter - 108, 720)}px`,
    '--login-orbit-ring-pulse': `${Math.max(ringOuter - 64, 760)}px`,
    '--login-orbit-ring-sweep': `${ringOuter + 56}px`,
  };
});

const canSendRecoveryCode = computed(() =>
  Boolean(
    recovery.account.trim() &&
      ((recovery.selectedChannel === 'email' &&
        recovery.email.enabled &&
        recovery.emailInput.trim()) ||
        (recovery.selectedChannel === 'sms' &&
          recovery.sms.enabled &&
          recovery.smsInput.trim())),
  ),
);

const canSubmitRecovery = computed(() =>
  Boolean(
    recovery.account.trim() &&
      recovery.newPassword &&
      recovery.confirmPassword &&
      ((recovery.selectedChannel === 'email' &&
        recovery.email.enabled &&
        recovery.emailInput.trim() &&
        recovery.emailCode.trim()) ||
        (recovery.selectedChannel === 'sms' &&
          recovery.sms.enabled &&
          recovery.smsInput.trim() &&
          recovery.smsCode.trim())),
  ),
);

const selectedRecoveryChannelState = computed(() =>
  recovery.selectedChannel === 'sms' ? recovery.sms : recovery.email,
);

const hasAnyRecoveryChannel = computed(
  () =>
    (recovery.email.bound && recovery.email.enabled) ||
    (recovery.sms.bound && recovery.sms.enabled),
);


const recoveryStatusDisplayText = computed(() => {
  if (!recovery.optionsLoaded) {
    return '请先输入账号（学号）并查询找回方式。';
  }
  if (recovery.selectedChannel === 'sms') {
    if (!recovery.sms.bound) {
      return '当前账号未绑定手机号。';
    }
    if (!recovery.sms.enabled) {
      return recovery.sms.reason || '短信找回当前不可用。';
    }
    if (recovery.sms.masked && recovery.countdown > 0 && recovery.smsChallengeId) {
      return `验证码已发送至 ${recovery.sms.masked}，${recovery.countdown}s 后可重新发送。`;
    }
    if (recovery.sms.masked && recovery.smsChallengeId) {
      return `验证码已发送至 ${recovery.sms.masked}。`;
    }
    return '请输入完整绑定手机号，完成短信验证码校验后再重置密码。';
  }
  if (!recovery.email.bound) {
    return '当前账号未绑定邮箱。';
  }
  if (!recovery.email.enabled) {
    return recovery.email.reason || '邮箱找回当前不可用。';
  }
  if (recovery.email.masked && recovery.countdown > 0 && recovery.emailChallengeId) {
    return `验证码已发送至 ${recovery.email.masked}，${recovery.countdown}s 后可重新发送。`;
  }
  if (recovery.email.masked && recovery.emailChallengeId) {
    return `验证码已发送至 ${recovery.email.masked}。`;
  }
  return '请输入完整绑定邮箱，完成邮箱验证码校验后再重置密码。';
});


const maskEmailForDisplay = (value?: string) => {
  const text = String(value || '').trim();
  if (!text || !text.includes('@')) {
    return text;
  }
  const [localPart, domainPart] = text.split('@');
  if (!localPart || !domainPart) {
    return text;
  }
  if (/X{2,}/i.test(localPart)) {
    return text;
  }
  const visibleLocal = localPart.slice(0, Math.min(3, localPart.length));
  return `${visibleLocal}${'X'.repeat(Math.max(0, localPart.length - visibleLocal.length))}@${domainPart}`;
};

const clearTimer = () => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
};

const clearRecoveryTimer = () => {
  if (recoveryCountdownTimer) {
    clearInterval(recoveryCountdownTimer);
    recoveryCountdownTimer = null;
  }
};

const clearLoginActivationTimer = () => {
  if (loginActivationTimer) {
    clearTimeout(loginActivationTimer);
    loginActivationTimer = null;
  }
};

const clearLoginBootTimer = () => {
  if (loginBootTimer) {
    clearTimeout(loginBootTimer);
    loginBootTimer = null;
  }
};

const clearPersistedEmailChallenge = () => sessionStorage.removeItem(LOGIN_EMAIL_CHALLENGE_KEY);

const clearPersistedRecoveryChallenge = () =>
  sessionStorage.removeItem(PASSWORD_RESET_RECOVERY_CHALLENGE_KEY);

const persistEmailChallenge = (payload: {
  challengeId: string;
  target: string;
  account: string;
  cooldownUntil: number;
  expireAt: number;
}) => {
  sessionStorage.setItem(LOGIN_EMAIL_CHALLENGE_KEY, JSON.stringify(payload));
};

const persistRecoveryChallenge = (payload: PersistedRecoveryChallenge) => {
  sessionStorage.setItem(PASSWORD_RESET_RECOVERY_CHALLENGE_KEY, JSON.stringify(payload));
};

const clearEmailChallengeState = () => {
  clearTimer();
  countdown.value = 0;
  form.emailChallengeId = '';
  form.emailChallengeTarget = '';
  form.emailCode = '';
  form.email_ticket = '';
  clearPersistedEmailChallenge();
};

const clearRecoveryVerificationState = (options?: {
  preserveEmailInput?: boolean;
  preserveSmsInput?: boolean;
}) => {
  clearRecoveryTimer();
  recovery.countdown = 0;
  recovery.emailChallengeId = '';
  recovery.emailCode = '';
  recovery.emailTicket = '';
  recovery.smsChallengeId = '';
  recovery.smsCode = '';
  recovery.smsTicket = '';
  if (!options?.preserveEmailInput) {
    recovery.emailInput = '';
  }
  if (!options?.preserveSmsInput) {
    recovery.smsInput = '';
  }
  clearPersistedRecoveryChallenge();
};


const resetRecoveryOptions = () => {
  recovery.optionsLoaded = false;
  recovery.queryError = '';
  recovery.selectedChannel = 'email';
  Object.assign(recovery.email, createRecoveryChannel());
  Object.assign(recovery.sms, {
    bound: false,
    masked: '',
    enabled: false,
    reason: '短信找回暂不可用',
  });
  clearRecoveryVerificationState();
  recovery.newPassword = '';
  recovery.confirmPassword = '';
  recovery.cooldownSeconds = security.emailCodeCooldownSeconds || 60;
  recovery.expireSeconds = security.emailCodeExpireSeconds || 300;
};


const startCountdown = (seconds: number) => {
  clearTimer();
  countdown.value = Math.max(0, Math.ceil(seconds));
  if (countdown.value <= 0) {
    return;
  }
  countdownTimer = setInterval(() => {
    if (countdown.value <= 1) {
      countdown.value = 0;
      clearTimer();
      return;
    }
    countdown.value -= 1;
  }, 1000);
};

const startRecoveryCountdown = (seconds: number) => {
  clearRecoveryTimer();
  recovery.countdown = Math.max(0, Math.ceil(seconds));
  if (recovery.countdown <= 0) {
    return;
  }
  recoveryCountdownTimer = setInterval(() => {
    if (recovery.countdown <= 1) {
      recovery.countdown = 0;
      clearRecoveryTimer();
      return;
    }
    recovery.countdown -= 1;
  }, 1000);
};

const restoreEmailChallenge = () => {
  const raw = sessionStorage.getItem(LOGIN_EMAIL_CHALLENGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw) as {
      challengeId?: string;
      target?: string;
      account?: string;
      cooldownUntil?: number;
      expireAt?: number;
    };
    if (!saved.challengeId || !saved.expireAt || saved.expireAt <= Date.now()) {
      clearPersistedEmailChallenge();
      return;
    }
    form.emailChallengeId = saved.challengeId;
    form.emailChallengeTarget = maskEmailForDisplay(saved.target || '');
    if (!form.account && saved.account) {
      form.account = saved.account;
    }
    const remaining = Math.max(0, Math.ceil(((saved.cooldownUntil || 0) - Date.now()) / 1000));
    if (remaining > 0) {
      startCountdown(remaining);
    }
  } catch {
    clearPersistedEmailChallenge();
  }
};

const restoreRecoveryChallenge = () => {
  const raw = sessionStorage.getItem(PASSWORD_RESET_RECOVERY_CHALLENGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const saved = JSON.parse(raw) as PersistedRecoveryChallenge;
    if (!saved.challengeId || !saved.expireAt || saved.expireAt <= Date.now()) {
      clearPersistedRecoveryChallenge();
      return;
    }
    recovery.account = saved.account || recovery.account;
    recovery.selectedChannel = saved.channel === 'sms' ? 'sms' : 'email';
    recovery.optionsLoaded = Boolean(recovery.account);
    if (saved.channel === 'sms') {
      Object.assign(recovery.sms, {
        bound: true,
        masked: saved.target || '',
        enabled: true,
        reason: '',
      });
      recovery.smsInput = saved.mobile || recovery.smsInput;
      recovery.smsChallengeId = saved.challengeId;
    } else {
      Object.assign(recovery.email, {
        bound: true,
        masked: maskEmailForDisplay(saved.target || ''),
        enabled: true,
        reason: '',
      });
      recovery.emailInput = saved.email || recovery.emailInput;
      recovery.emailChallengeId = saved.challengeId;
    }
    const remaining = Math.max(0, Math.ceil(((saved.cooldownUntil || 0) - Date.now()) / 1000));
    if (remaining > 0) {
      startRecoveryCountdown(remaining);
    }
  } catch {
    clearPersistedRecoveryChallenge();
  }
};

const resetEmailTicketOnly = () => {
  form.email_ticket = '';
};

const handleAccountChange = () => {
  clearEmailChallengeState();
};

const handlePasswordChange = () => {
  form.email_ticket = '';
};

const handleRecoveryAccountChange = () => {
  const nextAccount = recovery.account.trim();
  resetRecoveryOptions();
  recovery.account = nextAccount;
};

const handleRecoveryEmailInput = () => {
  clearRecoveryVerificationState({
    preserveEmailInput: true,
    preserveSmsInput: true,
  });
};

const handleRecoverySmsInput = () => {
  clearRecoveryVerificationState({
    preserveEmailInput: true,
    preserveSmsInput: true,
  });
};

const handleRecoveryCodeInput = () => {
  recovery.emailTicket = '';
  recovery.smsTicket = '';
};

const shouldRefreshCaptchaForError = (message?: string) => {
  const text = String(message || '');
  return (
    text.includes('图形验证码') ||
    text.toLowerCase().includes('captcha') ||
    text.includes('已失效') ||
    text.includes('请刷新')
  );
};

const refreshCaptcha = async (options?: { preserveInput?: boolean }) => {
  if (!security.captchaEnabled) {
    captcha.id = '';
    captcha.image = '';
    form.captcha_code = '';
    return;
  }
  captchaLoading.value = true;
  try {
    const resp = await getLoginCaptcha();
    if (resp.code !== 0) {
      throw new Error(resp.message || '加载图形验证码失败');
    }
    captcha.id = resp.data.captchaId;
    captcha.image = resp.data.image;
    if (!options?.preserveInput) {
      form.captcha_code = '';
    }
  } catch (error: any) {
    ElMessage.error(getErrorMessage(error, '加载图形验证码失败'));
  } finally {
    captchaLoading.value = false;
  }
};

const loadSecurityConfig = async () => {
  securityLoading.value = true;
  try {
    const resp = await getLoginSecurityConfig();
    if (resp.code !== 0) {
      throw new Error(resp.message || '加载登录安全配置失败');
    }
    Object.assign(security, resp.data || {});
    recovery.cooldownSeconds = security.emailCodeCooldownSeconds || 60;
    recovery.expireSeconds = security.emailCodeExpireSeconds || 300;
    if (security.captchaEnabled) {
      await refreshCaptcha();
    }
    if (!requiresEmailCode.value) {
      clearEmailChallengeState();
    }
  } catch (error: any) {
    ElMessage.error(getErrorMessage(error, '加载登录安全配置失败'));
  } finally {
    securityLoading.value = false;
  }
};

const loadRegisterStatus = async () => {
  try {
    const resp = await getRegisterStatus();
    if (resp.code === 0) {
      registerEnabled.value = resp.data?.openRegistration !== false;
    } else {
      registerEnabled.value = false;
    }
  } catch {
    registerEnabled.value = false;
  }
};

const ensureEmailTicket = async () => {
  if (!requiresEmailCode.value) {
    return '';
  }
  if (form.email_ticket) {
    return form.email_ticket;
  }
  if (!form.emailChallengeId || !form.emailCode.trim()) {
    throw new Error('请输入邮箱验证码');
  }
  const resp = await verifyCode({
    challenge_id: form.emailChallengeId,
    code: form.emailCode.trim(),
  });
  if (resp.code !== 0 || !resp.data?.ticket) {
    throw new Error(resp.message || '邮箱验证码校验失败');
  }
  form.email_ticket = resp.data.ticket;
  return form.email_ticket;
};


const ensureRecoveryEmailTicket = async () => {
  if (recovery.emailTicket) {
    return recovery.emailTicket;
  }
  if (!recovery.emailChallengeId || !recovery.emailCode.trim()) {
    throw new Error('请输入邮箱验证码');
  }
  const resp = await verifyCode({
    challenge_id: recovery.emailChallengeId,
    code: recovery.emailCode.trim(),
  });
  if (resp.code !== 0 || !resp.data?.ticket) {
    if (resp.code === 4001 || resp.code === 4002) {
      clearRecoveryVerificationState({
        preserveEmailInput: true,
        preserveSmsInput: true,
      });
    }
    throw new Error(resp.message || '邮箱验证码校验失败');
  }
  recovery.emailTicket = resp.data.ticket;
  return recovery.emailTicket;
};



const ensureRecoverySmsTicket = async () => {
  if (recovery.smsTicket) {
    return recovery.smsTicket;
  }
  if (!recovery.smsChallengeId || !recovery.smsCode.trim()) {
    throw new Error('请输入短信验证码');
  }
  const resp = await verifyCode({
    challenge_id: recovery.smsChallengeId,
    code: recovery.smsCode.trim(),
  });
  if (resp.code !== 0 || !resp.data?.ticket) {
    if (resp.code === 4001 || resp.code === 4002) {
      clearRecoveryVerificationState({
        preserveEmailInput: true,
        preserveSmsInput: true,
      });
    }
    throw new Error(resp.message || '短信验证码校验失败');
  }
  recovery.smsTicket = resp.data.ticket;
  return recovery.smsTicket;
};



const loadRecoveryOptions = async (silent = false) => {
  const account = recovery.account.trim();
  if (!account) {
    if (!silent) {
      ElMessage.warning('请输入账号（学号）');
    }
    return false;
  }
  recovery.optionsLoading = true;
  recovery.queryError = '';
  try {
    const resp = await getPasswordRecoveryOptions({ account });
    if (resp.code !== 0) {
      throw new Error(resp.message || '查询找回方式失败');
    }
    clearRecoveryVerificationState({
      preserveEmailInput: true,
      preserveSmsInput: true,
    });
    recovery.optionsLoaded = true;
    Object.assign(recovery.email, resp.data.email || createRecoveryChannel());
    Object.assign(recovery.sms, {
      bound: Boolean(resp.data.sms?.bound),
      masked: resp.data.sms?.masked || '',
      enabled: Boolean(resp.data.sms?.enabled),
      reason: resp.data.sms?.reason || '短信找回暂不可用',
    });
    recovery.selectedChannel =
      recovery.email.enabled && recovery.email.bound
        ? 'email'
        : recovery.sms.enabled && recovery.sms.bound
          ? 'sms'
          : 'email';
    recovery.cooldownSeconds =
      Number(resp.data.cooldown_seconds || security.emailCodeCooldownSeconds) || 60;
    recovery.expireSeconds =
      Number(resp.data.expire_seconds || security.emailCodeExpireSeconds) || 300;
    return true;
  } catch (error: any) {
    resetRecoveryOptions();
    recovery.account = account;
    const message = getErrorMessage(error, '查询找回方式失败');
    recovery.queryError = message.includes('账号不存在') ? '账号不存在' : message;
    if (!silent) {
      ElMessage.error(recovery.queryError);
    }
    return false;
  } finally {
    recovery.optionsLoading = false;
  }
};


const openRecoveryDialog = async () => {
  recovery.visible = true;
  if (!recovery.account && form.account.trim()) {
    recovery.account = form.account.trim();
  }
  if (recovery.account && !recovery.optionsLoaded) {
    await loadRecoveryOptions(true);
  }
};


const selectRecoveryChannel = (channel: RecoveryChannelType) => {
  if (channel === 'email') {
    if (!recovery.email.bound) {
      ElMessage.warning('当前账号未绑定邮箱');
      return;
    }
    if (!recovery.email.enabled) {
      ElMessage.warning(recovery.email.reason || '邮箱找回当前不可用');
      return;
    }
  }
  if (channel === 'sms') {
    if (!recovery.sms.bound) {
      ElMessage.warning('当前账号未绑定手机号');
      return;
    }
    if (!recovery.sms.enabled) {
      ElMessage.warning(recovery.sms.reason || '短信找回当前不可用');
      return;
    }
  }
  if (recovery.selectedChannel !== channel) {
    clearRecoveryVerificationState({
      preserveEmailInput: true,
      preserveSmsInput: true,
    });
  }
  recovery.selectedChannel = channel;
};


const onSendCode = async () => {
  if (!form.account.trim()) {
    ElMessage.warning('请输入账号（学号）');
    return;
  }
  if (!form.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  if (showSmsWarning.value) {
    ElMessage.warning('当前登录流程不支持短信二次验证，请联系管理员调整配置');
    return;
  }
  if (!canSendCode.value) {
    ElMessage.warning('请先输入账号、密码和图形验证码');
    return;
  }
  sendingCode.value = true;
  try {
    const resp = await sendAdminLoginCode({
      account: form.account.trim(),
      password: form.password,
      captcha_id: captcha.id || undefined,
      captcha_code: form.captcha_code.trim() || undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '发送邮箱验证码失败');
    }
    const maskedTarget = maskEmailForDisplay(resp.data.target);
    form.emailChallengeId = resp.data.challenge_id;
    form.emailChallengeTarget = maskedTarget;
    form.emailCode = '';
    form.email_ticket = '';
    const cooldownSeconds =
      Number(resp.data.cooldown_seconds || security.emailCodeCooldownSeconds) ||
      security.emailCodeCooldownSeconds;
    const expireSeconds =
      Number(resp.data.expire_seconds || security.emailCodeExpireSeconds) ||
      security.emailCodeExpireSeconds;
    persistEmailChallenge({
      challengeId: resp.data.challenge_id,
      target: maskedTarget,
      account: form.account.trim(),
      cooldownUntil: Date.now() + cooldownSeconds * 1000,
      expireAt: Date.now() + expireSeconds * 1000,
    });
    startCountdown(cooldownSeconds);
    ElMessage.success(`验证码已发送至 ${maskedTarget}`);
  } catch (error: any) {
    ElMessage.error(getErrorMessage(error, '发送邮箱验证码失败'));
    if (security.captchaEnabled && shouldRefreshCaptchaForError(getErrorMessage(error, ''))) {
      await refreshCaptcha();
    }
  } finally {
    sendingCode.value = false;
  }
};


const onSendRecoveryCode = async () => {
  if (!recovery.account.trim()) {
    ElMessage.warning('请输入账号（学号）');
    return;
  }
  if (!recovery.optionsLoaded) {
    const ok = await loadRecoveryOptions();
    if (!ok) {
      return;
    }
  }

  if (recovery.selectedChannel === 'sms') {
    if (!recovery.sms.enabled) {
      ElMessage.warning(recovery.sms.reason || '短信找回当前不可用');
      return;
    }
    if (!recovery.smsInput.trim()) {
      ElMessage.warning('请输入完整绑定手机号');
      return;
    }
    recovery.sending = true;
    try {
      const resp = await sendPasswordRecoverySmsCode({
        account: recovery.account.trim(),
        mobile: recovery.smsInput.trim(),
      });
      if (resp.code !== 0) {
        throw new Error(resp.message || '发送短信验证码失败');
      }
      recovery.smsChallengeId = resp.data.challenge_id;
      recovery.smsCode = '';
      recovery.smsTicket = '';
      recovery.emailChallengeId = '';
      recovery.emailTicket = '';
      recovery.emailCode = '';
      recovery.sms.masked = resp.data.target || recovery.sms.masked;
      const cooldownSeconds =
        Number(
          resp.data.cooldown_seconds ||
            recovery.cooldownSeconds ||
            security.emailCodeCooldownSeconds,
        ) || 60;
      const expireSeconds =
        Number(
          resp.data.expire_seconds ||
            recovery.expireSeconds ||
            security.emailCodeExpireSeconds,
        ) || 300;
      recovery.cooldownSeconds = cooldownSeconds;
      recovery.expireSeconds = expireSeconds;
      persistRecoveryChallenge({
        challengeId: resp.data.challenge_id,
        target: resp.data.target || recovery.sms.masked,
        account: recovery.account.trim(),
        channel: 'sms',
        mobile: recovery.smsInput.trim(),
        cooldownUntil: Date.now() + cooldownSeconds * 1000,
        expireAt: Date.now() + expireSeconds * 1000,
      });
      startRecoveryCountdown(cooldownSeconds);
      ElMessage.success(`验证码已发送至 ${resp.data.target || recovery.sms.masked}`);
    } catch (error: any) {
      ElMessage.error(getErrorMessage(error, '发送短信验证码失败'));
    } finally {
      recovery.sending = false;
    }
    return;
  }

  if (!recovery.email.enabled) {
    ElMessage.warning(recovery.email.reason || '邮箱找回当前不可用');
    return;
  }
  if (!recovery.emailInput.trim()) {
    ElMessage.warning('请输入完整绑定邮箱');
    return;
  }
  recovery.sending = true;
  try {
    const resp = await sendPasswordRecoveryEmailCode({
      account: recovery.account.trim(),
      email: recovery.emailInput.trim(),
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '发送邮箱验证码失败');
    }
    recovery.emailChallengeId = resp.data.challenge_id;
    recovery.emailCode = '';
    recovery.emailTicket = '';
    recovery.smsChallengeId = '';
    recovery.smsTicket = '';
    recovery.smsCode = '';
    recovery.email.masked = resp.data.target || recovery.email.masked;
    const cooldownSeconds =
      Number(
        resp.data.cooldown_seconds ||
          recovery.cooldownSeconds ||
          security.emailCodeCooldownSeconds,
      ) || 60;
    const expireSeconds =
      Number(
        resp.data.expire_seconds ||
          recovery.expireSeconds ||
          security.emailCodeExpireSeconds,
      ) || 300;
    recovery.cooldownSeconds = cooldownSeconds;
    recovery.expireSeconds = expireSeconds;
    persistRecoveryChallenge({
      challengeId: resp.data.challenge_id,
      target: resp.data.target || recovery.email.masked,
      account: recovery.account.trim(),
      channel: 'email',
      email: recovery.emailInput.trim(),
      cooldownUntil: Date.now() + cooldownSeconds * 1000,
      expireAt: Date.now() + expireSeconds * 1000,
    });
    startRecoveryCountdown(cooldownSeconds);
    ElMessage.success(`验证码已发送至 ${resp.data.target || recovery.email.masked}`);
  } catch (error: any) {
    ElMessage.error(getErrorMessage(error, '发送邮箱验证码失败'));
  } finally {
    recovery.sending = false;
  }
};



const onResetPassword = async () => {
  if (!recovery.account.trim()) {
    ElMessage.warning('请输入账号（学号）');
    return;
  }
  if (!recovery.optionsLoaded) {
    const ok = await loadRecoveryOptions();
    if (!ok) {
      return;
    }
  }
  if (!recovery.newPassword || !recovery.confirmPassword) {
    ElMessage.warning('请输入并确认新密码');
    return;
  }
  if (recovery.newPassword !== recovery.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }

  recovery.resetting = true;
  try {
    if (recovery.selectedChannel === 'sms') {
      if (!recovery.sms.enabled) {
        throw new Error(recovery.sms.reason || '短信找回当前不可用');
      }
      if (!recovery.smsInput.trim()) {
        throw new Error('请输入完整绑定手机号');
      }
      const ticket = await ensureRecoverySmsTicket();
      const resp = await resetPasswordByChannel({
        account: recovery.account.trim(),
        channel: 'sms',
        mobile: recovery.smsInput.trim(),
        ticket,
        new_password: recovery.newPassword,
      });
      if (resp.code !== 0) {
        throw new Error(resp.message || '重置密码失败');
      }
    } else {
      if (!recovery.email.enabled) {
        throw new Error(recovery.email.reason || '邮箱找回当前不可用');
      }
      if (!recovery.emailInput.trim()) {
        throw new Error('请输入完整绑定邮箱');
      }
      const ticket = await ensureRecoveryEmailTicket();
      const resp = await resetPasswordByChannel({
        account: recovery.account.trim(),
        channel: 'email',
        email: recovery.emailInput.trim(),
        ticket,
        new_password: recovery.newPassword,
      });
      if (resp.code !== 0) {
        throw new Error(resp.message || '重置密码失败');
      }
    }

    const recoveredAccount = recovery.account.trim();
    form.account = recoveredAccount;
    form.password = '';
    recovery.visible = false;
    resetRecoveryOptions();
    recovery.account = recoveredAccount;
    ElMessage.success('密码已重置，请重新登录');
  } catch (error: any) {
    recovery.emailTicket = '';
    recovery.smsTicket = '';
    ElMessage.error(getErrorMessage(error, '重置密码失败'));
  } finally {
    recovery.resetting = false;
  }
};


const onSubmit = async () => {
  if (loading.value) {
    return;
  }
  if (!form.account.trim()) {
    ElMessage.warning('请输入账号（学号）');
    return;
  }
  if (!form.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  if (showSmsWarning.value) {
    ElMessage.warning('当前登录流程不支持短信二次验证，请联系管理员调整配置');
    return;
  }
  if (requiresEmailCode.value && !security.emailServiceReady) {
    ElMessage.warning('邮箱服务未配置完整，暂时无法完成邮箱二次验证');
    return;
  }
  if (security.captchaEnabled && (!captcha.id || !form.captcha_code.trim())) {
    ElMessage.warning('请输入图形验证码');
    return;
  }

  loading.value = true;
  try {
    const emailTicket = await ensureEmailTicket();
    const resp = await loginAdmin({
      account: form.account.trim(),
      password: form.password,
      captcha_id: captcha.id || undefined,
      captcha_code: form.captcha_code.trim() || undefined,
      email_ticket: emailTicket || undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '登录失败');
    }
    clearEmailChallengeState();
    clearBindingStateCache();
    localStorage.setItem('admin_token', resp.data.token);
    if (resp.data.user) {
      localStorage.setItem('admin_user', JSON.stringify(resp.data.user));
    }
    if (resp.data.roles) {
      const roles = resp.data.roles.map((item: any) => item.role);
      localStorage.setItem('admin_roles', JSON.stringify(roles));
      localStorage.setItem('admin_roles_full', JSON.stringify(resp.data.roles));
      if (!roles.includes('teacher')) {
        setTeacherBindingState({ hasBoundOrg: null, hasBoundCourses: null });
      }
      if (!roles.includes('head_teacher')) {
        setHeadTeacherBoundState(null);
      }
      if (!roles.includes('student_admin')) {
        setStudentAdminBoundState(null);
      }
      if (!roles.includes('student') && !roles.includes('class_monitor')) {
        setStudentBoundState(null);
      }
    }
    if (resp.data.role_names) {
      localStorage.setItem('admin_role_names', JSON.stringify(resp.data.role_names));
    }
    if (resp.data.user?.user_type === 'student' || resp.data.user_type === 'student') {
      const studentId = String(resp.data.student_id || '').trim();
      if (studentId) {
        localStorage.setItem('student_id', studentId);
      } else {
        localStorage.removeItem('student_id');
        setStudentBoundState(false);
      }
    } else {
      localStorage.removeItem('student_id');
      setStudentBoundState(null);
    }
    ElMessage.success('登录成功');
    if (resp.data.login_prompt?.content) {
      sessionStorage.setItem(
        LOGIN_PROMPT_SESSION_KEY,
        JSON.stringify(resp.data.login_prompt),
      );
    } else {
      sessionStorage.removeItem(LOGIN_PROMPT_SESSION_KEY);
    }
    persistRememberedCredentials();
    const redirectPath = await getRedirectPath(resp.data.roles || []);
    await router.replace(redirectPath);
    if (router.currentRoute.value.path === '/login') {
      window.location.assign(redirectPath);
    }
  } catch (error: any) {
    form.email_ticket = '';
    ElMessage.error(getErrorMessage(error, '登录失败'));
    if (security.captchaEnabled && shouldRefreshCaptchaForError(getErrorMessage(error, ''))) {
      await refreshCaptcha();
    }
  } finally {
    loading.value = false;
  }
};

const getRedirectPath = async (roles: any[]): Promise<string> => {
  const roleCodes = roles.map((item: any) => item.role);
  const headTeacherRole =
    roles.find((item: any) => item.role === 'head_teacher' && item.scope_id)
    || roles.find((item: any) => item.role === 'head_teacher');
  const hasBoundHeadTeacherClass = roles.some(
    (item: any) => item.role === 'head_teacher' && item.scope_id,
  );
  setHeadTeacherBoundState(headTeacherRole ? hasBoundHeadTeacherClass : null);
  if (headTeacherRole && !hasBoundHeadTeacherClass) {
    return '/teacher-bind-class';
  }

  const studentAdminRole = roles.find((item: any) => item.role === 'student_admin');
  setStudentAdminBoundState(studentAdminRole ? Boolean(studentAdminRole.scope_id) : null);
  if (studentAdminRole && !studentAdminRole.scope_id) {
    return '/student-admin-bind-org';
  }

  if (roleCodes.includes('class_monitor')) {
    const studentId = localStorage.getItem('student_id');
    if (!studentId) {
      return '/bind-class';
    }
    const isBound = await checkStudentBound();
    return isBound ? '/class-overview' : '/bind-class';
  }

  if (roleCodes.includes('student')) {
    const studentId = localStorage.getItem('student_id');
    if (!studentId) {
      return '/bind-class';
    }
    const isBound = await checkStudentBound();
    return isBound ? '/my-warnings' : '/bind-class';
  }

  if (roleCodes.includes('head_teacher')) {
    try {
      const bindingResp = await getTeacherBindingStatus();
      if (bindingResp.code === 0) {
        const hasBoundCourses = Boolean(bindingResp.data?.has_bound_courses);
        setTeacherBindingState({
          hasBoundOrg: true,
          hasBoundCourses,
        });
        if (!hasBoundCourses) {
          return '/teacher-bind-courses';
        }
      } else {
        setTeacherBindingState({ hasBoundOrg: true, hasBoundCourses: null });
      }
    } catch {
      setTeacherBindingState({ hasBoundOrg: true, hasBoundCourses: null });
    }
    return '/head-teacher-class-overview';
  }

  if (roleCodes.includes('teacher')) {
    try {
      const bindingResp = await getTeacherBindingStatus();
      if (bindingResp.code === 0) {
        const hasBoundOrg = Boolean(bindingResp.data?.has_bound_org);
        const hasBoundCourses = Boolean(bindingResp.data?.has_bound_courses);
        setTeacherBindingState({ hasBoundOrg, hasBoundCourses });
        if (!hasBoundOrg) {
          return '/teacher-bind-org';
        }
        if (!hasBoundCourses) {
          return '/teacher-bind-courses';
        }
        return '/teacher-attendance';
      }
    } catch {
      setTeacherBindingState({ hasBoundOrg: null, hasBoundCourses: null });
    }
    return '/teacher-bind-org';
  }

  if (roleCodes.includes('student_admin')) {
    return '/college-dashboard';
  }
  if (roleCodes.includes('teaching_admin') || roleCodes.includes('dean')) {
    return '/school-stats';
  }
  if (roleCodes.includes('vice_dean')) {
    return '/approvals';
  }
  if (roleCodes.includes('sys_admin')) {
    return '/orgs';
  }
  return '/warnings';
};

const checkStudentBound = async () => {
  try {
    const response = await api.get('/student/profile');
    const isBound = response.data.code === 0 && !!response.data.data?.is_bound;
    setStudentBoundState(isBound);
    return isBound;
  } catch (error: any) {
    if (error?.response?.status !== 404) {
      console.error('Failed to check student binding state', error);
    }
    setStudentBoundState(false);
    return false;
  }
};

const goToRegister = () => {
  router.push('/register');
};

onMounted(async () => {
  updateViewportSize();
  restoreRememberedCredentials();
  await loadSecurityConfig();
  await loadRegisterStatus();
  restoreEmailChallenge();
  restoreRecoveryChallenge();
  bootCards();
  window.addEventListener('resize', updateViewportSize);
});

onBeforeUnmount(() => {
  clearTimer();
  clearRecoveryTimer();
  clearLoginActivationTimer();
  clearLoginBootTimer();
  window.removeEventListener('resize', updateViewportSize);
});
</script>

<style scoped src="../styles/login-judge-login.css"></style>
<style scoped>
.judge-shell {
  color-scheme: light;
  --text-main: #102132;
  --text-soft: #5d7180;
  --text-faint: #7b90a0;
  --line-soft: rgba(102, 134, 150, 0.16);
  --line-strong: rgba(15, 118, 110, 0.28);
  --shadow-soft: 0 24px 60px rgba(23, 46, 65, 0.12);
  --shadow-strong: 0 34px 90px rgba(17, 38, 56, 0.18);
  --shadow-accent: 0 18px 42px rgba(15, 118, 110, 0.22);
  --accent: #0f766e;
  --accent-strong: #14b8a6;
  --font-display: "MiSans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --font-body: "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif;
}

.login-form {
  display: block;
}

.login-alert--warning {
  border: 1px solid rgba(202, 138, 4, 0.18);
  background: rgba(255, 251, 235, 0.92);
  color: #9a6700;
}

.primary-button:disabled,
.ghost-button:disabled,
.secondary-button:disabled,
.captcha-button:disabled {
  cursor: not-allowed;
  opacity: 0.72;
  transform: none;
}

.remember-check {
  cursor: pointer;
}

.recovery-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.recovery-intro {
  margin: 0;
  color: #556878;
  line-height: 1.7;
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.channel-card {
  padding: 16px;
  border: 1px solid rgba(99, 132, 150, 0.16);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(247, 251, 252, 0.96), rgba(255, 255, 255, 0.84));
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 16px 34px rgba(40, 63, 81, 0.08);
}

.channel-card.active {
  border-color: rgba(15, 118, 110, 0.48);
  box-shadow:
    0 0 0 3px rgba(15, 118, 110, 0.12),
    0 18px 36px rgba(34, 64, 81, 0.12);
}

.channel-card.disabled,
.channel-card:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.channel-card p {
  margin: 10px 0 0;
  color: #6b7280;
  line-height: 1.6;
}

.channel-title {
  color: #102132;
  font-weight: 600;
}

.channel-value {
  margin-top: 8px;
  color: #0f766e;
  font-size: 15px;
  font-weight: 600;
  word-break: break-all;
}

.recovery-static {
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid rgba(97, 128, 145, 0.18);
  border-radius: 14px;
  background: rgba(248, 251, 252, 0.92);
  color: #102132;
  line-height: 22px;
  box-sizing: border-box;
}

@media (max-width: 720px) {
  .channel-grid {
    grid-template-columns: 1fr;
  }
}
</style>
