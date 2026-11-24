<template>
  <div class="page-container">
    <h2 class="page-title">本班导出</h2>

    <el-card class="export-card">
      <div class="toolbar">
        <el-radio-group v-model="mode">
          <el-radio-button label="day">按日导出</el-radio-button>
          <el-radio-button label="week">按周导出</el-radio-button>
          <el-radio-button label="month">按月导出</el-radio-button>
        </el-radio-group>

        <el-date-picker
          v-if="mode === 'day'"
          v-model="selectedDay"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
        />

        <el-select
          v-else-if="mode === 'week'"
          v-model="selectedWeekNumber"
          placeholder="选择周次"
          style="width: 220px"
        >
          <el-option
            v-for="week in weekOptions"
            :key="week.value"
            :label="week.label"
            :value="week.value"
          />
        </el-select>

        <el-date-picker
          v-else
          v-model="selectedMonth"
          type="month"
          value-format="YYYY-MM"
          placeholder="选择月份"
        />

        <el-button type="primary" :loading="generating" @click="handleGenerate">
          生成预览
        </el-button>

        <el-button
          type="success"
          plain
          :disabled="!latestExportJobId"
          :loading="downloading"
          @click="handleDownload"
        >
          下载导出
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="helper-alert"
        title="导出范围会自动按当前班主任绑定的班级过滤；点击“生成预览”只生成预览，不会自动下载。"
      />

      <div v-if="preview" class="preview-panel">
        <div class="preview-title">导出预览</div>

        <el-descriptions v-if="mode === 'day'" :column="3" border>
          <el-descriptions-item label="日期">{{ preview.date }}</el-descriptions-item>
          <el-descriptions-item label="预警总数">{{ preview.total }}</el-descriptions-item>
          <el-descriptions-item label="导出任务">{{ latestExportJobId || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-else-if="mode === 'week'" :column="5" border>
          <el-descriptions-item label="周次">
            {{ preview.weekLabel || (preview.weekNumber ? `第${preview.weekNumber}周` : '-') }}
          </el-descriptions-item>
          <el-descriptions-item label="开始日期">{{ preview.startDate }}</el-descriptions-item>
          <el-descriptions-item label="结束日期">{{ preview.endDate }}</el-descriptions-item>
          <el-descriptions-item label="预警总数">{{ preview.total }}</el-descriptions-item>
          <el-descriptions-item label="导出任务">{{ latestExportJobId || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions v-else :column="3" border>
          <el-descriptions-item label="月份">{{ preview.month }}</el-descriptions-item>
          <el-descriptions-item label="预警总数">{{ preview.total }}</el-descriptions-item>
          <el-descriptions-item label="导出任务">{{ latestExportJobId || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="table-shell">
        <el-table
          v-if="mode === 'week'"
          :data="preview.dailyStats || []"
          size="small"
          border
          style="width: 100%; margin-top: 16px"
        >
          <el-table-column prop="date" label="日期" min-width="140" />
          <el-table-column prop="count" label="预警数" width="120" />
        </el-table>
        </div>

        <div class="table-shell">
        <el-table
          v-if="mode === 'month'"
          :data="preview.levelStats || []"
          size="small"
          border
          style="width: 100%; margin-top: 16px"
        >
          <el-table-column prop="level" label="级别" min-width="140" />
          <el-table-column prop="count" label="预警数" width="120" />
        </el-table>
        </div>

        <div class="table-shell">
        <el-table
          :data="previewWarnings"
          size="small"
          border
          style="width: 100%; margin-top: 16px"
        >
          <el-table-column prop="studentName" label="学生" min-width="120" />
          <el-table-column prop="studentNo" label="学号" min-width="120" />
          <el-table-column prop="className" label="班级" min-width="140" />
          <el-table-column prop="warningType" label="预警内容" min-width="240" show-overflow-tooltip />
          <el-table-column prop="warningLevel" label="级别" width="100" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="createdAt" label="时间" min-width="180" />
        </el-table>
        </div>

        <el-empty
          v-if="!previewWarnings.length"
          description="当前时间范围内暂无可预览的预警记录"
          :image-size="90"
          class="preview-empty"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { ElMessage } from 'element-plus';
import {
  downloadExportReport,
  generateDailyReport,
  generateMonthlyReport,
  generateWeeklyReport,
} from '../../api';

type ExportMode = 'day' | 'week' | 'month';

const mode = ref<ExportMode>('day');
const selectedDay = ref(dayjs().format('YYYY-MM-DD'));
const selectedWeekNumber = ref(1);
const selectedMonth = ref(dayjs().format('YYYY-MM'));
const generating = ref(false);
const downloading = ref(false);
const preview = ref<any | null>(null);
const latestExportJobId = ref('');
const semesterStartDate = ref(dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD'));
const semesterTotalWeeks = ref(20);

const previewWarnings = computed(() => preview.value?.warnings || []);

const getMonday = (value: string) => {
  const current = dayjs(value);
  const weekday = current.day();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return current.subtract(offset, 'day');
};

const currentWeekNumber = computed(() => {
  const today = getMonday(dayjs().format('YYYY-MM-DD'));
  const semesterStart = getMonday(semesterStartDate.value);
  const diffDays = Math.max(0, today.startOf('day').diff(semesterStart.startOf('day'), 'day'));
  return Math.floor(diffDays / 7) + 1;
});

const weekOptions = computed(() =>
  Array.from({ length: Math.max(1, semesterTotalWeeks.value) }, (_, index) => {
    const weekNumber = index + 1;
    const start = getMonday(semesterStartDate.value).add(index, 'week');
    const end = start.add(6, 'day');
    return {
      value: weekNumber,
      label: `第${weekNumber}周（${start.format('MM-DD')} ~ ${end.format('MM-DD')}）`,
    };
  }),
);

const getWeekStartDateByNumber = (weekNumber: number) =>
  getMonday(semesterStartDate.value)
    .add(Math.max(0, Number(weekNumber || 1) - 1), 'week')
    .format('YYYY-MM-DD');

const downloadBlobAsFile = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const buildFileName = (payload: any) => {
  if (mode.value === 'day') {
    return `本班预警日导出-${payload.date || selectedDay.value}.csv`;
  }
  if (mode.value === 'week') {
    return `本班预警周导出-${payload.startDate || getWeekStartDateByNumber(selectedWeekNumber.value)}.csv`;
  }
  return `本班预警月导出-${payload.month || selectedMonth.value}.csv`;
};

const resolveDefaultSemesterStart = () => {
  const now = dayjs();
  const month = now.month() + 1;
  const year = now.year();
  const anchor = month >= 8
    ? `${year}-09-01`
    : month >= 2
      ? `${year}-02-01`
      : `${year - 1}-09-01`;
  return getMonday(anchor).format('YYYY-MM-DD');
};

const loadSemesterConfig = () => {
  semesterStartDate.value = resolveDefaultSemesterStart();
  semesterTotalWeeks.value = 20;
  const safeWeek = Math.min(
    Math.max(1, currentWeekNumber.value),
    Math.max(1, semesterTotalWeeks.value),
  );
  selectedWeekNumber.value = safeWeek;
};

const handleGenerate = async () => {
  generating.value = true;
  try {
    let response: any;

    if (mode.value === 'day') {
      response = await generateDailyReport(selectedDay.value);
    } else if (mode.value === 'week') {
      response = await generateWeeklyReport(
        undefined,
        undefined,
        undefined,
        selectedWeekNumber.value,
      );
    } else {
      response = await generateMonthlyReport(selectedMonth.value);
    }

    if (!response || response.code !== 0) {
      throw new Error(response?.message || '生成预览失败');
    }

    preview.value = response.data || null;
    latestExportJobId.value = String(response.data?.export_job_id || '').trim();
    ElMessage.success('预览生成成功');
  } catch (error: any) {
    ElMessage.error(error?.message || '生成预览失败');
  } finally {
    generating.value = false;
  }
};

const handleDownload = async () => {
  if (!latestExportJobId.value) {
    ElMessage.warning('请先生成预览');
    return;
  }

  downloading.value = true;
  try {
    const blob = await downloadExportReport(latestExportJobId.value);
    downloadBlobAsFile(blob, buildFileName(preview.value || {}));
    ElMessage.success('下载成功');
  } catch (error: any) {
    ElMessage.error(error?.message || '下载失败');
  } finally {
    downloading.value = false;
  }
};

watch(mode, () => {
  preview.value = null;
  latestExportJobId.value = '';
});

onMounted(() => {
  loadSemesterConfig();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.page-title {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 700;
}

.export-card {
  min-height: 420px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.helper-alert {
  margin-top: 16px;
}

.preview-panel {
  margin-top: 20px;
}

.preview-title {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 700;
  color: #1f2937;
}

.preview-empty {
  margin-top: 12px;
}
</style>
