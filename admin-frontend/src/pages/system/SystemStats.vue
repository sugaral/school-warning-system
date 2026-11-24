<template>
  <div class="system-stats-page">
    <el-row :gutter="20" class="top-row">
      <el-col :span="8">
        <el-card class="stat-card" shadow="never">
          <div class="card-header">
            <div class="card-title">预警级别分布</div>
            <div class="card-subtitle">近 30 天累计 {{ totalWarnings }} 条</div>
          </div>
          <div ref="pieChartRef" class="pie-chart-container"></div>
          <div class="warning-stats-grid">
            <div class="stat-pill">
              <span class="pill-dot yellow"></span>
              <span class="pill-label">黄色预警</span>
              <span class="pill-count">{{ warningStats.yellow }}</span>
            </div>
            <div class="stat-pill">
              <span class="pill-dot orange"></span>
              <span class="pill-label">橙色预警</span>
              <span class="pill-count">{{ warningStats.orange }}</span>
            </div>
            <div class="stat-pill">
              <span class="pill-dot red"></span>
              <span class="pill-label">红色预警</span>
              <span class="pill-count">{{ warningStats.red }}</span>
            </div>
            <div class="stat-pill">
              <span class="pill-dot severe"></span>
              <span class="pill-label">严重预警</span>
              <span class="pill-count">{{ warningStats.severe }}</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card class="stat-card" shadow="never">
          <div class="card-header">
            <div class="card-title">处置时效分析</div>
            <div class="card-subtitle">SLA 目标：7 天内闭环</div>
            <div class="sla-tag">{{ slaComplianceRate }}% 达标</div>
          </div>

          <div class="sla-circle" :style="{ '--rate': slaComplianceRate }">
            <div class="sla-inner">
              <div class="sla-percentage">{{ slaComplianceRate }}%</div>
              <div class="sla-label">SLA 达标率</div>
            </div>
          </div>

          <div class="sla-progress-list">
            <div class="progress-item">
              <span class="label">24 小时内</span>
              <div class="progress-bar">
                <div class="progress-fill twenty-four" :style="{ width: `${slaStats.twentyFour}%` }"></div>
              </div>
              <span class="percentage">{{ slaStats.twentyFour }}%</span>
              <span class="count">{{ slaStats.twentyFourCount }}</span>
            </div>
            <div class="progress-item">
              <span class="label">3 天内</span>
              <div class="progress-bar">
                <div class="progress-fill three" :style="{ width: `${slaStats.three}%` }"></div>
              </div>
              <span class="percentage">{{ slaStats.three }}%</span>
              <span class="count">{{ slaStats.threeCount }}</span>
            </div>
            <div class="progress-item">
              <span class="label">7 天内</span>
              <div class="progress-bar">
                <div class="progress-fill seven" :style="{ width: `${slaStats.seven}%` }"></div>
              </div>
              <span class="percentage">{{ slaStats.seven }}%</span>
              <span class="count">{{ slaStats.sevenCount }}</span>
            </div>
            <div class="progress-item">
              <span class="label">超过 7 天</span>
              <div class="progress-bar">
                <div class="progress-fill over" :style="{ width: `${slaStats.over}%` }"></div>
              </div>
              <span class="percentage">{{ slaStats.over }}%</span>
              <span class="count">{{ slaStats.overCount }}</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card class="stat-card" shadow="never">
          <div class="card-header">
            <div class="card-title">周预警统计</div>
            <div class="card-subtitle">按学期起始时间自动匹配第 N 周</div>
          </div>
          <div ref="weeklyChartRef" class="weekly-chart-container"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row>
      <el-col :span="24">
        <el-card class="table-card" shadow="never">
          <div class="card-header table-header">
            <div class="card-title">院系处置表现</div>
            <div class="card-subtitle">按近 30 天预警量倒序展示</div>
          </div>

          <div class="table-shell">
            <el-table :data="normalizedPerformance" stripe style="width: 100%">
              <el-table-column prop="department" label="院系" min-width="180" sortable>
                <template #default="{ row }">
                  <span class="department-name">
                    <span class="status-dot" :class="row.status === '达标' ? 'green' : 'red'"></span>
                    {{ row.department }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="studentCount" label="学生总数" min-width="120" sortable />
              <el-table-column prop="warningCount" label="预警数" min-width="100" sortable />
              <el-table-column prop="redCount" label="红色" min-width="90" sortable />
              <el-table-column prop="yellowCount" label="一般" min-width="90" sortable />
              <el-table-column prop="resolveRate" label="解决率" min-width="180" sortable>
                <template #default="{ row }">
                  <div class="resolve-rate-bar">
                    <div
                      class="bar-fill"
                      :class="row.resolveRate >= 75 ? 'green' : 'red'"
                      :style="{ width: `${row.resolveRate}%` }"
                    ></div>
                    <span class="rate-text">{{ row.resolveRate }}%</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="avgResponse" label="平均响应" min-width="120" sortable>
                <template #default="{ row }">{{ row.avgResponse }} 天</template>
              </el-table-column>
              <el-table-column prop="trendPoints" label="趋势" width="180">
                <template #default="{ row }">
                  <svg class="trend-svg" viewBox="0 0 80 40">
                    <polyline
                      :points="row.trendPoints"
                      :stroke="row.status === '达标' ? '#67c23a' : '#dc2626'"
                      stroke-width="2"
                      fill="none"
                    />
                  </svg>
                </template>
              </el-table-column>
              <el-table-column prop="status" label="状态" min-width="130">
                <template #default="{ row }">
                  <el-tag :type="row.status === '达标' ? 'success' : 'warning'" size="small">
                    {{ row.status }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { echarts, type ECharts } from '../../lib/echarts';
import { api } from '../../api';
import { warningLevelPalette } from '../../lib/warning-level';

const pieChartRef = ref<HTMLElement>();
const weeklyChartRef = ref<HTMLElement>();
let pieChart: ECharts | null = null;
let weeklyChart: ECharts | null = null;

const totalWarnings = ref(0);
const slaComplianceRate = ref(0);
const orgPerformanceData = ref<any[]>([]);
const weeklyTrend = ref<{
  labels: string[];
  totals: number[];
  serious: number[];
  resolved: number[];
}>({
  labels: [],
  totals: [],
  serious: [],
  resolved: [],
});

const warningStats = reactive({
  yellow: 0,
  orange: 0,
  red: 0,
  severe: 0,
});

const slaStats = reactive({
  twentyFour: 0,
  twentyFourCount: 0,
  three: 0,
  threeCount: 0,
  seven: 0,
  sevenCount: 0,
  over: 0,
  overCount: 0,
});

const normalizedPerformance = computed(() =>
  orgPerformanceData.value.map((item) => ({
    ...item,
    department: item.department || '未知学院',
    status: Number(item.resolveRate || 0) >= 75 ? '达标' : '待改善',
  })),
);

const updatePieChart = () => {
  if (!pieChart) {
    return;
  }

  pieChart.setOption(
    {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        bottom: 0,
      },
      series: [
        {
          name: '预警分布',
          type: 'pie',
          radius: ['42%', '76%'],
          center: ['50%', '44%'],
          itemStyle: {
            borderRadius: 10,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            formatter: '{b}\n{c}',
          },
          data: [
            { value: warningStats.yellow, name: '黄色预警', itemStyle: { color: warningLevelPalette.yellow } },
            { value: warningStats.orange, name: '橙色预警', itemStyle: { color: warningLevelPalette.orange } },
            { value: warningStats.red, name: '红色预警', itemStyle: { color: warningLevelPalette.red } },
            { value: warningStats.severe, name: '严重预警', itemStyle: { color: warningLevelPalette.severe } },
          ],
        },
      ],
    },
    true,
  );
};

const updateWeeklyChart = () => {
  if (!weeklyChart) {
    return;
  }

  weeklyChart.setOption(
    {
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 24,
        right: 18,
        top: 44,
        bottom: 30,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: weeklyTrend.value.labels,
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
      },
      series: [
        {
          name: '周预警总数',
          type: 'line',
          smooth: true,
          data: weeklyTrend.value.totals,
          lineStyle: { color: '#0f766e', width: 3 },
          itemStyle: { color: '#0f766e' },
          areaStyle: {
            color: 'rgba(15, 118, 110, 0.12)',
          },
        },
        {
          name: '高等级预警',
          type: 'line',
          smooth: true,
          data: weeklyTrend.value.serious,
          lineStyle: { color: '#dc2626', width: 2 },
          itemStyle: { color: '#dc2626' },
        },
        {
          name: '已处理',
          type: 'line',
          smooth: true,
          data: weeklyTrend.value.resolved,
          lineStyle: { color: '#409eff', width: 2 },
          itemStyle: { color: '#409eff' },
        },
      ],
    },
    true,
  );
};

const initCharts = () => {
  if (pieChartRef.value && !pieChart) {
    pieChart = echarts.init(pieChartRef.value);
  }
  if (weeklyChartRef.value && !weeklyChart) {
    weeklyChart = echarts.init(weeklyChartRef.value);
  }
  updatePieChart();
  updateWeeklyChart();
};

const fetchStats = async () => {
  try {
    const response = await api.get('/admin/stats/system');
    const data = response.data?.data || {};

    totalWarnings.value = Number(data.totalWarnings || 0);
    slaComplianceRate.value = Number(data.slaComplianceRate || 0);
    orgPerformanceData.value = Array.isArray(data.orgPerformance) ? data.orgPerformance : [];
    weeklyTrend.value = {
      labels: Array.isArray(data.weeklyTrend?.labels) ? data.weeklyTrend.labels : [],
      totals: Array.isArray(data.weeklyTrend?.totals) ? data.weeklyTrend.totals : [],
      serious: Array.isArray(data.weeklyTrend?.serious) ? data.weeklyTrend.serious : [],
      resolved: Array.isArray(data.weeklyTrend?.resolved) ? data.weeklyTrend.resolved : [],
    };
    Object.assign(warningStats, data.warningStats || {});
    Object.assign(slaStats, data.slaStats || {});
  } catch (error) {
    console.error('获取系统统计失败:', error);
  } finally {
    await nextTick();
    initCharts();
  }
};

const handleResize = () => {
  pieChart?.resize();
  weeklyChart?.resize();
};

onMounted(async () => {
  await fetchStats();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  pieChart?.dispose();
  weeklyChart?.dispose();
  pieChart = null;
  weeklyChart = null;
});
</script>

<style scoped>
.system-stats-page {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
}

.top-row {
  margin-bottom: 20px;
}

.top-row :deep(.el-col) {
  display: flex;
}

.stat-card,
.table-card {
  border-radius: 18px;
  border: none;
}

.stat-card {
  flex: 1;
}

.stat-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.card-header {
  margin-bottom: 16px;
  position: relative;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.card-title {
  font-size: 18px;
  font-weight: 700;
  color: #303133;
}

.card-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: #909399;
}

.pie-chart-container,
.weekly-chart-container {
  height: 320px;
}

.warning-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(107, 140, 158, 0.14);
  backdrop-filter: blur(12px);
}

.pill-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.pill-dot.yellow {
  background: var(--ws-warning-yellow);
}

.pill-dot.orange {
  background: var(--ws-warning-orange);
}

.pill-dot.red {
  background: var(--ws-warning-red);
}

.pill-dot.severe {
  background: var(--ws-warning-severe);
}

.pill-label {
  color: #606266;
}

.pill-count {
  margin-left: auto;
  font-weight: 700;
  color: #303133;
}

.sla-tag {
  position: absolute;
  right: 0;
  top: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.18);
  color: #409eff;
  font-size: 13px;
  font-weight: 600;
}

.sla-circle {
  width: 260px;
  height: 260px;
  margin: 18px auto;
  border-radius: 50%;
  background: conic-gradient(#67c23a 0deg calc(var(--rate) * 3.6deg), #ebeef5 calc(var(--rate) * 3.6deg) 360deg);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.sla-circle::before {
  content: '';
  position: absolute;
  width: 188px;
  height: 188px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: inset 0 0 0 1px rgba(107, 140, 158, 0.12);
}

.sla-inner {
  position: relative;
  z-index: 1;
  text-align: center;
}

.sla-percentage {
  font-size: 42px;
  font-weight: 700;
  color: #303133;
}

.sla-label {
  margin-top: 6px;
  color: #67c23a;
}

.sla-progress-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: auto;
}

.progress-item {
  display: grid;
  grid-template-columns: 76px 1fr 52px 42px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #606266;
}

.progress-bar {
  height: 10px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
}

.progress-fill.twenty-four {
  background: #67c23a;
}

.progress-fill.three {
  background: #409eff;
}

.progress-fill.seven {
  background: #d4a017;
}

.progress-fill.over {
  background: #dc2626;
}

.percentage,
.count {
  text-align: right;
}

.department-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-dot.green {
  background: #67c23a;
}

.status-dot.red {
  background: #dc2626;
}

.resolve-rate-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bar-fill {
  width: 100px;
  max-width: 100px;
  min-width: 4px;
  height: 8px;
  border-radius: 999px;
}

.bar-fill.green {
  background: #67c23a;
}

.bar-fill.red {
  background: #dc2626;
}

.rate-text {
  color: #303133;
  font-weight: 600;
}

.trend-svg {
  width: 100px;
  height: 40px;
}
</style>
