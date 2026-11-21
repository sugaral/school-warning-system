<template>
  <div class="attendance-page">
    <section class="attendance-hero">
      <div class="attendance-hero__copy">
        <span class="attendance-hero__eyebrow">Attendance Console</span>
        <h2 class="attendance-hero__title">签到管理</h2>
        <p class="attendance-hero__desc">统一查看课次、二维码刷新、签到截止和实时签到统计，并支持快速进入记录与应签到名单。</p>
      </div>
      <div class="attendance-hero__actions">
        <div class="attendance-hero__meta">
          <span>当前课次</span>
          <strong>{{ sessions.length }}</strong>
          <small>二维码刷新 {{ qrRefreshSeconds }} 秒</small>
          <small v-if="lastBatchCreatedSessionIds.length > 0">最近压测批次 {{ lastBatchCreatedSessionIds.length }} 条</small>
        </div>
        <el-button type="primary" @click="openCreateDialog">创建课次</el-button>
        <el-button type="success" :loading="batchCreatingSessions" @click="openBatchCreatePrompt">批量创建签到</el-button>
        <el-button
          type="warning"
          :loading="batchEndingSessions"
          :disabled="lastBatchCreatedSessionIds.length === 0"
          @click="endLatestBatchSessions"
        >
          批量结束签到
        </el-button>
        <el-button
          type="danger"
          :loading="bulkDeletingSessions"
          :disabled="sessions.length === 0"
          @click="deleteAllSessions"
        >
          一键删除所有签到
        </el-button>
        <el-button type="info" @click="loadDashboardData">刷新</el-button>
      </div>
    </section>

    <section class="attendance-overview">
      <article class="attendance-overview__card">
        <span class="attendance-overview__label">课次总数</span>
        <strong class="attendance-overview__value">{{ sessions.length }}</strong>
        <p class="attendance-overview__desc">当前已加载的全部签到课次</p>
      </article>
      <article class="attendance-overview__card">
        <span class="attendance-overview__label">未开始</span>
        <strong class="attendance-overview__value">{{ upcomingSessionCount }}</strong>
        <p class="attendance-overview__desc">尚未到达开始时间的课次数量</p>
      </article>
      <article class="attendance-overview__card">
        <span class="attendance-overview__label">进行中</span>
        <strong class="attendance-overview__value">{{ activeSessionCount }}</strong>
        <p class="attendance-overview__desc">正在进行签到中的课次数量</p>
      </article>
      <article class="attendance-overview__card">
        <span class="attendance-overview__label">应到总数</span>
        <strong class="attendance-overview__value">{{ totalExpectedCount }}</strong>
        <p class="attendance-overview__desc">当前所有课次累计应签到人数</p>
      </article>
    </section>

    <el-card class="attendance-table-card">
      <template #header>
        <div class="attendance-table-card__header">
          <div>
            <span class="attendance-table-card__title">课次列表</span>
            <p class="attendance-table-card__desc">桌面端支持快速查看课程、班级、截止时间和签到统计。</p>
          </div>
          <el-tag type="primary" effect="plain">当前 {{ sessions.length }} 条</el-tag>
        </div>
      </template>

      <div class="attendance-filter-row">
        <el-date-picker
          v-model="selectedSessionDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="按日期筛选课次"
          clearable
        />
        <el-button type="primary" @click="loadSessions">按日期筛选</el-button>
        <el-button @click="resetSessionDate">重置日期</el-button>
      </div>

      <div class="table-shell">
        <el-table :data="sessions">
          <el-table-column prop="id" label="课次ID" width="90" />
          <el-table-column label="课程" min-width="180">
            <template #default="{ row }">
              {{ row.course_name }}
            </template>
          </el-table-column>
          <el-table-column label="班级" min-width="160">
            <template #default="{ row }">
              {{ row.class_name }}
            </template>
          </el-table-column>
          <el-table-column label="开始时间" width="195">
            <template #default="{ row }">{{ formatDateTime(row.session_start) }}</template>
          </el-table-column>
          <el-table-column label="二维码刷新" width="110">
            <template #default="{ row }">{{ row.qr_refresh_seconds || qrRefreshSeconds }} 秒</template>
          </el-table-column>
          <el-table-column label="签到截止" width="195">
            <template #default="{ row }">{{ formatDateTime(row.session_end || row.qr_expire_at) }}</template>
          </el-table-column>
          <el-table-column label="签到统计" width="215">
            <template #default="{ row }">
              <div class="session-stats">
                <div>
                  <span>应到:</span>
                  <strong>{{ row.stats?.total || 0 }}</strong>
                  <span>已到:</span>
                  <strong class="ok">{{ row.stats?.checkedIn || 0 }}</strong>
                  <span>请假:</span>
                  <strong class="muted">{{ row.stats?.leave || 0 }}</strong>
                </div>
                <div>
                  <span>准时:</span>
                  <strong>{{ row.stats?.onTime || 0 }}</strong>
                  <span>迟到:</span>
                  <strong class="warn">{{ row.stats?.late || 0 }}</strong>
                  <span>缺勤:</span>
                  <strong class="danger">{{ row.stats?.absent || 0 }}</strong>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="112">
            <template #default="{ row }">
              <el-tag :type="getAttendanceStatusType(row.status)">{{ getAttendanceStatusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="370" fixed="right">
            <template #default="{ row }">
              <div class="session-action-row">
                <el-button
                  link
                  size="small"
                  :disabled="row.status === 'not_started' || row.is_qr_code_expired_too_long"
                  @click="showQRCode(row)"
                >
                  查看二维码
                </el-button>
                <el-button link size="small" @click="viewRecords(row)">签到记录</el-button>
                <el-button link size="small" @click="viewExpectedAttendance(row)">查看应签到名单</el-button>
                <el-button v-if="row.status === 'active'" link size="small" type="warning" :loading="endingSessionId === row.id" :disabled="!!endingSessionId || !!deletingSessionId" @click="endSession(row)">结束签到</el-button>
                <el-button link size="small" style="color: #f56c6c" :loading="deletingSessionId === row.id" :disabled="!!endingSessionId || !!deletingSessionId" @click="deleteSession(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" title="创建课次" width="560px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="学院">
          <el-select v-model="form.org_id" placeholder="请选择学院" :loading="loadingCreateOptions" :disabled="loadingCreateOptions" @change="onOrgChange">
            <el-option
              v-for="org in orgList"
              :key="org.id"
              :label="getOrgLabel(org)"
              :value="normalizeOptionValue(org.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="majorList.length > 0" label="专业">
          <el-select v-model="form.major" placeholder="可选" :disabled="!form.org_id || loadingCreateOptions" @change="onMajorChange">
            <el-option v-for="major in majorList" :key="major" :label="major" :value="major" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级">
          <el-select-v2
            v-model="form.class_id"
            :disabled="!form.org_id || loadingCreateOptions"
            :loading="loadingCreateOptions"
            :options="classOptions"
            :placeholder="classSelectPlaceholder"
            filterable
            clearable
          />
        </el-form-item>
        <el-form-item label="课程">
          <el-select-v2
            v-model="form.course_id"
            placeholder="请先选择班级"
            :disabled="!form.class_id || loadingCreateOptions"
            :loading="loadingCreateOptions || loadingCourses"
            :options="courseOptions"
            filterable
            clearable
          />
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker v-model="form.start_time" type="datetime" style="width: 100%" />
        </el-form-item>
        <el-form-item label="签到有效时间">
          <el-input-number v-model="form.expire_minutes" :min="1" :max="240" />
          <span class="inline-help">分钟</span>
        </el-form-item>
        <el-form-item label="二维码刷新时间">
          <el-input :model-value="`${qrRefreshSeconds} 秒`" readonly />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creatingSession" @click="createSession">确定</el-button>
      </template>
    </el-dialog>

    <!-- 签到看板：左侧二维码 + 右侧「已签到 / 未签到」双标签头像墙 -->
    <SignInBoard
      :visible="showSignInBoard"
      :session="signInSession"
      :qr-url="qrCodeUrl"
      :qr-url-large="qrCodeUrlLarge"
      :countdown="qrCountdownSeconds"
      :refresh-seconds="currentSession?.qr_refresh_seconds || qrRefreshSeconds"
      :start-at="signInSession?.session_start || currentSession?.session_start || null"
      @close="closeSignInBoard"
      @refresh-qr="reloadQrCode"
      @end-session="endSessionFromBoard"
    />

    <el-dialog v-model="showAttendanceListDialog" title="应签到名单" width="92vw">
      <div v-if="loadingAttendanceList" class="loading-box">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <p>加载中...</p>
      </div>
      <div v-else>
        <div class="dialog-title">
          课次: {{ attendanceSession?.course_name }} ({{ attendanceSession?.class_name }})
        </div>
        <div class="dialog-subtitle">
          时间: {{ formatDateTime(attendanceSession?.session_start) }}
        </div>
        <div v-if="!isSessionEnded" class="warning-copy">
          <el-icon><Warning /></el-icon>
          签到尚未结束，无法修改签到状态
        </div>
        <el-divider />
        <div class="attendance-card-grid">
          <div v-for="row in expectedAttendanceList" :key="row.id" class="attendance-card">
            <div class="attendance-card__header">
              <div class="attendance-card__name">{{ row.name }}</div>
              <div class="attendance-card__student-no">{{ row.student_no }}</div>
            </div>
            <div class="attendance-card__body">
              <label class="attendance-card__field">
                <span>签到状态</span>
                <el-select
                  v-model="row.status"
                  size="small"
                  :disabled="!isSessionEnded"
                  @change="handleStatusChange(row)"
                >
                  <el-option label="准时到" value="on_time" />
                  <el-option label="迟到" value="late" />
                  <el-option label="请假" value="leave" />
                  <el-option label="缺勤" value="absent" />
                </el-select>
              </label>
              <label class="attendance-card__field">
                <span>迟到分钟数</span>
                <el-input-number
                  v-model="row.lateMinutes"
                  size="small"
                  :min="0"
                  :max="120"
                  :disabled="row.status !== 'late' || !isSessionEnded"
                />
              </label>
            </div>
            <div class="attendance-card__footer">
              <el-button
                type="primary"
                size="small"
                :disabled="!isSessionEnded || !row.hasChanged"
                :loading="row.saving"
                @click="saveSingleStudentStatus(row)"
              >
                完成变更
              </el-button>
            </div>
          </div>
        </div>
        <div class="summary-line">
          应到: {{ expectedAttendanceList.length }} 人 |
          已到: {{ expectedAttendanceList.filter((item: any) => item.status === 'on_time' || item.status === 'late').length }} 人 |
          未到: {{ expectedAttendanceList.filter((item: any) => item.status === 'absent').length }} 人 |
          请假: {{ expectedAttendanceList.filter((item: any) => item.status === 'leave').length }} 人
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="showRecordsDialog" title="签到记录" width="820px">
      <div v-if="loadingRecords" class="loading-box">
        <el-icon class="is-loading" :size="28"><Loading /></el-icon>
        <p>加载中...</p>
      </div>
      <div v-else>
        <div class="dialog-title">
          课次: {{ recordsSession?.course_name }} ({{ recordsSession?.class_name }})
        </div>
        <div class="dialog-subtitle">
          时间: {{ formatDateTime(recordsSession?.session_start) }}
        </div>
        <el-divider />
        <div class="table-shell">
          <el-table :data="attendanceRecords" style="width: 100%">
            <el-table-column prop="student_name" label="姓名" width="120" />
            <el-table-column prop="student_no" label="学号" width="150" />
            <el-table-column prop="gender" label="性别" width="80">
              <template #default="{ row }">
                {{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '未知' }}
              </template>
            </el-table-column>
            <el-table-column prop="org_name" label="所属学院" width="150" />
            <el-table-column prop="checkin_time" label="签到时间" width="180">
              <template #default="{ row }">{{ formatDateTime(row.checkin_time) }}</template>
            </el-table-column>
            <el-table-column prop="attendance_status" label="签到状态" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.attendance_status === 'on_time'" type="success">准时</el-tag>
                <el-tag v-else-if="row.attendance_status === 'late'" type="warning">迟到</el-tag>
                <el-tag v-else type="danger">缺勤</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="source" label="签到方式" width="100">
              <template #default="{ row }">{{ row.source === 'scan' ? '扫码' : '其他' }}</template>
            </el-table-column>
          </el-table>
        </div>
        <div class="summary-line right">签到人数: {{ attendanceRecords.length }} 人</div>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showBulkProgressDialog"
      :title="bulkProgressTitle"
      width="520px"
      :close-on-click-modal="false"
      :show-close="!bulkProgressRunning"
      :close-on-press-escape="!bulkProgressRunning"
    >
      <div class="bulk-progress-panel">
        <el-progress
          :percentage="bulkProgressPercent"
          :status="!bulkProgressRunning && bulkProgressFailedCount > 0 ? 'warning' : (!bulkProgressRunning ? 'success' : undefined)"
        />
        <div class="bulk-progress-stats">
          <span>总数 {{ bulkProgressTotal }}</span>
          <span>已处理 {{ bulkProgressProcessed }}</span>
          <span>成功 {{ bulkProgressSuccessCount }}</span>
          <span>跳过 {{ bulkProgressSkippedCount }}</span>
          <span>失败 {{ bulkProgressFailedCount }}</span>
        </div>
        <p class="bulk-progress-hint">
          {{ bulkProgressHint }}
        </p>
      </div>
      <template #footer>
        <el-button :disabled="bulkProgressRunning" @click="showBulkProgressDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { ElIcon, ElMessage, ElMessageBox } from 'element-plus';
import { Loading, Warning } from '@element-plus/icons-vue';
import {
  api,
  ApiResponse,
  batchCreateSessions as batchCreateAttendanceSessions,
  createSession as createAttendanceSession,
  endSession as endSessionApi,
  getAttendanceBatchJob,
  getAttendanceQrConfig,
  getAttendanceSessionCourses,
  getAttendanceSessionOptions,
  getAttendanceSessionQrState,
  getSessionAttendance,
  getSessionRecords,
  listSessions,
  rotateSessionQr,
  startBatchDeleteSessionJob,
  startBatchEndSessionJob,
} from '../api';
import { takePreloadedValue } from '../preload-cache';
import { buildQrCodeDataUrl } from '../lib/qrcode';
import SignInBoard from '../components/SignInBoard.vue';
import { formatDateTime, getAttendanceStatusType, getAttendanceStatusText } from '../lib/format';

const sessions = ref<any[]>([]);
const allSessionClasses = ref<any[]>([]);
const classCourseCache = ref<Record<string, any[]>>({});
const classes = ref<any[]>([]);
const courses = ref<any[]>([]);
const orgList = ref<any[]>([]);
const majorList = ref<string[]>([]);
const showCreateDialog = ref(false);
const showQRDialog = ref(false);
const showSignInBoard = ref(false);
const signInSession = ref<any>(null);
const showAttendanceListDialog = ref(false);
const showRecordsDialog = ref(false);
const showQrPreview = ref(false);
const currentSession = ref<any>(null);
const attendanceSession = ref<any>(null);
const recordsSession = ref<any>(null);
const loadingAttendanceList = ref(false);
const loadingRecords = ref(false);
const loadingCreateOptions = ref(false);
const loadingCourses = ref(false);
const creatingSession = ref(false);
const sessionOptionsLoaded = ref(false);
const expectedAttendanceList = ref<any[]>([]);
const attendanceRecords = ref<any[]>([]);
const qrCodeUrl = ref('');
// 放大查看用的高分辨率版本（面板内放大，不做全屏）
const qrCodeUrlLarge = ref('');
const qrRefreshSeconds = ref(900);
const qrCountdownSeconds = ref(0);
const qrLeaveStudents = ref<any[]>([]);
const selectedSessionDate = ref('');
const endingSessionId = ref<string | null>(null);
const deletingSessionId = ref<string | null>(null);
const batchCreatingSessions = ref(false);
const batchEndingSessions = ref(false);
const bulkDeletingSessions = ref(false);
const lastBatchCreatedSessionIds = ref<string[]>([]);
const showBulkProgressDialog = ref(false);
const bulkProgressTitle = ref('');
const bulkProgressRunning = ref(false);
const bulkProgressTotal = ref(0);
const bulkProgressProcessed = ref(0);
const bulkProgressSuccessCount = ref(0);
const bulkProgressSkippedCount = ref(0);
const bulkProgressFailedCount = ref(0);
let qrCountdownTimer: number | null = null;
let batchJobPollingTimer: number | null = null;

const form = ref({
  org_id: '',
  major: '',
  class_id: '',
  course_id: '',
  start_time: new Date(),
  expire_minutes: 15,
});

const normalizeOptionValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

const getOrgLabel = (org: any) => org?.org_name || org?.name || `学院 ${normalizeOptionValue(org?.id)}`;
const getClassLabel = (classItem: any) => classItem?.class_name || classItem?.name || `班级 ${normalizeOptionValue(classItem?.id)}`;
const getCourseValue = (course: any) => normalizeOptionValue(course?.course_id ?? course?.id);
const getCourseLabel = (course: any) =>
  course?.course_name || course?.name || course?.course_code || getCourseValue(course);
const toOption = (value: string, label: string, raw: any) => ({ value, label, raw });

const orgOptions = computed(() =>
  orgList.value.map((org: any) => toOption(normalizeOptionValue(org.id), getOrgLabel(org), org)),
);

const classOptions = computed(() =>
  filteredClasses.value.map((item: any) =>
    toOption(normalizeOptionValue(item.id), getClassLabel(item), item),
  ),
);

const courseOptions = computed(() =>
  courses.value.map((item: any) =>
    toOption(getCourseValue(item), getCourseLabel(item), item),
  ),
);

const filteredClasses = computed(() => {
  if (!form.value.org_id) return [];
  if (!form.value.major) return classes.value;
  return classes.value.filter(
    (item: any) => normalizeOptionValue(item.major) === normalizeOptionValue(form.value.major),
  );
});

const classSelectPlaceholder = computed(() => {
  if (loadingCreateOptions.value) return '正在加载可用选项';
  if (!form.value.org_id) return '请先选择学院';
  if (majorList.value.length > 0 && !form.value.major) return '可先按专业筛选，也可直接选择班级';
  return '请选择班级';
});

const isSessionEnded = computed(() => {
  if (!attendanceSession.value) return false;
  const sessionEnd = new Date(attendanceSession.value.session_end || attendanceSession.value.qr_expire_at);
  return sessionEnd.getTime() <= Date.now();
});

const upcomingSessionCount = computed(
  () => sessions.value.filter((item: any) => item.status === 'not_started').length,
);

const activeSessionCount = computed(
  () => sessions.value.filter((item: any) => item.status === 'active').length,
);

const totalExpectedCount = computed(
  () =>
    sessions.value.reduce(
      (sum: number, item: any) => sum + Number(item.stats?.total || 0),
      0,
    ),
);

const bulkProgressPercent = computed(() => {
  if (bulkProgressTotal.value <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((bulkProgressProcessed.value / bulkProgressTotal.value) * 100));
});

const bulkProgressHint = computed(() => {
  if (bulkProgressRunning.value) {
    return '正在处理，请稍候…';
  }
  if (bulkProgressFailedCount.value > 0) {
    return '处理结束，但存在失败项，请检查结果后再关闭弹窗。';
  }
  return '处理完成，可关闭弹窗。';
});

const clearQrCountdown = () => {
  if (qrCountdownTimer) {
    window.clearInterval(qrCountdownTimer);
    qrCountdownTimer = null;
  }
};

const startQrCountdown = () => {
  clearQrCountdown();
  qrCountdownTimer = window.setInterval(async () => {
    if (!showSignInBoard.value || !currentSession.value?.id) {
      clearQrCountdown();
      return;
    }

    if (qrCountdownSeconds.value > 1) {
      qrCountdownSeconds.value -= 1;
      return;
    }

    await loadQrState(currentSession.value.id);
  }, 1000);
};

const loadClassesByOrg = (orgId: string) => {
  classes.value = allSessionClasses.value.filter(
    (item: any) => normalizeOptionValue(item.org_id) === normalizeOptionValue(orgId),
  );
  majorList.value = Array.from(
    new Set(
      classes.value
        .map((item: any) => String(item.major || '').trim())
        .filter(Boolean),
    ),
  );
    /* const response = await listClasses({ org_id: orgId });
    if (response.code === 0) {
      classes.value = response.data || [];
      majorList.value = Array.from(
        new Set(
          (response.data || [])
            .map((item: any) => String(item.major || '').trim())
            .filter(Boolean),
        ),
      );
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载班级失败');
  } */
};

const loadCoursesByClass = async (classId: string) => {
  loadingCourses.value = true;
  try {
    const normalizedClassId = normalizeOptionValue(classId);
    if (classCourseCache.value[normalizedClassId]) {
      courses.value = classCourseCache.value[normalizedClassId];
    } else {
      const response = await getAttendanceSessionCourses(normalizedClassId);
      if (response.code !== 0) {
        throw new Error(response.message || '加载课程失败');
      }
      const nextCourses = response.data?.courses || [];
      classCourseCache.value = {
        ...classCourseCache.value,
        [normalizedClassId]: nextCourses,
      };
      courses.value = nextCourses;
    }
    if (
      form.value.course_id &&
      !courses.value.some((item: any) => getCourseValue(item) === normalizeOptionValue(form.value.course_id))
    ) {
      form.value.course_id = '';
    }
    return;

    /* const response = await listCourseClasses({
      pageSize: 1000,
      class_id: normalizeOptionValue(classId),
    });
    if (response.code === 0) {
      const list = response.data?.list || [];
      courses.value = list.filter(
        (item: any) => normalizeOptionValue(item.class_id) === normalizeOptionValue(classId),
      );
      if (
        form.value.course_id &&
        !courses.value.some((item: any) => getCourseValue(item) === normalizeOptionValue(form.value.course_id))
      ) {
        form.value.course_id = '';
      }
    } */
  } catch (error: any) {
    ElMessage.error(error?.message || '加载课程失败');
  } finally {
    loadingCourses.value = false;
  }
};

const loadSessionOptions = async (force = false) => {
  if (loadingCreateOptions.value) {
    return;
  }
  if (sessionOptionsLoaded.value && !force) {
    return;
  }

  loadingCreateOptions.value = true;
  try {
    const preloadedOptions = !force ? takePreloadedValue('attendanceSessionOptions') : undefined;
    const response = preloadedOptions
      ? { code: 0, data: preloadedOptions }
      : await getAttendanceSessionOptions();
    if (response.code !== 0) {
      throw new Error(response.message || '加载创建签到选项失败');
    }

    orgList.value = response.data?.orgs || [];
    allSessionClasses.value = response.data?.classes || [];
    sessionOptionsLoaded.value = true;

    if (form.value.org_id) {
      await loadClassesByOrg(form.value.org_id);
    }
    if (form.value.class_id) {
      await loadCoursesByClass(form.value.class_id);
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载创建签到选项失败');
  } finally {
    loadingCreateOptions.value = false;
  }
};

const loadOrgsList = async () => {
  await loadSessionOptions();
  return;
  /* try {
    const response = await listOrgs();
    if (response.code === 0) {
      orgList.value = response.data || [];
    }
  } catch (error) {
    console.error('加载学院列表失败', error);
  } */
};

const loadSessions = async () => {
  try {
    const response = await listSessions({
      date: selectedSessionDate.value || undefined,
    });
    if (response.code !== 0) {
      throw new Error(response.message || '加载课次失败');
    }

    const now = Date.now();
    sessions.value = (response.data || []).map((session: any) => {
      const sessionStart = new Date(session.session_start).getTime();
      const sessionEnd = new Date(session.session_end || session.qr_expire_at).getTime();
      const backendStatus = String(session.status || '').trim();
      let status = 'inactive';

      if (backendStatus === 'ended' || backendStatus === 'inactive') {
        status = 'inactive';
      } else if (now < sessionStart) {
        status = 'not_started';
      } else if (now < sessionEnd) {
        status = 'active';
      }

      return {
        ...session,
        status,
        is_qr_code_expired_too_long: now > sessionEnd + 25 * 60 * 1000,
      };
    });
  } catch (error: any) {
    ElMessage.error(error?.message || '加载课次失败');
  }
};

const resetSessionDate = async () => {
  selectedSessionDate.value = '';
  await loadSessions();
};

const loadDashboardData = async () => {
  await loadSessions();
};

const openCreateDialog = async () => {
  form.value = {
    org_id: '',
    major: '',
    class_id: '',
    course_id: '',
    start_time: new Date(),
    expire_minutes: 15,
  };
  majorList.value = [];
  classes.value = [];
  courses.value = [];
  showCreateDialog.value = true;
  await loadSessionOptions();
};

const onOrgChange = async () => {
  form.value.major = '';
  form.value.class_id = '';
  form.value.course_id = '';
  courses.value = [];
  majorList.value = [];
  if (form.value.org_id) {
    await loadClassesByOrg(form.value.org_id);
  } else {
    classes.value = [];
  }
};

const onMajorChange = () => {
  form.value.class_id = '';
  form.value.course_id = '';
  courses.value = [];
};

watch(
  () => form.value.class_id,
  async (value) => {
    if (value) {
      await loadCoursesByClass(value);
    } else {
      courses.value = [];
      form.value.course_id = '';
    }
  },
);

const createSessionSubmit = async () => {
  if (!form.value.course_id || !form.value.class_id) {
    ElMessage.warning('请选择课程和班级');
    return;
  }

  creatingSession.value = true;
  try {
    const response = await createAttendanceSession({
      org_id: form.value.org_id,
      course_id: form.value.course_id,
      class_id: form.value.class_id,
      start_time: form.value.start_time,
      expire_minutes: form.value.expire_minutes,
    });
    if (response.code === 0) {
      ElMessage.success('创建成功，正在进入签到页面');
      showCreateDialog.value = false;

      // 创建成功立刻进入签到看板（左侧二维码 / 右侧实时名单）
      const created = response.data || {};
      const classLabel =
        classOptions.value.find(
          (item) => item.value === normalizeOptionValue(form.value.class_id),
        )?.label || '';
      const courseLabel =
        courseOptions.value.find(
          (item) => item.value === normalizeOptionValue(form.value.course_id),
        )?.label || '';
      const createdSession = {
        id: String(created.session_id || ''),
        status: 'active',
        course_name: courseLabel,
        class_name: classLabel,
        session_start: form.value.start_time,
        session_end: created.session_end || created.qr_expire_at || null,
        qr_expire_at: created.qr_expire_at || created.session_end || null,
        qr_refresh_seconds: created.qr_refresh_seconds,
      };

      await loadSessions();
      if (createdSession.id) {
        await openSignInBoard(createdSession);
      }
    } else {
      ElMessage.error(response.message || '创建失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '创建失败');
  } finally {
    creatingSession.value = false;
  }
};

const loadQrState = async (sessionId: string) => {
  const response = await getAttendanceSessionQrState(String(sessionId));
  if (response.code !== 0) {
    throw new Error(response.message || '获取二维码失败');
  }

  const qrState = response.data || {};
  qrRefreshSeconds.value = Number(qrState.qr_refresh_seconds || qrRefreshSeconds.value || 900);
  qrCountdownSeconds.value = Number(qrState.qr_countdown_seconds || 0);
  qrLeaveStudents.value = Array.isArray(qrState.leave_students) ? qrState.leave_students : [];
  currentSession.value = {
    ...(currentSession.value || {}),
    ...qrState,
    id: String(qrState.session_id || currentSession.value?.id || sessionId),
  };

  const qrData = {
    session_id: currentSession.value.id,
    token: qrState.scan_token,
    expire_at: qrState.qr_next_refresh_at || qrState.session_end || currentSession.value.session_end,
  };
  qrCodeUrl.value = await buildQrCodeDataUrl(qrData, 320);
  qrCodeUrlLarge.value = await buildQrCodeDataUrl(qrData, 720);
  startQrCountdown();
};

const openSignInBoard = async (session: any) => {
  if (!session?.id) {
    return;
  }

  currentSession.value = session;
  signInSession.value = session;

  try {
    await loadQrState(session.id);
    // loadQrState 会把最新的二维码状态合并进 currentSession，回写给看板
    signInSession.value = { ...session, ...(currentSession.value || {}) };
    showSignInBoard.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '生成二维码失败');
  }
};

const closeSignInBoard = () => {
  showSignInBoard.value = false;
  clearQrCountdown();
};

const reloadQrCode = async () => {
  if (!currentSession.value?.id) {
    ElMessage.warning('当前课次信息已失效，请重新打开签到');
    return;
  }

  try {
    // 强制换码：服务端重置 qr_token_hash 种子，旧码立即失效（不再是「只读一遍状态」）
    const rotateResponse = await rotateSessionQr(currentSession.value.id);
    if (rotateResponse.code !== 0) {
      ElMessage.warning(rotateResponse.message || '换码失败');
      return;
    }

    await loadQrState(currentSession.value.id);
    signInSession.value = { ...(signInSession.value || {}), ...(currentSession.value || {}) };
    ElMessage.success('二维码已更新，旧码已失效（正在扫码的学生需重新扫码）');
  } catch (error: any) {
    ElMessage.error(error?.message || '刷新二维码失败');
  }
};

const endSessionFromBoard = async () => {
  if (!signInSession.value) {
    return;
  }
  await endSession(signInSession.value);
};

const showQRCode = async (session: any) => {
  if (session.is_qr_code_expired_too_long) {
    ElMessage.warning('二维码已过期较久，无法查看');
    return;
  }

  // 未开始的课次也允许进入签到页：页内显示「签到尚未开始」倒计时，到点自动出码。
  // 旧实现直接弹一句 warning 就 return，用户看到的就是「点了没反应」。
  await openSignInBoard(session);
};

const loadQrRefreshConfig = async () => {
  try {
    const preloadedQrConfig = takePreloadedValue('attendanceQrConfig');
    const response = preloadedQrConfig
      ? { code: 0, data: preloadedQrConfig }
      : await getAttendanceQrConfig();
    if (response.code === 0) {
      qrRefreshSeconds.value = Math.max(1, Number(response.data?.qr_refresh_seconds || 900));
    }
  } catch (error) {
    console.error('加载二维码刷新时间失败', error);
  }
};

const viewRecords = async (session: any) => {
  recordsSession.value = session;
  loadingRecords.value = true;
  try {
    const response = await getSessionRecords(session.id);
    if (response.code === 0) {
      attendanceRecords.value = response.data || [];
    } else {
      ElMessage.error(response.message || '获取签到记录失败');
      attendanceRecords.value = [];
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取签到记录失败');
    attendanceRecords.value = [];
  } finally {
    loadingRecords.value = false;
    showRecordsDialog.value = true;
  }
};

const viewExpectedAttendance = async (session: any) => {
  attendanceSession.value = session;
  loadingAttendanceList.value = true;
  try {
    const response = await getSessionAttendance(session.id);
    if (response.code === 0) {
      expectedAttendanceList.value = (response.data || []).map((student: any) => ({
        ...student,
        status: student.status || 'absent',
        lateMinutes: 0,
        originalStatus: student.status || 'absent',
        hasChanged: false,
        saving: false,
      }));
    } else {
      ElMessage.error(response.message || '获取应签到名单失败');
      expectedAttendanceList.value = [];
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取应签到名单失败');
    expectedAttendanceList.value = [];
  } finally {
    loadingAttendanceList.value = false;
    showAttendanceListDialog.value = true;
  }
};

const handleStatusChange = (row: any) => {
  if (row.status !== 'late') {
    row.lateMinutes = 0;
  }
  row.hasChanged = row.status !== row.originalStatus;
};

const saveSingleStudentStatus = async (row: any) => {
  if (!attendanceSession.value) {
    ElMessage.error('未找到课次信息');
    return;
  }

  row.saving = true;
  try {
    const response = await api.post<ApiResponse<any>>(
      `/attendance/sessions/${attendanceSession.value.id}/students/${row.id}/status`,
      {
        status: row.status,
        late_minutes: row.lateMinutes,
      },
    );
    if (response.data.code === 0) {
      ElMessage.success('更新成功');
      row.originalStatus = row.status;
      row.hasChanged = false;
      await loadSessions();
    } else {
      ElMessage.error(response.data.message || '更新失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '更新失败');
  } finally {
    row.saving = false;
  }
};

const deleteCurrentSession = async (session: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除课次 ${session.id} 吗？`, '确认删除', {
      type: 'warning',
    });
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
    return;
  }

  deletingSessionId.value = session.id;
  try {
    const deletedIds = await runServerTrackedSessionAction([String(session.id)], {
      title: '删除签到进度',
      starter: async (sessionIds) => {
        return startBatchDeleteSessionJob({
          session_ids: sessionIds,
        });
      },
    });
    const deletedIdSet = new Set(deletedIds);
    sessions.value = sessions.value.filter((item: any) => !deletedIdSet.has(String(item.id)));
    lastBatchCreatedSessionIds.value = lastBatchCreatedSessionIds.value.filter(
      (item) => !deletedIdSet.has(String(item)),
    );
    ElMessage.success(
      `删除完成：成功 ${bulkProgressSuccessCount.value} 条，跳过 ${bulkProgressSkippedCount.value} 条，失败 ${bulkProgressFailedCount.value} 条`,
    );
    void loadSessions();
  } catch (error: any) {
    ElMessage.error(error?.message || '删除失败');
  } finally {
    deletingSessionId.value = null;
  }
};

watch(showSignInBoard, (visible) => {
  if (!visible) {
    clearQrCountdown();
  }
});

const createSession = createSessionSubmit;
const deleteSession = deleteCurrentSession;

const resetBulkProgress = (title: string, total: number, visible = true) => {
  bulkProgressTitle.value = title;
  bulkProgressTotal.value = total;
  bulkProgressProcessed.value = 0;
  bulkProgressSuccessCount.value = 0;
  bulkProgressSkippedCount.value = 0;
  bulkProgressFailedCount.value = 0;
  bulkProgressRunning.value = true;
  showBulkProgressDialog.value = visible;
};

const createChunks = (ids: string[], chunkSize = 10) => {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
};

const clearBatchJobPolling = () => {
  if (batchJobPollingTimer) {
    clearTimeout(batchJobPollingTimer);
    batchJobPollingTimer = null;
  }
};

const syncBulkProgressState = (job: any) => {
  bulkProgressTotal.value = Number(job?.total || 0);
  bulkProgressProcessed.value = Number(job?.processed || 0);
  bulkProgressSuccessCount.value = Number(job?.success_count || 0);
  bulkProgressSkippedCount.value = Number(job?.skipped_count || 0);
  bulkProgressFailedCount.value = Number(job?.failed_count || 0);
  bulkProgressRunning.value = String(job?.status || '') === 'running';
};

const runServerTrackedSessionAction = async (
  ids: string[],
  options: {
    title: string;
    starter: (sessionIds: string[]) => Promise<any>;
    showProgressDialog?: boolean;
  },
) => {
  const actionStartedAt = performance.now();
  const normalizedIds = Array.from(
    new Set(
      ids
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) {
    return [];
  }

  console.log('[attendance][action] start', {
    title: options.title,
    sessionIds: normalizedIds,
    at: new Date().toISOString(),
  });

  clearBatchJobPolling();
  resetBulkProgress(options.title, normalizedIds.length, options.showProgressDialog !== false);

  const starterStartedAt = performance.now();
  const startResponse = await options.starter(normalizedIds);
  console.log('[attendance][action] starter done', {
    title: options.title,
    costMs: Math.round(performance.now() - starterStartedAt),
    code: startResponse?.code,
    at: new Date().toISOString(),
  });
  if (startResponse.code !== 0) {
    bulkProgressRunning.value = false;
    throw new Error(startResponse.message || '任务启动失败');
  }

  const jobId = String(startResponse.data?.job_id || '').trim();
  if (!jobId) {
    bulkProgressRunning.value = false;
    throw new Error('任务启动失败');
  }

  console.log('[attendance][action] polling start', {
    title: options.title,
    jobId,
    at: new Date().toISOString(),
  });

  return await new Promise<string[]>((resolve, reject) => {
    let pollCount = 0;
    const poll = async () => {
      const pollStartedAt = performance.now();
      pollCount += 1;
      try {
        const response = await getAttendanceBatchJob(jobId);
        console.log('[attendance][action] poll', {
          title: options.title,
          jobId,
          pollCount,
          costMs: Math.round(performance.now() - pollStartedAt),
          code: response?.code,
          status: response?.data?.status,
          processed: response?.data?.processed,
          total: response?.data?.total,
          at: new Date().toISOString(),
        });
        if (response.code !== 0) {
          throw new Error(response.message || '获取任务进度失败');
        }

        const job = response.data || {};
        syncBulkProgressState(job);

        if (String(job.status || '') === 'running') {
          batchJobPollingTimer = setTimeout(() => {
            void poll();
          }, 200);
          return;
        }

        clearBatchJobPolling();
        console.log('[attendance][action] done', {
          title: options.title,
          jobId,
          pollCount,
          totalCostMs: Math.round(performance.now() - actionStartedAt),
          status: job.status,
          processed: job.processed,
          total: job.total,
          sessionIds: job.session_ids,
          at: new Date().toISOString(),
        });
        resolve(
          Array.isArray(job.session_ids)
            ? job.session_ids.map((item: any) => String(item))
            : [],
        );
      } catch (error) {
        clearBatchJobPolling();
        bulkProgressRunning.value = false;
        console.error('[attendance][action] failed', {
          title: options.title,
          jobId,
          pollCount,
          totalCostMs: Math.round(performance.now() - actionStartedAt),
          at: new Date().toISOString(),
          error,
        });
        reject(error);
      }
    };

    void poll();
  });
};

const openBatchCreatePrompt = async () => {
  try {
    const { value } = await ElMessageBox.prompt(
      '输入要随机创建的签到数量，系统会基于现有班级和课程随机生成可立即结束的签到。',
      '批量创建签到',
      {
        confirmButtonText: '开始创建',
        cancelButtonText: '取消',
        inputValue: '10',
        inputPattern: /^(?:[1-9]\d?|[1-4]\d{2}|500)$/,
        inputErrorMessage: '请输入 1 到 500 之间的整数',
      },
    );

    const count = Number(value || 0);
    if (!Number.isFinite(count) || count <= 0) {
      ElMessage.warning('请输入有效的创建数量');
      return;
    }

    batchCreatingSessions.value = true;
    const response = await batchCreateAttendanceSessions({ count });
    if (response.code === 0) {
      lastBatchCreatedSessionIds.value = Array.isArray(response.data?.session_ids)
        ? response.data.session_ids.map((item: any) => String(item))
        : [];
      ElMessage.success(
        `已随机创建 ${Number(response.data?.created_count || lastBatchCreatedSessionIds.value.length || 0)} 条签到`,
      );
      await loadSessions();
    } else {
      ElMessage.error(response.message || '批量创建签到失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '批量创建签到失败');
    }
  } finally {
    batchCreatingSessions.value = false;
  }
};

const endLatestBatchSessions = async () => {
  if (lastBatchCreatedSessionIds.value.length === 0) {
    ElMessage.warning('暂无刚刚批量创建的签到');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定结束刚才批量创建的 ${lastBatchCreatedSessionIds.value.length} 条签到吗？`,
      '批量结束签到',
      {
        type: 'warning',
        confirmButtonText: '批量结束',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }

  batchEndingSessions.value = true;
  try {
    const endedIds = await runServerTrackedSessionAction(lastBatchCreatedSessionIds.value, {
      title: '批量结束签到进度',
      starter: async (sessionIds) => {
        return startBatchEndSessionJob({
          session_ids: sessionIds,
        });
      },
    });

    const endedIdSet = new Set(endedIds);
    lastBatchCreatedSessionIds.value = lastBatchCreatedSessionIds.value.filter(
      (item) => !endedIdSet.has(String(item)),
    );
    sessions.value = sessions.value.map((item: any) =>
      endedIdSet.has(String(item.id))
        ? {
            ...item,
            status: 'inactive',
            session_end: new Date().toISOString(),
            qr_expire_at: new Date().toISOString(),
          }
        : item,
    );
    ElMessage.success(
      `批量结束完成：成功 ${bulkProgressSuccessCount.value} 条，跳过 ${bulkProgressSkippedCount.value} 条，失败 ${bulkProgressFailedCount.value} 条`,
    );
    void loadSessions();
  } catch (error: any) {
    ElMessage.error(error?.message || '批量结束签到失败');
  } finally {
    batchEndingSessions.value = false;
  }
};

const deleteAllSessions = async () => {
  if (sessions.value.length === 0) {
    ElMessage.warning('当前没有可删除的签到');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定删除当前列表中的 ${sessions.value.length} 条签到吗？此操作不可恢复。`,
      '一键删除所有签到',
      {
        type: 'warning',
        confirmButtonText: '开始删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }

  bulkDeletingSessions.value = true;
  try {
    const targetIds = sessions.value.map((item: any) => String(item.id));
    const deletedIds = await runServerTrackedSessionAction(targetIds, {
      title: '批量删除签到进度',
      starter: async (sessionIds) => {
        return startBatchDeleteSessionJob({
          session_ids: sessionIds,
        });
      },
    });

    const deletedIdSet = new Set(deletedIds);
    sessions.value = sessions.value.filter((item: any) => !deletedIdSet.has(String(item.id)));
    lastBatchCreatedSessionIds.value = lastBatchCreatedSessionIds.value.filter(
      (item) => !deletedIdSet.has(String(item)),
    );
    ElMessage.success(
      `批量删除完成：成功 ${bulkProgressSuccessCount.value} 条，跳过 ${bulkProgressSkippedCount.value} 条，失败 ${bulkProgressFailedCount.value} 条`,
    );
    void loadSessions();
  } catch (error: any) {
    ElMessage.error(error?.message || '批量删除签到失败');
  } finally {
    bulkDeletingSessions.value = false;
  }
};

const endSession = async (session: any) => {
  try {
    await ElMessageBox.confirm(
      `确定提前结束课次 ${session.id} 的签到吗？系统会立即停止扫码并补齐未签到学生状态。`,
      '提前结束签到',
      {
        type: 'warning',
        confirmButtonText: '结束签到',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }

  const endStartedAt = performance.now();
  console.log('[attendance][endSession] click confirmed', {
    sessionId: String(session.id),
    at: new Date().toISOString(),
  });

  endingSessionId.value = session.id;
  try {
    // 单条结束走直接 API，不走批量轮询
    await endSessionApi(String(session.id));
    console.log('[attendance][endSession] done', {
      sessionId: String(session.id),
      costMs: Math.round(performance.now() - endStartedAt),
      at: new Date().toISOString(),
    });
    // 乐观更新
    sessions.value = sessions.value.map((item: any) =>
      String(item.id) === String(session.id)
        ? { ...item, status: 'inactive', session_end: new Date().toISOString(), qr_expire_at: new Date().toISOString() }
        : item,
    );
    if (currentSession.value?.id === session.id) {
      showQRDialog.value = false;
      closeSignInBoard();
    }
    ElMessage.success('签到已结束');
    void loadSessions();
  } catch (error: any) {
    console.error('[attendance][endSession] failed', {
      sessionId: String(session.id),
      costMs: Math.round(performance.now() - endStartedAt),
      error,
    });
    ElMessage.error(error?.message || '结束签到失败');
  } finally {
    endingSessionId.value = null;
  }
};

onMounted(async () => {
  await loadDashboardData();
  await loadQrRefreshConfig();
  void loadSessionOptions();
});

onActivated(() => {
  if (showSignInBoard.value) {
    startQrCountdown();
  }
});

onDeactivated(() => {
  clearQrCountdown();
  clearBatchJobPolling();
});

onBeforeUnmount(() => {
  clearQrCountdown();
  clearBatchJobPolling();
});
</script>

<style scoped>
.attendance-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.attendance-hero {
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

.attendance-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.attendance-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.attendance-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.attendance-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.attendance-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.attendance-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.attendance-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.bulk-progress-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bulk-progress-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #5c7284;
  font-size: 13px;
}

.bulk-progress-hint {
  margin: 0;
  color: #7b8d9a;
  font-size: 13px;
}

.attendance-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.attendance-overview__card {
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

.attendance-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.attendance-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.attendance-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.attendance-table-card {
  overflow: hidden;
}

.attendance-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.attendance-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.attendance-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.attendance-filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.toolbar {
  display: flex;
  gap: 8px;
}

.action-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.session-action-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.session-action-row :deep(.el-button) {
  margin-left: 0 !important;
  padding-left: 2px;
  padding-right: 2px;
}

.session-stats {
  font-size: 12px;
  line-height: 1.5;
}

.session-stats div {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.session-stats .ok {
  color: #67c23a;
}

.session-stats .warn {
  color: #e6a23c;
}

.session-stats .danger {
  color: #f56c6c;
}

.session-stats .muted {
  color: #909399;
}

.inline-help {
  margin-left: 8px;
  color: #909399;
}

.qr-dialog {
  padding: 20px;
  text-align: center;
}

.qr-dialog__session {
  margin-bottom: 20px;
  font-size: 24px;
  font-weight: 600;
  color: #102132;
}

.qr-code-shell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 22px;
  border: 1px solid rgba(107, 140, 158, 0.18);
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(247, 251, 252, 0.46));
  box-shadow: 0 20px 44px rgba(37, 61, 79, 0.12);
  backdrop-filter: blur(18px);
}

.qr-code-image,
.qr-code-placeholder {
  width: 220px;
  height: 220px;
  border-radius: 18px;
}

.qr-code-image {
  display: block;
  cursor: zoom-in;
}

.qr-code-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(107, 140, 158, 0.24);
  background: rgba(255, 255, 255, 0.58);
  color: #607384;
}

.qr-dialog__expire,
.qr-dialog__countdown,
.qr-dialog__refresh {
  margin-top: 10px;
  color: #6b7280;
}

.qr-dialog__countdown {
  color: #0f766e;
  font-weight: 700;
}

.qr-dialog__leave-list {
  margin-top: 16px;
  text-align: left;
}

.qr-dialog__leave-title {
  margin-bottom: 10px;
  font-weight: 700;
  color: #102132;
}

.qr-dialog__leave-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.qr-dialog__leave-tag {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  font-size: 12px;
  font-weight: 600;
}

.qr-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(12, 18, 24, 0.72);
  backdrop-filter: blur(12px);
}

.qr-preview-image {
  width: min(78vw, 820px);
  height: auto;
  max-height: 82vh;
  border-radius: 28px;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
  padding: 20px;
}

.loading-box {
  text-align: center;
  padding: 40px;
}

.dialog-title {
  margin-bottom: 16px;
  font-weight: 700;
}

.dialog-subtitle {
  margin-bottom: 8px;
  color: #666;
}

.warning-copy {
  margin-bottom: 16px;
  color: #f56c6c;
  font-size: 14px;
}

.attendance-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px 18px;
}

.attendance-card {
  min-height: 188px;
  padding: 16px;
  border: 1px solid rgba(107, 140, 158, 0.16);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(247, 251, 252, 0.58));
}

.attendance-card__header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 14px;
}

.attendance-card__name {
  font-size: 16px;
  font-weight: 700;
  color: #102132;
}

.attendance-card__student-no {
  font-size: 12px;
  line-height: 1.5;
  color: #6b7280;
  overflow-wrap: anywhere;
}

.attendance-card__body {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.attendance-card__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #607384;
}

.attendance-card__footer {
  display: flex;
  justify-content: stretch;
  margin-top: 16px;
}

.attendance-card__footer .el-button {
  width: 100%;
}

.summary-line {
  margin-top: 18px;
  color: #666;
}

.summary-line.right {
  text-align: right;
}

@media (max-width: 1200px) {
  .attendance-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .attendance-hero {
    padding: 20px;
  }

  .attendance-filter-row {
    align-items: stretch;
  }

  .attendance-filter-row > * {
    width: 100%;
  }

  .attendance-overview {
    grid-template-columns: 1fr;
  }

  .attendance-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .attendance-hero__actions > * {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .attendance-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
