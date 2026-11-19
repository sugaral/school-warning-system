<template>
  <div class="system-stats-2">
    <el-row :gutter="16" class="summary-row">
      <el-col :span="4" v-for="card in summaryCards" :key="card.key">
        <el-card class="summary-card" shadow="hover">
          <div class="summary-label">{{ card.label }}</div>
          <div class="summary-value">{{ card.value }}</div>
          <div class="summary-extra" :class="{ down: card.growth < 0 }">
            较上周期 {{ card.growth >= 0 ? '+' : '' }}{{ card.growth }}%
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :span="15">
        <el-card class="panel-card trend-panel-card" shadow="never">
          <div class="panel-header">
            <div>
              <div class="panel-title">全校预警趋势</div>
              <div class="panel-subtitle">{{ chartSubtitle }}</div>
            </div>
            <el-radio-group v-model="timeRange" size="small" @change="handleRangeChange">
              <el-radio-button label="day">按日</el-radio-button>
              <el-radio-button label="week">按周</el-radio-button>
              <el-radio-button label="month">按月</el-radio-button>
            </el-radio-group>
          </div>
          <div ref="trendChartRef" class="chart-box chart-box-trend"></div>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card class="panel-card" shadow="never">
          <div class="panel-header">
            <div>
              <div class="panel-title">全校高风险学生</div>
              <div class="panel-subtitle">基于当前活跃案例与风险分排序</div>
            </div>
          </div>

          <div class="list-toolbar">
            <el-input
              v-model="searchText"
              placeholder="搜索姓名、学号、学院"
              clearable
            />
            <el-select v-model="filterType" style="width: 120px">
              <el-option label="全部" value="all" />
              <el-option label="高风险" value="severe" />
              <el-option label="一般风险" value="general" />
            </el-select>
          </div>

          <div class="student-list">
            <div v-for="student in filteredStudents" :key="student.id" class="student-item">
              <div class="student-main">
                <div class="student-name">{{ student.name || '未命名学生' }}</div>
                <el-tag :type="student.statusType || 'info'" size="small">
                  {{ student.status || '处理中' }}
                </el-tag>
              </div>
              <div class="student-meta">
                <span>{{ student.id || '-' }}</span>
                <span>{{ student.department || '未知学院' }}</span>
              </div>
              <div class="student-meta">
                <span>风险分 {{ student.riskScore || 0 }}</span>
                <span>活跃预警 {{ student.warningCount || 0 }}</span>
              </div>
              <div class="student-meta">
                <span>最近预警 {{ student.lastWarning || '-' }}</span>
              </div>
            </div>

            <el-empty
              v-if="!filteredStudents.length"
              description="暂无高风险学生"
              :image-size="80"
            />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row>
      <el-col :span="24">
        <el-card class="panel-card" shadow="never">
          <div class="panel-header">
            <div>
              <div class="panel-title">学院预警分布</div>
              <div class="panel-subtitle">展示近 6 个月红色与黄色预警数量</div>
            </div>
          </div>
          <div ref="deptChartRef" class="chart-box chart-box-large"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { echarts, type ECharts } from '../../lib/echarts';
import { api } from '../../api';
import { warningLevelPalette } from '../../lib/warning-level';

type TimeRange = 'day' | 'week' | 'month';

interface Overview {
  totalWarnings: number;
  redWarnings: number;
  yellowWarnings: number;
  resolvedWarnings: number;
  pendingWarnings: number;
  highRiskCount: number;
  totalGrowth: number;
  redGrowth: number;
  yellowGrowth: number;
  resolvedGrowth: number;
  pendingGrowth: number;
  highRiskGrowth: number;
}

const defaultOverview = (): Overview => ({
  totalWarnings: 0,
  redWarnings: 0,
  yellowWarnings: 0,
  resolvedWarnings: 0,
  pendingWarnings: 0,
  highRiskCount: 0,
  totalGrowth: 0,
  redGrowth: 0,
  yellowGrowth: 0,
  resolvedGrowth: 0,
  pendingGrowth: 0,
  highRiskGrowth: 0,
});

const trendChartRef = ref<HTMLElement>();
const deptChartRef = ref<HTMLElement>();
let trendChart: ECharts | null = null;
let deptChart: ECharts | null = null;

const timeRange = ref<TimeRange>('month');
const searchText = ref('');
const filterType = ref<'all' | 'severe' | 'general'>('all');
const overview = ref<Overview>(defaultOverview());
const students = ref<any[]>([]);
const trendData = ref<any>(null);
const deptData = ref<any>(null);

const summaryCards = computed(() => [
  { key: 'total', label: '预警总数', value: overview.value.totalWarnings, growth: overview.value.totalGrowth },
  { key: 'red', label: '严重预警', value: overview.value.redWarnings, growth: overview.value.redGrowth },
  { key: 'yellow', label: '一般预警', value: overview.value.yellowWarnings, growth: overview.value.yellowGrowth },
  { key: 'resolved', label: '已处理', value: overview.value.resolvedWarnings, growth: overview.value.resolvedGrowth },
  { key: 'pending', label: '待处理', value: overview.value.pendingWarnings, growth: overview.value.pendingGrowth },
  { key: 'highRisk', label: '高风险学生', value: overview.value.highRiskCount, growth: overview.value.highRiskGrowth },
]);

const chartSubtitle = computed(() => {
  if (timeRange.value === 'day') {
    return '最近 7 天每日预警变化';
  }
  if (timeRange.value === 'week') {
    return '最近 12 周每周预警变化';
  }
  return '最近 6 个月按月预警变化';
});

const normalizeStatus = (item: any) => {
  if (item.statusType === 'danger') {
    return '待分配';
  }
  if (item.statusType === 'warning') {
    return '待干预';
  }
  if (item.statusType === 'success') {
    return '处理完成';
  }
  if (item.status === 'resolved') {
    return '已解除';
  }
  return '处理中';
};

const filteredStudents = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  let result = students.value;

  if (keyword) {
    result = result.filter((item) =>
      [item.name, item.id, item.department]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(keyword)),
    );
  }

  if (filterType.value === 'severe') {
    result = result.filter((item) => Number(item.riskScore || 0) >= 80);
  } else if (filterType.value === 'general') {
    result = result.filter((item) => Number(item.riskScore || 0) < 80);
  }

  return result;
});

const resetToEmptyState = () => {
  overview.value = defaultOverview();
  students.value = [];
  trendData.value = null;
  deptData.value = null;
};

const getNiceAxisStep = (value: number) => {
  if (!Number.isFinite(value) || value <= 1) {
    return 1;
  }

  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;

  if (fraction <= 1) return exponent;
  if (fraction <= 2) return 2 * exponent;
  if (fraction <= 5) return 5 * exponent;
  return 10 * exponent;
};

const buildDynamicYAxis = (values: number[]) => {
  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const rawMax = normalized.length ? Math.max(...normalized) : 0;

  if (rawMax <= 0) {
    return { min: 0, max: 5, interval: 1 };
  }

  const interval = getNiceAxisStep(rawMax / 4);
  const max = Math.max(interval, Math.ceil(rawMax / interval) * interval);

  return {
    min: 0,
    max,
    interval,
  };
};

const normalizeStudents = (list: any[]) =>
  list.map((item) => ({
    id: item.id || '',
    name: item.name || '未命名学生',
    department: item.department || '未知学院',
    riskScore: Number(item.riskScore || 0),
    warningCount: Number(item.warningCount || 0),
    lastWarning: item.lastWarning || '',
    status: normalizeStatus(item),
    statusType: item.statusType || 'info',
  }));

const fetchStats = async () => {
  try {
    const response = await api.get('/admin/stats/system2', {
      params: { timeRange: timeRange.value },
    });
    const data = response.data?.data || {};

    overview.value = {
      ...defaultOverview(),
      ...(data.overview || {}),
    };
    students.value = normalizeStudents(Array.isArray(data.students) ? data.students : []);
    trendData.value = data.trend || null;
    deptData.value = data.deptDistribution || null;

    await nextTick();
    renderCharts();
  } catch (error) {
    console.error('获取全校统计失败:', error);
    resetToEmptyState();
    await nextTick();
    renderCharts();
  }
};

const updateTrendChart = () => {
  if (!trendChart) {
    return;
  }

  const labels = Array.isArray(trendData.value?.labels) ? trendData.value.labels : [];
  const totals = Array.isArray(trendData.value?.totals) ? trendData.value.totals : [];
  const reds = Array.isArray(trendData.value?.reds) ? trendData.value.reds : [];
  const yellows = Array.isArray(trendData.value?.yellows) ? trendData.value.yellows : [];
  const resolveds = Array.isArray(trendData.value?.resolveds) ? trendData.value.resolveds : [];
  const trendAxis = buildDynamicYAxis([...totals, ...reds, ...yellows, ...resolveds]);

  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预警总数', '严重预警', '一般预警', '已处理'] },
    color: ['#409eff', warningLevelPalette.severe, warningLevelPalette.yellow, '#67c23a'],
    grid: { left: 42, right: 26, top: 72, bottom: 44, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: {
      type: 'value',
      min: trendAxis.min,
      max: trendAxis.max,
      interval: trendAxis.interval,
      minInterval: 1,
      axisLabel: {
        formatter: (value: number) => `${Math.round(value)}`,
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.22)',
        },
      },
    },
    series: [
      {
        name: '预警总数',
        type: 'line',
        smooth: true,
        data: totals,
        symbolSize: 6,
        itemStyle: { color: '#409eff' },
        lineStyle: { color: '#409eff', width: 2 },
      },
      {
        name: '严重预警',
        type: 'line',
        smooth: true,
        data: reds,
        symbolSize: 6,
        itemStyle: { color: warningLevelPalette.severe },
        lineStyle: { color: warningLevelPalette.severe, width: 2 },
      },
      {
        name: '一般预警',
        type: 'line',
        smooth: true,
        data: yellows,
        symbolSize: 6,
        itemStyle: { color: warningLevelPalette.yellow },
        lineStyle: { color: warningLevelPalette.yellow, width: 2 },
      },
      {
        name: '已处理',
        type: 'line',
        smooth: true,
        data: resolveds,
        symbolSize: 6,
        itemStyle: { color: '#67c23a' },
        lineStyle: { color: '#67c23a', width: 2 },
      },
    ],
  });

  deptChart.setOption({
    legend: {
      formatter: (_name: string) => {
        const option = deptChart?.getOption();
        const legendNames = Array.isArray(option?.legend?.[0]?.data) ? option.legend[0].data : [];
        const index = legendNames.findIndex((item: any) => String(item) === _name);
        return index === 1 ? '紫色预警' : '红色预警';
      },
    },
    tooltip: {
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        if (!rows.length) {
          return '';
        }

        const title = String(rows[0]?.axisValue ?? '');
        const lines = rows.map((item: any) => {
          const displayName = item?.seriesIndex === 1 ? '紫色预警' : '红色预警';
          return `${item.marker}${displayName}：${item.value ?? 0}`;
        });

        return [title, ...lines].join('<br/>');
      },
    },
  });

  deptChart.setOption({
    legend: {
      formatter: (_name: string) => {
        const option = deptChart?.getOption();
        const legendNames = Array.isArray(option?.legend?.[0]?.data) ? option.legend[0].data : [];
        const index = legendNames.findIndex((item: any) => String(item) === _name);
        return index === 1 ? '橙色及以下预警' : '红色及以上预警';
      },
    },
    tooltip: {
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        if (!rows.length) {
          return '';
        }

        const title = String(rows[0]?.axisValue ?? '');
        const lines = rows.map((item: any) => {
          const displayName = item?.seriesIndex === 1 ? '橙色及以下预警' : '红色及以上预警';
          return `${item.marker}${displayName}：${item.value ?? 0}`;
        });

        return [title, ...lines].join('<br/>');
      },
    },
  });
};

const updateDeptChart = () => {
  if (!deptChart) {
    return;
  }

  const depts = Array.isArray(deptData.value?.depts) ? deptData.value.depts : [];
  const red = Array.isArray(deptData.value?.red) ? deptData.value.red : [];
  const orange = Array.isArray(deptData.value?.orange) ? deptData.value.orange : [];
  const maxValue = Math.max(10, ...red.map((value: number, index: number) => value + Number(orange[index] || 0)));
  const barMaxWidth = depts.length <= 1 ? 72 : 40;

  deptChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['红色预警', '黄色预警'] },
    color: [warningLevelPalette.orange, warningLevelPalette.red],
    grid: { left: 36, right: 20, top: 48, bottom: 48, containLabel: true },
    xAxis: {
      type: 'category',
      data: depts,
      axisLabel: {
        interval: 0,
        rotate: 25,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: Math.ceil(maxValue / 5) * 5,
    },
    series: [
      {
        name: '红色预警',
        type: 'bar',
        stack: 'total',
        barMaxWidth,
        data: red,
        itemStyle: { color: warningLevelPalette.red },
      },
      {
        name: '黄色预警',
        type: 'bar',
        stack: 'total',
        barMaxWidth,
        data: orange,
        itemStyle: { color: warningLevelPalette.orange },
      },
    ],
  });
};

const renderTrendChart = () => {
  if (!trendChart) {
    return;
  }

  const labels = Array.isArray(trendData.value?.labels) ? trendData.value.labels : [];
  const totals = Array.isArray(trendData.value?.totals) ? trendData.value.totals : [];
  const reds = Array.isArray(trendData.value?.reds) ? trendData.value.reds : [];
  const yellows = Array.isArray(trendData.value?.yellows) ? trendData.value.yellows : [];
  const resolveds = Array.isArray(trendData.value?.resolveds) ? trendData.value.resolveds : [];
  const trendAxis = buildDynamicYAxis([...totals, ...reds, ...yellows, ...resolveds]);

  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预警总数', '严重预警', '一般预警', '已处理'] },
    color: ['#409eff', warningLevelPalette.severe, warningLevelPalette.yellow, '#67c23a'],
    grid: { left: 42, right: 26, top: 72, bottom: 44, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: {
      type: 'value',
      min: trendAxis.min,
      max: trendAxis.max,
      interval: trendAxis.interval,
      minInterval: 1,
      axisLabel: {
        formatter: (value: number) => `${Math.round(value)}`,
      },
      splitLine: {
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.22)',
        },
      },
    },
    series: [
      {
        name: '预警总数',
        type: 'line',
        smooth: true,
        data: totals,
        symbolSize: 6,
        itemStyle: { color: '#409eff' },
        lineStyle: { color: '#409eff', width: 2 },
      },
      {
        name: '严重预警',
        type: 'line',
        smooth: true,
        data: reds,
        symbolSize: 6,
        itemStyle: { color: warningLevelPalette.severe },
        lineStyle: { color: warningLevelPalette.severe, width: 2 },
      },
      {
        name: '一般预警',
        type: 'line',
        smooth: true,
        data: yellows,
        symbolSize: 6,
        itemStyle: { color: warningLevelPalette.yellow },
        lineStyle: { color: warningLevelPalette.yellow, width: 2 },
      },
      {
        name: '已处理',
        type: 'line',
        smooth: true,
        data: resolveds,
        symbolSize: 6,
        itemStyle: { color: '#67c23a' },
        lineStyle: { color: '#67c23a', width: 2 },
      },
    ],
  });
};

const renderDeptDistributionChart = () => {
  if (!deptChart) {
    return;
  }

  const depts = Array.isArray(deptData.value?.depts) ? deptData.value.depts : [];
  const orange = Array.isArray(deptData.value?.orange) ? deptData.value.orange : [];
  const red = Array.isArray(deptData.value?.red) ? deptData.value.red : [];
  const maxValue = Math.max(10, ...red.map((value: number, index: number) => value + Number(orange[index] || 0)));
  const barMaxWidth = depts.length <= 1 ? 72 : 40;

  deptChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const rows = Array.isArray(params) ? params : [params];
        if (!rows.length) {
          return '';
        }

        const title = String(rows[0]?.axisValue ?? '');
        const lines = rows.map((item: any) => {
          const displayName = item?.seriesName === 'redOrAboveSeries' ? '红色及以上预警' : '橙色及以下预警';
          return `${item.marker}${displayName}：${item.value ?? 0}`;
        });

        return [title, ...lines].join('<br/>');
      },
    },
    legend: {
      data: ['orangeOrBelowSeries', 'redOrAboveSeries'],
      formatter: (name: string) => (name === 'redOrAboveSeries' ? '红色及以上预警' : '橙色及以下预警'),
    },
    color: [warningLevelPalette.orange, warningLevelPalette.red],
    grid: { left: 36, right: 20, top: 48, bottom: 48, containLabel: true },
    xAxis: {
      type: 'category',
      data: depts,
      axisLabel: {
        interval: 0,
        rotate: 25,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: Math.ceil(maxValue / 5) * 5,
    },
    series: [
      {
        name: 'orangeOrBelowSeries',
        type: 'bar',
        stack: 'total',
        barMaxWidth,
        data: orange,
        itemStyle: { color: warningLevelPalette.orange },
      },
      {
        name: 'redOrAboveSeries',
        type: 'bar',
        stack: 'total',
        barMaxWidth,
        data: red,
        itemStyle: { color: warningLevelPalette.red },
      },
    ],
  });
};

const renderCharts = () => {
  if (trendChartRef.value && !trendChart) {
    trendChart = echarts.init(trendChartRef.value);
  }
  if (deptChartRef.value && !deptChart) {
    deptChart = echarts.init(deptChartRef.value);
  }
  renderTrendChart();
  renderDeptDistributionChart();
};

const handleRangeChange = async () => {
  await fetchStats();
};

const handleResize = () => {
  trendChart?.resize();
  deptChart?.resize();
};

onMounted(async () => {
  await fetchStats();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  deptChart?.dispose();
  trendChart = null;
  deptChart = null;
});
</script>

<style scoped>
.system-stats-2 {
  padding: 20px;
}

.summary-row,
.content-row {
  margin-bottom: 16px;
}

.content-row {
  align-items: stretch;
}

.content-row :deep(.el-col) {
  display: flex;
}

.summary-card,
.panel-card {
  border-radius: 14px;
}

.panel-card {
  width: 100%;
  height: 100%;
}

.trend-panel-card {
  height: auto;
}

.panel-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.trend-panel-card :deep(.el-card__body) {
  height: auto;
}

.summary-label {
  font-size: 13px;
  color: #6b7280;
}

.summary-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
  color: #111827;
}

.summary-extra {
  margin-top: 8px;
  font-size: 12px;
  color: #16a34a;
}

.summary-extra.down {
  color: #dc2626;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}

.panel-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.chart-box {
  flex: 1;
  min-height: 320px;
}

.chart-box-trend {
  flex: none;
  height: 300px;
  min-height: 300px;
}

.chart-box-large {
  height: 360px;
}

.list-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.student-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 320px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
}

.student-item {
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.14);
  backdrop-filter: blur(14px);
}

.student-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.student-name {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.student-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
}
</style>
