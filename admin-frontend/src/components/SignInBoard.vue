<template>
  <teleport to="body">
    <!-- 签到看板：白色小框（左侧二维码 / 右侧已签到·未签到） -->
    <div v-if="visible" class="signin-mask" @click.self="emit('close')">
      <div class="signin-panel">
        <header class="signin-panel__header">
          <div class="signin-panel__title-group">
            <h3 class="signin-panel__title">{{ titleText }}</h3>
            <div class="signin-panel__subtitle">
              <span>课次 #{{ session?.id }}</span>
              <span class="dot">·</span>
              <span>截止 {{ formatDateTime(session?.session_end || session?.qr_expire_at) }}</span>
              <span class="dot">·</span>
              <span :class="['live-dot', { 'live-dot--paused': !polling }]"></span>
              <span>{{ liveText }}</span>
            </div>
          </div>
          <div class="signin-panel__actions">
            <button
              class="panel-btn"
              type="button"
              :disabled="refreshing"
              @click="refreshNow"
            >
              {{ refreshing ? '刷新中…' : '刷新名单' }}
            </button>
            <button
              class="panel-btn"
              type="button"
              :disabled="notStarted"
              :title="notStarted ? '签到开始后才能换码' : '换一张二维码'"
              @click="emit('refresh-qr')"
            >
              换二维码
            </button>
            <button class="panel-btn" type="button" @click="emit('end-session')">结束签到</button>
            <button class="panel-btn panel-btn--icon" type="button" title="关闭" @click="emit('close')">
              ✕
            </button>
          </div>
        </header>

        <main :class="['signin-panel__body', { 'is-qr-zoomed': qrZoom }]">
          <!-- 左侧：二维码（点击在面板内放大 / 再点缩小） -->
          <section class="panel-qr">
            <button
              :class="['panel-qr__frame', { 'is-flashing': qrFlashing, 'is-waiting': notStarted }]"
              type="button"
              :title="notStarted ? '签到尚未开始' : qrZoom ? '点击缩小' : '点击放大'"
              @click="toggleQrZoom"
            >
              <div v-if="notStarted" class="panel-qr__waiting">
                <div class="panel-qr__waiting-title">签到尚未开始</div>
                <div class="panel-qr__waiting-timer">{{ startCountdownText }}</div>
                <div class="panel-qr__waiting-hint">到点后二维码自动出现</div>
              </div>
              <img
                v-else-if="qrUrl && !qrZoom"
                :src="qrUrl"
                alt="签到二维码"
                class="panel-qr__image"
              />
              <img
                v-else-if="qrZoom && (qrUrlLarge || qrUrl)"
                :src="qrUrlLarge || qrUrl"
                alt="签到二维码（放大）"
                class="panel-qr__image"
              />
              <span v-else class="panel-qr__placeholder">二维码生成中…</span>
              <span v-if="!notStarted" class="panel-qr__zoom">
                {{ qrZoom ? '点击缩小' : '点击放大' }}
              </span>
            </button>
            <div class="panel-qr__meta">
              <template v-if="notStarted">签到开始后每 {{ refreshSeconds }}s 自动换码</template>
              <template v-else>剩余 <b>{{ countdown }}s</b> 刷新（每 {{ refreshSeconds }}s）</template>
            </div>
            <div class="panel-qr__hint">
              {{ notStarted ? '未开始时二维码不展示，防止提前扫码' : '学生用小程序扫码签到' }}
            </div>
          </section>

          <!-- 右侧：已签到 / 未签到 -->
          <section class="panel-roster">
            <div class="roster-tabs">
              <button
                type="button"
                :class="['roster-tab', 'roster-tab--checked', { 'is-active': activeTab === 'checked' }]"
                @click="activeTab = 'checked'"
              >
                已签到
                <span class="roster-tab__count">{{ checkedList.length }}</span>
              </button>
              <button
                type="button"
                :class="['roster-tab', 'roster-tab--unchecked', { 'is-active': activeTab === 'unchecked' }]"
                @click="activeTab = 'unchecked'"
              >
                未签到
                <span class="roster-tab__count">{{ uncheckedList.length }}</span>
              </button>
              <span class="roster-summary">
                应到 {{ roster.length }} · 请假 {{ leaveCount }}
              </span>
            </div>

            <div v-if="loading && roster.length === 0" class="roster-empty">正在加载学生名单…</div>
            <div v-else-if="activeList.length === 0" class="roster-empty">
              {{ activeTab === 'checked' ? '还没有学生签到' : '全部学生都已签到' }}
            </div>
            <div v-else class="roster-grid">
              <div v-for="member in activeList" :key="member.id" class="roster-member">
                <div class="roster-avatar" :style="avatarStyle(member.name)">
                  {{ avatarChar(member.name) }}
                </div>
                <div class="roster-name" :title="member.name">{{ member.name || '未命名' }}</div>
                <div class="roster-no">{{ member.student_no }}</div>
                <span v-if="member._tag" :class="['roster-tag', 'roster-tag--' + member._tagType]">
                  {{ member._tag }}
                </span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getSessionAttendance } from '../api';
import { formatDateTime } from '../lib/format';

const props = defineProps<{
  visible: boolean;
  session: any;
  qrUrl: string;
  qrUrlLarge?: string;
  countdown: number;
  refreshSeconds: number;
  startAt?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'refresh-qr'): void;
  (e: 'end-session'): void;
}>();

const POLL_INTERVAL_MS = 2000;
const CHECKED_STATUSES = ['on_time', 'late'];

const roster = ref<any[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const activeTab = ref<'checked' | 'unchecked'>('checked');
const lastUpdatedAt = ref<Date | null>(null);
const polling = ref(false);
const qrZoom = ref(false);
const qrFlashing = ref(false);
const nowTs = ref(Date.now());

let pollTimer: number | null = null;
let qrFlashTimer: number | null = null;
let clockTimer: number | null = null;

/** 课次开始时间（未到点时不展示二维码，避免提前签到） */
const startTimestamp = computed(() => {
  const raw = props.startAt;
  if (!raw) {
    return null;
  }
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : null;
});

const notStarted = computed(
  () => startTimestamp.value !== null && nowTs.value < startTimestamp.value,
);

const startCountdownText = computed(() => {
  if (startTimestamp.value === null) {
    return '';
  }
  const diff = Math.max(0, startTimestamp.value - nowTs.value);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分后开始`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒后开始`;
  }
  return `${seconds} 秒后开始`;
});

const titleText = computed(() => {
  const parts = [props.session?.course_name, props.session?.class_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : `课次 #${props.session?.id ?? ''} 签到`;
});

const liveText = computed(() => {
  if (!lastUpdatedAt.value) {
    return polling.value ? '实时同步中' : '等待同步';
  }
  return `更新于 ${lastUpdatedAt.value.toLocaleTimeString('zh-CN', { hour12: false })}`;
});

const leaveCount = computed(
  () => roster.value.filter((member) => member.status === 'leave').length,
);

const checkedList = computed(() =>
  roster.value
    .filter((member) => CHECKED_STATUSES.includes(String(member.status || '').trim()))
    .map((member) =>
      member.status === 'late'
        ? { ...member, _tag: '迟到', _tagType: 'late' }
        : { ...member, _tag: '', _tagType: 'late' },
    ),
);

const uncheckedList = computed(() =>
  roster.value
    .filter((member) => !CHECKED_STATUSES.includes(String(member.status || '').trim()))
    .map((member) =>
      member.status === 'leave'
        ? { ...member, _tag: '请假', _tagType: 'leave' }
        : { ...member, _tag: '', _tagType: 'absent' },
    ),
);

const activeList = computed(() =>
  activeTab.value === 'checked' ? checkedList.value : uncheckedList.value,
);

/** 白色主题：低饱和底色 + 同色系深色文字 */
const AVATAR_STYLES = [
  { background: '#eef3ff', color: '#3557c9' },
  { background: '#e8f7f2', color: '#0f7a5a' },
  { background: '#f3eeff', color: '#5b3fc0' },
  { background: '#fff1e8', color: '#b4551c' },
  { background: '#e9f8ee', color: '#17803d' },
  { background: '#fdecec', color: '#b32f34' },
  { background: '#e9f5ff', color: '#17679b' },
  { background: '#fdecf5', color: '#a52d76' },
];

const hashName = (name: string) => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000;
  }
  return hash;
};

const avatarStyle = (name: string) => {
  const key = String(name || '?');
  const style = AVATAR_STYLES[hashName(key) % AVATAR_STYLES.length];
  return { background: style.background, color: style.color };
};

/** 头像显示姓名最后一个字；英文名取末字母大写 */
const avatarChar = (name: string) => {
  const text = String(name || '').trim();
  if (!text) {
    return '?';
  }
  const chars = Array.from(text);
  const last = chars[chars.length - 1];
  return /[a-zA-Z]/.test(last) ? last.toUpperCase() : last;
};

const refresh = async () => {
  if (!props.session?.id) {
    return;
  }

  loading.value = true;
  polling.value = true;
  try {
    const response = await getSessionAttendance(String(props.session.id));
    if (response?.code === 0) {
      roster.value = Array.isArray(response.data) ? response.data : [];
      lastUpdatedAt.value = new Date();
    }
    return response;
  } catch (error: any) {
    // 轮询失败保留上一次数据；手动刷新时由调用方提示错误
    return { code: -1, message: error?.message || '刷新失败' };
  } finally {
    loading.value = false;
  }
};

/** 手动刷新名单：按钮进入 loading，并给出明确结果提示 */
const refreshNow = async () => {
  if (refreshing.value) {
    return;
  }
  refreshing.value = true;
  try {
    const result: any = await refresh();
    if (result?.code === 0) {
      ElMessage.success(
        `名单已刷新：已签到 ${checkedList.value.length} · 未签到 ${uncheckedList.value.length}`,
      );
    } else {
      ElMessage.error(result?.message || '刷新名单失败');
    }
  } finally {
    refreshing.value = false;
  }
};

/** 二维码换码：由父组件重新拉取并生成，这里只做“闪一下”的视觉反馈 */
const flashQr = () => {
  qrFlashing.value = true;
  if (qrFlashTimer !== null) {
    window.clearTimeout(qrFlashTimer);
  }
  qrFlashTimer = window.setTimeout(() => {
    qrFlashing.value = false;
    qrFlashTimer = null;
  }, 900);
};

/** 点击二维码：在面板内放大 / 缩小（不弹全屏层） */
const toggleQrZoom = () => {
  if (!props.qrUrl && !props.qrUrlLarge) {
    return;
  }
  qrZoom.value = !qrZoom.value;
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') {
    return;
  }
  if (qrZoom.value) {
    qrZoom.value = false;
    return;
  }
  if (props.visible) {
    emit('close');
  }
};

const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  polling.value = false;
};

const startPolling = async () => {
  stopPolling();
  await refresh();
  pollTimer = window.setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void startPolling();
    } else {
      stopPolling();
      qrZoom.value = false;
      roster.value = [];
      lastUpdatedAt.value = null;
    }
  },
  { immediate: true },
);

watch(
  () => props.session?.id,
  () => {
    if (props.visible) {
      void startPolling();
    }
  },
);

watch(
  () => props.qrUrl,
  (value, previous) => {
    if (value && previous && value !== previous) {
      flashQr();
    }
  },
);

// 到点自动出码
watch(notStarted, (value, previous) => {
  if (previous && !value) {
    emit('refresh-qr');
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  clockTimer = window.setInterval(() => {
    nowTs.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  stopPolling();
  if (qrFlashTimer !== null) {
    window.clearTimeout(qrFlashTimer);
    qrFlashTimer = null;
  }
  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.signin-mask {
  position: fixed;
  inset: 0;
  /* 低于 Element Plus 弹层，保证「结束签到」确认框浮在面板之上 */
  z-index: 1900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.signin-panel {
  width: min(1040px, 92vw);
  height: min(640px, 84vh);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}

.signin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid #f0f2f5;
}

.signin-panel__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #1f2937;
}

.signin-panel__subtitle {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8f95a3;
}

.dot {
  opacity: 0.5;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #18a058;
  animation: live-pulse 1.6s infinite;
}

.live-dot--paused {
  background: #c0c4cc;
  animation: none;
}

@keyframes live-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0.45);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(24, 160, 88, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0);
  }
}

.signin-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #dcdfe6;
  background: #ffffff;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: all 0.16s ease;
}

.panel-btn:hover {
  border-color: #c0c4cc;
  color: #1f2937;
  background: #fafafa;
}

.panel-btn--icon {
  width: 30px;
  padding: 6px 0;
  text-align: center;
  color: #909399;
}

.signin-panel__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  padding: 18px 22px 20px;
}

/* ---------- 左侧二维码 ---------- */
.panel-qr {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-qr__frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 12px;
  background: #ffffff;
  cursor: zoom-in;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.panel-qr__frame:hover {
  border-color: #c6d7ff;
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.08);
}

.panel-qr__frame:disabled {
  cursor: progress;
}

/* 未开始：二维码区域显示倒计时 */
.panel-qr__frame.is-waiting {
  cursor: default;
  border-style: dashed;
  background: #fcfcfd;
}

.panel-qr__waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px;
  text-align: center;
}

.panel-qr__waiting-title {
  font-size: 15px;
  font-weight: 600;
  color: #4b5563;
}

.panel-qr__waiting-timer {
  font-size: 22px;
  font-weight: 700;
  color: #409eff;
  font-variant-numeric: tabular-nums;
}

.panel-qr__waiting-hint {
  font-size: 12px;
  color: #a8abb2;
}

/* 换码成功时的提示动画 */
.panel-qr__frame.is-flashing {
  animation: qr-flash 0.9s ease;
}

@keyframes qr-flash {
  0% {
    border-color: #18a058;
    box-shadow: 0 0 0 0 rgba(24, 160, 88, 0.45);
    transform: scale(1);
  }
  40% {
    border-color: #18a058;
    box-shadow: 0 0 0 8px rgba(24, 160, 88, 0);
    transform: scale(1.015);
  }
  100% {
    border-color: #ebeef5;
    box-shadow: none;
    transform: scale(1);
  }
}

.panel-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.panel-qr__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.panel-qr__placeholder {
  font-size: 13px;
  color: #a8abb2;
}

.panel-qr__zoom {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(31, 41, 55, 0.72);
  color: #fff;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.panel-qr__frame:hover .panel-qr__zoom {
  opacity: 1;
}

.panel-qr__meta {
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}

.panel-qr__meta b {
  color: #409eff;
}

.panel-qr__hint {
  font-size: 11px;
  color: #a8abb2;
  text-align: center;
}

/* ---------- 右侧名单 ---------- */
.panel-roster {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
}

.roster-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.roster-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #6b7280;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.roster-tab:hover {
  border-color: #c0c4cc;
  color: #374151;
}

.roster-tab.is-active.roster-tab--checked {
  border-color: #18a058;
  color: #0f7a43;
  background: #f0fbf5;
}

.roster-tab.is-active.roster-tab--unchecked {
  border-color: #e5484d;
  color: #b32f34;
  background: #fdf2f2;
}

.roster-tab__count {
  min-width: 24px;
  padding: 1px 7px;
  border-radius: 999px;
  background: #f4f5f7;
  color: #4b5563;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.roster-tab.is-active.roster-tab--checked .roster-tab__count {
  background: #d8f5e6;
  color: #0f7a43;
}

.roster-tab.is-active.roster-tab--unchecked .roster-tab__count {
  background: #fbe0e1;
  color: #b32f34;
}

.roster-summary {
  margin-left: auto;
  font-size: 12px;
  color: #a8abb2;
}

.roster-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 14px 8px;
  padding: 14px 6px;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  background: #fcfcfd;
  align-content: start;
}

.roster-member {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 2px 8px;
}

.roster-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 600;
  user-select: none;
  border: 1px solid rgba(15, 23, 42, 0.04);
}

.roster-name {
  max-width: 100%;
  font-size: 12px;
  color: #374151;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-no {
  font-size: 10px;
  color: #b0b4bd;
}

.roster-tag {
  position: absolute;
  top: 0;
  right: 2px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 9px;
  line-height: 15px;
}

.roster-tag--late {
  background: #fff7e6;
  color: #b76b00;
  border: 1px solid #ffe1ab;
}

.roster-tag--leave {
  background: #eef3ff;
  color: #3557c9;
  border: 1px solid #cfdcff;
}

.roster-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
  color: #a8abb2;
  font-size: 13px;
  background: #fcfcfd;
}

/* ---------- 面板内放大二维码（不弹全屏层） ---------- */
.signin-panel__body.is-qr-zoomed {
  grid-template-columns: minmax(340px, 46%) 1fr;
}

.signin-panel__body.is-qr-zoomed .panel-qr__frame {
  width: min(100%, 420px);
  margin: 0 auto;
  cursor: zoom-out;
  border-color: #c6d7ff;
}

.signin-panel__body.is-qr-zoomed .panel-qr__image {
  /* 用 720px 的高分辨率源图，放大后依然清晰 */
  image-rendering: auto;
}

@media (max-width: 900px) {
  .signin-panel__body {
    grid-template-columns: 220px 1fr;
  }
}
</style>
