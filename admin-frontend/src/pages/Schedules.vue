<template>
  <div class="schedules-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">课表管理</h2>
        <p class="page-subtitle">
          先选择学院，再选班级和学期，最后按学期周次筛选课表。周次会根据学期起始时间和上课日期自动计算。
        </p>
      </div>
      <div class="page-actions">
        <el-button type="danger" plain @click="openBatchDeleteDialog">删除班级学期课表</el-button>
        <el-button type="success" @click="showImportDialog = true">导入课表</el-button>
      </div>
    </div>

    <el-card class="filter-card" shadow="never">
      <el-form :model="searchForm" label-width="88px" class="filter-form">
        <el-form-item label="学院">
          <el-select
            v-model="searchForm.org_name"
            placeholder="请选择学院"
            clearable
            filterable
            @change="handleOrgChange"
          >
            <el-option
              v-for="org in orgs"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.org_name || org.name"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="班级">
          <el-select
            v-model="searchForm.class_id"
            placeholder="请选择班级"
            clearable
            filterable
            :disabled="!searchForm.org_name"
            @change="handleClassChange"
          >
            <el-option
              v-for="clazz in filteredClasses"
              :key="clazz.id"
              :label="clazz.class_name"
              :value="clazz.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="学期">
          <el-select
            v-model="searchForm.term_code"
            placeholder="请选择学期"
            clearable
            filterable
            :disabled="!searchForm.class_id"
            @change="handleTermChange"
          >
            <el-option
              v-for="term in termOptions"
              :key="term"
              :label="term"
              :value="term"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="周次">
          <el-select
            v-model="searchForm.week_number"
            placeholder="全部周次"
            clearable
            :disabled="!weekFilterEnabled"
          >
            <el-option
              v-for="week in availableWeekOptions"
              :key="week.value"
              :label="week.label"
              :value="week.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item class="filter-form__actions">
          <el-button
            type="primary"
            :loading="loading"
            :disabled="!canQuerySchedules"
            @click="loadSchedules"
          >
            查询课表
          </el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        class="filter-hint"
        type="info"
        :closable="false"
        show-icon
        title="课表管理不会默认加载全部数据，请按 学院 -> 班级 -> 学期 的顺序选择后再查询。周次按教学端设置的学期起始日期自动计算。"
      />
    </el-card>

    <el-card class="timetable-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="timetable-card__header">
          <div>
            <div class="timetable-card__title">标准课表视图</div>
            <div class="timetable-card__subtitle">
              {{ selectedClassLabel || '未选择班级' }} · {{ searchForm.term_code || '未选择学期' }} · {{ selectedWeekLabel }}
            </div>
          </div>
        </div>
      </template>

      <el-empty
        v-if="!hasSearched"
        description="请先选择学院、班级和学期后查询课表"
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
                    <div class="schedule-card__name">{{ item.course_name }}</div>
                    <div class="schedule-card__meta">{{ item.teacher_name || '未分配教师' }}</div>
                    <div class="schedule-card__meta">{{ item.weekLabel }}</div>
                    <div class="schedule-card__meta">{{ item.dateLabel }}</div>
                    <div class="schedule-card__actions">
                      <el-button type="primary" size="small" @click="handleEdit(item.raw)">
                        编辑
                      </el-button>
                      <el-button type="danger" size="small" @click="handleDelete(item.raw)">
                        删除
                      </el-button>
                    </div>
                  </div>
                </div>
                <div v-else class="cell-empty">-</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <el-dialog v-model="editDialogVisible" title="编辑课表" width="560px">
      <el-form :model="editForm" label-width="110px">
        <el-form-item label="学期">
          <el-select v-model="editForm.term_code" filterable style="width: 100%">
            <el-option v-for="term in termOptions" :key="term" :label="term" :value="term" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程代码">
          <el-input v-model="editForm.course_code" readonly />
        </el-form-item>
        <el-form-item label="班级名称">
          <el-input v-model="editForm.class_name" readonly />
        </el-form-item>
        <el-form-item label="教师名称">
          <el-input v-model="editForm.teacher_name" readonly />
        </el-form-item>
        <el-form-item label="上课开始时间">
          <el-date-picker
            v-model="editForm.session_start"
            type="datetime"
            style="width: 100%"
            placeholder="请选择时间"
          />
        </el-form-item>
        <el-form-item label="下课结束时间">
          <el-date-picker
            v-model="editForm.session_end"
            type="datetime"
            style="width: 100%"
            placeholder="请选择时间"
          />
        </el-form-item>
        <el-form-item label="过期分钟数">
          <el-input-number
            v-model="editForm.expire_minutes"
            :min="1"
            :max="180"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showImportDialog"
      title="导入课表"
      width="980px"
      :close-on-click-modal="false"
    >
      <div class="import-toolbar">
        <el-upload
          action=""
          :auto-upload="false"
          :show-file-list="false"
          accept=".csv"
          :on-change="handleBatchFileChange"
        >
          <el-button type="success">上传 CSV</el-button>
        </el-upload>
        <el-upload
          action=""
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleBatchFileChange"
        >
          <el-button type="success" plain>上传 XLSX</el-button>
        </el-upload>
        <span class="import-hint">
          模板字段建议包含：学期、课程代码、课程名称、班级名称、教师名称、上课开始时间、下课结束时间、过期分钟数。
        </span>
      </div>

      <el-table v-if="batchParsedData.length" :data="batchParsedData" max-height="420">
        <el-table-column prop="term_code" label="学期" width="140" />
        <el-table-column prop="course_code" label="课程代码" width="120" />
        <el-table-column prop="course_name" label="课程名称" min-width="160" />
        <el-table-column prop="class_name" label="班级名称" min-width="140" />
        <el-table-column prop="teacher_name" label="教师名称" width="140" />
        <el-table-column prop="session_start" label="上课开始时间" min-width="180" />
        <el-table-column prop="session_end" label="下课结束时间" min-width="180" />
        <el-table-column prop="expire_minutes" label="过期分钟数" width="110" />
      </el-table>

      <el-empty v-else description="请先上传 CSV 或 XLSX 文件" :image-size="88" />

      <template #footer>
        <el-button @click="closeImportDialog">取消</el-button>
        <el-button type="primary" :loading="batchCreating" @click="submitBatchImport">
          开始导入
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showBatchDeleteDialog"
      title="删除班级学期课表"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form :model="deleteForm" label-width="88px">
        <el-form-item label="学院">
          <el-select
            v-model="deleteForm.org_name"
            placeholder="请选择学院"
            clearable
            filterable
            style="width: 100%"
            @change="handleDeleteOrgChange"
          >
            <el-option
              v-for="org in orgs"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.org_name || org.name"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="班级">
          <el-select
            v-model="deleteForm.class_id"
            placeholder="请选择班级"
            clearable
            filterable
            style="width: 100%"
            :disabled="!deleteForm.org_name"
          >
            <el-option
              v-for="clazz in deleteFilteredClasses"
              :key="clazz.id"
              :label="clazz.class_name"
              :value="String(clazz.id)"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="学期">
          <el-select
            v-model="deleteForm.term_code"
            placeholder="请选择学期"
            clearable
            filterable
            style="width: 100%"
            :disabled="!deleteForm.class_id"
          >
            <el-option
              v-for="term in termOptions"
              :key="term"
              :label="term"
              :value="term"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="该操作会删除所选学院-班级-学期下的全部课表，请确认后再执行。"
      />

      <template #footer>
        <el-button @click="showBatchDeleteDialog = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleting" @click="submitBatchDelete">
          确认删除
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  batchDeleteSchedulesByScope,
  deleteSchedule,
  getAdminImportTemplates,
  getSchedulesImportTemplate,
  getTeachingAdminSemesterConfig,
  importSchedules,
  listClasses,
  listOrgs,
  listSchedules,
  updateSchedule,
} from '../api';
import { parseSpreadsheetFile } from '../lib/spreadsheet';

const TERM_CODE_PATTERN = /^\d{4}-(SPRING|FALL)$/;

const getCurrentTermCode = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 2 && month <= 7) {
    return `${year}-SPRING`;
  }
  if (month >= 8) {
    return `${year}-FALL`;
  }
  return `${year - 1}-FALL`;
};

const shiftTermCode = (termCode: string, offset: number) => {
  const normalized = String(termCode || '').trim().toUpperCase();
  const match = normalized.match(/^(\d{4})-(SPRING|FALL)$/);
  if (!match) {
    return normalized;
  }

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

const defaultTermCode = getCurrentTermCode();

const orgs = ref<any[]>([]);
const classes = ref<any[]>([]);
const schedules = ref<any[]>([]);
const allSchedules = ref<any[]>([]);
const loading = ref(false);
const hasSearched = ref(false);
const editDialogVisible = ref(false);
const showImportDialog = ref(false);
const showBatchDeleteDialog = ref(false);
const batchCreating = ref(false);
const batchDeleting = ref(false);
const batchParsedData = ref<any[]>([]);
const scheduleImportTemplate = ref<any>({ fields: [] });
const semesterStartDate = ref('');
const semesterTotalWeeks = ref(20);

const weekdayColumns = [
  { key: 1, label: '周一' },
  { key: 2, label: '周二' },
  { key: 3, label: '周三' },
  { key: 4, label: '周四' },
  { key: 5, label: '周五' },
  { key: 6, label: '周六' },
  { key: 7, label: '周日' },
];

const searchForm = ref({
  org_name: '',
  class_id: '',
  term_code: '',
  week_number: '',
});

const editForm = ref({
  id: '',
  term_code: '',
  course_code: '',
  course_name: '',
  class_name: '',
  teacher_name: '',
  session_start: '',
  session_end: '',
  expire_minutes: 15,
});

const deleteForm = ref({
  org_name: '',
  class_id: '',
  term_code: '',
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

const filteredClasses = computed(() => {
  if (!searchForm.value.org_name) {
    return classes.value;
  }

  return classes.value.filter((clazz: any) => {
    const org = orgs.value.find((item: any) => item.id === clazz.org_id);
    const orgName = org?.org_name || org?.name || '';
    return orgName === searchForm.value.org_name;
  });
});

const deleteFilteredClasses = computed(() => {
  if (!deleteForm.value.org_name) {
    return [];
  }

  return classes.value.filter((clazz: any) => {
    const org = orgs.value.find((item: any) => item.id === clazz.org_id);
    const orgName = org?.org_name || org?.name || '';
    return orgName === deleteForm.value.org_name;
  });
});

const selectedClassLabel = computed(() => {
  const current = classes.value.find(
    (item: any) => String(item.id) === String(searchForm.value.class_id),
  );
  return current?.class_name || '';
});

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
    canQuerySchedules.value
    && Boolean(semesterStartDate.value)
    && availableWeekOptions.value.length > 0,
);

const selectedWeekLabel = computed(() => {
  if (!semesterStartDate.value) {
    return '未设置学期起始日';
  }
  if (!searchForm.value.week_number) {
    return '全部周次';
  }

  const matched = availableWeekOptions.value.find(
    (item) => String(item.value) === String(searchForm.value.week_number),
  );
  return matched?.label || `第${searchForm.value.week_number}周`;
});

const canQuerySchedules = computed(
  () =>
    Boolean(searchForm.value.org_name) &&
    Boolean(searchForm.value.class_id) &&
    TERM_CODE_PATTERN.test(String(searchForm.value.term_code || '').trim()),
);

const termOptions = computed(() => {
  const values: string[] = [];
  for (let offset = -4; offset <= 4; offset += 1) {
    values.push(shiftTermCode(defaultTermCode, offset));
  }
  return Array.from(new Set(values));
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

const getTimestamp = (value: string | Date) => {
  const parsed = toDate(value).getTime();
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const sortScheduleItemsByStart = <T extends { session_start: string | Date; session_end?: string | Date }>(items: T[]) =>
  [...items].sort((left, right) => {
    const startDiff = getTimestamp(left.session_start) - getTimestamp(right.session_start);
    if (startDiff !== 0) {
      return startDiff;
    }
    return getTimestamp(left.session_end || left.session_start) - getTimestamp(right.session_end || right.session_start);
  });

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
      raw: item,
    });
  });

  rowMap.forEach((row) => {
    Object.keys(row.cells).forEach((weekdayKey) => {
      row.cells[Number(weekdayKey)] = sortScheduleItemsByStart(row.cells[Number(weekdayKey)]);
    });
  });

  return Array.from(rowMap.values()).sort((left, right) => left.startMinutes - right.startMinutes);
});

const loadOrgs = async () => {
  const resp = await listOrgs();
  if (resp.code === 0) {
    orgs.value = resp.data || [];
  }
};

const loadClasses = async () => {
  const resp = await listClasses();
  if (resp.code === 0) {
    classes.value = resp.data || [];
  }
};

const loadSemesterConfig = async () => {
  try {
    const response = await getTeachingAdminSemesterConfig();
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

const loadScheduleImportTemplate = async () => {
  try {
    const response = await getSchedulesImportTemplate();
    if (response.code === 0) {
      scheduleImportTemplate.value = response.data || { fields: [] };
    }
  } catch (error) {
    console.error('加载课表导入模板失败', error);
  }
};

const invalidateQueryState = () => {
  searchForm.value.week_number = '';
  schedules.value = [];
  allSchedules.value = [];
  hasSearched.value = false;
};

const handleOrgChange = () => {
  searchForm.value.class_id = '';
  searchForm.value.term_code = '';
  invalidateQueryState();
};

const handleClassChange = () => {
  searchForm.value.term_code = '';
  invalidateQueryState();
};

const handleTermChange = () => {
  invalidateQueryState();
};

const handleDeleteOrgChange = () => {
  deleteForm.value.class_id = '';
  deleteForm.value.term_code = '';
};

const normalizeTermCode = (value: string) => String(value || '').trim().toUpperCase();

const applyWeekFilter = () => {
  if (!searchForm.value.week_number) {
    schedules.value = [...allSchedules.value];
    return;
  }

  schedules.value = allSchedules.value.filter(
    (item: any) => String(item.weekNumber) === String(searchForm.value.week_number),
  );
};

const loadSchedules = async () => {
  const normalizedTerm = normalizeTermCode(searchForm.value.term_code);
  searchForm.value.term_code = normalizedTerm;

  if (!searchForm.value.org_name || !searchForm.value.class_id || !TERM_CODE_PATTERN.test(normalizedTerm)) {
    ElMessage.warning('请选择学院、班级和学期后再查询课表');
    return;
  }

  loading.value = true;
  try {
    const resp = await listSchedules({
      page: 1,
      pageSize: 500,
      class_id: String(searchForm.value.class_id),
      term_code: normalizedTerm,
    });

    if (resp.code === 0) {
      allSchedules.value = sortScheduleItemsByStart(
        (Array.isArray(resp.data?.list) ? resp.data.list : []).map((item: any) => {
          const weekInfo = getAcademicWeekInfo(item.session_start);
          return {
            ...item,
            weekNumber: weekInfo.weekNumber ?? '',
            weekLabel: weekInfo.weekLabel,
          };
        }),
      );

      if (Number(searchForm.value.week_number || 0) > semesterTotalWeeks.value) {
        searchForm.value.week_number = '';
      }

      applyWeekFilter();
      hasSearched.value = true;
    } else {
      ElMessage.error(resp.message || '加载课表失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载课表失败');
  } finally {
    loading.value = false;
  }
};

watch(
  () => searchForm.value.week_number,
  () => {
    if (hasSearched.value) {
      applyWeekFilter();
    }
  },
);

const resetSearch = () => {
  searchForm.value = {
    org_name: '',
    class_id: '',
    term_code: '',
    week_number: '',
  };
  schedules.value = [];
  allSchedules.value = [];
  hasSearched.value = false;
};

const handleEdit = (row: any) => {
  editForm.value = {
    id: row.id,
    term_code: row.term_code,
    course_code: row.course_code,
    course_name: row.course_name,
    class_name: row.class_name,
    teacher_name: row.teacher_name,
    session_start: new Date(row.session_start) as any,
    session_end: new Date(row.session_end) as any,
    expire_minutes: Number(row.expire_minutes || 15),
  };
  editDialogVisible.value = true;
};

const submitEdit = async () => {
  const termCode = normalizeTermCode(editForm.value.term_code);
  if (!TERM_CODE_PATTERN.test(termCode)) {
    ElMessage.warning('学期格式必须为 2026-SPRING 或 2025-FALL');
    return;
  }

  try {
    const resp = await updateSchedule(editForm.value.id, {
      term_code: termCode,
      session_start: editForm.value.session_start,
      session_end: editForm.value.session_end,
      expire_minutes: editForm.value.expire_minutes,
    });

    if (resp.code === 0) {
      ElMessage.success('课表更新成功');
      editDialogVisible.value = false;
      if (hasSearched.value) {
        await loadSchedules();
      }
    } else {
      ElMessage.error(resp.message || '课表更新失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '课表更新失败');
  }
};

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定删除这条课表记录吗？', '删除确认', {
      type: 'warning',
    });
    const resp = await deleteSchedule(row.id);
    if (resp.code === 0) {
      ElMessage.success('课表删除成功');
      if (hasSearched.value) {
        await loadSchedules();
      }
    } else {
      ElMessage.error(resp.message || '课表删除失败');
    }
  } catch (error: any) {
    if (error?.message !== 'cancel') {
      ElMessage.error(error?.message || '课表删除失败');
    }
  }
};

const resolveScheduleFieldValue = (row: Record<string, any>, key: string) => {
  const templateField = scheduleImportTemplate.value.fields?.find((field: any) => field.key === key);
  const templateColumn = String(templateField?.columnName || '').trim();
  const fallbackKeys: Record<string, string[]> = {
    org_name: ['org_name', '学院'],
    term_code: ['term_code', '学期'],
    course_code: ['course_code', '课程代码'],
    course_name: ['course_name', '课程名称'],
    class_name: ['class_name', '班级名称', '班级'],
    teacher_name: ['teacher_name', '教师名称', '教师'],
    session_start: ['session_start', '上课开始时间'],
    session_end: ['session_end', '下课结束时间'],
    expire_minutes: ['expire_minutes', '过期分钟数'],
  };

  const candidates = [templateColumn, key, ...(fallbackKeys[key] || [])].filter(Boolean);
  for (const candidate of candidates) {
    const value = row[candidate];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
};

const normalizeScheduleRow = (row: Record<string, any>) => ({
  org_name: resolveScheduleFieldValue(row, 'org_name'),
  term_code: normalizeTermCode(resolveScheduleFieldValue(row, 'term_code')),
  course_code: resolveScheduleFieldValue(row, 'course_code'),
  course_name: resolveScheduleFieldValue(row, 'course_name'),
  class_name: resolveScheduleFieldValue(row, 'class_name'),
  teacher_name: resolveScheduleFieldValue(row, 'teacher_name'),
  session_start: resolveScheduleFieldValue(row, 'session_start'),
  session_end: resolveScheduleFieldValue(row, 'session_end'),
  expire_minutes: resolveScheduleFieldValue(row, 'expire_minutes') || '15',
});

const handleBatchFileChange = async (file: any) => {
  try {
    const parsed = await parseSpreadsheetFile(file.raw);
    batchParsedData.value = sortScheduleItemsByStart(
      parsed.rows.map((row) => normalizeScheduleRow(row)),
    );
    ElMessage.success(`已解析 ${batchParsedData.value.length} 条课表记录`);
  } catch (error: any) {
    ElMessage.error(error?.message || '表格解析失败');
  }
};

const closeImportDialog = () => {
  showImportDialog.value = false;
  batchParsedData.value = [];
};

const openBatchDeleteDialog = () => {
  deleteForm.value = {
    org_name: searchForm.value.org_name || '',
    class_id: searchForm.value.class_id ? String(searchForm.value.class_id) : '',
    term_code: searchForm.value.term_code || '',
  };
  showBatchDeleteDialog.value = true;
};

const submitBatchDelete = async () => {
  if (!deleteForm.value.org_name) {
    ElMessage.warning('请选择学院');
    return;
  }

  if (!deleteForm.value.class_id) {
    ElMessage.warning('请选择班级');
    return;
  }

  if (!deleteForm.value.term_code) {
    ElMessage.warning('请选择学期');
    return;
  }

  const selectedClass = classes.value.find(
    (item: any) => String(item.id) === String(deleteForm.value.class_id),
  );
  const classLabel = selectedClass?.class_name || '当前班级';

  try {
    await ElMessageBox.confirm(
      `确定删除 ${deleteForm.value.org_name} / ${classLabel} / ${deleteForm.value.term_code} 下的全部课表吗？`,
      '删除班级学期课表',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    );
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') {
      return;
    }
    throw error;
  }

  batchDeleting.value = true;
  try {
    const resp = await batchDeleteSchedulesByScope({
      org_name: deleteForm.value.org_name,
      class_id: String(deleteForm.value.class_id),
      term_code: deleteForm.value.term_code,
    });

    if (resp.code === 0) {
      ElMessage.success(resp.message || '删除成功');
      showBatchDeleteDialog.value = false;

      if (
        hasSearched.value &&
        String(searchForm.value.class_id) === String(deleteForm.value.class_id) &&
        String(searchForm.value.term_code) === String(deleteForm.value.term_code)
      ) {
        await loadSchedules();
      }
      return;
    }

    ElMessage.error(resp.message || '删除失败');
  } catch (error: any) {
    ElMessage.error(error?.message || '删除失败');
  } finally {
    batchDeleting.value = false;
  }
};

const submitBatchImport = async () => {
  if (!batchParsedData.value.length) {
    ElMessage.warning('请先上传 CSV 或 XLSX 文件');
    return;
  }

  const invalidTerm = batchParsedData.value.find((item: any) => !TERM_CODE_PATTERN.test(item.term_code));
  if (invalidTerm) {
    ElMessage.warning(`导入数据里的学期格式不正确：${invalidTerm.term_code || '空值'}`);
    return;
  }

  batchCreating.value = true;
  try {
    const resp = await importSchedules(batchParsedData.value);
    if (resp.code === 0) {
      const errors = Array.isArray(resp.data?.errors) ? resp.data.errors : [];
      if (errors.length > 0) {
        ElMessage.warning(
          `导入完成：成功 ${resp.data.success} 条，失败 ${resp.data.failed} 条。失败原因：${errors.join('；')}`,
        );
      } else {
        ElMessage.success(`导入完成：成功 ${resp.data.success} 条，失败 ${resp.data.failed} 条`);
      }
      closeImportDialog();
      if (hasSearched.value) {
        await loadSchedules();
      }
    } else {
      ElMessage.error(resp.message || '导入课表失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '导入课表失败');
  } finally {
    batchCreating.value = false;
  }
};

onMounted(async () => {
  await Promise.all([
    loadOrgs(),
    loadClasses(),
    loadScheduleImportTemplate(),
    loadSemesterConfig(),
  ]);
});
</script>

<style scoped>
.schedules-page {
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

.page-actions {
  display: flex;
  gap: 12px;
}

.filter-card,
.timetable-card {
  border-radius: 24px;
}

.filter-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 16px;
}

.filter-form :deep(.el-select),
.filter-form :deep(.el-input) {
  width: 100%;
}

.filter-form__actions {
  align-self: end;
}

.filter-hint {
  margin-top: 8px;
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

.schedule-card__actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.import-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.import-hint {
  color: #607384;
  font-size: 13px;
}

@media (max-width: 900px) {
  .filter-form {
    grid-template-columns: 1fr;
  }

  .schedule-card__actions {
    flex-direction: column;
  }
}
</style>
