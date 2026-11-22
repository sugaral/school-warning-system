<template>
  <div class="teacher-attendance-page">
    <section class="teacher-attendance-hero">
      <div class="teacher-attendance-hero__copy">
        <span class="teacher-attendance-hero__eyebrow">Teacher Attendance</span>
        <h2 class="teacher-attendance-hero__title">签到管理</h2>
        <p class="teacher-attendance-hero__desc">教师端可直接创建签到、查看二维码、核对签到记录并管理应签到名单。</p>
      </div>
      <div class="teacher-attendance-hero__actions">
        <div class="teacher-attendance-hero__meta">
          <span>当前课次</span>
          <strong>{{ sessions.length }}</strong>
          <small>已绑定课程 {{ myCourses.length }} 门</small>
          <small v-if="lastBatchCreatedSessionIds.length > 0">最近压测批次 {{ lastBatchCreatedSessionIds.length }} 条</small>
        </div>
        <el-button type="primary" @click="openCreateDialog">创建签到</el-button>
        <el-button type="success" :loading="batchCreatingSessions" @click="openBatchCreatePrompt">批量创建签到</el-button>
        <el-button
          type="warning"
          :loading="batchEndingSessions"
          :disabled="lastBatchCreatedSessionIds.length === 0"
          @click="endLatestBatchSessions"
        >
          批量结束签到
        </el-button>
        <el-button type="info" @click="loadSessions">刷新</el-button>
      </div>
    </section>

    <section class="teacher-attendance-overview">
      <article class="teacher-attendance-overview__card">
        <span class="teacher-attendance-overview__label">课次总数</span>
        <strong class="teacher-attendance-overview__value">{{ sessions.length }}</strong>
        <p class="teacher-attendance-overview__desc">当前教师可见的签到课次总数</p>
      </article>
      <article class="teacher-attendance-overview__card">
        <span class="teacher-attendance-overview__label">未开始</span>
        <strong class="teacher-attendance-overview__value">{{ upcomingSessionCount }}</strong>
        <p class="teacher-attendance-overview__desc">尚未开始的签到课次数量</p>
      </article>
      <article class="teacher-attendance-overview__card">
        <span class="teacher-attendance-overview__label">进行中</span>
        <strong class="teacher-attendance-overview__value">{{ activeSessionCount }}</strong>
        <p class="teacher-attendance-overview__desc">当前进行中的签到课次数量</p>
      </article>
      <article class="teacher-attendance-overview__card">
        <span class="teacher-attendance-overview__label">应到总数</span>
        <strong class="teacher-attendance-overview__value">{{ totalExpectedCount }}</strong>
        <p class="teacher-attendance-overview__desc">当前课次累计应签到人数</p>
      </article>
    </section>

    <el-card class="teacher-attendance-table-card">
      <template #header>
        <div class="teacher-attendance-table-card__header">
          <div>
            <span class="teacher-attendance-table-card__title">课次列表</span>
            <p class="teacher-attendance-table-card__desc">按行颜色快速区分签到状态，支持一屏查看课程、班级和签到统计。</p>
          </div>
          <div class="session-header-meta">
            <div class="session-status-legend" aria-label="课次状态颜色说明">
              <span class="session-legend-item">
                <span class="session-status-dot is-active" />
                <span>进行中</span>
              </span>
              <span class="session-legend-item">
                <span class="session-status-dot is-not-started" />
                <span>未开始</span>
              </span>
              <span class="session-legend-item">
                <span class="session-status-dot is-ended" />
                <span>已结束</span>
              </span>
            </div>
            <el-tag type="primary" effect="plain">当前 {{ sessions.length }} 条</el-tag>
          </div>
        </div>
      </template>

      <div class="table-shell">
      <el-table :data="sessions" :row-class-name="getSessionRowClass">
        <el-table-column prop="id" label="课次ID" width="90" />
        <el-table-column label="课程" min-width="180">
          <template #default="{ row }">
            <span class="session-course-cell" :title="`${getSessionStatusTitle(row)} · ${row.course_name || ''}`">
              <span class="session-status-dot" :class="getSessionStatusClass(row)" />
              <span class="session-course-name">{{ row.course_name }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="班级" min-width="160">
          <template #default="{ row }">
            {{ row.class_name }}
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="195">
          <template #default="{ row }">
            {{ formatDateTime(row.session_start) }}
          </template>
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
        <el-table-column label="操作" width="360" fixed="right">
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
              <el-button link size="small" @click="viewExpectedAttendance(row)">应签到名单</el-button>
              <el-button v-if="row.status === 'active'" link size="small" type="warning" :loading="endingSessionId === row.id" :disabled="!!endingSessionId || !!deletingSessionId" @click="endSession(row)">结束签到</el-button>
              <el-button link size="small" style="color: #f56c6c" :loading="deletingSessionId === row.id" :disabled="!!endingSessionId || !!deletingSessionId" @click="deleteSession(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" title="创建签到" width="520px">
      <el-form :model="form" label-width="110px">
        <el-form-item label="选择课程">
          <el-select v-model="form.course_id" placeholder="请选择课程" style="width: 100%" @change="onCourseChange">
            <el-option
              v-for="course in myCourses"
              :key="course.id"
              :label="course.course_name"
              :value="course.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选择班级">
          <el-select v-model="form.class_id" placeholder="请选择班级" style="width: 100%" :disabled="!form.course_id">
            <el-option
              v-for="cls in myClassesByCourse[form.course_id] || []"
              :key="cls.id"
              :label="cls.class_name"
              :value="cls.id"
            />
          </el-select>
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
        <el-button type="primary" @click="createSession">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showQRDialog" title="签到二维码" width="540px">
      <div class="qr-dialog">
        <div v-if="currentSession" class="qr-dialog__session">
          课次ID: {{ currentSession.id }}
        </div>
        <div class="qr-code-shell">
          <img
            v-if="qrCodeUrl"
            :src="qrCodeUrl"
            alt="签到二维码"
            class="qr-code-image"
            @click="showQrPreview = true"
          />
          <div v-else class="qr-code-placeholder">生成中...</div>
        </div>
        <p class="qr-dialog__expire">
          签到截止: {{ formatDateTime(currentSession?.session_end || currentSession?.qr_expire_at) }}
        </p>
        <p class="qr-dialog__countdown">
          距离下次刷新二维码还剩：{{ qrCountdownSeconds }}s
        </p>
        <p class="qr-dialog__refresh">
          二维码刷新时间: {{ currentSession?.qr_refresh_seconds || qrRefreshSeconds }} 秒
        </p>
        <div v-if="qrLeaveStudents.length" class="qr-dialog__leave-list">
          <div class="qr-dialog__leave-title">当前请假学生</div>
          <div class="qr-dialog__leave-tags">
            <span v-for="item in qrLeaveStudents" :key="item.id" class="qr-dialog__leave-tag">
              {{ item.name || item.student_no }}请假
            </span>
          </div>
        </div>
        <p class="qr-dialog__hint">点击二维码可放大查看</p>
      </div>
    </el-dialog>

    <teleport to="body">
      <div v-if="showQrPreview" class="qr-preview-overlay" @click.self="showQrPreview = false">
        <img :src="qrCodeUrl" alt="签到二维码大图" class="qr-preview-image" />
      </div>
    </teleport>

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
              <template #default="{ row }">
                {{ formatDateTime(row.checkin_time) }}
              </template>
            </el-table-column>
            <el-table-column prop="attendance_status" label="签到状态" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.attendance_status === 'on_time'" type="success">准时</el-tag>
                <el-tag v-else-if="row.attendance_status === 'late'" type="warning">迟到</el-tag>
                <el-tag v-else type="danger">缺勤</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="source" label="签到方式" width="100">
              <template #default="{ row }">
                {{ row.source === 'scan' ? '扫码' : '其他' }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="summary-line right">
          签到人数: {{ attendanceRecords.length }} 人
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElIcon, ElMessage, ElMessageBox } from 'element-plus';
import { Loading, Warning } from '@element-plus/icons-vue';
import {
  api,
  ApiResponse,
  batchCreateSessions as batchCreateAttendanceSessions,
  batchEndSessions as batchEndAttendanceSessions,
  createTeacherSession,
  deleteTeacherSession,
  endTeacherSession,
  getTeacherMyBindings,
  getTeacherSessionAttendance,
  getTeacherSessionQrState,
  getTeacherSessionRecords,
  getTeacherSessions,
  updateTeacherStudentStatus,
} from '../../api';
import { buildQrCodeDataUrl } from '../../lib/qrcode';
import { formatDateTime } from '../../lib/format';

const sessions = ref<any[]>([]);
const myCourses = ref<any[]>([]);
const myClassesByCourse = ref<Record<string, any[]>>({});
const showCreateDialog = ref(false);
const showQRDialog = ref(false);
const showAttendanceListDialog = ref(false);
const showRecordsDialog = ref(false);
const showQrPreview = ref(false);
const currentSession = ref<any>(null);
const attendanceSession = ref<any>(null);
const recordsSession = ref<any>(null);
const loadingAttendanceList = ref(false);
const loadingRecords = ref(false);
const expectedAttendanceList = ref<any[]>([]);
const attendanceRecords = ref<any[]>([]);
const qrCodeUrl = ref('');
const qrContent = ref('');
const qrRefreshSeconds = ref(900);
const qrCountdownSeconds = ref(0);
const qrLeaveStudents = ref<any[]>([]);
const endingSessionId = ref<string | null>(null);
const deletingSessionId = ref<string | null>(null);
const batchCreatingSessions = ref(false);
const batchEndingSessions = ref(false);
const lastBatchCreatedSessionIds = ref<string[]>([]);
let qrCountdownTimer: number | null = null;

const form = ref({
  course_id: '',
  class_id: '',
  start_time: new Date(),
  expire_minutes: 15,
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

const onCourseChange = () => {
  form.value.class_id = '';
};

const clearQrCountdown = () => {
  if (qrCountdownTimer) {
    window.clearInterval(qrCountdownTimer);
    qrCountdownTimer = null;
  }
};

const startQrCountdown = () => {
  clearQrCountdown();
  qrCountdownTimer = window.setInterval(async () => {
    if (!showQRDialog.value || !currentSession.value?.id) {
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



const getSessionStatusClass = (row: any) => {
  if (row?.status === 'active') return 'is-active';
  if (row?.status === 'not_started') return 'is-not-started';
  return 'is-ended';
};

const getSessionStatusTitle = (row: any) => {
  if (row?.status === 'active') return '进行中';
  if (row?.status === 'not_started') return '未开始';
  return '已结束';
};

const getSessionRowClass = ({ row }: { row: any }) => {
  if (row?.status === 'active') return 'session-row--active';
  if (row?.status === 'not_started') return 'session-row--not-started';
  return 'session-row--ended';
};

const loadMyBindings = async () => {
  try {
    const response = await getTeacherMyBindings();
    if (response.code === 0) {
      myCourses.value = response.data?.courses || [];
      myClassesByCourse.value = response.data?.classes_by_course || {};
    }
  } catch (error) {
    console.error('加载教师绑定失败', error);
  }
};

const loadSessions = async () => {
  try {
    const response = await getTeacherSessions();
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

const openCreateDialog = () => {
  form.value = {
    course_id: '',
    class_id: '',
    start_time: new Date(),
    expire_minutes: 15,
  };
  showCreateDialog.value = true;
};

const createSession = async () => {
  if (!form.value.course_id || !form.value.class_id) {
    ElMessage.warning('请选择课程和班级');
    return;
  }

  try {
    const response = await createTeacherSession({
      course_id: form.value.course_id,
      class_id: form.value.class_id,
      start_time: form.value.start_time,
      expire_minutes: form.value.expire_minutes,
    });
    if (response.code === 0) {
      ElMessage.success('创建成功');
      showCreateDialog.value = false;
      await loadSessions();
    } else {
      ElMessage.error(response.message || '创建失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '创建失败');
  }
};

const loadQrState = async (sessionId: string) => {
  const response = await getTeacherSessionQrState(String(sessionId));
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
  qrContent.value = JSON.stringify(qrData);
  qrCodeUrl.value = await buildQrCodeDataUrl(qrData, 220);
  startQrCountdown();
};

const showQRCode = async (session: any) => {
  if (session.status === 'not_started') {
    ElMessage.warning('签到尚未开始');
    return;
  }

  if (session.is_qr_code_expired_too_long) {
    ElMessage.warning('二维码已过期较久，无法查看');
    return;
  }

  currentSession.value = session;
  try {
    await loadQrState(session.id);
    showQrPreview.value = false;
    showQRDialog.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '生成二维码失败');
  }
};

const loadQrRefreshConfig = async () => {
  try {
    const response = await api.get('/teacher/qr-config');
    if (response.data?.code === 0) {
      qrRefreshSeconds.value = Math.max(1, Number(response.data?.data?.qr_refresh_seconds || 900));
    }
  } catch (error) {
    console.error('加载二维码刷新时间失败', error);
  }
};

const viewRecords = async (session: any) => {
  recordsSession.value = session;
  loadingRecords.value = true;
  try {
    const response = await getTeacherSessionRecords(session.id);
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
    const response = await getTeacherSessionAttendance(session.id);
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
    const response = await updateTeacherStudentStatus(
      attendanceSession.value.id,
      row.id,
      row.status,
      row.lateMinutes,
    );
    if (response.code === 0) {
      ElMessage.success('更新成功');
      row.originalStatus = row.status;
      row.hasChanged = false;
      await loadSessions();
    } else {
      ElMessage.error(response.message || '更新失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '更新失败');
  } finally {
    row.saving = false;
  }
};

const deleteSession = async (session: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除课次 ${session.id} 吗？`, '确认删除', {
      type: 'warning',
    });

    deletingSessionId.value = session.id;
    const response = await deleteTeacherSession(session.id);
    if (response.code === 0) {
      ElMessage.success('删除成功');
      await loadSessions();
    } else {
      ElMessage.error(response.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  } finally {
    deletingSessionId.value = null;
  }
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
    const response = await batchEndAttendanceSessions({
      session_ids: lastBatchCreatedSessionIds.value,
    });
    if (response.code === 0) {
      const endedIds = Array.isArray(response.data?.session_ids)
        ? response.data.session_ids.map((item: any) => String(item))
        : [];
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
        `批量结束完成：成功 ${Number(response.data?.ended_count || endedIds.length)} 条，跳过 ${Number(response.data?.skipped_count || 0)} 条`,
      );
      void loadSessions();
    } else {
      ElMessage.error(response.message || '批量结束签到失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '批量结束签到失败');
  } finally {
    batchEndingSessions.value = false;
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
    return; // 用户取消
  }

  endingSessionId.value = session.id;
  try {
    const response = await endTeacherSession(String(session.id));
    if (response.code === 0) {
      ElMessage.success(response.message || '已提前结束签到');
      if (currentSession.value?.id === session.id) {
        showQRDialog.value = false;
      }
      sessions.value = sessions.value.map((item: any) =>
        item.id === session.id
          ? {
              ...item,
              status: 'inactive',
              session_end: new Date().toISOString(),
              qr_expire_at: new Date().toISOString(),
            }
          : item,
      );
      void loadSessions();
    } else if (response.code === 409) {
      ElMessage.warning(response.message || '该签到正在处理中，请稍后再试');
    } else {
      ElMessage.error(response.message || '结束签到失败');
    }
  } catch (error: any) {
    if (error?.response?.data?.code === 409) {
      ElMessage.warning(error.response.data.message || '该签到正在处理中，请稍后再试');
    } else {
      ElMessage.error(error?.message || '结束签到失败');
    }
  } finally {
    endingSessionId.value = null;
  }
};

watch(showQRDialog, (visible) => {
  if (!visible) {
    clearQrCountdown();
  }
});

onMounted(async () => {
  await loadMyBindings();
  await loadSessions();
  await loadQrRefreshConfig();
});

onBeforeUnmount(() => {
  clearQrCountdown();
});
</script>

<style scoped>
.teacher-attendance-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.teacher-attendance-hero {
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

.teacher-attendance-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.teacher-attendance-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.teacher-attendance-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.teacher-attendance-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.teacher-attendance-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.teacher-attendance-hero__meta {
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

.teacher-attendance-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.teacher-attendance-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.teacher-attendance-overview__card {
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

.teacher-attendance-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.teacher-attendance-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.teacher-attendance-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.teacher-attendance-table-card {
  overflow: hidden;
}

.teacher-attendance-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.teacher-attendance-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.teacher-attendance-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.session-header-meta {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.session-status-legend {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(241, 246, 249, 0.9);
  border: 1px solid rgba(108, 140, 158, 0.16);
  font-size: 12px;
  font-weight: 600;
  color: #334e63;
}

.session-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.session-course-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.session-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex: 0 0 auto;
  display: inline-block;
}

.session-status-dot.is-active {
  background: #16a34a;
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
}

.session-status-dot.is-not-started {
  background: #d97706;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.16);
}

.session-status-dot.is-ended {
  background: #94a3b8;
}

.table-shell :deep(.el-table tbody tr.session-row--active > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--active > td.el-table__cell.ws-sticky-action-col) {
  background: #f2fbf5 !important;
}

.table-shell :deep(.el-table tbody tr.session-row--active:hover > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--active:hover > td.el-table__cell.ws-sticky-action-col) {
  background: #e6f7ec !important;
}

.table-shell :deep(.el-table tbody tr.session-row--active > td.el-table__cell:first-child) {
  box-shadow: inset 4px 0 0 #16a34a;
}

.table-shell :deep(.el-table tbody tr.session-row--not-started > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--not-started > td.el-table__cell.ws-sticky-action-col) {
  background: #fefaf0 !important;
}

.table-shell :deep(.el-table tbody tr.session-row--not-started:hover > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--not-started:hover > td.el-table__cell.ws-sticky-action-col) {
  background: #fcf2dc !important;
}

.table-shell :deep(.el-table tbody tr.session-row--not-started > td.el-table__cell:first-child) {
  box-shadow: inset 4px 0 0 #d97706;
}

.table-shell :deep(.el-table tbody tr.session-row--ended > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--ended > td.el-table__cell.ws-sticky-action-col) {
  background: #f8fafc !important;
}

.table-shell :deep(.el-table tbody tr.session-row--ended:hover > td.el-table__cell),
.table-shell :deep(.el-table tbody tr.session-row--ended:hover > td.el-table__cell.ws-sticky-action-col) {
  background: #f1f5f9 !important;
}

.table-shell :deep(.el-table tbody tr.session-row--ended > td.el-table__cell:first-child) {
  box-shadow: inset 4px 0 0 #94a3b8;
}

.table-shell :deep(.el-table tbody tr.session-row--ended > td.el-table__cell:not(.ws-sticky-action-col) .cell) {
  color: #64748b;
}

/* Note: hero/overview/table-card patterns available globally in page-layout.css */

.session-action-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.session-action-row :deep(.el-button.is-link),
.session-action-row :deep(.el-button) {
  margin-left: 0 !important;
  padding: 2px 4px !important;
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
.qr-dialog__refresh,
.qr-dialog__hint {
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
  .teacher-attendance-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .teacher-attendance-hero {
    padding: 20px;
  }

  .teacher-attendance-overview {
    grid-template-columns: 1fr;
  }

  .teacher-attendance-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .teacher-attendance-hero__actions > * {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .attendance-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
