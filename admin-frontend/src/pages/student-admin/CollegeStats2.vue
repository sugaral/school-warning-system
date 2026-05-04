<template>
  <div class="college-stats-2">
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
        <el-card class="panel-card" shadow="never">
          <div class="panel-header">
            <div>
              <div class="panel-title">预警趋势分析</div>
              <div class="panel-subtitle">{{ chartSubtitle }}</div>
            </div>
            <el-radio-group v-model="timeRange" size="small" @change="handleRangeChange">
              <el-radio-button label="day">按日</el-radio-button>
              <el-radio-button label="week">按周</el-radio-button>
              <el-radio-button label="month">按月</el-radio-button>
            </el-radio-group>
          </div>
          <div ref="trendChartRef" class="chart-box"></div>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card class="panel-card" shadow="never">
          <div class="panel-header">
            <div>
              <div class="panel-title">高风险学生</div>
              <div class="panel-subtitle">基于近 30 天实际预警聚合生成</div>
            </div>
          </div>

          <div class="list-toolbar">
            <el-input
              v-model="searchText"
              placeholder="搜索姓名、学号、班级"
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
                  {{ student.status || '待关注' }}
                </el-tag>
              </div>
              <div class="student-meta">
                <span>{{ student.id || '-' }}</span>
                <span>{{ student.className || '未分班' }}</span>
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
              <div class="panel-title">班级预警分布</div>
              <div class="panel-subtitle">展示近 6 个月红色与黄色预警数量</div>
            </div>
          </div>
          <div ref="classChartRef" class="chart-box chart-box-large"></div>
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
const classChartRef = ref<HTMLElement>();
let trendChart: ECharts | null = null;
let classChart: ECharts | null = null;

const timeRange = ref<TimeRange>('month');
const searchText = ref('');
const filterType = ref<'all' | 'severe' | 'general'>('all');
const overview = ref<Overview>(defaultOverview());
const students = ref<any[]>([]);
const trendData = ref<any>(null);
const classData = ref<any>(null);

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

const filteredStudents = computed(() => {
  const keyword = searchText.value.trim().toLowerCase();
  let result = students.value;

  if (keyword) {
    result = result.filter((item) =>
      [item.name, item.id, item.className]
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
  classData.value = null;
};

const normalizeStudents = (list: any[]) =>
  list.map((item) => ({
    id: item.id || '',
    name: item.name || '未命名学生',
    className: item.className || '未分班',
    riskScore: Number(item.riskScore || 0),
    warningCount: Number(item.warningCount || 0),
    lastWarning: item.lastWarning || '',
    status: item.status || '待关注',
    statusType: item.statusType || 'info',
  }));

const fetchStats = async () => {
  try {
    const response = await api.get('/student-admin/stats-2', {
      params: { timeRange: timeRange.value },
    });
    const data = response.data?.data || {};

    overview.value = {
      ...defaultOverview(),
      ...(data.overview || {}),
    };
    students.value = normalizeStudents(Array.isArray(data.students) ? data.students : []);
    trendData.value = data.trend || null;
    classData.value = data.classDistribution || null;

    await nextTick();
    renderCharts();
  } catch (error) {
    console.error('获取学院统计失败:', error);
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
  const maxValue = Math.max(10, ...totals, ...reds, ...yellows, ...resolveds);

  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预警总数', '严重预警', '一般预警', '已处理'] },
    color: ['#409eff', warningLevelPalette.severe, warningLevelPalette.yellow, '#67c23a'],
    grid: { left: 36, right: 20, top: 48, bottom: 32, containLabel: true },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', min: 0, max: Math.ceil(maxValue / 10) * 10 },
    series: [
      {
        name: '预警总数',
        type: 'line',
        smooth: true,
        data: totals,
        itemStyle: { color: '#409eff' },
        lineStyle: { color: '#409eff' },
      },
      {
        name: '严重预警',
        type: 'line',
        smooth: true,
        data: reds,
        itemStyle: { color: warningLevelPalette.severe },
        lineStyle: { color: warningLevelPalette.severe },
      },
      {
        name: '一般预警',
        type: 'line',
        smooth: true,
        data: yellows,
        itemStyle: { color: warningLevelPalette.yellow },
        lineStyle: { color: warningLevelPalette.yellow },
      },
      {
        name: '已处理',
        type: 'line',
        smooth: true,
        data: resolveds,
        itemStyle: { color: '#67c23a' },
        lineStyle: { color: '#67c23a' },
      },
    ],
  });
};

const updateClassChart = () => {
  if (!classChart) {
    return;
  }

  const classes = Array.isArray(classData.value?.classes) ? classData.value.classes : [];
  const red = Array.isArray(classData.value?.red) ? classData.value.red : [];
  const yellow = Array.isArray(classData.value?.yellow) ? classData.value.yellow : [];
  const maxValue = Math.max(10, ...red.map((value: number, index: number) => value + Number(yellow[index] || 0)));

  classChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['红色预警', '黄色预警'] },
    color: [warningLevelPalette.red, warningLevelPalette.yellow],
    grid: { left: 36, right: 20, top: 48, bottom: 56, containLabel: true },
    xAxis: {
      type: 'category',
      data: classes,
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
        data: red,
        itemStyle: { color: warningLevelPalette.red },
      },
      {
        name: '黄色预警',
        type: 'bar',
        stack: 'total',
        data: yellow,
        itemStyle: { color: warningLevelPalette.yellow },
      },
    ],
  });
};

const renderCharts = () => {
  if (trendChartRef.value && !trendChart) {
    trendChart = echarts.init(trendChartRef.value);
  }
  if (classChartRef.value && !classChart) {
    classChart = echarts.init(classChartRef.value);
  }
  updateTrendChart();
  updateClassChart();
};

const handleRangeChange = async () => {
  await fetchStats();
};

const handleResize = () => {
  trendChart?.resize();
  classChart?.resize();
};

onMounted(async () => {
  await fetchStats();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  classChart?.dispose();
  trendChart = null;
  classChart = null;
});
</script>

<style scoped>
.college-stats-2 {
  padding: 20px;
}

.summary-row,
.content-row {
  margin-bottom: 16px;
}

.summary-card,
.panel-card {
  border-radius: 14px;
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
  height: 320px;
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 320px;
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
