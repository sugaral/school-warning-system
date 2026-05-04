<template>
  <div class="schedule-view-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ pageTitle }}</h2>
        <p class="page-subtitle">{{ pageSubtitle }}</p>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-radio-group
          v-if="scopeOptions.length > 1"
          v-model="activeScope"
          @change="handleScopeChange"
        >
          <el-radio-button
            v-for="option in scopeOptions"
            :key="option.value"
            :label="option.value"
          >
            {{ option.label }}
          </el-radio-button>
        </el-radio-group>

        <div class="filter-actions">
          <el-select v-model="selectedTerm" filterable class="term-select" @change="handleTermChange">
            <el-option
              v-for="term in termOptions"
              :key="term"
              :label="term"
              :value="term"
            />
          </el-select>
          <el-select
            v-model="selectedWeek"
            clearable
            placeholder="全部周次"
            class="term-select"
            :disabled="!weekFilterEnabled"
          >
            <el-option
              v-for="week in availableWeekOptions"
              :key="week.value"
              :label="week.label"
              :value="week.value"
            />
          </el-select>
          <el-button type="primary" :loading="loading" @click="loadSchedules">
            查询课表
          </el-button>
        </div>
      </div>

      <el-alert
        class="filter-hint"
        type="info"
        :closable="false"
        show-icon
        :title="contextHint"
      />
    </el-card>

    <el-card class="timetable-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="timetable-card__header">
          <div>
            <div class="timetable-card__title">{{ currentScopeLabel }}</div>
            <div class="timetable-card__subtitle">
              {{ contextLabel || fallbackContextLabel }} · {{ selectedTerm }} · {{ selectedWeekLabel }}
            </div>
          </div>
        </div>
      </template>

      <el-empty
        v-if="!hasLoaded"
        description="请选择学期后查询课表"
        :image-size="88"
      />

      <el-empty
        v-else-if="!timetableRows.length"
        description="当前条件下暂无课表数据"
        :image-size="88"
      />

      <div v-else class="timetable-shell">
        <table class="timetable-grid">
          <thead>
            <tr>
              <th class="time-col">上下课时间</th>
              <th v-for="weekday in weekdayColumns" :key="weekday.key">
                {{ weekday.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in timetableRows" :key="row.slotKey">
              <th class="time-col">
                <div class="time-label">{{ row.label }}</div>
              </th>
              <td v-for="weekday in weekdayColumns" :key="`${row.slotKey}-${weekday.key}`">
                <div v-if="row.cells[weekday.key]?.length" class="cell-stack">
                  <div
                    v-for="item in row.cells[weekday.key]"
                    :key="item.id"
                    class="schedule-card"
                  >
                    <div class="schedule-card__name">
                      {{ item.course_name || '未命名课程' }}
                    </div>
                    <div class="schedule-card__meta">
                      {{ item.teacher_name || '未分配教师' }}
                    </div>
                    <div class="schedule-card__meta">
                      {{ item.class_name || contextLabel || fallbackContextLabel }}
                    </div>
                    <div class="schedule-card__meta">{{ item.weekLabel }}</div>
                    <div class="schedule-card__meta">{{ item.dateLabel }}</div>
                  </div>
                </div>
                <div v-else class="cell-empty">-</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getRoleSchedulesView, getSchedulesSemesterConfig } from '../api';

const TERM_CODE_PATTERN = /^\d{4}-(SPRING|FALL)$/;

const weekdayColumns = [
  { key: 1, label: '周一' },
  { key: 2, label: '周二' },
  { key: 3, label: '周三' },
  { key: 4, label: '周四' },
  { key: 5, label: '周五' },
  { key: 6, label: '周六' },
  { key: 7, label: '周日' },
];

const getCurrentTermCode = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 2 && month <= 7) return `${year}-SPRING`;
  if (month >= 8) return `${year}-FALL`;
  return `${year - 1}-FALL`;
};

const shiftTermCode = (termCode: string, offset: number) => {
  const normalized = String(termCode || '').trim().toUpperCase();
  const match = normalized.match(/^(\d{4})-(SPRING|FALL)$/);
  if (!match) return normalized;

  let year = Number(match[1]);
  let season = match[2];
  let remaining = offset;

  while (remaining > 0) {
    if (season === 'SPRING') {
      season = 'FALL';
    } else {
      season = 'SPRING';
      year += 1;
    }
    remaining -= 1;
  }

  while (remaining < 0) {
    if (season === 'FALL') {
      season = 'SPRING';
    } else {
      season = 'FALL';
      year -= 1;
    }
    remaining += 1;
  }

  return `${year}-${season}`;
};

const getRolesFull = () => {
  try {
    const raw = localStorage.getItem('admin_roles_full');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const inferUserType = () => {
  const rolesFull = getRolesFull();
  if (rolesFull.find((role: any) => role.role === 'class_monitor')) return 'class_monitor';
  if (rolesFull.find((role: any) => role.role === 'head_teacher')) return 'head_teacher';
  if (rolesFull.find((role: any) => role.role === 'teacher')) return 'teacher';
  if (rolesFull.find((role: any) => role.role === 'student')) return 'student';

  try {
    const rawUser = localStorage.getItem('admin_user');
    const user = rawUser ? JSON.parse(rawUser) : {};
    return String(user?.user_type || '').trim();
  } catch {
    return '';
  }
};

const defaultTermCode = getCurrentTermCode();
const currentRole = ref(inferUserType());
const selectedTerm = ref(defaultTermCode);
const selectedWeek = ref('');
const activeScope = ref<'class' | 'teaching'>('class');
const loading = ref(false);
const hasLoaded = ref(false);
const contextLabel = ref('');
const schedules = ref<any[]>([]);
const allSchedules = ref<any[]>([]);
const semesterStartDate = ref('');
const semesterTotalWeeks = ref(20);

const scopeOptions = computed(() => {
  if (currentRole.value === 'head_teacher') {
    return [
      { label: '本班课表', value: 'class' as const },
      { label: '任教课表', value: 'teaching' as const },
    ];
  }
  if (currentRole.value === 'teacher') {
    return [{ label: '任教课表', value: 'teaching' as const }];
  }
  return [{ label: '本班课表', value: 'class' as const }];
});

const pageTitle = computed(() => {
  if (currentRole.value === 'head_teacher') return '课表查询';
  if (currentRole.value === 'teacher') return '任教课表';
  return '本班课表';
});

const pageSubtitle = computed(() => {
  if (currentRole.value === 'head_teacher') {
    return '班主任可以在本班课表和本人任教课表之间切换，并按学期周次筛选。';
  }
  if (currentRole.value === 'teacher') {
    return '教师端展示本人当前学期的任教课表，并支持按周次筛选。';
  }
  return '学生端展示当前绑定班级课表，并支持按学期周次查看。';
});

const currentScopeLabel = computed(() => {
  const current = scopeOptions.value.find((item) => item.value === activeScope.value);
  return current?.label || '课表';
});

const fallbackContextLabel = computed(() =>
  activeScope.value === 'teaching' ? '本人任教' : '当前班级',
);

const contextHint = computed(() => {
  if (currentRole.value === 'head_teacher') {
    return '班主任可在“本班课表”和“任教课表”之间切换，并按学期周次查看。';
  }
  if (currentRole.value === 'teacher') {
    return '教师端仅展示本人任教课表，可切换学期并按周次筛选。';
  }
  return '学生端显示当前绑定班级课表，可切换学期并按周次筛选。';
});

const termOptions = computed(() => {
  const values: string[] = [];
  for (let offset = -4; offset <= 4; offset += 1) {
    values.push(shiftTermCode(defaultTermCode, offset));
  }
  return Array.from(new Set(values));
});

const startOfDay = (value: string | Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const startOfWeekMonday = (value: string | Date) => {
  const date = startOfDay(value);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
};

const getActiveSemesterStartDate = () =>
  semesterStartDate.value ? startOfWeekMonday(semesterStartDate.value) : null;

const getAcademicWeekInfo = (value: string | Date) => {
  const current = startOfWeekMonday(value);
  const base = getActiveSemesterStartDate();
  if (!base) {
    return {
      weekNumber: null,
      weekLabel: '未设置学期起始日',
    };
  }
  const diffDays = Math.max(
    0,
    Math.floor((current.getTime() - base.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const weekNumber = Math.floor(diffDays / 7) + 1;
  return {
    weekNumber,
    weekLabel: `第${weekNumber}周`,
  };
};

const availableWeekOptions = computed(() => {
  if (!semesterStartDate.value || semesterTotalWeeks.value <= 0) {
    return [];
  }
  return Array.from({ length: semesterTotalWeeks.value }, (_, index) => {
    const weekNumber = index + 1;
    return {
      value: String(weekNumber),
      label: `第${weekNumber}周`,
    };
  });
});

const weekFilterEnabled = computed(
  () =>
    Boolean(semesterStartDate.value)
    && availableWeekOptions.value.length > 0,
);

const selectedWeekLabel = computed(() => {
  if (!semesterStartDate.value) {
    return '未设置学期起始日';
  }
  if (!selectedWeek.value) {
    return '全部周次';
  }
  const matched = availableWeekOptions.value.find(
    (item) => String(item.value) === String(selectedWeek.value),
  );
  return matched?.label || `第${selectedWeek.value}周`;
});

const toDate = (value: string | Date) => new Date(value);

const padTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const formatDateLabel = (value: string | Date) => {
  const date = toDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const getWeekdayKey = (value: string | Date) => {
  const weekday = toDate(value).getDay();
  return weekday === 0 ? 7 : weekday;
};

const getTimeRangeLabel = (start: string | Date, end: string | Date) =>
  `${padTime(toDate(start))} - ${padTime(toDate(end))}`;

const getMinutes = (value: string | Date) => {
  const date = toDate(value);
  return date.getHours() * 60 + date.getMinutes();
};

const timetableRows = computed(() => {
  const rowMap = new Map<
    string,
    {
      slotKey: string;
      label: string;
      startMinutes: number;
      cells: Record<number, any[]>;
    }
  >();

  schedules.value.forEach((item: any) => {
    const slotKey = getTimeRangeLabel(item.session_start, item.session_end);
    if (!rowMap.has(slotKey)) {
      rowMap.set(slotKey, {
        slotKey,
        label: slotKey,
        startMinutes: getMinutes(item.session_start),
        cells: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] },
      });
    }

    const row = rowMap.get(slotKey)!;
    const weekdayKey = getWeekdayKey(item.session_start);
    row.cells[weekdayKey].push({
      ...item,
      dateLabel: formatDateLabel(item.session_start),
    });
  });

  return Array.from(rowMap.values()).sort((left, right) => left.startMinutes - right.startMinutes);
});

const applyWeekFilter = () => {
  if (!selectedWeek.value) {
    schedules.value = [...allSchedules.value];
    return;
  }

  schedules.value = allSchedules.value.filter(
    (item: any) => String(item.weekNumber) === String(selectedWeek.value),
  );
};

const loadSemesterConfig = async () => {
  try {
    const response = await getSchedulesSemesterConfig();
    if (response.code === 0) {
      semesterStartDate.value = response.data?.semester_start_date || '';
      semesterTotalWeeks.value = Number(
        response.data?.semester_total_weeks
          || response.data?.default_semester_total_weeks
          || 20,
      );
    } else {
      semesterStartDate.value = '';
      semesterTotalWeeks.value = 20;
      ElMessage.warning('尚未设置学期起始日，暂不支持按周次筛选');
    }
  } catch {
    semesterStartDate.value = '';
    semesterTotalWeeks.value = 20;
    ElMessage.warning('学期起始日加载失败，暂不支持按周次筛选');
  }
};

const loadSchedules = async () => {
  const normalizedTerm = String(selectedTerm.value || '').trim().toUpperCase();
  selectedTerm.value = normalizedTerm;

  if (!TERM_CODE_PATTERN.test(normalizedTerm)) {
    ElMessage.warning('学期格式必须为 2026-SPRING 或 2025-FALL');
    return;
  }

  loading.value = true;
  try {
    const resp = await getRoleSchedulesView({
      term_code: normalizedTerm,
      scope: activeScope.value,
    });

    if (resp.code === 0) {
      allSchedules.value = (Array.isArray(resp.data?.list) ? resp.data.list : []).map((item: any) => {
        const weekInfo = getAcademicWeekInfo(item.session_start);
        return {
          ...item,
          weekNumber: weekInfo.weekNumber ?? '',
          weekLabel: weekInfo.weekLabel,
        };
      });
      if (Number(selectedWeek.value || 0) > semesterTotalWeeks.value) {
        selectedWeek.value = '';
      }
      applyWeekFilter();
      contextLabel.value = String(resp.data?.context_label || '').trim();
      const backendScope = String(resp.data?.active_scope || '').trim();
      if (backendScope === 'class' || backendScope === 'teaching') {
        activeScope.value = backendScope;
      }
      hasLoaded.value = true;
      return;
    }

    ElMessage.error(resp.message || '加载课表失败');
  } catch (error: any) {
    ElMessage.error(error?.message || '加载课表失败');
  } finally {
    loading.value = false;
  }
};

watch(selectedWeek, () => {
  if (hasLoaded.value) {
    applyWeekFilter();
  }
});

const handleScopeChange = async () => {
  selectedWeek.value = '';
  await loadSchedules();
};

const handleTermChange = () => {
  selectedWeek.value = '';
  schedules.value = [];
  allSchedules.value = [];
  hasLoaded.value = false;
};

onMounted(async () => {
  if (scopeOptions.value.length === 1) {
    activeScope.value = scopeOptions.value[0].value;
  }
  await loadSemesterConfig();
  await loadSchedules();
});
</script>

<style scoped>
.schedule-view-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 24px;
  color: #102132;
}

.page-subtitle {
  margin: 8px 0 0;
  color: #607384;
  font-size: 14px;
}

.filter-card,
.timetable-card {
  border-radius: 24px;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.term-select {
  width: 180px;
}

.filter-hint {
  margin-top: 12px;
}

.timetable-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.timetable-card__title {
  font-size: 18px;
  font-weight: 700;
  color: #102132;
}

.timetable-card__subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: #607384;
}

.timetable-shell {
  width: 100%;
  overflow: auto;
}

.timetable-grid {
  width: 100%;
  min-width: 1080px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.timetable-grid th,
.timetable-grid td {
  border: 1px solid rgba(107, 140, 158, 0.14);
  vertical-align: top;
  background: rgba(255, 255, 255, 0.52);
}

.timetable-grid thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 14px 12px;
  background: rgba(248, 251, 252, 0.92);
  color: #102132;
  font-size: 14px;
  font-weight: 700;
}

.timetable-grid tbody td,
.timetable-grid tbody th {
  padding: 12px;
}

.time-col {
  width: 148px;
  min-width: 148px;
  background: rgba(248, 251, 252, 0.92);
}

.time-label {
  font-weight: 700;
  color: #102132;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cell-empty {
  min-height: 96px;
  display: grid;
  place-items: center;
  color: #8da0af;
}

.schedule-card {
  border-radius: 18px;
  padding: 12px 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 248, 250, 0.86));
  box-shadow: 0 10px 22px rgba(27, 56, 74, 0.08);
}

.schedule-card__name {
  font-size: 14px;
  font-weight: 700;
  color: #102132;
}

.schedule-card__meta {
  margin-top: 6px;
  font-size: 12px;
  color: #607384;
}

@media (max-width: 900px) {
  .filter-bar {
    align-items: stretch;
  }

  .filter-actions {
    width: 100%;
  }

  .term-select {
    flex: 1 1 180px;
    width: auto;
  }
}
</style>
