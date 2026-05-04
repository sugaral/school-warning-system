<template>
  <div class="system-config">
    <el-card v-loading="loading">
      <template #header>
        <div class="card-header">
          <span>系统配置</span>
          <div class="header-actions">
            <el-button @click="reloadConfig">重新加载</el-button>
            <el-button @click="resetForm">恢复默认</el-button>
            <el-button type="primary" :loading="saving" @click="saveConfig">
              保存配置
            </el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="基础设置" name="basic">
          <el-form :model="config.basic" label-width="150px">
            <el-form-item label="系统名称">
              <el-input v-model="config.basic.systemName" />
            </el-form-item>
            <el-form-item label="系统描述">
              <el-input v-model="config.basic.systemDescription" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="管理员邮箱">
              <el-input v-model="config.basic.adminEmail" />
            </el-form-item>
            <el-form-item label="联系电话">
              <el-input v-model="config.basic.contactPhone" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="登录提示" name="loginPrompt">
          <el-alert
            title="启用后，所有管理端用户登录后都会看到这条系统提示"
            type="info"
            :closable="false"
            show-icon
            class="notice-alert"
          />

          <el-form :model="config.loginPrompt" label-width="150px">
            <el-form-item label="启用登录提示">
              <el-switch v-model="config.loginPrompt.enabled" />
            </el-form-item>
            <el-form-item label="提示标题">
              <el-input
                v-model="config.loginPrompt.title"
                maxlength="40"
                show-word-limit
                placeholder="例如：系统提示"
              />
            </el-form-item>
            <el-form-item label="提示内容">
              <el-input
                v-model="config.loginPrompt.content"
                type="textarea"
                :rows="6"
                maxlength="2000"
                show-word-limit
                placeholder="用户登录管理端后会看到这段提示内容"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="安全设置" name="security">
          <el-form :model="config.security" label-width="170px">
            <el-form-item label="密码最小长度">
              <el-input-number v-model="config.security.minPasswordLength" :min="6" :max="20" />
            </el-form-item>
            <el-form-item label="密码过期天数">
              <el-input-number v-model="config.security.passwordExpireDays" :min="0" :max="365" />
              <span class="help-text">0 表示永不过期</span>
            </el-form-item>
            <el-form-item label="登录失败后锁定">
              <el-switch v-model="config.security.lockAfterFailedLogin" />
            </el-form-item>
            <el-form-item label="最大失败次数">
              <el-input-number v-model="config.security.maxFailedAttempts" :min="3" :max="10" />
            </el-form-item>
            <el-form-item label="锁定时长（分钟）">
              <el-input-number v-model="config.security.lockDurationMinutes" :min="5" :max="1440" />
            </el-form-item>
            <el-form-item label="会话超时（分钟）">
              <el-input-number
                v-model="config.security.sessionTimeoutMinutes"
                :min="30"
                :max="1440"
              />
              <span class="help-text">2FA 与图形验证码请在“2FA 管理”中单独维护</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="邮箱设置" name="email">
          <el-alert
            title="推荐使用 QQ 邮箱 SMTP"
            type="info"
            :closable="false"
            show-icon
            class="notice-alert"
          >
            <template #default>
              建议填写 `smtp.qq.com`、端口 `465`、开启 `SSL`，并使用邮箱后台生成的 SMTP 授权码，
              不要直接填写邮箱登录密码。
            </template>
          </el-alert>

          <el-form :model="config.email" label-width="190px">
            <el-form-item label="启用邮箱服务">
              <el-switch v-model="config.email.enabled" />
            </el-form-item>
            <el-form-item label="SMTP 服务商">
              <div class="inline-row">
                <el-select v-model="config.email.smtpProvider" style="width: 180px">
                  <el-option label="QQ 邮箱" value="qq" />
                </el-select>
                <el-button @click="applyQqDefaults">填充 QQ 默认配置</el-button>
              </div>
            </el-form-item>
            <el-form-item label="SMTP 服务器">
              <el-input v-model="config.email.smtpHost" placeholder="smtp.qq.com" />
            </el-form-item>
            <el-form-item label="SMTP 端口">
              <el-input-number v-model="config.email.smtpPort" :min="1" :max="65535" />
            </el-form-item>
            <el-form-item label="启用 SSL">
              <el-switch v-model="config.email.smtpSecure" />
            </el-form-item>
            <el-form-item label="SMTP 登录账号">
              <el-input v-model="config.email.smtpUser" placeholder="请输入完整邮箱地址" />
            </el-form-item>
            <el-form-item label="SMTP 授权码">
              <el-input
                v-model="config.email.smtpPass"
                type="password"
                show-password
                placeholder="请输入 SMTP 授权码"
              />
            </el-form-item>
            <el-form-item label="发件邮箱">
              <el-input
                v-model="config.email.smtpFrom"
                placeholder="通常与 SMTP 登录账号保持一致"
              />
            </el-form-item>
            <el-form-item label="发件人名称">
              <el-input v-model="config.email.smtpFromName" />
            </el-form-item>
            <el-form-item label="重试次数">
              <el-input-number v-model="config.email.retryCount" :min="0" :max="10" />
            </el-form-item>
            <el-form-item label="重试间隔（分钟）">
              <el-input-number
                v-model="config.email.retryIntervalMinutes"
                :min="1"
                :max="120"
              />
            </el-form-item>

            <el-divider content-position="left">开放 API</el-divider>

            <el-form-item label="启用开放接口">
              <el-switch v-model="config.email.openApiEnabled" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input
                v-model="config.email.openApiKey"
                type="password"
                show-password
                placeholder="供第三方调用邮件发送接口使用"
              />
            </el-form-item>
            <el-form-item label="接口地址">
              <el-input :model-value="emailOpenEndpoint" readonly />
            </el-form-item>
            <el-form-item label="鉴权方式">
              <div class="open-api-help">
                <div>请求头支持 `x-api-key: &lt;key&gt;` 或 `Authorization: Bearer &lt;key&gt;`。</div>
                <div>请求体支持直接传 `subject + text/html`，也支持 `template_code + params`。</div>
              </div>
            </el-form-item>
            <el-form-item label="接入示例">
              <pre class="api-snippet">{{ emailCurlExample }}</pre>
            </el-form-item>

            <el-divider content-position="left">测试发送</el-divider>

            <el-form-item label="测试邮箱">
              <div class="inline-row full-width">
                <el-input v-model="testEmail.to" placeholder="请输入收件邮箱" />
                <el-button type="primary" :loading="testingEmail" @click="sendTestEmail">
                  发送测试邮件
                </el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="短信设置" name="sms">
          <el-alert
            title="短信通道采用通用 HTTP 网关模式"
            type="warning"
            :closable="false"
            show-icon
            class="notice-alert"
          >
            <template #default>
              目前短信发送采用“自定义 HTTP 网关”接入方式。只要第三方短信平台支持 HTTP 接口，
              按下面的网关地址、请求头和请求体模板配置后即可直接使用。
            </template>
          </el-alert>

          <el-form :model="config.sms" label-width="190px">
            <el-form-item label="启用短信服务">
              <el-switch v-model="config.sms.enabled" />
            </el-form-item>
            <el-form-item label="服务标识">
              <el-select v-model="config.sms.provider" style="width: 240px">
                <el-option label="自定义 HTTP 网关" value="custom_http" />
                <el-option label="腾讯云（网关接入）" value="tencent" />
                <el-option label="阿里云（网关接入）" value="aliyun" />
                <el-option label="华为云（网关接入）" value="huawei" />
              </el-select>
            </el-form-item>
            <el-form-item label="短信签名">
              <el-input v-model="config.sms.signName" placeholder="例如：学业预警系统" />
            </el-form-item>
            <el-form-item label="网关地址">
              <el-input
                v-model="config.sms.gatewayUrl"
                placeholder="例如：https://sms-provider.example.com/send"
              />
            </el-form-item>
            <el-form-item label="请求方法">
              <el-select v-model="config.sms.gatewayMethod" style="width: 180px">
                <el-option label="POST" value="POST" />
                <el-option label="PUT" value="PUT" />
                <el-option label="PATCH" value="PATCH" />
                <el-option label="GET" value="GET" />
              </el-select>
            </el-form-item>
            <el-form-item label="请求头 JSON">
              <el-input
                v-model="config.sms.gatewayHeaders"
                type="textarea"
                :rows="5"
                placeholder='例如：{"Authorization":"Bearer xxx","Content-Type":"application/json"}'
              />
              <span class="help-text">需要填写合法 JSON 对象，不填则按默认请求头发送。</span>
            </el-form-item>
            <el-form-item label="请求体模板">
              <el-input
                v-model="config.sms.gatewayBodyTemplate"
                type="textarea"
                :rows="7"
                placeholder='例如：{"mobile":"{mobile}","content":"{content}","sign":"{sign_name}"}'
              />
              <span class="help-text">
                可用变量：`{mobile}`、`{mobiles}`、`{content}`、`{template_code}`、`{sign_name}`、`{timestamp}`。
              </span>
            </el-form-item>
            <el-form-item label="成功标识字段">
              <el-input
                v-model="config.sms.successField"
                placeholder="例如：code 或 data.success"
              />
            </el-form-item>
            <el-form-item label="成功标识值">
              <el-input
                v-model="config.sms.successValue"
                placeholder="例如：0、true、SUCCESS；留空则按字段是否为真判断"
              />
            </el-form-item>
            <el-form-item label="消息 ID 字段">
              <el-input
                v-model="config.sms.messageIdField"
                placeholder="例如：messageId 或 data.msgId"
              />
            </el-form-item>
            <el-form-item label="重试次数">
              <el-input-number v-model="config.sms.retryCount" :min="0" :max="10" />
            </el-form-item>
            <el-form-item label="重试间隔（分钟）">
              <el-input-number
                v-model="config.sms.retryIntervalMinutes"
                :min="1"
                :max="120"
              />
            </el-form-item>

            <el-divider content-position="left">开放 API</el-divider>

            <el-form-item label="启用开放接口">
              <el-switch v-model="config.sms.openApiEnabled" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input
                v-model="config.sms.openApiKey"
                type="password"
                show-password
                placeholder="供第三方调用短信发送接口使用"
              />
            </el-form-item>
            <el-form-item label="接口地址">
              <el-input :model-value="smsOpenEndpoint" readonly />
            </el-form-item>
            <el-form-item label="鉴权方式">
              <div class="open-api-help">
                <div>请求头支持 `x-api-key: &lt;key&gt;` 或 `Authorization: Bearer &lt;key&gt;`。</div>
                <div>请求体支持直接传 `content`，也支持 `template_code + params` 模板化发送。</div>
              </div>
            </el-form-item>
            <el-form-item label="接入示例">
              <pre class="api-snippet">{{ smsCurlExample }}</pre>
            </el-form-item>

            <el-divider content-position="left">测试发送</el-divider>

            <el-form-item label="测试手机号">
              <el-input v-model="testSms.mobile" placeholder="请输入接收短信的手机号" />
            </el-form-item>
            <el-form-item label="测试内容">
              <el-input
                v-model="testSms.content"
                type="textarea"
                :rows="3"
                placeholder="留空时自动使用 SYSTEM_TEST_SMS 模板"
              />
            </el-form-item>
            <el-form-item label="发送测试短信">
              <el-button type="primary" :loading="testingSms" @click="sendTestSms">
                发送测试短信
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="存储设置" name="storage">
          <el-form :model="config.storage" label-width="170px">
            <el-form-item label="存储类型">
              <el-radio-group v-model="config.storage.type">
                <el-radio label="local">本地存储</el-radio>
                <el-radio label="oss">对象存储</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="config.storage.type === 'local'" label="上传路径">
              <el-input v-model="config.storage.uploadPath" />
            </el-form-item>
            <el-form-item label="最大文件大小（MB）">
              <el-input-number v-model="config.storage.maxFileSize" :min="1" :max="500" />
            </el-form-item>
            <el-form-item label="允许的文件类型">
              <el-input
                v-model="config.storage.allowedTypes"
                type="textarea"
                :rows="3"
                placeholder=".jpg,.png,.pdf,.xlsx"
              />
            </el-form-item>
            <el-form-item v-if="config.storage.type === 'oss'" label="OSS 提供商">
              <el-select v-model="config.storage.ossProvider">
                <el-option label="阿里云 OSS" value="aliyun" />
                <el-option label="腾讯云 COS" value="tencent" />
                <el-option label="华为云 OBS" value="huawei" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="config.storage.type === 'oss'" label="Bucket">
              <el-input v-model="config.storage.ossBucket" />
            </el-form-item>
            <el-form-item v-if="config.storage.type === 'oss'" label="Region">
              <el-input v-model="config.storage.ossRegion" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="预警设置" name="warning">
          <el-form :model="config.warning" label-width="190px">
            <el-form-item label="默认预警级别">
              <el-select v-model="config.warning.defaultLevel">
                <el-option label="黄色预警" value="yellow" />
                <el-option label="橙色预警" value="orange" />
                <el-option label="红色预警" value="red" />
                <el-option label="严重预警" value="severe" />
              </el-select>
            </el-form-item>
            <el-form-item label="自动关闭预警">
              <el-switch v-model="config.warning.autoClose" />
            </el-form-item>
            <el-form-item label="自动关闭天数">
              <el-input-number v-model="config.warning.autoCloseDays" :min="1" :max="365" />
            </el-form-item>
            <el-form-item label="自动升级预警">
              <el-switch v-model="config.warning.autoEscalate" />
            </el-form-item>
            <el-form-item label="最高升级级别">
              <el-select v-model="config.warning.maxEscalateLevel">
                <el-option label="黄色预警" value="yellow" />
                <el-option label="橙色预警" value="orange" />
                <el-option label="红色预警" value="red" />
                <el-option label="严重预警" value="severe" />
              </el-select>
            </el-form-item>
            <el-form-item label="扫描间隔（分钟）">
              <el-input-number v-model="config.warning.scanIntervalMinutes" :min="1" :max="60" />
            </el-form-item>
            <el-form-item label="后台预警并发数">
              <el-input-number v-model="config.warning.recalcConcurrency" :min="1" :max="12" />
              <span class="help-text">用于后台批量预警重算，数值越大越吃 CPU 和数据库连接。</span>
            </el-form-item>
            <el-form-item label="结束签到预警并发数">
              <el-input-number v-model="config.warning.syncRecalcConcurrency" :min="1" :max="8" />
              <span class="help-text">用于结束签到后后台生成预警，建议按服务器核数调优。</span>
            </el-form-item>
            <el-form-item label="二维码刷新时间（秒）">
              <el-input-number v-model="config.warning.qrRefreshSeconds" :min="5" :max="7200" />
              <span class="help-text">只控制二维码刷新频率，不再作为签到截止时间使用。</span>
            </el-form-item>

            <el-divider content-position="left">缺课提醒邮件</el-divider>

            <el-form-item label="启用缺课邮件提醒">
              <el-switch v-model="config.warning.absentEmailAlertEnabled" />
            </el-form-item>
            <el-form-item label="触发缺课次数">
              <el-input-number
                v-model="config.warning.absentEmailThreshold"
                :min="1"
                :max="999"
              />
              <span class="help-text">达到该次数后系统会向学生发送提醒邮件。</span>
            </el-form-item>
            <el-form-item label="邮件模板代码">
              <el-select
                v-model="config.warning.absentEmailTemplateCode"
                filterable
                allow-create
                default-first-option
                style="width: 100%"
                placeholder="请选择或输入邮件模板代码"
              >
                <el-option
                  v-for="item in emailTemplates"
                  :key="item.template_code"
                  :label="`${item.template_code} - ${item.title || '未命名模板'}`"
                  :value="item.template_code"
                />
              </el-select>
              <span class="help-text">建议使用 `ABSENT_THRESHOLD_EMAIL`。</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="日志设置" name="logging">
          <el-form :model="config.logging" label-width="170px">
            <el-form-item label="日志级别">
              <el-select v-model="config.logging.level">
                <el-option label="DEBUG" value="debug" />
                <el-option label="INFO" value="info" />
                <el-option label="WARN" value="warn" />
                <el-option label="ERROR" value="error" />
              </el-select>
            </el-form-item>
            <el-form-item label="日志保留天数">
              <el-input-number v-model="config.logging.retentionDays" :min="7" :max="365" />
            </el-form-item>
            <el-form-item label="启用审计日志">
              <el-switch v-model="config.logging.enableAuditLog" />
            </el-form-item>
            <el-form-item label="启用安全日志">
              <el-switch v-model="config.logging.enableSecurityLog" />
            </el-form-item>
            <el-form-item label="启用性能日志">
              <el-switch v-model="config.logging.enablePerformanceLog" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="账号配置" name="account">
          <el-form :model="config.account" label-width="170px">
            <el-form-item label="开放用户注册">
              <el-switch v-model="config.account.openRegistration" />
            </el-form-item>
            <el-form-item label="启用统一默认密码">
              <el-switch v-model="config.account.enableDefaultPassword" />
            </el-form-item>
            <el-form-item label="统一默认密码">
              <el-input
                v-model="config.account.defaultPassword"
                placeholder="留空则按规则随机生成"
              />
            </el-form-item>
            <el-form-item label="默认密码长度">
              <el-input-number
                v-model="config.account.defaultPasswordLength"
                :min="6"
                :max="16"
              />
            </el-form-item>
            <el-form-item label="默认密码类型">
              <el-select v-model="config.account.defaultPasswordType">
                <el-option label="纯数字" value="digits" />
                <el-option label="纯字母" value="letters" />
                <el-option label="数字加字母" value="mixed" />
                <el-option label="大小写混合" value="mixed_random" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="导入模板设置" name="import-templates">
          <ImportTemplateConfig />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';
import ImportTemplateConfig from './ImportTemplateConfig.vue';

type AnyRecord = Record<string, any>;

const activeTab = ref('email');
const loading = ref(false);
const saving = ref(false);
const testingEmail = ref(false);
const testingSms = ref(false);
const emailTemplates = ref<Array<{ template_code: string; title?: string | null }>>([]);

const emailOpenEndpoint = '/admin/config/open/email/send';
const smsOpenEndpoint = '/admin/config/open/sms/send';

const createDefaultConfig = () => ({
  basic: {
    systemName: '学业预警系统',
    systemDescription: '学生学业预警与过程管理平台',
    adminEmail: '',
    contactPhone: '',
  },
  loginPrompt: {
    enabled: false,
    title: '系统提示',
    content: '',
  },
  security: {
    minPasswordLength: 8,
    passwordExpireDays: 90,
    lockAfterFailedLogin: true,
    maxFailedAttempts: 5,
    lockDurationMinutes: 30,
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
    sessionTimeoutMinutes: 120,
  },
  email: {
    enabled: true,
    smtpProvider: 'qq',
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpFromName: '学业预警系统',
    retryCount: 3,
    retryIntervalMinutes: 5,
    openApiEnabled: false,
    openApiKey: '',
  },
  sms: {
    enabled: false,
    provider: 'custom_http',
    signName: '',
    gatewayUrl: '',
    gatewayMethod: 'POST',
    gatewayHeaders: '',
    gatewayBodyTemplate: '',
    successField: '',
    successValue: '',
    messageIdField: 'messageId',
    retryCount: 3,
    retryIntervalMinutes: 5,
    openApiEnabled: false,
    openApiKey: '',
  },
  storage: {
    type: 'local',
    uploadPath: '/uploads',
    maxFileSize: 50,
    allowedTypes: '.jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx',
    ossProvider: 'aliyun',
    ossBucket: '',
    ossRegion: '',
  },
  warning: {
    defaultLevel: 'yellow',
    autoClose: false,
    autoCloseDays: 30,
    autoEscalate: true,
    maxEscalateLevel: 'severe',
    scanIntervalMinutes: 5,
    recalcConcurrency: 4,
    syncRecalcConcurrency: 6,
    qrRefreshSeconds: 900,
    absentEmailAlertEnabled: false,
    absentEmailThreshold: 3,
    absentEmailTemplateCode: 'ABSENT_THRESHOLD_EMAIL',
  },
  logging: {
    level: 'info',
    retentionDays: 90,
    enableAuditLog: true,
    enableSecurityLog: true,
    enablePerformanceLog: false,
  },
  account: {
    openRegistration: true,
    enableDefaultPassword: true,
    defaultPassword: '',
    defaultPasswordLength: 8,
    defaultPasswordType: 'digits',
  },
});

const config = ref(createDefaultConfig());
const testEmail = reactive({ to: '' });
const testSms = reactive({ mobile: '', content: '' });

const formatJsonForEditor = (value: unknown) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return '';
    }

    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  return String(value);
};

const parseJsonObjectText = (label: string, text: string) => {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(`${label}必须是合法的 JSON 对象`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }

  return parsed as Record<string, string>;
};

const mergeConfig = (incoming: AnyRecord = {}) => {
  const defaults = createDefaultConfig();
  const incomingSecurity = incoming.security || {};
  const incomingEmail = incoming.email || incoming.notification || {};
  const incomingSms = incoming.sms || {};
  const secondFactorMode =
    incomingSecurity.secondFactorMode ||
    (incomingSecurity.enable2FA ? 'email' : 'none');

  return {
    ...defaults,
    ...incoming,
    basic: { ...defaults.basic, ...(incoming.basic || {}) },
    loginPrompt: {
      ...defaults.loginPrompt,
      ...(incoming.loginPrompt || incoming.login_prompt || {}),
    },
    security: {
      ...defaults.security,
      ...incomingSecurity,
      secondFactorMode,
      enable2FA: secondFactorMode !== 'none',
    },
    email: {
      ...defaults.email,
      ...incomingEmail,
    },
    sms: {
      ...defaults.sms,
      ...incomingSms,
      gatewayHeaders: formatJsonForEditor(incomingSms.gatewayHeaders ?? defaults.sms.gatewayHeaders),
    },
    storage: { ...defaults.storage, ...(incoming.storage || {}) },
    warning: {
      ...defaults.warning,
      ...(incoming.warning || {}),
      qrRefreshSeconds: Math.max(
        5,
        Number(
          incoming.warning?.qrRefreshSeconds ??
            ((incoming.warning?.qrRefreshMinutes || defaults.warning.qrRefreshSeconds / 60) * 60),
        ) || defaults.warning.qrRefreshSeconds,
      ),
    },
    logging: { ...defaults.logging, ...(incoming.logging || {}) },
    account: { ...defaults.account, ...(incoming.account || {}) },
  };
};

const emailCurlExample = computed(() => {
  return [
    `curl -X POST "${emailOpenEndpoint}" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "x-api-key: your-api-key" \\',
    '  -d "{',
    '    \\"to\\": \\"user@example.com\\",',
    '    \\"subject\\": \\"系统通知\\",',
    '    \\"text\\": \\"这是一封开放接口测试邮件\\"',
    '  }"',
  ].join('\n');
});

const smsCurlExample = computed(() => {
  return [
    `curl -X POST "${smsOpenEndpoint}" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "x-api-key: your-api-key" \\',
    '  -d "{',
    '    \\"mobile\\": \\"13800138000\\",',
    '    \\"content\\": \\"【学业预警系统】这是一条开放接口测试短信\\"',
    '  }"',
  ].join('\n');
});

const syncTestTargets = () => {
  testEmail.to =
    config.value.basic.adminEmail ||
    config.value.email.smtpFrom ||
    config.value.email.smtpUser ||
    '';

  if (!testSms.mobile) {
    testSms.mobile = config.value.basic.contactPhone || '';
  }
};

const applyQqDefaults = () => {
  config.value.email.smtpProvider = 'qq';
  config.value.email.smtpHost = 'smtp.qq.com';
  config.value.email.smtpPort = 465;
  config.value.email.smtpSecure = true;
  if (!config.value.email.smtpFromName) {
    config.value.email.smtpFromName = config.value.basic.systemName || '学业预警系统';
  }
};

const normalizeConfigForSubmit = () => {
  const payload = JSON.parse(JSON.stringify(config.value));

  payload.security.enable2FA = payload.security.secondFactorMode !== 'none';
  payload.loginPrompt.title = String(payload.loginPrompt.title || '').trim() || '系统提示';
  payload.loginPrompt.content = String(payload.loginPrompt.content || '').trim();

  if (!payload.email.smtpFrom && payload.email.smtpUser) {
    payload.email.smtpFrom = payload.email.smtpUser;
  }

  if (!payload.email.smtpFromName) {
    payload.email.smtpFromName = payload.basic.systemName || '学业预警系统';
  }

  if (!payload.warning.absentEmailTemplateCode) {
    payload.warning.absentEmailTemplateCode = 'ABSENT_THRESHOLD_EMAIL';
  }

  payload.warning.qrRefreshSeconds = Math.min(
    7200,
    Math.max(5, Number(payload.warning.qrRefreshSeconds || 900)),
  );
  payload.warning.recalcConcurrency = Math.min(
    12,
    Math.max(1, Number(payload.warning.recalcConcurrency || 4)),
  );
  payload.warning.syncRecalcConcurrency = Math.min(
    8,
    Math.max(1, Number(payload.warning.syncRecalcConcurrency || 6)),
  );
  payload.warning.qrRefreshMinutes = Math.max(
    1,
    Math.ceil(payload.warning.qrRefreshSeconds / 60),
  );

  payload.sms.gatewayHeaders = parseJsonObjectText('短信请求头', payload.sms.gatewayHeaders);

  return payload;
};

const fetchEmailTemplates = async () => {
  try {
    const response = await api.get('/admin/config/templates', {
      params: {
        channel: 'email',
      },
    });
    emailTemplates.value = Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (error: any) {
    ElMessage.warning(error?.message || '加载邮件模板列表失败');
  }
};

const fetchConfig = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/config');
    config.value = mergeConfig(response.data?.data || {});
    if (!config.value.email.smtpFromName) {
      config.value.email.smtpFromName = config.value.basic.systemName || '学业预警系统';
    }
    syncTestTargets();
  } catch (error: any) {
    ElMessage.error(error?.message || '获取系统配置失败');
  } finally {
    loading.value = false;
  }
};

const saveConfig = async () => {
  saving.value = true;
  try {
    const payload = normalizeConfigForSubmit();
    await api.post('/admin/config', payload);
    config.value = mergeConfig(payload);
    syncTestTargets();
    ElMessage.success('系统配置已保存');
    await fetchEmailTemplates();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存系统配置失败');
  } finally {
    saving.value = false;
  }
};

const sendTestEmail = async () => {
  if (!testEmail.to.trim()) {
    ElMessage.warning('请先输入测试邮箱');
    return;
  }

  testingEmail.value = true;
  try {
    await api.post('/admin/config/email/test', { to: testEmail.to.trim() });
    ElMessage.success('测试邮件已发送，请检查收件箱');
  } catch (error: any) {
    ElMessage.error(error?.message || '测试邮件发送失败');
  } finally {
    testingEmail.value = false;
  }
};

const sendTestSms = async () => {
  if (!testSms.mobile.trim()) {
    ElMessage.warning('请先输入测试手机号');
    return;
  }

  testingSms.value = true;
  try {
    await api.post('/admin/config/sms/test', {
      mobile: testSms.mobile.trim(),
      content: testSms.content.trim() || undefined,
    });
    ElMessage.success('测试短信已发送，请检查手机是否收到');
  } catch (error: any) {
    ElMessage.error(error?.message || '测试短信发送失败');
  } finally {
    testingSms.value = false;
  }
};

const reloadConfig = async () => {
  await Promise.all([fetchConfig(), fetchEmailTemplates()]);
  ElMessage.success('系统配置已重新加载');
};

const resetForm = async () => {
  try {
    await ElMessageBox.confirm(
      '将表单恢复为默认值，未保存的修改会丢失，是否继续？',
      '提示',
      { type: 'warning' },
    );

    const currentSecurity = { ...config.value.security };
    const nextDefaults = createDefaultConfig();
    config.value = {
      ...nextDefaults,
      security: {
        ...nextDefaults.security,
        secondFactorMode: currentSecurity.secondFactorMode,
        enable2FA: currentSecurity.enable2FA,
        loginCaptchaEnabled: currentSecurity.loginCaptchaEnabled,
        captchaLength: currentSecurity.captchaLength,
        captchaExpireSeconds: currentSecurity.captchaExpireSeconds,
        captchaRefreshLimit: currentSecurity.captchaRefreshLimit,
        captchaRefreshWindowSeconds: currentSecurity.captchaRefreshWindowSeconds,
        captchaMaxVerifyAttempts: currentSecurity.captchaMaxVerifyAttempts,
        emailCodeExpireSeconds: currentSecurity.emailCodeExpireSeconds,
        emailCodeCooldownSeconds: currentSecurity.emailCodeCooldownSeconds,
      },
    };
    syncTestTargets();
  } catch {
    // ignore cancel
  }
};

onMounted(async () => {
  await Promise.all([fetchConfig(), fetchEmailTemplates()]);
});
</script>

<style scoped>
.system-config {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.notice-alert {
  margin-bottom: 20px;
}

.help-text {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}

.inline-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.full-width {
  width: 100%;
}

.full-width :deep(.el-input) {
  flex: 1;
}

.open-api-help {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #606266;
  line-height: 1.6;
}

.api-snippet {
  width: 100%;
  margin: 0;
  padding: 14px 16px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
  overflow: auto;
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 12px;
}
</style>
