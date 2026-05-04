<template>
  <div class="page-container">
    <h2>学院看板</h2>
    
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-value">{{ stats.totalStudents || 0 }}</div>
          <div class="stat-label">学生总数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card warning">
          <div class="stat-value">{{ stats.warningCount || 0 }}</div>
          <div class="stat-label">预警人数</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card danger">
          <div class="stat-value">{{ stats.seriousWarning || 0 }}</div>
          <div class="stat-label">严重预警</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card success">
          <div class="stat-value">{{ stats.closedWarning || 0 }}</div>
          <div class="stat-label">已解除预警</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="24">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>预警统计-1：按预警级别统计</span>
            </div>
          </template>
          <el-row :gutter="20">
            <el-col :span="8">
              <el-card class="level-card yellow">
                <div class="level-icon">⚠️</div>
                <div class="level-name">黄色预警</div>
                <div class="level-count">{{ stats.yellowWarning || 0 }}</div>
              </el-card>
            </el-col>
            <el-col :span="8">
              <el-card class="level-card orange">
                <div class="level-icon">🔶</div>
                <div class="level-name">橙色预警</div>
                <div class="level-count">{{ stats.orangeWarning || 0 }}</div>
              </el-card>
            </el-col>
            <el-col :span="8">
              <el-card class="level-card red">
                <div class="level-icon">🚨</div>
                <div class="level-name">红色预警</div>
                <div class="level-count">{{ stats.redWarning || 0 }}</div>
              </el-card>
            </el-col>
          </el-row>
          <div class="chart-container" style="margin-top: 20px;">
            <div v-if="levelDistribution.length > 0">
              <div v-for="(item, index) in levelDistribution" :key="index" class="chart-bar-item">
                <div class="chart-bar-label">{{ item.level }}</div>
                <div class="chart-bar-wrapper">
                  <div 
                    class="chart-bar" 
                    :style="{ 
                      width: (item.count / maxLevelCount * 100) + '%',
                      backgroundColor: item.color 
                    }"
                  ></div>
                  <div class="chart-bar-count">{{ item.count }}</div>
                </div>
              </div>
            </div>
            <el-empty v-else description="暂无数据" />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="24">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>预警统计-2：按班级统计</span>
            </div>
          </template>
          <div class="table-shell">
          <el-table :data="classWarningStats" border stripe style="width: 100%">
            <el-table-column prop="class_name" label="班级" width="200" />
            <el-table-column prop="major" label="专业" width="150" />
            <el-table-column prop="enroll_year" label="入学年份" width="100" />
            <el-table-column prop="student_count" label="学生数" width="100" align="center" />
            <el-table-column prop="warning_count" label="预警数" width="100" align="center">
              <template #default="{ row }">
                <span :class="getWarningCountClass(row.warning_count)">{{ row.warning_count }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="warning_rate" label="预警率" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="getWarningRateType(row.warning_rate)" size="small">
                  {{ row.warning_rate }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>按专业统计</span>
          </template>
          <div class="table-shell">
          <el-table :data="majorWarningStats" border stripe style="width: 100%">
            <el-table-column prop="major" label="专业" />
            <el-table-column prop="student_count" label="学生数" align="center" />
            <el-table-column prop="warning_count" label="预警数" align="center">
              <template #default="{ row }">
                <span :class="getWarningCountClass(row.warning_count)">{{ row.warning_count }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="warning_rate" label="预警率" align="center">
              <template #default="{ row }">
                <el-tag :type="getWarningRateType(row.warning_rate)" size="small">
                  {{ row.warning_rate }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          </div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="chart-header">
              <span>预警趋势（近7天）</span>
              <div class="legend">
                <div v-for="(item, index) in trendData" :key="index" class="legend-item">
                  <div class="legend-color" :style="{ backgroundColor: item.color }"></div>
                  <span>{{ item.label }}</span>
                </div>
              </div>
            </div>
          </template>
          <div class="chart-container">
            <div v-if="trendData.length > 0" class="line-chart-container">
              <svg class="line-chart" viewBox="0 0 600 250">
                <g class="grid-lines">
                  <line v-for="i in 5" :key="'h' + i" :x1="50" :y1="30 + i * 38" x2="550" :y2="30 + i * 38" stroke="#eee" stroke-width="1" />
                  <line v-for="i in 7" :key="'v' + i" :x1="50 + i * 71.4" y1="30" :x2="50 + i * 71.4" y2="220" stroke="#eee" stroke-width="1" />
                </g>
                <g class="y-axis-labels">
                  <text v-for="(value, i) in yAxisLabels" :key="i" x="45" :y="38 + i * 38" text-anchor="end" fill="#909399" font-size="12">{{ value }}</text>
                </g>
                <g class="x-axis-labels">
                  <text v-for="(date, i) in dates" :key="i" :x="50 + i * 71.4" y="240" text-anchor="middle" fill="#909399" font-size="12">{{ date }}</text>
                </g>
                <g v-for="(item, itemIndex) in trendData" :key="itemIndex" class="line-group">
                  <polyline
                    :points="getLinePoints(item.data)"
                    :stroke="item.color"
                    stroke-width="3"
                    fill="none"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <circle
                    v-for="(point, pointIndex) in item.data"
                    :key="pointIndex"
                    :cx="50 + pointIndex * 71.4"
                    :cy="getPointY(point)"
                    r="5"
                    :fill="item.color"
                    stroke="white"
                    stroke-width="2"
                  />
                </g>
              </svg>
            </div>
            <el-empty v-else description="暂无数据" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getStudentAdminDashboard } from '../../api';

const loading = ref(false);
const stats = ref<any>({});
const levelDistribution = ref<any[]>([]);
const classWarningStats = ref<any[]>([]);
const majorWarningStats = ref<any[]>([]);
const trendData = ref<any[]>([]);
const dates = ref<string[]>([]);

const maxLevelCount = computed(() => {
  return Math.max(...levelDistribution.value.map(item => item.count), 1);
});

const maxTrendValue = computed(() => {
  let max = 0;
  trendData.value.forEach((item: any) => {
    item.data.forEach((d: number) => {
      if (d > max) max = d;
    });
  });
  return max || 10;
});

const yAxisLabels = computed(() => {
  const step = Math.ceil(maxTrendValue.value / 5);
  return [0, step, step * 2, step * 3, step * 4, step * 5];
});

const getPointY = (count: number) => {
  return 220 - (count / maxTrendValue.value) * 190;
};

const getLinePoints = (data: number[]) => {
  return data.map((item, index) => {
    const x = 50 + index * 71.4;
    const y = getPointY(item);
    return `${x},${y}`;
  }).join(' ');
};

const getWarningCountClass = (count: number) => {
  if (count === 0) return 'warning-count-low';
  if (count < 5) return 'warning-count-medium';
  return 'warning-count-high';
};

const getWarningRateType = (rate: string) => {
  const num = parseFloat(rate);
  if (num < 5) return 'success';
  if (num < 15) return 'warning';
  return 'danger';
};

const loadStats = async () => {
  loading.value = true;
  try {
    const response = await getStudentAdminDashboard();
    if (response.code === 0) {
      stats.value = response.data || {};
      if (response.data.levelDistribution) {
        levelDistribution.value = response.data.levelDistribution;
      }
      if (response.data.classWarningStats) {
        classWarningStats.value = response.data.classWarningStats;
      }
      if (response.data.majorWarningStats) {
        majorWarningStats.value = response.data.majorWarningStats;
      }
      if (response.data.trendData) {
        trendData.value = response.data.trendData;
      }
      if (response.data.dates) {
        dates.value = response.data.dates;
      }
    }
  } catch (error) {
    console.error('获取学院看板失败:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadStats();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
}

.stat-card.warning .stat-value { color: #d4a017; }
.stat-card.danger .stat-value { color: #dc2626; }
.stat-card.success .stat-value { color: #67c23a; }

.stat-label {
  margin-top: 10px;
  color: #909399;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.level-card {
  text-align: center;
  padding: 20px;
}

.level-card.yellow { border-left: 4px solid #d4a017; }
.level-card.orange { border-left: 4px solid #f97316; }
.level-card.red { border-left: 4px solid #dc2626; }

.level-icon {
  font-size: 36px;
  margin-bottom: 10px;
}

.level-name {
  font-size: 16px;
  color: #606266;
  margin-bottom: 10px;
}

.level-count {
  font-size: 28px;
  font-weight: bold;
}

.level-card.yellow .level-count { color: #d4a017; }
.level-card.orange .level-count { color: #f97316; }
.level-card.red .level-count { color: #dc2626; }

.chart-container {
  min-height: 200px;
  padding: 20px 0;
}

.chart-bar-item {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
}

.chart-bar-label {
  width: 100px;
  font-size: 14px;
  color: #606266;
}

.chart-bar-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.chart-bar {
  height: 30px;
  border-radius: 4px;
  transition: width 0.3s;
  min-width: 2px;
}

.chart-bar-count {
  width: 40px;
  font-size: 14px;
  color: #909399;
  font-weight: bold;
}

.warning-count-low { color: #67c23a; font-weight: bold; }
.warning-count-medium { color: #d4a017; font-weight: bold; }
.warning-count-high { color: #dc2626; font-weight: bold; }

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.legend {
  display: flex;
  gap: 15px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: #606266;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.line-chart-container {
  width: 100%;
}

.line-chart {
  width: 100%;
  height: 100%;
}
</style>
