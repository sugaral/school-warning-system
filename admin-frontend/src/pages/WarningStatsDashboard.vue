<template>
  <div class="warning-stats-page">
    <section class="stats-hero">
      <div class="stats-hero__copy">
        <span class="stats-hero__eyebrow">
          {{ scope.mode === 'college' ? 'College Warning Statistics' : 'Warning Statistics Overview' }}
        </span>
        <h2 class="stats-hero__title">{{ scope.title || '预警统计' }}</h2>
        <p class="stats-hero__desc">统计口径：{{ scope.rangeLabel || '本学期' }}</p>
      </div>

      <div class="stats-hero__actions">
        <el-radio-group v-model="selectedRange" size="small" :disabled="loading" @change="handleRangeChange">
          <el-radio-button value="semester">本学期</el-radio-button>
          <el-radio-button value="30d">近 30 天</el-radio-button>
          <el-radio-button value="7d">近 7 天</el-radio-button>
        </el-radio-group>
        <el-button size="small" :loading="loading" @click="fetchStats">刷新</el-button>
        <el-button v-if="canExportReports" type="primary" size="small" @click="goToReports">
          报表导出
        </el-button>
      </div>
    </section>

    <section class="kpi-grid">
      <article class="kpi-card">
        <span class="kpi-card__label">在册学生数</span>
        <strong class="kpi-card__value">{{ kpis.totalStudents }}</strong>
        <p class="kpi-card__sub">{{ kpis.unitCount }} 个{{ unitLabel }}</p>
      </article>

      <article class="kpi-card">
        <span class="kpi-card__label">期间预警总数</span>
        <strong class="kpi-card__value">{{ kpis.totalWarnings }}</strong>
        <p class="kpi-card__sub">涉及 {{ kpis.warnedStudents }} 人 · 预警率 {{ kpis.warningRate }}%</p>
      </article>

      <article class="kpi-card kpi-card--mint">
        <span class="kpi-card__label">预警闭环率</span>
        <strong class="kpi-card__value">{{ kpis.closureRate }}%</strong>
        <p class="kpi-card__sub">已闭环 {{ kpis.closedWarnings }} 条 · 平均响应 {{ kpis.avgResponseDays }} 天</p>
      </article>
    </section>

    <el-row :gutter="16" class="charts-row">
      <el-col :xs="24" :md="15" class="chart-col">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-card__header">
              <div>
                <div class="panel-card__title">预警趋势</div>
                <div class="panel-card__subtitle">{{ scope.rangeLabel || '按统计周期展示' }} · 新增、高等级与已闭环</div>
              </div>
            </div>
          </template>
          <div class="chart-stage chart-stage--trend">
            <div ref="trendChartRef" class="chart-canvas"></div>
            <div v-if="!loading && trend.labels.length === 0" class="chart-empty">暂无趋势数据</div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="9" class="chart-col">
        <el-card class="panel-card" shadow="never">
          <template #header>
            <div class="panel-card__header">
              <div>
                <div class="panel-card__title">预警级别分布</div>
                <div class="panel-card__subtitle">累计 {{ levelDistribution.total }} 条预警</div>
              </div>
            </div>
          </template>
          <div class="chart-stage chart-stage--pie">
            <div ref="pieChartRef" class="chart-canvas"></div>
            <div v-if="!loading && levelDistribution.total === 0" class="chart-empty">期间暂无预警记录</div>
          </div>
          <div class="level-legend">
            <div v-for="item in levelLegendItems" :key="item.key" class="level-pill">
              <span class="level-pill__dot" :style="{ backgroundColor: item.color }"></span>
              <span class="level-pill__label">{{ item.label }}</span>
              <span class="level-pill__count">{{ item.count }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="panel-card table-card" shadow="never">
      <template #header>
        <div class="panel-card__header">
          <div>
            <div class="panel-card__title">各{{ unitLabel }}预警概况</div>
            <div class="panel-card__subtitle">
              展示各{{ unitLabel }}在册学生、预警数量、级别构成与闭环率
            </div>
          </div>
          <el-tag type="info" effect="plain" size="small">共 {{ unitStats.length }} 个{{ unitLabel }}</el-tag>
        </div>
      </template>

      <el-table :data="unitStats" stripe v-loading="loading" style="width: 100%" empty-text="暂无统计数据">
        <el-table-column prop="name" :label="`${unitLabel}名称`" min-width="170" sortable show-overflow-tooltip />
        <el-table-column
          v-if="scope.mode === 'college'"
          prop="major"
          label="专业"
          min-width="150"
          sortable
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ row.major || '-' }}</template>
        </el-table-column>
        <el-table-column prop="studentCount" label="在册学生" width="110" align="right" sortable />
        <el-table-column prop="warnedStudentCount" label="预警人数" width="110" align="right" sortable />
        <el-table-column prop="totalWarnings" label="预警总条数" width="122" align="right" sortable />
        <el-table-column prop="seriousCount" label="高等级（红/严重）" width="156" align="right" sortable />
        <el-table-column prop="generalCount" label="一般（黄/橙）" width="138" align="right" sortable />
        <el-table-column prop="closureRate" label="闭环率" min-width="170" sortable>
          <template #default="{ row }">
            <div class="closure-cell">
              <div class="closure-track">
                <div class="closure-fill" :style="{ width: `${clampPercent(row.closureRate)}%` }"></div>
              </div>
              <span class="closure-text">{{ row.closureRate }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="warningRate" label="预警率" width="108" align="right" sortable>
          <template #default="{ row }">{{ row.warningRate }}%</template>
        </el-table-column>
        <el-table-column
          v-if="canDrillDownWarnings"
          label="操作"
          width="108"
          align="center"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              size="small"
              :disabled="!canRowDrillDown(row)"
              @click="goToUnitWarnings(row)"
            >
              查看预警
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getWarningStatsOverview } from '../api';
import { roleMenuConfig, type MenuItem } from '../config/menus';
import { echarts, type ECharts } from '../lib/echarts';
import { warningLevelPalette } from '../lib/warning-level';

type StatsRange = 'semester' | '30d' | '7d';

interface StatsScope {
  mode: 'school' | 'college';
  title: string;
  unitLabel: string;
  range: StatsRange;
  rangeLabel: string;
  orgId: string;
  orgName: string;
}

interface StatsKpis {
  totalStudents: number;
  unitCount: number;
  warnedStudents: number;
  warningRate: number;
  totalWarnings: number;
  openWarnings: number;
  closedWarnings: number;
  closureRate: number;
  highRiskCases: number;
  avgResponseDays: number;
}

interface LevelDistribution {
  yellow: number;
  orange: number;
  red: number;
  severe: number;
  total: number;
}

interface StatsTrend {
  labels: string[];
  created: number[];
  serious: number[];
  closed: number[];
}

interface UnitStatRow {
  id: string;
  name: string;
  major?: string;
  studentCount: number;
  warnedStudentCount: number;
  totalWarnings: number;
  seriousCount: number;
  generalCount: number;
  closedCount: number;
  closureRate: number;
  warningRate: number;
}

const router = useRouter();

const selectedRange = ref<StatsRange>('semester');
const loading = ref(false);
let requestSeq = 0;

const createDefaultScope = (): StatsScope => ({
  mode: 'school',
  title: '预警统计',
  unitLabel: '学院',
  range: selectedRange.value,
  rangeLabel: '本学期',
  orgId: '',
  orgName: '',
});

const createDefaultKpis = (): StatsKpis => ({
  totalStudents: 0,
  unitCount: 0,
  warnedStudents: 0,
  warningRate: 0,
  totalWarnings: 0,
  openWarnings: 0,
  closedWarnings: 0,
  closureRate: 0,
  highRiskCases: 0,
  avgResponseDays: 0,
});

const createDefaultLevels = (): LevelDistribution => ({
  yellow: 0,
  orange: 0,
  red: 0,
  severe: 0,
  total: 0,
});

const createDefaultTrend = (): StatsTrend => ({
  labels: [],
  created: [],
  serious: [],
  closed: [],
});

const scope = ref<StatsScope>(createDefaultScope());
const kpis = ref<StatsKpis>(createDefaultKpis());
const levelDistribution = ref<LevelDistribution>(createDefaultLevels());
const trend = ref<StatsTrend>(createDefaultTrend());
const unitStats = ref<UnitStatRow[]>([]);

const trendChartRef = ref<HTMLElement>();
const pieChartRef = ref<HTMLElement>();
let trendChart: ECharts | null = null;
let pieChart: ECharts | null = null;

const readStoredRoleCodes = () => {
  try {
    const rawFull = localStorage.getItem('admin_roles_full');
    if (rawFull) {
      const parsed = JSON.parse(rawFull);
      if (Array.isArray(parsed)) {
        const codes = parsed.map((item: any) => String(item?.role || '').trim()).filter(Boolean);
        if (codes.length > 0) {
          return codes;
        }
      }
    }
    const rawRoles = localStorage.getItem('admin_roles');
    if (rawRoles) {
      const parsed = JSON.parse(rawRoles);
      if (Array.isArray(parsed)) {
        return parsed.map((code: any) => String(code || '').trim()).filter(Boolean);
      }
    }
  } catch {
    // 忽略本地存储格式异常
  }
  return [];
};

const getPrimaryRoleCode = (roleCodes: string[]) => {
  if (roleCodes.includes('head_teacher')) return 'head_teacher';
  if (roleCodes.includes('student_admin')) return 'student_admin';
  if (roleCodes.includes('vice_dean')) return 'vice_dean';
  if (roleCodes.includes('dean') || roleCodes.includes('teaching_admin')) return 'teaching_admin';
  if (roleCodes.includes('sys_admin')) return 'sys_admin';
  if (roleCodes.includes('teacher')) return 'teacher';
  return '';
};

const collectMenuPaths = (menus: MenuItem[], target = new Set<string>()) => {
  menus.forEach((item) => {
    if (item.path.startsWith('/')) {
      target.add(item.path);
    }
    if (Array.isArray(item.children) && item.children.length > 0) {
      collectMenuPaths(item.children, target);
    }
  });
  return target;
};

const roleCodes = readStoredRoleCodes();
const primaryRoleCode = getPrimaryRoleCode(roleCodes);
const primaryMenuPaths = collectMenuPaths(
  roleMenuConfig.find((config) => config.role === primaryRoleCode)?.menus || [],
);
const allowedMenuPaths = roleCodes.reduce((paths, code) => {
  const config = roleMenuConfig.find((item) => item.role === code);
  if (config?.menus) {
    collectMenuPaths(config.menus, paths);
  }
  return paths;
}, new Set<string>());

const canExportReports = computed(() => primaryMenuPaths.has('/reports'));
const canDrillDownWarnings = computed(() => allowedMenuPaths.has('/warnings'));

const unitLabel = computed(() => scope.value.unitLabel || (scope.value.mode === 'college' ? '班级' : '学院'));

const levelLegendItems = computed(() => [
  { key: 'yellow', label: '黄色预警', count: levelDistribution.value.yellow, color: warningLevelPalette.yellow },
  { key: 'orange', label: '橙色预警', count: levelDistribution.value.orange, color: warningLevelPalette.orange },
  { key: 'red', label: '红色预警', count: levelDistribution.value.red, color: warningLevelPalette.red },
  { key: 'severe', label: '严重预警', count: levelDistribution.value.severe, color: warningLevelPalette.severe },
]);

const clampPercent = (value: number) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

const resetState = () => {
  scope.value = createDefaultScope();
  kpis.value = createDefaultKpis();
  levelDistribution.value = createDefaultLevels();
  trend.value = createDefaultTrend();
  unitStats.value = [];
};

const updateTrendChart = () => {
  if (!trendChart) {
    return;
  }

  trendChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        top: 0,
        data: ['新增预警', '高等级预警', '已闭环'],
      },
      grid: {
        left: 18,
        right: 18,
        top: 42,
        bottom: 18,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trend.value.labels,
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisLabel: { color: '#475569' },
      },
      yAxis: {
        type: 'value',
        min: 0,
        minInterval: 1,
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
        axisLabel: { color: '#64748b' },
      },
      series: [
        {
          name: '新增预警',
          type: 'line',
          smooth: true,
          data: trend.value.created,
          lineStyle: { color: '#0f766e', width: 3 },
          itemStyle: { color: '#0f766e' },
          areaStyle: { color: 'rgba(15, 118, 110, 0.12)' },
        },
        {
          name: '高等级预警',
          type: 'line',
          smooth: true,
          data: trend.value.serious,
          lineStyle: { color: warningLevelPalette.red, width: 2 },
          itemStyle: { color: warningLevelPalette.red },
        },
        {
          name: '已闭环',
          type: 'line',
          smooth: true,
          data: trend.value.closed,
          lineStyle: { color: '#2563eb', width: 2 },
          itemStyle: { color: '#2563eb' },
        },
      ],
    },
    true,
  );
};

const updatePieChart = () => {
  if (!pieChart) {
    return;
  }

  const hasData = levelDistribution.value.total > 0;
  pieChart.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} 条 ({d}%)',
      },
      series: [
        {
          name: '预警级别分布',
          type: 'pie',
          radius: ['48%', '76%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 8,
            borderColor: '#ffffff',
            borderWidth: 2,
          },
          label: {
            show: hasData,
            formatter: '{b}\n{c}',
            color: '#334155',
            fontSize: 12,
          },
          labelLine: {
            show: hasData,
          },
          data: hasData
            ? [
                { value: levelDistribution.value.yellow, name: '黄色', itemStyle: { color: warningLevelPalette.yellow } },
                { value: levelDistribution.value.orange, name: '橙色', itemStyle: { color: warningLevelPalette.orange } },
                { value: levelDistribution.value.red, name: '红色', itemStyle: { color: warningLevelPalette.red } },
                { value: levelDistribution.value.severe, name: '严重', itemStyle: { color: warningLevelPalette.severe } },
              ]
            : [],
        },
      ],
    },
    true,
  );
};

const initAndRenderCharts = () => {
  if (trendChartRef.value && !trendChart) {
    trendChart = echarts.init(trendChartRef.value);
  }
  if (pieChartRef.value && !pieChart) {
    pieChart = echarts.init(pieChartRef.value);
  }
  updateTrendChart();
  updatePieChart();
};

const fetchStats = async () => {
  const currentSeq = ++requestSeq;
  loading.value = true;
  try {
    const response = await getWarningStatsOverview({ range: selectedRange.value });
    if (currentSeq !== requestSeq) {
      return;
    }

    if (response.code !== 0 || !response.data) {
      resetState();
      ElMessage.warning(response.message || '暂未获取到预警统计数据');
      return;
    }

    const payload = response.data;
    scope.value = {
      ...createDefaultScope(),
      ...(payload.scope || {}),
    };
    kpis.value = {
      ...createDefaultKpis(),
      ...(payload.kpis || {}),
    };
    levelDistribution.value = {
      ...createDefaultLevels(),
      ...(payload.levelDistribution || {}),
    };
    trend.value = {
      labels: Array.isArray(payload.trend?.labels) ? payload.trend.labels : [],
      created: Array.isArray(payload.trend?.created) ? payload.trend.created : [],
      serious: Array.isArray(payload.trend?.serious) ? payload.trend.serious : [],
      closed: Array.isArray(payload.trend?.closed) ? payload.trend.closed : [],
    };
    unitStats.value = Array.isArray(payload.unitStats) ? payload.unitStats : [];
  } catch (error: any) {
    if (currentSeq === requestSeq) {
      resetState();
      ElMessage.error(error?.message || '获取预警统计失败');
    }
  } finally {
    if (currentSeq === requestSeq) {
      loading.value = false;
      await nextTick();
      initAndRenderCharts();
    }
  }
};

const handleRangeChange = () => {
  void fetchStats();
};

const goToReports = () => {
  router.push('/reports');
};

const canRowDrillDown = (row: UnitStatRow) => Boolean(row?.id && row.id !== '0');

const goToUnitWarnings = (row: UnitStatRow) => {
  if (!canDrillDownWarnings.value || !canRowDrillDown(row)) {
    return;
  }

  if (scope.value.mode === 'college') {
    const query: Record<string, string> = { class_id: String(row.id) };
    if (scope.value.orgId) {
      query.org_id = String(scope.value.orgId);
    }
    router.push({ path: '/warnings', query });
    return;
  }

  router.push({ path: '/warnings', query: { org_id: String(row.id) } });
};

const handleResize = () => {
  trendChart?.resize();
  pieChart?.resize();
};

onMounted(async () => {
  window.addEventListener('resize', handleResize);
  await fetchStats();
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  trendChart?.dispose();
  pieChart?.dispose();
  trendChart = null;
  pieChart = null;
});
</script>

<style scoped>
.warning-stats-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 20px 24px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(246, 250, 252, 0.84));
  box-shadow: 0 16px 34px rgba(34, 59, 78, 0.08);
}

.stats-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stats-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.stats-hero__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #173145;
}

.stats-hero__desc {
  margin: 0;
  color: #5d7283;
  font-size: 13px;
}

.stats-hero__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 20px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 251, 252, 0.84));
  box-shadow: 0 14px 28px rgba(34, 59, 78, 0.06);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.kpi-card--warm {
  background: linear-gradient(180deg, rgba(255, 248, 241, 0.94), rgba(255, 239, 224, 0.84));
}

.kpi-card--mint {
  background: linear-gradient(180deg, rgba(240, 253, 250, 0.94), rgba(220, 250, 243, 0.84));
}

.kpi-card--clickable {
  cursor: pointer;
}

.kpi-card--clickable:hover,
.kpi-card--clickable:focus-visible {
  transform: translateY(-2px);
  border-color: rgba(15, 118, 110, 0.38);
  box-shadow: 0 18px 32px rgba(34, 59, 78, 0.1);
  outline: none;
}

.kpi-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.kpi-card__label {
  color: #607688;
  font-size: 13px;
  font-weight: 600;
}

.kpi-card__action {
  color: #0f766e;
  font-size: 12px;
  font-weight: 600;
}

.kpi-card__value {
  color: #173145;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
}

.kpi-card__sub {
  margin: 0;
  color: #5e7384;
  font-size: 12px;
  line-height: 1.5;
}

.charts-row {
  row-gap: 16px;
}

.chart-col {
  display: flex;
}

.panel-card {
  width: 100%;
  border-radius: 20px;
  border: 1px solid rgba(109, 140, 158, 0.16);
  box-shadow: 0 14px 28px rgba(34, 59, 78, 0.07);
}

.panel-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.panel-card__title {
  font-size: 16px;
  font-weight: 700;
  color: #173145;
}

.panel-card__subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: #607688;
}

.chart-stage {
  position: relative;
  width: 100%;
}

.chart-stage--trend {
  height: 310px;
}

.chart-stage--pie {
  height: 220px;
}

.chart-canvas {
  width: 100%;
  height: 100%;
}

.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a9bad;
  font-size: 13px;
  pointer-events: none;
}

.level-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.level-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(246, 250, 252, 0.9);
  border: 1px solid rgba(108, 140, 158, 0.14);
}

.level-pill__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.level-pill__label {
  font-size: 12px;
  color: #475569;
  flex: 1;
}

.level-pill__count {
  font-size: 14px;
  font-weight: 700;
  color: #173145;
}

.closure-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.closure-track {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.closure-fill {
  height: 100%;
  border-radius: 999px;
  background: #0f766e;
  transition: width 0.25s ease;
}

.closure-text {
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: #173145;
}

@media (max-width: 1120px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .stats-hero {
    padding: 16px 18px;
  }

  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .stats-hero__actions {
    width: 100%;
  }
}
</style>
