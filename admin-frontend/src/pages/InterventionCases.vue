<template>
  <div class="intervention-page">
    <section class="intervention-hero">
      <div class="intervention-hero__copy">
        <span class="intervention-hero__eyebrow">High Risk Desk</span>
        <h2 class="intervention-hero__title">高风险干预</h2>
        <p class="intervention-hero__desc">
          风险分 = 预警分（活跃预警按黄 10、橙 18、红 28、严重 40 累加，上限 60）
          + 行为分（近 7 天缺勤×4、迟到×2、早退×2，上限 25）
          + 趋势分（近 7 天异常较前 7 天明显上升加 8 或 15）
          + 持续分（周/月/学期等持续预警周期达到 2 个加 8、达到 4 个加 15），总分封顶 100；
          出现红色/严重预警或总分 ≥ 60 即纳入高风险干预。
        </p>
      </div>
      <div class="intervention-hero__actions">
        <div class="intervention-hero__meta">
          <span>当前工单</span>
          <strong>{{ total }}</strong>
          <small>已选中 {{ selectedIds.length }} 条</small>
        </div>
        <el-button @click="resetFilters">重置筛选</el-button>
        <el-button type="primary" @click="loadAll">刷新</el-button>
        <el-button
          type="danger"
          :disabled="selectedIds.length === 0"
          @click="batchDeleteCases"
        >
          批量删除{{ selectedIds.length ? `（${selectedIds.length}）` : '' }}
        </el-button>
      </div>
    </section>

    <el-row :gutter="16" class="summary-row">
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card">
          <div class="summary-label">工单总数</div>
          <div class="summary-value">{{ summary.total }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card danger">
          <div class="summary-label">待分配</div>
          <div class="summary-value">{{ summary.pendingAssignment }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card warning">
          <div class="summary-label">待干预</div>
          <div class="summary-value">{{ summary.pendingIntervention }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card info">
          <div class="summary-label">处理中</div>
          <div class="summary-value">{{ summary.inProgress }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card success">
          <div class="summary-label">平均风险分</div>
          <div class="summary-value">{{ summary.avgRiskScore }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="8" :md="4">
        <div class="summary-card dark">
          <div class="summary-label">最高风险分</div>
          <div class="summary-value">{{ summary.topRiskScore }}</div>
        </div>
      </el-col>
    </el-row>

    <el-card class="intervention-filter-card">
      <template #header>
        <div class="intervention-filter-card__header">
          <div>
            <span class="intervention-filter-card__title">筛选面板</span>
            <p class="intervention-filter-card__desc">按状态、学院、班级和关键词缩小工单范围。</p>
          </div>
          <el-tag type="primary" effect="plain">当前 {{ items.length }} 条</el-tag>
        </div>
      </template>

    <el-row :gutter="16" class="filters">
      <el-col :xs="24" :sm="12" :md="5">
        <div class="filter-item">
          <span class="filter-label">状态</span>
          <el-select v-model="query.status" clearable style="width: 100%" @change="handleFilterChange">
            <el-option label="全部" value="" />
            <el-option label="待分配" value="pending_assignment" />
            <el-option label="待干预" value="pending_intervention" />
            <el-option label="处理中" value="in_progress" />
            <el-option label="处理完成" value="completed" />
          </el-select>
        </div>
      </el-col>

      <el-col :xs="24" :sm="12" :md="5">
        <div class="filter-item">
          <span class="filter-label">学院</span>
          <el-select
            v-model="query.org_id"
            clearable
            filterable
            style="width: 100%"
            :disabled="isHeadTeacherView"
            @change="handleOrgChange"
          >
            <el-option label="全部学院" value="" />
            <el-option
              v-for="org in orgOptions"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.id"
            />
          </el-select>
        </div>
      </el-col>

      <el-col :xs="24" :sm="12" :md="5">
        <div class="filter-item">
          <span class="filter-label">班级</span>
          <el-select
            v-model="query.class_id"
            clearable
            filterable
            style="width: 100%"
            :disabled="isHeadTeacherView"
            @change="handleFilterChange"
          >
            <el-option label="全部班级" value="" />
            <el-option
              v-for="item in filteredClasses"
              :key="item.id"
              :label="item.class_name"
              :value="item.id"
            />
          </el-select>
        </div>
      </el-col>

      <el-col :xs="24" :sm="12" :md="6">
        <div class="filter-item">
          <span class="filter-label">搜索</span>
          <el-input
            v-model="query.keyword"
            placeholder="搜索学生姓名或学号"
            clearable
            @input="handleFilterChange"
          />
        </div>
      </el-col>

      <el-col :xs="24" :sm="12" :md="3">
        <div class="filter-item switch-item">
          <span class="filter-label">显示历史</span>
          <el-switch v-model="includeInactive" @change="loadAll" />
        </div>
      </el-col>
    </el-row>
    </el-card>

    <el-card class="intervention-table-card">
      <template #header>
        <div class="intervention-table-card__header">
          <div>
            <span class="intervention-table-card__title">干预工单列表</span>
            <p class="intervention-table-card__desc">桌面端支持一屏查看风险分、优先级、处理人和分数组成。</p>
          </div>
          <div class="intervention-table-card__meta">
            <el-tag type="warning" effect="plain">处理中 {{ summary.inProgress }}</el-tag>
            <el-tag type="info" effect="plain">可删除 {{ deletableCaseCount }}</el-tag>
          </div>
        </div>
      </template>

      <el-alert
        class="intervention-table-card__alert"
        type="info"
        :closable="false"
        show-icon
        title="说明：系统管理员和学工管理员可以分配待分配工单；班主任可以确认接手和提交完成；仅已完成或已解除的工单支持勾选删除。"
      />

      <div class="table-shell">
    <el-table
      v-loading="loading"
      :data="items"
      row-key="id"
      style="width: 100%"
      data-fixed-mode="left-only"
      @selection-change="handleSelectionChange"
    >
      <el-table-column
        v-if="canDeleteCases"
        type="selection"
        width="52"
        :selectable="isSelectableCase"
      />
      <el-table-column label="学生" min-width="180" fixed="left">
        <template #default="{ row }">
          <div class="student-cell">
            <div class="student-name">{{ row.student_name }}</div>
            <div class="student-meta">{{ row.student_no }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="org_name" label="学院" width="150" />
      <el-table-column prop="class_name" label="班级" width="180" />
      <el-table-column label="风险分" width="100">
        <template #default="{ row }">
          <span class="risk-score" :class="getRiskClass(row.risk_score)">{{ row.risk_score }}</span>
        </template>
      </el-table-column>
      <el-table-column label="优先级" width="120">
        <template #default="{ row }">
          <el-tag class="priority-tag" :type="getPriorityType(row.handling_priority)">
            {{ getPriorityText(row.handling_priority) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="活跃预警" width="100">
        <template #default="{ row }">
          {{ row.active_warning_count }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="getStatusTagType(row.status)">{{ getStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="处理人" width="120">
        <template #default="{ row }">
          {{ row.handler_name || '未分配' }}
        </template>
      </el-table-column>
      <el-table-column label="最新预警" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.latest_warning_at) }}
        </template>
      </el-table-column>
      <el-table-column label="分数构成" min-width="250">
        <template #default="{ row }">
          <div class="breakdown">
            <span>预警 {{ row.risk_breakdown.warning_score || 0 }}</span>
            <span>行为 {{ row.risk_breakdown.behavior_score || 0 }}</span>
            <span>趋势 {{ row.risk_breakdown.trend_score || 0 }}</span>
            <span>持续 {{ row.risk_breakdown.persistence_score || 0 }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="处理总结" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.completion_summary || '-' }}
        </template>
      </el-table-column>
      <el-table-column label="处理动作" width="196">
        <template #default="{ row }">
          <div class="action-group action-group--workflow">
            <el-button v-if="canAssign(row)" type="primary" link @click="assignCase(row)">分配</el-button>
            <el-button v-if="canAccept(row)" type="warning" link @click="acceptCase(row)">确认接手</el-button>
            <el-button v-if="canComplete(row)" type="success" link @click="openCompleteDialog(row)">提交完成</el-button>
            <div
              v-if="!canAssign(row) && !canAccept(row) && !canComplete(row) && getWorkflowHint(row)"
              class="action-status"
              :title="getWorkflowHint(row)"
            >
              {{ getWorkflowHint(row) }}
            </div>
            <span
              v-if="!canAssign(row) && !canAccept(row) && !canComplete(row) && !getWorkflowHint(row)"
              class="action-group__empty"
            >
              -
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="188">
        <template #default="{ row }">
          <div class="action-group action-group--fixed">
            <div
              v-if="row.handler_name"
              class="action-group__assignee"
              :title="`当前处理人：${row.handler_name}`"
            >
              当前处理人：{{ row.handler_name }}
            </div>
            <div class="action-group__buttons">
              <el-button link type="info" @click="openDetail(row)">详情</el-button>
              <el-button
                v-if="canDeleteCases"
                type="danger"
                link
                :title="getDeleteDisabledReason(row)"
                @click="deleteSingleCase(row)"
              >
                删除
              </el-button>
            </div>
          </div>
        </template>
      </el-table-column>
      </el-table>
      </div>

    <div class="pagination-row">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @size-change="loadCases"
        @current-change="loadCases"
      />
    </div>
    </el-card>

    <el-drawer v-model="detailVisible" title="干预工单详情" size="540px">
      <template v-if="currentDetail">
        <div class="detail-section">
          <div class="detail-title">基础信息</div>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="学生">{{ currentDetail.student_name }}</el-descriptions-item>
            <el-descriptions-item label="学号">{{ currentDetail.student_no }}</el-descriptions-item>
            <el-descriptions-item label="学院">{{ currentDetail.org_name }}</el-descriptions-item>
            <el-descriptions-item label="班级">{{ currentDetail.class_name }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ getStatusText(currentDetail.status) }}</el-descriptions-item>
            <el-descriptions-item label="处理人">{{ currentDetail.handler_name || '未分配' }}</el-descriptions-item>
            <el-descriptions-item label="风险分">{{ currentDetail.risk_score }}</el-descriptions-item>
            <el-descriptions-item label="活跃预警">{{ currentDetail.active_warning_count }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="detail-section">
          <div class="detail-title">风险构成</div>
          <el-progress :percentage="Number(currentDetail.risk_breakdown.warning_score || 0)" :stroke-width="12">
            <span>预警分</span>
          </el-progress>
          <el-progress :percentage="Number(currentDetail.risk_breakdown.behavior_score || 0)" :stroke-width="12" status="warning">
            <span>行为分</span>
          </el-progress>
          <el-progress :percentage="Number(currentDetail.risk_breakdown.trend_score || 0)" :stroke-width="12" color="#dc2626">
            <span>趋势分</span>
          </el-progress>
          <el-progress :percentage="Number(currentDetail.risk_breakdown.persistence_score || 0)" :stroke-width="12" color="#8b5cf6">
            <span>持续分</span>
          </el-progress>
        </div>

        <div class="detail-section">
          <div class="detail-title">时间线</div>
          <el-timeline>
            <el-timeline-item timestamp="创建时间">
              {{ formatDateTime(currentDetail.created_at) }}
            </el-timeline-item>
            <el-timeline-item v-if="currentDetail.assigned_at" timestamp="分配时间">
              {{ formatDateTime(currentDetail.assigned_at) }}
            </el-timeline-item>
            <el-timeline-item v-if="currentDetail.accepted_at" timestamp="接手时间">
              {{ formatDateTime(currentDetail.accepted_at) }}
            </el-timeline-item>
            <el-timeline-item v-if="currentDetail.completed_at" timestamp="完成时间">
              {{ formatDateTime(currentDetail.completed_at) }}
            </el-timeline-item>
            <el-timeline-item v-if="currentDetail.resolved_at" timestamp="解除时间">
              {{ formatDateTime(currentDetail.resolved_at) }}
            </el-timeline-item>
          </el-timeline>
        </div>

        <div class="detail-section">
          <div class="detail-title">工单备注</div>
          <div class="detail-block">
            <p><strong>处理总结：</strong>{{ currentDetail.completion_summary || '暂无' }}</p>
            <p><strong>详细说明：</strong>{{ currentDetail.completion_detail_json?.detail || '暂无' }}</p>
            <p><strong>预警来源：</strong>{{ formatSourceIds(currentDetail.source_warning_ids) }}</p>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-title">处理日志</div>
          <el-empty v-if="!currentLogs.length" description="暂无处理日志" />
          <el-timeline v-else>
            <el-timeline-item
              v-for="log in currentLogs"
              :key="log.id"
              :timestamp="formatDateTime(log.created_at)"
            >
              <div class="log-title">{{ log.action_label }} · {{ log.actor_name }}</div>
              <div class="log-note">{{ log.note || '无备注' }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="completeDialogVisible" title="提交干预完成" width="520px">
      <el-form label-width="90px">
        <el-form-item label="干预总结" required>
          <el-input v-model="completeForm.completion_summary" maxlength="255" show-word-limit />
        </el-form-item>
        <el-form-item label="过程说明">
          <el-input
            v-model="completeForm.completion_detail"
            type="textarea"
            :rows="5"
            placeholder="填写与学生沟通、约谈、帮扶措施等过程"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitComplete">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  acceptWarningCase,
  assignWarningCase,
  batchDeleteWarningCases,
  completeWarningCase,
  deleteWarningCase,
  getHeadTeacherBindingStatus,
  getWarningCaseDetail,
  getWarningCaseLogs,
  getWarningCasesSummary,
  listWarningCases,
  listClassesAdmin,
  listOrgs,
} from '../api';

const items = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const includeInactive = ref(true);
const currentRoles = ref<string[]>([]);
const currentUserId = ref('');
const completeDialogVisible = ref(false);
const detailVisible = ref(false);
const currentCaseId = ref('');
const currentDetail = ref<any | null>(null);
const currentLogs = ref<any[]>([]);
const orgOptions = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const selectedIds = ref<string[]>([]);
const fixedHeadTeacherOrgId = ref('');
const fixedHeadTeacherClassId = ref('');

const summary = reactive({
  total: 0,
  pendingAssignment: 0,
  pendingIntervention: 0,
  inProgress: 0,
  avgRiskScore: 0,
  topRiskScore: 0,
});

const completeForm = reactive({
  completion_summary: '',
  completion_detail: '',
});

const query = reactive({
  status: '',
  keyword: '',
  org_id: '',
  class_id: '',
  page: 1,
  pageSize: 10,
});

let queryTimer: ReturnType<typeof setTimeout> | null = null;

const filteredClasses = computed(() => {
  if (!query.org_id) {
    return classOptions.value;
  }
  return classOptions.value.filter((item) => String(item.org_id) === String(query.org_id));
});

const canDeleteCases = computed(
  () =>
    currentRoles.value.includes('sys_admin')
    || currentRoles.value.includes('student_admin')
    || currentRoles.value.includes('head_teacher'),
);

const deletableCaseCount = computed(() => items.value.filter((item: any) => isDeletableCase(item)).length);

const isHeadTeacherView = computed(
  () => currentRoles.value.includes('head_teacher') && !currentRoles.value.includes('sys_admin'),
);

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    pending_assignment: '待分配',
    pending_intervention: '待干预',
    in_progress: '处理中',
    completed: '处理完成',
    resolved: '已解除',
  };
  return map[status] || status || '-';
};

const getStatusTagType = (status: string) => {
  const map: Record<string, string> = {
    pending_assignment: 'danger',
    pending_intervention: 'warning',
    in_progress: 'info',
    completed: 'success',
    resolved: 'info',
  };
  return map[status] || 'info';
};

const getRiskClass = (score: number) => {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
};

const getPriorityType = (priority: number) => {
  if (priority >= 90) return 'danger';
  if (priority >= 70) return 'warning';
  if (priority >= 50) return 'primary';
  return 'info';
};

const getPriorityText = (priority: number) => {
  if (priority >= 90) return '紧急';
  if (priority >= 70) return '高';
  if (priority >= 50) return '中';
  return '低';
};

const formatDateTime = (value: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const formatSourceIds = (value: string[]) => {
  if (!Array.isArray(value) || value.length === 0) {
    return '暂无';
  }
  return value.join('、');
};

const isDeletableCase = (row: any) =>
  !row?.is_active && ['completed', 'resolved'].includes(String(row?.status || ''));

const isSelectableCase = (row: any) => canDeleteCases.value && isDeletableCase(row);

const getDeleteDisabledReason = (row: any) => {
  if (isDeletableCase(row)) {
    return '';
  }
  if (row?.is_active) {
    return '仅已完成或已解除的工单可删除';
  }
  return '当前状态暂不支持删除';
};

const handleSelectionChange = (rows: any[]) => {
  selectedIds.value = rows.map((row) => String(row.id));
};

const patchAcceptedCase = (caseId: string) => {
  const target = items.value.find((item: any) => String(item.id) === String(caseId));
  if (!target) {
    return;
  }

  target.status = 'in_progress';
  target.status_label = getStatusText('in_progress');
  target.status_tag_type = getStatusTagType('in_progress');
  target.handler_user_id = currentUserId.value || target.handler_user_id;
  target.accepted_at = new Date().toISOString();

  if (summary.pendingIntervention > 0) {
    summary.pendingIntervention -= 1;
  }
  summary.inProgress += 1;
};

const updateSummary = (data: any) => {
  summary.total = Number(data?.total || 0);
  summary.pendingAssignment = Number(data?.pendingAssignment || 0);
  summary.pendingIntervention = Number(data?.pendingIntervention || 0);
  summary.inProgress = Number(data?.inProgress || 0);
  summary.avgRiskScore = Number(data?.avgRiskScore || 0);
  summary.topRiskScore = Number(data?.topRiskScore || 0);
};

const clearCaseList = () => {
  items.value = [];
  total.value = 0;
  selectedIds.value = [];
};

const loadBaseOptions = async () => {
  if (isHeadTeacherView.value) {
    try {
      const response = await getHeadTeacherBindingStatus();
      if (response.code === 0 && Array.isArray(response.data?.bound_classes)) {
        const boundClasses = response.data.bound_classes || [];
        const boundOrgs = Array.isArray(response.data?.bound_orgs) ? response.data.bound_orgs : [];

        fixedHeadTeacherOrgId.value = boundOrgs.length === 1 ? String(boundOrgs[0]?.id || '') : '';
        fixedHeadTeacherClassId.value = '';

        query.org_id = fixedHeadTeacherOrgId.value;
        query.class_id = '';

        orgOptions.value = boundOrgs.map((item: any) => ({
          id: String(item.id || ''),
          org_name: item.name || '当前学院',
        }));
        classOptions.value = boundClasses.map((item: any) => ({
          id: String(item.id || ''),
          class_name: item.class_name || '当前班级',
          org_id: String(item.org_id || ''),
        }));
      }
    } catch (error) {
      console.error('加载班主任绑定范围失败:', error);
    }
    return;
  }

  const [orgResp, classResp] = await Promise.all([
    listOrgs(),
    listClassesAdmin({ pageSize: 1000 }),
  ]);

  if (orgResp.code === 0) {
    orgOptions.value = orgResp.data || [];
  }
  if (classResp.code === 0) {
    classOptions.value = classResp.data?.list || [];
  }
};

const loadCases = async () => {
  loading.value = true;
  try {
    const response = await listWarningCases({
      status: query.status || undefined,
      keyword: query.keyword || undefined,
      org_id: query.org_id || undefined,
      class_id: query.class_id || undefined,
      page: query.page,
      page_size: query.pageSize,
      include_inactive: includeInactive.value ? 1 : 0,
    });

    if (response.code === 0) {
      items.value = response.data.items || [];
      total.value = response.data.total || 0;
      selectedIds.value = [];
    } else {
      clearCaseList();
      ElMessage.error(response.message || '加载失败');
    }
  } catch (error: any) {
    clearCaseList();
    ElMessage.error(error?.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const loadSummary = async () => {
  try {
    const response = await getWarningCasesSummary({
      status: query.status || undefined,
      keyword: query.keyword || undefined,
      org_id: query.org_id || undefined,
      class_id: query.class_id || undefined,
      include_inactive: includeInactive.value ? 1 : 0,
    });
    if (response.code === 0) {
      updateSummary(response.data || {});
    } else {
      updateSummary({});
    }
  } catch {
    updateSummary({});
  }
};

const loadAll = async () => {
  await Promise.all([loadCases(), loadSummary()]);
};

const handleFilterChange = () => {
  query.page = 1;
  if (queryTimer) {
    clearTimeout(queryTimer);
  }
  queryTimer = setTimeout(() => {
    void loadAll();
  }, 250);
};

const handleOrgChange = () => {
  if (isHeadTeacherView.value) {
    query.org_id = fixedHeadTeacherOrgId.value;
    query.class_id = '';
    handleFilterChange();
    return;
  }

  if (
    query.class_id
    && !filteredClasses.value.some((item) => String(item.id) === String(query.class_id))
  ) {
    query.class_id = '';
  }
  handleFilterChange();
};

const resetFilters = async () => {
  query.status = '';
  query.keyword = '';
  query.org_id = isHeadTeacherView.value ? fixedHeadTeacherOrgId.value : '';
  query.class_id = '';
  query.page = 1;
  query.pageSize = 10;
  includeInactive.value = true;
  selectedIds.value = [];
  await loadAll();
};

const canAssign = (row: any) =>
  (currentRoles.value.includes('sys_admin') || currentRoles.value.includes('student_admin'))
  && row.status === 'pending_assignment';

const canAccept = (row: any) =>
  currentRoles.value.includes('head_teacher') && row.status === 'pending_intervention';

const canComplete = (row: any) =>
  currentRoles.value.includes('head_teacher')
  && row.status === 'in_progress'
  && row.handler_user_id
  && String(row.handler_user_id) === String(currentUserId.value);

const getWorkflowHint = (row: any) => {
  if (!row?.handler_name) {
    return '';
  }

  if (row.status === 'pending_intervention') {
    return `已分配给 ${row.handler_name}`;
  }

  if (row.status === 'in_progress') {
    return `${row.handler_name} 处理中`;
  }

  if (row.status === 'completed') {
    return `${row.handler_name} 已完成`;
  }

  if (row.status === 'resolved') {
    return `${row.handler_name} 已处理`;
  }

  return `处理人 ${row.handler_name}`;
};

const openDetail = async (row: any) => {
  detailVisible.value = true;
  currentDetail.value = row;
  currentLogs.value = [];
  try {
    const [detailResp, logsResp] = await Promise.all([
      getWarningCaseDetail(row.id),
      getWarningCaseLogs(row.id),
    ]);
    if (detailResp.code === 0) {
      currentDetail.value = detailResp.data;
    }
    if (logsResp.code === 0) {
      currentLogs.value = Array.isArray(logsResp.data) ? logsResp.data : [];
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载详情失败');
  }
};

const assignCase = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定将该工单分配给对应班主任吗？', '确认分配', {
      type: 'warning',
    });
    const response = await assignWarningCase(row.id);
    if (response.code === 0) {
      ElMessage.success('分配成功');
      await loadAll();
    } else {
      ElMessage.error(response.message || '分配失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '分配失败');
    }
  }
};

const acceptCase = async (row: any) => {
  try {
    const response = await acceptWarningCase(row.id);
    if (response.code === 0) {
      patchAcceptedCase(String(row.id));
      ElMessage.success('已确认接手');
    } else {
      ElMessage.error(response.message || '确认失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '确认失败');
  }
};

const openCompleteDialog = (row: any) => {
  currentCaseId.value = row.id;
  completeForm.completion_summary = row.completion_summary || '';
  completeForm.completion_detail = row.completion_detail_json?.detail || '';
  completeDialogVisible.value = true;
};

const submitComplete = async () => {
  if (!completeForm.completion_summary.trim()) {
    ElMessage.warning('请填写干预总结');
    return;
  }

  try {
    const response = await completeWarningCase(currentCaseId.value, {
      completion_summary: completeForm.completion_summary.trim(),
      completion_detail: completeForm.completion_detail.trim() || undefined,
    });

    if (response.code === 0) {
      completeDialogVisible.value = false;
      ElMessage.success('处理完成');
      await loadAll();
    } else {
      ElMessage.error(response.message || '提交失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '提交失败');
  }
};

const deleteSingleCase = async (row: any) => {
  if (!isDeletableCase(row)) {
    ElMessage.warning(getDeleteDisabledReason(row) || '当前工单暂不支持删除');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定删除 ${row.student_name} 的高风险干预记录吗？删除后会同步删除处理日志。`,
      '确认删除',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );

    const response = await deleteWarningCase(String(row.id));
    if (response.code === 0) {
      ElMessage.success(response.message || '删除成功');
      await loadAll();
    } else {
      ElMessage.error(response.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const batchDeleteCases = async () => {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要删除的高风险干预记录');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确定批量删除选中的 ${selectedIds.value.length} 条高风险干预记录吗？删除后会同步删除对应处理日志。`,
      '批量删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );

    const response = await batchDeleteWarningCases(selectedIds.value);
    if (response.code === 0) {
      const blockedCount = Number(response.data?.blocked?.length || 0);
      if (blockedCount > 0) {
        ElMessage.warning(response.message || '部分记录未删除');
      } else {
        ElMessage.success(response.message || '删除成功');
      }
      await loadAll();
    } else {
      ElMessage.error(response.message || '批量删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.message || '批量删除失败');
    }
  }
};

onMounted(async () => {
  try {
    const userInfo = localStorage.getItem('admin_user');
    if (userInfo) {
      const parsedUser = JSON.parse(userInfo);
      currentUserId.value = String(parsedUser.id || parsedUser.user_id || '');
    }

    const rolesFull = localStorage.getItem('admin_roles_full');
    if (rolesFull) {
      const parsedRoles = JSON.parse(rolesFull);
      currentRoles.value = parsedRoles.map((item: any) => item.role).filter(Boolean);
    } else {
      const roleCodes = localStorage.getItem('admin_roles');
      currentRoles.value = roleCodes ? JSON.parse(roleCodes) : [];
    }
  } catch {
    currentRoles.value = [];
  }

  await loadBaseOptions();
  await loadAll();
});

onBeforeUnmount(() => {
  if (queryTimer) {
    clearTimeout(queryTimer);
  }
});
</script>

<style scoped>
.intervention-page {
  --intervention-action-fixed-width: 188px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.intervention-hero {
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

.intervention-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 920px;
}

.intervention-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.intervention-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.intervention-hero__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #5d7283;
}

.intervention-hero__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.intervention-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.intervention-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.summary-row {
  margin-bottom: 18px;
}

.summary-card {
  padding: 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #f8fafc, #eef2ff);
  border: 1px solid #e5e7eb;
}

.summary-card.danger {
  background: linear-gradient(135deg, #fff1f2, #ffe4e6);
}

.summary-card.warning {
  background: linear-gradient(135deg, #fff7ed, #ffedd5);
}

.summary-card.info {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
}

.summary-card.success {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
}

.summary-card.dark {
  background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
}

.summary-label {
  color: #6b7280;
  font-size: 13px;
}

.summary-value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 700;
  color: #111827;
}

.intervention-filter-card,
.intervention-table-card {
  overflow: hidden;
}

.intervention-filter-card__header,
.intervention-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.intervention-filter-card__title,
.intervention-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.intervention-filter-card__desc,
.intervention-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.intervention-table-card__meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.intervention-table-card__alert {
  margin-bottom: 16px;
}

.filters {
  margin-bottom: 16px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.switch-item {
  margin-top: 24px;
}

.filter-label {
  font-size: 13px;
  color: #606266;
}

.student-cell {
  display: flex;
  flex-direction: column;
}

.student-name {
  font-weight: 600;
  color: #111827;
}

.student-meta {
  margin-top: 2px;
  font-size: 12px;
  color: #6b7280;
}

.risk-score {
  font-weight: 700;
}

.risk-score.critical {
  color: #b91c1c;
}

.risk-score.high {
  color: #dc2626;
}

.risk-score.medium {
  color: #d97706;
}

.risk-score.low {
  color: #16a34a;
}

.priority-tag {
  min-width: 56px;
  justify-content: center;
  white-space: nowrap;
}

.breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #606266;
  font-size: 12px;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.action-group--workflow {
  flex-wrap: wrap;
}

.action-group--fixed {
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  text-align: right;
}

.action-group__buttons {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  width: 100%;
  gap: 8px;
}

.action-group--fixed .el-button,
.action-group--workflow .el-button {
  margin-left: 0 !important;
  opacity: 1 !important;
  filter: none !important;
}

.action-group__empty {
  color: #94a3b8;
  font-size: 12px;
}

.action-group__assignee,
.action-status {
  width: 100%;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-shell :deep(.el-table__header-wrapper tr th.el-table-fixed-column--left),
.table-shell :deep(.el-table__header-wrapper tr th.el-table-fixed-column--right),
.table-shell :deep(.el-table__body-wrapper tr td.el-table-fixed-column--left),
.table-shell :deep(.el-table__body-wrapper tr td.el-table-fixed-column--right),
.table-shell :deep(.el-table__footer-wrapper tr td.el-table-fixed-column--left),
.table-shell :deep(.el-table__footer-wrapper tr td.el-table-fixed-column--right),
.table-shell :deep(.el-table__body-wrapper tr td.el-table__fixed-right-patch),
.table-shell :deep(.el-table__header-wrapper tr th.el-table__fixed-right-patch) {
  background: #f8fbfc !important;
  background-color: #f8fbfc !important;
  background-image: none !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.table-shell :deep(.el-table__body tr.hover-row > td.el-table-fixed-column--left),
.table-shell :deep(.el-table__body tr.hover-row > td.el-table-fixed-column--right),
.table-shell :deep(.el-table__body tr.el-table__row--striped td.el-table-fixed-column--left),
.table-shell :deep(.el-table__body tr.el-table__row--striped td.el-table-fixed-column--right),
.table-shell :deep(.el-table__body tr.current-row > td.el-table-fixed-column--left),
.table-shell :deep(.el-table__body tr.current-row > td.el-table-fixed-column--right) {
  background: #f8fbfc !important;
  background-color: #f8fbfc !important;
  background-image: none !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.table-shell :deep(.el-table-fixed-column--left .cell),
.table-shell :deep(.el-table-fixed-column--right .cell) {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  opacity: 1 !important;
}

.table-shell :deep(.el-table__fixed-right),
.table-shell :deep(.el-table__fixed-right-patch),
.table-shell :deep(.el-table__fixed-right::before),
.table-shell :deep(.el-table__fixed-right::after) {
  background: #f8fbfc !important;
  background-color: #f8fbfc !important;
  background-image: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.table-shell :deep(.el-table__fixed-right) {
  width: var(--intervention-action-fixed-width) !important;
  min-width: var(--intervention-action-fixed-width) !important;
  max-width: var(--intervention-action-fixed-width) !important;
  position: absolute !important;
  right: 0 !important;
  top: 0 !important;
  z-index: 30 !important;
  overflow: hidden !important;
  border-left: 1px solid rgba(148, 163, 184, 0.22);
}

.table-shell :deep(.el-table__fixed-right .el-table__fixed-header-wrapper),
.table-shell :deep(.el-table__fixed-right .el-table__fixed-body-wrapper),
.table-shell :deep(.el-table__fixed-right table) {
  width: var(--intervention-action-fixed-width) !important;
  min-width: var(--intervention-action-fixed-width) !important;
  max-width: var(--intervention-action-fixed-width) !important;
}

.table-shell :deep(.el-table__fixed-right .el-table__fixed-header-wrapper),
.table-shell :deep(.el-table__fixed-right .el-table__header-wrapper) {
  position: relative !important;
  z-index: 31 !important;
  overflow: hidden !important;
  background: #f8fbfc !important;
}

.table-shell :deep(.el-table__fixed-right .el-table__fixed-header-wrapper::before),
.table-shell :deep(.el-table__fixed-right .el-table__header-wrapper::before) {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: #f8fbfc !important;
  pointer-events: none;
}

.table-shell :deep(.el-table__fixed-right .el-table__fixed-header-wrapper table),
.table-shell :deep(.el-table__fixed-right .el-table__header-wrapper table) {
  position: relative;
  z-index: 1;
}

.table-shell :deep(.el-table__fixed-right-patch) {
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  display: none !important;
}

.table-shell :deep(.el-table__header-wrapper tr th.el-table-fixed-column--right),
.table-shell :deep(.el-table__body-wrapper tr td.el-table-fixed-column--right) {
  width: var(--intervention-action-fixed-width) !important;
  min-width: var(--intervention-action-fixed-width) !important;
  max-width: var(--intervention-action-fixed-width) !important;
  box-sizing: border-box;
  padding-left: 12px !important;
  padding-right: 12px !important;
}

.table-shell :deep(.el-table__header-wrapper tr th.el-table-fixed-column--right .cell) {
  position: relative;
  z-index: 2;
  justify-content: flex-end;
  text-align: right;
}

.table-shell :deep(.el-table__body-wrapper tr td.el-table-fixed-column--right .cell) {
  justify-content: flex-end;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-section + .detail-section {
  margin-top: 20px;
}

.detail-title {
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 700;
  color: #111827;
}

.detail-block {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  color: #374151;
  line-height: 1.7;
}

.log-title {
  font-weight: 600;
  color: #111827;
}

.log-note {
  margin-top: 4px;
  color: #6b7280;
  line-height: 1.6;
}

@media (max-width: 768px) {
  .intervention-hero {
    padding: 20px;
  }

  .intervention-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .intervention-hero__actions > * {
    width: 100%;
  }
}
</style>
