<template>
  <div class="audit-page">
    <section class="audit-hero">
      <div class="audit-hero__copy">
        <span class="audit-hero__eyebrow">Trace Center</span>
        <h2 class="audit-hero__title">审计中心</h2>
        <p class="audit-hero__desc">集中查看操作日志、消息发送审计和安全事件，并支持按页签分批清理历史记录。</p>
      </div>
      <div class="audit-hero__actions">
        <div class="audit-hero__meta">
          <span>当前视图</span>
          <strong>{{ currentTabLabel }}</strong>
          <small>本页 {{ currentTabPageCount }} 条 / 总计 {{ currentTabTotal }}</small>
        </div>
      </div>
    </section>

    <section class="audit-overview">
      <article class="audit-overview__card">
        <span class="audit-overview__label">操作日志</span>
        <strong class="audit-overview__value">{{ operationPagination.total }}</strong>
        <p class="audit-overview__desc">系统操作行为的累计审计记录</p>
      </article>
      <article class="audit-overview__card">
        <span class="audit-overview__label">消息发送</span>
        <strong class="audit-overview__value">{{ notificationPagination.total }}</strong>
        <p class="audit-overview__desc">通知渠道的发送历史与失败信息</p>
      </article>
      <article class="audit-overview__card">
        <span class="audit-overview__label">安全事件</span>
        <strong class="audit-overview__value">{{ securityPagination.total }}</strong>
        <p class="audit-overview__desc">登录、鉴权与关键安全事件轨迹</p>
      </article>
      <article class="audit-overview__card">
        <span class="audit-overview__label">当前选中</span>
        <strong class="audit-overview__value">{{ currentSelectionCount }}</strong>
        <p class="audit-overview__desc">当前页签中可执行批量删除的记录数</p>
      </article>
    </section>

    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="操作日志" name="operations">
        <div class="search-bar">
          <el-input
            v-model="operationSearch.action"
            placeholder="搜索操作类型"
            style="width: 220px"
            clearable
          />
          <el-select
            v-model="operationSearch.entityType"
            placeholder="选择操作资源"
            style="width: 180px"
            clearable
          >
            <el-option label="全部" value="" />
            <el-option
              v-for="type in entityTypes"
              :key="type"
              :label="formatResource(type)"
              :value="type"
            />
          </el-select>
          <el-date-picker
            v-model="operationDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
          <el-button type="primary" :loading="loadingOperations" @click="searchOperations">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetOperationSearch">重置</el-button>
          <el-button
            type="danger"
            :disabled="selectedOperationIds.length === 0"
            @click="batchDeleteOperations"
          >
            批量删除{{ selectedOperationIds.length ? `(${selectedOperationIds.length})` : '' }}
          </el-button>
        </div>

        <div class="table-shell">
        <el-table
          v-loading="loadingOperations"
          :data="operationLogs"
          stripe
          @selection-change="handleOperationSelectionChange"
        >
          <el-table-column type="selection" width="52" />
          <el-table-column prop="id" label="ID" width="90" />
          <el-table-column prop="operator" label="操作人" width="180" />
          <el-table-column label="操作类型" width="180">
            <template #default="{ row }">
              <el-tag type="primary" size="small">
                {{ row.actionDesc || formatAction(row.action) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作资源" width="180">
            <template #default="{ row }">
              {{ row.resourceDesc || formatResource(row.resource) }}
            </template>
          </el-table-column>
          <el-table-column prop="ip" label="IP 地址" width="170" />
          <el-table-column label="操作时间" width="190">
            <template #default="{ row }">
              {{ formatDateTime(row.timestamp) }}
            </template>
          </el-table-column>
          <el-table-column label="详情摘要" min-width="280" show-overflow-tooltip>
            <template #default="{ row }">
              {{ summarizeOperationDetail(row) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click="viewOperationDetail(row)">详情</el-button>
              <el-button link type="danger" size="small" @click="deleteOperation(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="operationPagination.page"
            v-model:page-size="operationPagination.pageSize"
            :total="operationPagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadOperationLogs"
            @size-change="loadOperationLogs"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="消息发送审计" name="notifications">
        <div class="search-bar">
          <el-input
            v-model="notificationSearch.receiver"
            placeholder="搜索接收人"
            style="width: 220px"
            clearable
          />
          <el-select
            v-model="notificationSearch.status"
            placeholder="发送状态"
            style="width: 160px"
            clearable
          >
            <el-option label="全部" value="" />
            <el-option label="发送成功" value="success" />
            <el-option label="发送失败" value="failed" />
            <el-option label="发送中" value="sending" />
            <el-option label="已送达" value="delivered" />
          </el-select>
          <el-select
            v-model="notificationSearch.channel"
            placeholder="发送渠道"
            style="width: 160px"
            clearable
          >
            <el-option label="全部" value="" />
            <el-option label="微信" value="wechat" />
            <el-option label="短信" value="sms" />
            <el-option label="邮件" value="email" />
          </el-select>
          <el-date-picker
            v-model="notificationDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
          <el-button type="primary" :loading="loadingNotifications" @click="searchNotifications">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetNotificationSearch">重置</el-button>
          <el-button
            type="danger"
            :disabled="selectedNotificationIds.length === 0"
            @click="batchDeleteNotificationsAction"
          >
            批量删除{{ selectedNotificationIds.length ? `(${selectedNotificationIds.length})` : '' }}
          </el-button>
        </div>

        <div class="table-shell">
        <el-table
          v-loading="loadingNotifications"
          :data="notificationLogs"
          stripe
          @selection-change="handleNotificationSelectionChange"
        >
          <el-table-column type="selection" width="52" />
          <el-table-column prop="id" label="ID" width="90" />
          <el-table-column prop="recipient" label="接收人" width="220" />
          <el-table-column label="发送渠道" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="getChannelType(row.channel)">
                {{ getChannelText(row.channel) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="content" label="消息内容" show-overflow-tooltip />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)">
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="发送时间" width="190">
            <template #default="{ row }">
              {{ formatDateTime(row.sentAt) }}
            </template>
          </el-table-column>
          <el-table-column label="错误信息" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.errorMessage" class="error-text">{{ row.errorMessage }}</span>
              <span v-else class="muted-text">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="deleteNotification(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="notificationPagination.page"
            v-model:page-size="notificationPagination.pageSize"
            :total="notificationPagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadNotificationLogs"
            @size-change="loadNotificationLogs"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="安全事件" name="security">
        <div class="search-bar">
          <el-input
            v-model="securitySearch.user"
            placeholder="搜索用户"
            style="width: 220px"
            clearable
          />
          <el-select
            v-model="securitySearch.eventType"
            placeholder="事件类型"
            style="width: 180px"
            clearable
          >
            <el-option label="全部" value="" />
            <el-option label="登录成功" value="login_success" />
            <el-option label="登录失败" value="login_failed" />
            <el-option label="2FA 失败" value="mfa_failed" />
            <el-option label="权限变更" value="permission_change" />
            <el-option label="数据变更" value="data_change" />
          </el-select>
          <el-date-picker
            v-model="securityDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
          />
          <el-button type="primary" :loading="loadingSecurityEvents" @click="searchSecurityEvents">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetSecuritySearch">重置</el-button>
          <el-button
            type="danger"
            :disabled="selectedSecurityIds.length === 0"
            @click="batchDeleteSecurityEventsAction"
          >
            批量删除{{ selectedSecurityIds.length ? `(${selectedSecurityIds.length})` : '' }}
          </el-button>
        </div>

        <div class="table-shell">
        <el-table
          v-loading="loadingSecurityEvents"
          :data="securityEvents"
          stripe
          @selection-change="handleSecuritySelectionChange"
        >
          <el-table-column type="selection" width="52" />
          <el-table-column prop="id" label="ID" width="90" />
          <el-table-column label="事件类型" width="150">
            <template #default="{ row }">
              <el-tag size="small" :type="getEventTypeColor(row.eventType)">
                {{ getEventTypeText(row.eventType) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="user" label="用户" width="180" />
          <el-table-column prop="ip" label="IP 地址" width="170" />
          <el-table-column label="详情摘要" show-overflow-tooltip>
            <template #default="{ row }">
              {{ summarizeDetail(row.detail) }}
            </template>
          </el-table-column>
          <el-table-column label="发生时间" width="190">
            <template #default="{ row }">
              {{ formatDateTime(row.timestamp) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link size="small" @click="viewSecurityDetail(row)">详情</el-button>
              <el-button link type="danger" size="small" @click="deleteSecurity(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="securityPagination.page"
            v-model:page-size="securityPagination.pageSize"
            :total="securityPagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            @current-change="loadSecurityEvents"
            @size-change="loadSecurityEvents"
          />
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="showOperationDetailDialog" title="操作日志详情" width="860px">
      <div v-if="operationDetail" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="ID">{{ operationDetail.id }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ operationDetail.operator }}</el-descriptions-item>
          <el-descriptions-item label="操作人邮箱">{{ operationDetail.operatorEmail || '-' }}</el-descriptions-item>
          <el-descriptions-item label="操作人手机号">{{ operationDetail.operatorMobile || '-' }}</el-descriptions-item>
          <el-descriptions-item label="操作类型">
            <el-tag size="small" type="primary">
              {{ operationDetail.actionDesc || formatAction(operationDetail.action) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="操作资源">
            {{ operationDetail.resourceDesc || formatResource(operationDetail.resource) }}
          </el-descriptions-item>
          <el-descriptions-item label="IP 地址">{{ operationDetail.ip || '-' }}</el-descriptions-item>
          <el-descriptions-item label="操作时间">
            {{ formatDateTime(operationDetail.timestamp) }}
          </el-descriptions-item>
          <el-descriptions-item label="User-Agent" :span="2">
            {{ operationDetail.userAgent || '-' }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <h4 class="dialog-title">数据变更对比</h4>
        <div class="diff-container">
          <div class="diff-section">
            <h5>变更前</h5>
            <pre class="json-display">{{ formatJson(operationDetail.before) }}</pre>
          </div>
          <div class="diff-section">
            <h5>变更后</h5>
            <pre class="json-display">{{ formatJson(operationDetail.after) }}</pre>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showOperationDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showSecurityDetailDialog" title="安全事件详情" width="760px">
      <div v-if="securityDetail" class="detail-content">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="ID">{{ securityDetail.id }}</el-descriptions-item>
          <el-descriptions-item label="事件类型">
            <el-tag size="small" :type="getEventTypeColor(securityDetail.eventType)">
              {{ getEventTypeText(securityDetail.eventType) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户">{{ securityDetail.user }}</el-descriptions-item>
          <el-descriptions-item label="用户邮箱">{{ securityDetail.userEmail || '-' }}</el-descriptions-item>
          <el-descriptions-item label="用户手机号">{{ securityDetail.userMobile || '-' }}</el-descriptions-item>
          <el-descriptions-item label="IP 地址">{{ securityDetail.ip || '-' }}</el-descriptions-item>
          <el-descriptions-item label="发生时间" :span="2">
            {{ formatDateTime(securityDetail.timestamp) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider />

        <h4 class="dialog-title">事件详情</h4>
        <pre class="json-display">{{ formatJson(securityDetail.detail) }}</pre>
      </div>

      <template #footer>
        <el-button @click="showSecurityDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import {
  batchDeleteNotificationLogs,
  batchDeleteOperationLogs,
  batchDeleteSecurityEvents,
  deleteNotificationLog,
  deleteOperationLog,
  deleteSecurityEvent,
  getNotificationLogs,
  getOperationLogDetail,
  getOperationLogs,
  getSecurityEventDetail,
  getSecurityEvents,
} from '../api';
import { formatDateTime } from '../lib/format';

const activeTab = ref('operations');

const operationLogs = ref<any[]>([]);
const loadingOperations = ref(false);
const operationSearch = reactive({ action: '', entityType: '' });
const operationDateRange = ref<any[]>([]);
const operationPagination = reactive({ page: 1, pageSize: 10, total: 0 });
const entityTypes = ref<string[]>([]);
const showOperationDetailDialog = ref(false);
const operationDetail = ref<any>(null);
const selectedOperationIds = ref<string[]>([]);

const notificationLogs = ref<any[]>([]);
const loadingNotifications = ref(false);
const notificationSearch = reactive({ receiver: '', status: '', channel: '' });
const notificationDateRange = ref<any[]>([]);
const notificationPagination = reactive({ page: 1, pageSize: 10, total: 0 });
const selectedNotificationIds = ref<string[]>([]);

const securityEvents = ref<any[]>([]);
const loadingSecurityEvents = ref(false);
const securitySearch = reactive({ user: '', eventType: '' });
const securityDateRange = ref<any[]>([]);
const securityPagination = reactive({ page: 1, pageSize: 10, total: 0 });
const showSecurityDetailDialog = ref(false);
const securityDetail = ref<any>(null);
const selectedSecurityIds = ref<string[]>([]);

const currentTabLabel = computed(() => {
  const map: Record<string, string> = {
    operations: '操作日志',
    notifications: '消息发送审计',
    security: '安全事件',
  };
  return map[activeTab.value] || '审计中心';
});

const currentTabTotal = computed(() => {
  if (activeTab.value === 'notifications') return notificationPagination.total;
  if (activeTab.value === 'security') return securityPagination.total;
  return operationPagination.total;
});

const currentTabPageCount = computed(() => {
  if (activeTab.value === 'notifications') return notificationLogs.value.length;
  if (activeTab.value === 'security') return securityEvents.value.length;
  return operationLogs.value.length;
});

const currentSelectionCount = computed(() => {
  if (activeTab.value === 'notifications') return selectedNotificationIds.value.length;
  if (activeTab.value === 'security') return selectedSecurityIds.value.length;
  return selectedOperationIds.value.length;
});

const actionTextMap: Record<string, string> = {
  view: '查看',
  login: '登录',
  logout: '退出',
  create: '创建',
  update: '更新',
  delete: '删除',
  import: '导入',
  export: '导出',
  approve: '审批',
  assign: '分配',
  complete: '完成',
  handle: '处理',
  checkin: '签到',
  status: '状态变更',
  enable: '启用',
  disable: '停用',
  bind: '绑定',
  unbind: '解绑',
  ack: '确认',
  clear: '清理',
  'batch-create': '批量创建',
  'batch-delete': '批量删除',
};

const resourceTextMap: Record<string, string> = {
  attendance: '签到',
  sessions: '签到',
  student: '学生',
  students: '学生',
  teacher: '教师',
  teachers: '教师',
  user: '用户',
  users: '用户',
  role: '角色',
  roles: '角色',
  permission: '权限',
  permissions: '权限',
  org: '组织',
  orgs: '组织',
  course: '课程',
  courses: '课程',
  schedule: '课表',
  schedules: '课表',
  'course-classes': '开课班',
  course_classes: '开课班',
  class: '班级',
  classes: '班级',
  warning: '预警',
  warnings: '预警',
  'warning-cases': '高风险干预',
  warning_cases: '高风险干预',
  leave_requests: '请假申请',
  makeup_requests: '补课申请',
  appeals: '申诉',
  rule: '规则',
  rules: '规则',
  config: '系统配置',
  notification: '通知',
  notifications: '通知',
  audit: '审计',
  admin: '管理端',
  teacher_bindings: '教师绑定',
  profile: '个人资料',
  report: '报表',
  reports: '报表',
  jobs: '任务',
};

const eventTypeTextMap: Record<string, string> = {
  login_success: '登录成功',
  login_failed: '登录失败',
  mfa_failed: '2FA 失败',
  permission_change: '权限变更',
  data_change: '数据变更',
  mfa_send_email: '发送邮箱验证码',
  mfa_send_failed: '验证码发送失败',
  register_success: '注册成功',
};

const formatDateParam = (value: string | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};



const formatJson = (value: any) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatResource = (value?: string) => resourceTextMap[value || ''] || value || '-';

const formatAction = (value?: string) => {
  if (!value) {
    return '-';
  }

  const segments = String(value).split('.').filter(Boolean);
  const actionKey = segments[segments.length - 1] || value;
  const actionText = actionTextMap[actionKey];
  if (!actionText) {
    return value;
  }

  if (actionKey === 'login' || actionKey === 'logout' || actionKey === 'checkin') {
    return actionText;
  }

  const resourceKey = segments.length > 1 ? segments[0] : '';
  const resourceText = formatResource(resourceKey);

  if (actionKey === 'status') {
    return resourceText !== '-'
      ? `${resourceText}状态变更`
      : actionText;
  }

  return resourceText !== '-'
    ? `${actionText}${resourceText}`
    : actionText;
};

const summarizeDetail = (detail: any) => {
  if (!detail) {
    return '-';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (
    detail &&
    typeof detail === 'object' &&
    detail.total !== undefined &&
    detail.success !== undefined &&
    detail.failed !== undefined
  ) {
    return `总 ${detail.total} 条 / 成功 ${detail.success} 条 / 失败 ${detail.failed} 条`;
  }
  if (detail.reason) {
    return String(detail.reason);
  }
  if (detail.account) {
    return `账号：${detail.account}`;
  }
  return JSON.stringify(detail);
};

const summarizeOperationDetail = (row: any) => {
  const candidate = row?.after ?? row?.before ?? null;
  return summarizeDetail(candidate);
};

const getStatusText = (status?: string) => {
  const map: Record<string, string> = {
    success: '发送成功',
    failed: '发送失败',
    sending: '发送中',
    delivered: '已送达',
  };
  return map[status || ''] || status || '-';
};

const getStatusType = (status?: string) => {
  if (status === 'success' || status === 'delivered') return 'success';
  if (status === 'failed') return 'danger';
  return 'warning';
};

const getChannelText = (channel?: string) => {
  const map: Record<string, string> = {
    wechat: '微信',
    sms: '短信',
    email: '邮件',
  };
  return map[channel || ''] || channel || '-';
};

const getChannelType = (channel?: string) => {
  const map: Record<string, string> = {
    wechat: 'success',
    sms: 'primary',
    email: 'info',
  };
  return map[channel || ''] || '';
};

const getEventTypeText = (eventType?: string) =>
  eventTypeTextMap[eventType || ''] || eventType || '-';

const getEventTypeColor = (eventType?: string) => {
  const map: Record<string, string> = {
    login_success: 'success',
    login_failed: 'danger',
    mfa_failed: 'danger',
    permission_change: 'warning',
    data_change: 'warning',
    mfa_send_failed: 'danger',
    register_success: 'success',
  };
  return map[eventType || ''] || 'info';
};

const loadOperationLogs = async () => {
  loadingOperations.value = true;
  try {
    const params: any = {
      page: operationPagination.page,
      pageSize: operationPagination.pageSize,
    };
    if (operationSearch.action) params.action = operationSearch.action;
    if (operationSearch.entityType) params.entityType = operationSearch.entityType;
    if (operationDateRange.value?.length === 2) {
      params.startDate = formatDateParam(operationDateRange.value[0]);
      params.endDate = formatDateParam(operationDateRange.value[1]);
    }

    const resp = await getOperationLogs(params);
    if (resp.code !== 0) throw new Error(resp.message || '加载操作日志失败');

    operationLogs.value = resp.data.list || [];
    selectedOperationIds.value = [];
    operationPagination.total = resp.data.pagination?.total || 0;
    entityTypes.value = Array.from(
      new Set((resp.data.list || []).map((item: any) => item.resource).filter(Boolean)),
    );
  } catch (error: any) {
    ElMessage.error(error?.message || '加载操作日志失败');
  } finally {
    loadingOperations.value = false;
  }
};

const loadNotificationLogs = async () => {
  loadingNotifications.value = true;
  try {
    const params: any = {
      page: notificationPagination.page,
      pageSize: notificationPagination.pageSize,
    };
    if (notificationSearch.receiver) params.receiver = notificationSearch.receiver;
    if (notificationSearch.status) params.status = notificationSearch.status;
    if (notificationSearch.channel) params.channel = notificationSearch.channel;
    if (notificationDateRange.value?.length === 2) {
      params.startDate = formatDateParam(notificationDateRange.value[0]);
      params.endDate = formatDateParam(notificationDateRange.value[1]);
    }

    const resp = await getNotificationLogs(params);
    if (resp.code !== 0) throw new Error(resp.message || '加载消息发送审计失败');

    notificationLogs.value = resp.data.list || [];
    selectedNotificationIds.value = [];
    notificationPagination.total = resp.data.pagination?.total || 0;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载消息发送审计失败');
  } finally {
    loadingNotifications.value = false;
  }
};

const loadSecurityEvents = async () => {
  loadingSecurityEvents.value = true;
  try {
    const params: any = {
      page: securityPagination.page,
      pageSize: securityPagination.pageSize,
    };
    if (securitySearch.user) params.user = securitySearch.user;
    if (securitySearch.eventType) params.eventType = securitySearch.eventType;
    if (securityDateRange.value?.length === 2) {
      params.startDate = formatDateParam(securityDateRange.value[0]);
      params.endDate = formatDateParam(securityDateRange.value[1]);
    }

    const resp = await getSecurityEvents(params);
    if (resp.code !== 0) throw new Error(resp.message || '加载安全事件失败');

    securityEvents.value = resp.data.list || [];
    selectedSecurityIds.value = [];
    securityPagination.total = resp.data.pagination?.total || 0;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载安全事件失败');
  } finally {
    loadingSecurityEvents.value = false;
  }
};

const searchOperations = async () => {
  operationPagination.page = 1;
  await loadOperationLogs();
};

const searchNotifications = async () => {
  notificationPagination.page = 1;
  await loadNotificationLogs();
};

const searchSecurityEvents = async () => {
  securityPagination.page = 1;
  await loadSecurityEvents();
};

const resetOperationSearch = async () => {
  operationSearch.action = '';
  operationSearch.entityType = '';
  operationDateRange.value = [];
  await searchOperations();
};

const resetNotificationSearch = async () => {
  notificationSearch.receiver = '';
  notificationSearch.status = '';
  notificationSearch.channel = '';
  notificationDateRange.value = [];
  await searchNotifications();
};

const resetSecuritySearch = async () => {
  securitySearch.user = '';
  securitySearch.eventType = '';
  securityDateRange.value = [];
  await searchSecurityEvents();
};

const handleOperationSelectionChange = (rows: any[]) => {
  selectedOperationIds.value = rows.map((row) => String(row.id));
};

const handleNotificationSelectionChange = (rows: any[]) => {
  selectedNotificationIds.value = rows.map((row) => String(row.id));
};

const handleSecuritySelectionChange = (rows: any[]) => {
  selectedSecurityIds.value = rows.map((row) => String(row.id));
};

const confirmDelete = async (message: string) => {
  await ElMessageBox.confirm(message, '确认删除', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消',
  });
};

const deleteOperation = async (row: any) => {
  try {
    await confirmDelete(`确定删除操作日志 ${row.id} 吗？`);
    const resp = await deleteOperationLog(String(row.id));
    if (resp.code !== 0) throw new Error(resp.message || '删除失败');
    ElMessage.success(resp.message || '删除成功');
    await loadOperationLogs();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const batchDeleteOperations = async () => {
  if (selectedOperationIds.value.length === 0) {
    ElMessage.warning('请先选择要删除的操作日志');
    return;
  }
  try {
    await confirmDelete(`确定批量删除 ${selectedOperationIds.value.length} 条操作日志吗？`);
    const resp = await batchDeleteOperationLogs(selectedOperationIds.value);
    if (resp.code !== 0) throw new Error(resp.message || '批量删除失败');
    ElMessage.success(resp.message || '批量删除成功');
    await loadOperationLogs();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '批量删除失败');
    }
  }
};

const deleteNotification = async (row: any) => {
  try {
    await confirmDelete(`确定删除消息发送记录 ${row.id} 吗？`);
    const resp = await deleteNotificationLog(String(row.id));
    if (resp.code !== 0) throw new Error(resp.message || '删除失败');
    ElMessage.success(resp.message || '删除成功');
    await loadNotificationLogs();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const batchDeleteNotificationsAction = async () => {
  if (selectedNotificationIds.value.length === 0) {
    ElMessage.warning('请先选择要删除的消息发送记录');
    return;
  }
  try {
    await confirmDelete(`确定批量删除 ${selectedNotificationIds.value.length} 条消息发送记录吗？`);
    const resp = await batchDeleteNotificationLogs(selectedNotificationIds.value);
    if (resp.code !== 0) throw new Error(resp.message || '批量删除失败');
    ElMessage.success(resp.message || '批量删除成功');
    await loadNotificationLogs();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '批量删除失败');
    }
  }
};

const deleteSecurity = async (row: any) => {
  try {
    await confirmDelete(`确定删除安全事件 ${row.id} 吗？`);
    const resp = await deleteSecurityEvent(String(row.id));
    if (resp.code !== 0) throw new Error(resp.message || '删除失败');
    ElMessage.success(resp.message || '删除成功');
    await loadSecurityEvents();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const batchDeleteSecurityEventsAction = async () => {
  if (selectedSecurityIds.value.length === 0) {
    ElMessage.warning('请先选择要删除的安全事件');
    return;
  }
  try {
    await confirmDelete(`确定批量删除 ${selectedSecurityIds.value.length} 条安全事件吗？`);
    const resp = await batchDeleteSecurityEvents(selectedSecurityIds.value);
    if (resp.code !== 0) throw new Error(resp.message || '批量删除失败');
    ElMessage.success(resp.message || '批量删除成功');
    await loadSecurityEvents();
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '批量删除失败');
    }
  }
};

const viewOperationDetail = async (row: any) => {
  try {
    const resp = await getOperationLogDetail(row.id);
    if (resp.code !== 0) throw new Error(resp.message || '加载操作日志详情失败');
    operationDetail.value = resp.data;
    showOperationDetailDialog.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载操作日志详情失败');
  }
};

const viewSecurityDetail = async (row: any) => {
  try {
    const resp = await getSecurityEventDetail(row.id);
    if (resp.code !== 0) throw new Error(resp.message || '加载安全事件详情失败');
    securityDetail.value = resp.data;
    showSecurityDetailDialog.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载安全事件详情失败');
  }
};

const handleTabChange = async (tabName: string | number) => {
  if (tabName === 'operations') {
    await loadOperationLogs();
    return;
  }
  if (tabName === 'notifications') {
    await loadNotificationLogs();
    return;
  }
  await loadSecurityEvents();
};

onMounted(async () => {
  await loadOperationLogs();
});
</script>

<style scoped>
.audit-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.audit-hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 18px;
  flex-wrap: wrap;
  padding: 24px 26px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 24px 48px rgba(34, 59, 78, 0.1);
}

.audit-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.audit-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.audit-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.audit-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.audit-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.audit-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.audit-hero__meta strong {
  color: #173145;
  font-size: 20px;
  line-height: 1.2;
}

.audit-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.audit-overview__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88),
    rgba(247, 251, 252, 0.8)
  );
  box-shadow: 0 18px 36px rgba(34, 59, 78, 0.08);
}

.audit-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.audit-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.audit-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.search-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dialog-title {
  margin: 0;
  color: #303133;
}

.diff-container {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.diff-section {
  min-width: 0;
}

.diff-section h5 {
  margin: 0 0 8px;
  color: #606266;
}

.json-display {
  margin: 0;
  padding: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.16);
  border-radius: 10px;
  min-height: 160px;
  white-space: pre-wrap;
  word-break: break-word;
  backdrop-filter: blur(14px);
}

.muted-text {
  color: #909399;
}

.error-text {
  color: #f56c6c;
}

@media (max-width: 900px) {
  .audit-hero {
    padding: 20px;
  }

  .audit-overview {
    grid-template-columns: 1fr;
  }

  .audit-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .audit-hero__actions > * {
    width: 100%;
  }

  .diff-container {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1200px) {
  .audit-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
