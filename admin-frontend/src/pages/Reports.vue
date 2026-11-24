<template>
  <div class="reports-page">
    <section class="reports-hero">
      <div class="reports-hero__copy">
        <span class="reports-hero__eyebrow">Export Desk</span>
        <h2 class="reports-hero__title">报表导出</h2>
        <p class="reports-hero__desc">快速生成日、周、月、学期报表，并统一查看导出历史和下载状态。</p>
      </div>
      <div class="reports-hero__meta">
        <span>当前筛选状态</span>
        <strong>{{ reportStatusLabel }}</strong>
        <small>历史记录 {{ exportHistory.length }} 条</small>
      </div>
    </section>

    <section class="reports-overview">
      <article class="reports-overview__card">
        <span class="reports-overview__label">历史总量</span>
        <strong class="reports-overview__value">{{ exportHistory.length }}</strong>
        <p class="reports-overview__desc">当前已记录的报表导出历史数量</p>
      </article>
      <article class="reports-overview__card">
        <span class="reports-overview__label">已完成</span>
        <strong class="reports-overview__value">{{ completedHistoryCount }}</strong>
        <p class="reports-overview__desc">已经生成完毕、可直接下载的报表数量</p>
      </article>
      <article class="reports-overview__card">
        <span class="reports-overview__label">生成中</span>
        <strong class="reports-overview__value">{{ pendingHistoryCount }}</strong>
        <p class="reports-overview__desc">后台仍在处理中的报表数量</p>
      </article>
      <article class="reports-overview__card">
        <span class="reports-overview__label">筛选后</span>
        <strong class="reports-overview__value">{{ filteredHistoryCount }}</strong>
        <p class="reports-overview__desc">按当前预警状态筛选得到的历史记录数</p>
      </article>
    </section>

    <el-card class="report-types">
      <div class="reports-section-heading">
        <div>
          <span class="reports-section-heading__title">选择报表类型</span>
          <p class="reports-section-heading__desc">生成前可先切换预警状态筛选，报表会使用当前筛选条件。</p>
        </div>
        <div class="reports-section-heading__filter">
          <span>预警状态筛选</span>
          <el-select v-model="filterStatus" placeholder="全部状态" style="width: 150px">
            <el-option label="全部" value="all" />
            <el-option label="待处理" value="open" />
            <el-option label="已确认" value="acknowledged" />
            <el-option label="已关闭" value="closed" />
          </el-select>
          <span>学院范围</span>
          <el-select v-model="selectedOrgId" placeholder="全校" clearable style="width: 180px">
            <el-option label="全校" value="" />
            <el-option
              v-for="org in orgOptions"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.id"
            />
          </el-select>
        </div>
      </div>
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="report-card" shadow="hover" @click="generateReport('daily')">
            <el-icon class="report-icon"><Document /></el-icon>
            <h4>日报表</h4>
            <p>导出当天的预警数据统计</p>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="report-card" shadow="hover" @click="generateReport('weekly')">
            <el-icon class="report-icon"><Document /></el-icon>
            <h4>周报表</h4>
            <p>导出一周的预警数据统计</p>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="report-card" shadow="hover" @click="generateReport('monthly')">
            <el-icon class="report-icon"><Document /></el-icon>
            <h4>月报表</h4>
            <p>导出一月的预警数据统计</p>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="report-card" shadow="hover" @click="generateReport('semester')">
            <el-icon class="report-icon"><Document /></el-icon>
            <h4>学期报表</h4>
            <p>导出整个学期的预警数据统计</p>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <el-card class="report-history">
      <div class="reports-section-heading">
        <div>
          <span class="reports-section-heading__title">导出历史</span>
          <p class="reports-section-heading__desc">生成完成后可直接下载，未完成的记录会保留在列表中继续追踪。</p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px">
          <el-button size="small" @click="loadHistory">刷新状态</el-button>
          <el-tag type="primary" effect="plain">共 {{ filteredHistoryCount }} 条</el-tag>
        </div>
      </div>
      <div class="table-shell">
      <el-table :data="filteredExportHistory" style="width: 100%">
        <el-table-column prop="reportType" label="报表类型" />
        <el-table-column prop="creatorName" label="创建人" min-width="190" show-overflow-tooltip>
          <template #default="scope">
            {{ scope.row.creatorName || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="date" label="导出时间" />
        <el-table-column prop="status" label="状态">
          <template #default="scope">
            <el-tooltip
              v-if="isReportFailed(scope.row.status) && scope.row.errorMsg"
              :content="scope.row.errorMsg"
              placement="top"
            >
              <el-tag type="danger">生成失败</el-tag>
            </el-tooltip>
            <el-tag
              v-else
              :type="isReportDone(scope.row.status) ? 'success' : (isReportFailed(scope.row.status) ? 'danger' : 'warning')"
            >
              {{ isReportDone(scope.row.status) ? '已完成' : (isReportFailed(scope.row.status) ? '生成失败' : '生成中') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作">
          <template #default="scope">
            <el-button 
              v-if="isReportDone(scope.row.status)" 
              size="small" 
              type="primary"
              @click="downloadReport(scope.row)"
            >
              下载
            </el-button>
            <el-button 
              v-else 
              size="small" 
              disabled
            >
              {{ isReportFailed(scope.row.status) ? '生成失败' : '生成中' }}
            </el-button>
            <el-button 
              size="small" 
              type="danger"
              @click="handleDelete(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue';
import { Document } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { 
  generateDailyReport, 
  generateWeeklyReport, 
  generateMonthlyReport, 
  generateSemesterReport, 
  getExportHistory, 
  downloadExportReport,
  deleteExportReport,
  listOrgs,
} from '../api';

const exportHistory = ref<any[]>([]);
const filterStatus = ref('all');
const selectedOrgId = ref('');
const orgOptions = ref<any[]>([]);

// 后端历史上出现过 completed / success 两种“已完成”口径，统一在前端收敛，
// 否则新生成的报表会一直显示“生成中”，下载按钮也不出现（文件其实已生成）。
const REPORT_DONE_STATUSES = ['completed', 'success'];
const isReportDone = (status: string) => REPORT_DONE_STATUSES.includes(String(status || ''));
const isReportFailed = (status: string) => String(status || '') === 'failed';

const filteredExportHistory = computed(() => {
  if (filterStatus.value === 'all') return exportHistory.value;

  return exportHistory.value.filter((item: any) => {
    if (filterStatus.value === 'closed') {
      return isReportDone(item.status);
    }
    if (filterStatus.value === 'open') {
      return !isReportDone(item.status);
    }
    if (filterStatus.value === 'acknowledged') {
      return isReportDone(item.status);
    }
    return true;
  });
});

const completedHistoryCount = computed(
  () => exportHistory.value.filter((item: any) => isReportDone(item.status)).length,
);

const pendingHistoryCount = computed(
  () => exportHistory.value.filter((item: any) => !isReportDone(item.status) && !isReportFailed(item.status)).length,
);

const filteredHistoryCount = computed(() => filteredExportHistory.value.length);

let pollTimer: number | null = null;

const stopPolling = () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};

const syncPolling = () => {
  if (pendingHistoryCount.value > 0) {
    if (pollTimer === null) {
      pollTimer = window.setInterval(() => {
        void loadHistory();
      }, 2000);
    }
  } else {
    stopPolling();
  }
};

const reportStatusLabel = computed(() => {
  const map: Record<string, string> = {
    all: '全部状态',
    open: '待处理',
    acknowledged: '已确认',
    closed: '已关闭',
  };

  return map[filterStatus.value] || '全部状态';
});

const loadHistory = async () => {
  try {
    const res = await getExportHistory();
    if (res && res.data) {
      exportHistory.value = (res.data.list || []).map((h: any) => ({
        ...h,
        // 如果后端返回的是短日期，这里可能需要处理，但 getExportHistory 已经处理了
      }));
      syncPolling();
    }
  } catch(e) {
    console.warn('Failed to load history', e);
  }
}

const handleDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定要删除这条报表记录吗？', '提示', {
      type: 'warning'
    });
    const res = await deleteExportReport(row.id);
    if (res && res.code === 0) {
      ElMessage.success('删除成功');
      loadHistory();
    } else {
      ElMessage.error(res?.message || '删除失败');
    }
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error('删除操作失败');
    }
  }
};

const loadOrgs = async () => {
  try {
    const res = await listOrgs();
    if (res && res.code === 0) {
      orgOptions.value = Array.isArray(res.data) ? res.data : [];
    }
  } catch (e) {
    console.warn('Failed to load orgs', e);
  }
}

onMounted(() => {
  loadHistory();
  loadOrgs();
})

onActivated(() => {
  loadHistory();
})

onDeactivated(() => {
  stopPolling();
})

onUnmounted(() => {
  stopPolling();
})

const generateReport = async (type: string) => {
  ElMessage.info(`正在生成${type === 'daily' ? '日' : type === 'weekly' ? '周' : type === 'monthly' ? '月' : '学期'}报表...`);
  try {
    let res;
    if (type === 'daily') res = await generateDailyReport(undefined, filterStatus.value, selectedOrgId.value || undefined);
    else if (type === 'weekly') res = await generateWeeklyReport(undefined, filterStatus.value, selectedOrgId.value || undefined);
    else if (type === 'monthly') res = await generateMonthlyReport(undefined, filterStatus.value, selectedOrgId.value || undefined);
    else if (type === 'semester') res = await generateSemesterReport(undefined, filterStatus.value, selectedOrgId.value || undefined);
    
    if(res && res.code === 0) {
      const done = isReportDone(res.data?.status);
      ElMessage.success(done ? '报表已生成，可直接下载！' : '导出任务已提交，正在后台生成...');
      await loadHistory();
      syncPolling();
    } else {
      ElMessage.error(res?.message || '报表生成失败');
    }
  } catch(e) {
    ElMessage.error('报表生成时发生错误');
  }
};

const downloadReport = async (row: any) => {
  ElMessage.info(`正在准备下载${row.reportType || '报表'}...`);
  try {
    const blob = await downloadExportReport(row.id);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 后端下发的是 xlsx（历史兜底分支才是 csv），按真实类型命名，避免被当成 CSV 打开
    const fileName = /\.(xlsx|csv)$/i.test(row.fileName || '')
      ? row.fileName
      : `${row.reportType || '报表'}-${Date.now()}.xlsx`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch(e) {
    // 针对被下载器拦截的情况优化提示
    console.warn('Download process info:', e);
    ElMessage({
      message: '下载失败，请稍后重试。',
      type: 'error',
      duration: 5000
    });
  }
};
</script>

<style scoped>
.reports-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.reports-hero {
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

.reports-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.reports-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.reports-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.reports-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.reports-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.reports-hero__meta strong {
  color: #173145;
  font-size: 20px;
  line-height: 1.2;
}

.reports-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.reports-overview__card {
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

.reports-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reports-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.reports-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.reports-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}

.reports-section-heading__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.reports-section-heading__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.reports-section-heading__filter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: #606266;
  font-size: 14px;
}

.report-card {
  text-align: center;
  cursor: pointer;
  transition: transform 0.3s;
}

.report-card:hover {
  transform: translateY(-5px);
}

.report-icon {
  font-size: 48px;
  color: #409eff;
  margin-bottom: 10px;
}

.report-card h4 {
  margin: 10px 0;
  color: #333;
}

.report-card p {
  color: #666;
  font-size: 14px;
}

@media (max-width: 1200px) {
  .reports-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .reports-hero {
    padding: 20px;
  }

  .reports-overview {
    grid-template-columns: 1fr;
  }

  .reports-section-heading__filter {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
