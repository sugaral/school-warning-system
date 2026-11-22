<template>
  <div class="warnings-page">
    <section class="warnings-hero">
      <div class="warnings-hero__copy">
        <span class="warnings-hero__eyebrow">Class Warning Desk</span>
        <h2 class="warnings-hero__title">班级预警中心</h2>
        <p class="warnings-hero__desc">
          先按班级定位学生，再在下方查看学生画像、当前预警、最高级别、最近预警时间，以及按课程聚合的预警明细。
        </p>
      </div>
      <div class="warnings-hero__actions">
        <div class="warnings-hero__meta">
          <span>当前范围</span>
          <strong>{{ scopeLabel }}</strong>
          <small>已选班级 {{ selectedClassName || '未选择' }}</small>
          <small>上次更新：{{ lastUpdatedText }}</small>
        </div>
        <el-button type="primary" size="small" :loading="loadingStudents" @click="refreshStudents">刷新学生列表</el-button>
        <el-button size="small" @click="reset">重置</el-button>
        <el-button
          v-if="canDeleteWarnings"
          type="warning"
          size="small"
          @click="onClearAllWarnings"
        >
          一键删除所有预警
        </el-button>
      </div>
    </section>

    <el-card class="warnings-filter-card">
      <template #header>
        <div class="warnings-filter-card__header">
          <div>
            <span class="warnings-filter-card__title">筛选条件</span>
            <p class="warnings-filter-card__desc">按学院、专业、班级和学生关键字查询，再从上方学生花名册选择学生进入详情。</p>
          </div>
          <div class="filter-summary-pills">
            <span class="filter-crumb">学院：<b>{{ selectedOrgName || '全部学院' }}</b></span>
            <span class="filter-crumb">专业：<b>{{ query.major || '全部专业' }}</b></span>
            <span class="filter-crumb">班级：<b>{{ selectedClassName || '未选班级' }}</b></span>
            <el-tag type="primary" effect="plain" size="small">
              已加载 {{ students.length }} 人{{ studentsHasMore ? '+' : '' }}
            </el-tag>
          </div>
        </div>
      </template>

      <el-row :gutter="16" class="filter-row">
        <el-col :xs="24" :sm="12" :md="8" :lg="5">
          <div class="filter-item">
            <span class="filter-label">学院</span>
            <el-select
              v-model="query.orgId"
              placeholder="请选择学院"
              clearable
              style="width: 100%"
              :disabled="isHeadTeacherView"
              @change="onOrgChange"
            >
              <el-option
                v-for="org in displayedOrgList"
                :key="org.id"
                :label="org.org_name || org.name"
                :value="org.id"
              />
            </el-select>
          </div>
        </el-col>

        <el-col :xs="24" :sm="12" :md="8" :lg="5">
          <div class="filter-item">
            <span class="filter-label">专业</span>
            <el-select
              v-model="query.major"
              placeholder="请选择专业"
              clearable
              style="width: 100%"
              :disabled="!query.orgId"
              @change="onMajorChange"
            >
              <el-option v-for="major in majorList" :key="major" :label="major" :value="major" />
            </el-select>
          </div>
        </el-col>

        <el-col :xs="24" :sm="12" :md="8" :lg="5">
          <div class="filter-item">
            <span class="filter-label">班级</span>
            <el-select
              v-model="query.classId"
              placeholder="请选择班级"
              clearable
              style="width: 100%"
              :disabled="!query.orgId && !filteredClasses.length"
              @change="onClassChange"
            >
              <el-option
                v-for="classItem in filteredClasses"
                :key="classItem.id"
                :label="classItem.class_name"
                :value="classItem.id"
              />
            </el-select>
          </div>
        </el-col>

        <el-col :xs="24" :sm="12" :md="8" :lg="5">
          <div class="filter-item">
            <span class="filter-label">学生搜索</span>
            <el-input
              v-model="query.keyword"
              placeholder="姓名 / 学号 / 专业"
              clearable
              @keyup.enter="refreshStudents"
              @clear="refreshStudents"
            />
          </div>
        </el-col>

        <el-col :xs="24" :sm="12" :md="8" :lg="4">
          <div class="filter-item filter-item--actions">
            <span class="filter-label">执行</span>
            <el-button type="primary" :loading="loadingStudents" @click="refreshStudents">查询班级预警</el-button>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <section class="warnings-layout">
      <el-card class="warnings-student-card">
        <template #header>
          <div class="panel-header panel-header--compact">
            <div>
              <span class="panel-title">学生花名册</span>
              <p class="panel-desc">按学号紧凑网格排列，点击任意学生卡片查看下方详情。</p>
            </div>
            <div class="panel-header__right">
              <el-radio-group v-model="studentListFilter" size="small">
                <el-radio-button label="all">全部 ({{ students.length }})</el-radio-button>
                <el-radio-button label="warned">仅看有预警 ({{ warnedStudentCount }})</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </template>

        <el-empty
          v-if="!query.classId && !students.length && !loadingStudents"
          description="请先选择班级后查询"
        />

        <el-skeleton v-else-if="loadingStudents" :rows="4" animated />

        <el-empty
          v-else-if="displayedStudents.length === 0"
          description="当前筛选条件下暂无符合的学生"
        />

        <div v-else>
          <div class="student-list">
            <button
              v-for="student in displayedStudents"
              :key="student.id"
              type="button"
              class="student-list__item"
              :class="{
                'student-list__item--active': selectedStudentId === student.id,
                'student-list__item--warned': (student.warning_count || 0) > 0,
              }"
              @click="selectStudent(student.id)"
            >
              <div class="student-list__main">
                <span
                  class="student-list__avatar"
                  :class="{ 'student-list__avatar--warned': (student.warning_count || 0) > 0 }"
                >
                  {{ (student.student_name || '学').slice(0, 1) }}
                </span>
                <div class="student-list__identity">
                  <div class="student-list__name">{{ student.student_name }}</div>
                  <div class="student-list__meta">{{ student.student_no }}</div>
                </div>
                <el-tag
                  v-if="(student.warning_count || 0) > 0 && student.highest_level"
                  :color="getWarningLevelColor(student.highest_level)"
                  effect="dark"
                  style="border: none; flex-shrink: 0"
                  size="small"
                >
                  {{ getWarningLevelText(student.highest_level) }}
                </el-tag>
                <span v-else class="student-list__level student-list__level--normal">正常</span>
              </div>
              <div class="student-list__stats">
                <span v-if="(student.occurrence_total || 0) > 0" class="student-list__occurrence">
                  异常 {{ student.occurrence_total }} 次课
                </span>
                <span v-else-if="(student.warning_count || 0) > 0">预警 {{ student.warning_count }} 项</span>
                <span v-else>无异常</span>
                <span v-if="student.processing_status === 'processing'">完善中</span>
                <span v-else-if="student.processing_status === 'failed'" style="color: #dc2626;">同步失败</span>
                <span v-else>{{ formatCompactTime(student.last_warning_at) }}</span>
              </div>
            </button>
          </div>
          <div v-if="studentsHasMore" class="student-list__load-more">
            <el-button size="small" :loading="loadingMoreStudents" @click="loadMoreStudents">加载更多学生</el-button>
          </div>
        </div>
      </el-card>

      <el-card class="warnings-detail-card">
        <template #header>
          <div class="panel-header panel-header--compact">
            <div>
              <span class="panel-title">学生预警详情</span>
              <p class="panel-desc">仅展示聚合后的课程预警记录，支持按周期切换核查。</p>
            </div>
            <el-segmented
              v-model="detailView"
              :options="detailViewOptions"
              @change="loadStudentDetail"
            />
          </div>
        </template>

        <el-empty
          v-if="!selectedStudentId && !detailLoading"
          description="请选择上方学生查看详情"
        />

        <el-skeleton v-else-if="detailLoading" :rows="10" animated />

        <div v-else-if="studentDetail" class="student-detail">
          <section class="student-overview-bar">
            <div class="student-overview-bar__left">
              <div class="student-overview-bar__title">
                <span class="student-profile__name">{{ studentDetail.student.student_name }}</span>
                <el-tag
                  v-if="(studentDetail.summary.warning_count || 0) > 0 && studentDetail.summary.highest_level"
                  :color="getWarningLevelColor(studentDetail.summary.highest_level)"
                  effect="dark"
                  style="border: none"
                  size="small"
                >
                  {{ getWarningLevelText(studentDetail.summary.highest_level) }}
                </el-tag>
                <span v-else class="student-list__level student-list__level--normal">正常</span>
              </div>
              <div class="student-overview-bar__meta">
                <span>学号 {{ studentDetail.student.student_no }}</span>
                <span>性别 {{ formatGender(studentDetail.student.gender) }}</span>
                <span>专业 {{ studentDetail.student.major || '未填写' }}</span>
                <span>{{ studentDetail.student.org_name }}</span>
              </div>
            </div>

            <div class="student-overview-bar__kpis">
              <div class="mini-kpi">
                <span>当前预警</span>
                <strong>{{ studentDetail.summary.warning_count || 0 }}</strong>
                <em v-if="(studentDetail.summary.occurrence_total || 0) > 0" class="mini-kpi__hint">
                  异常 {{ studentDetail.summary.occurrence_total }} 次课
                </em>
              </div>
              <div class="mini-kpi">
                <span>最高级别</span>
                <strong>{{ studentDetail.summary.highest_level ? getWarningLevelText(studentDetail.summary.highest_level) : '正常' }}</strong>
              </div>
              <div class="mini-kpi">
                <span>最近预警</span>
                <strong>{{ formatCompactTime(studentDetail.summary.last_warning_at) }}</strong>
              </div>
              <div class="mini-kpi">
                <span>预警课程</span>
                <strong>{{ countWarningCourses(studentDetail.course_groups) }} 门</strong>
              </div>
            </div>
          </section>

          <section class="detail-toolbar">
            <div>
              <span class="panel-title panel-title--small">{{ studentDetail.view_label }}</span>
              <span v-if="studentDetail.warning_items_truncated" class="detail-toolbar__hint">
                （仅展示最近 {{ studentDetail.warning_items_limit }} 条预警）
              </span>
            </div>
            <el-tag type="primary" effect="plain" size="small">课程 {{ studentDetail.course_groups.length }} 门</el-tag>
          </section>

          <el-empty
            v-if="studentDetail.course_groups.length === 0"
            description="当前视图下暂无预警课程明细"
          />

          <div v-else class="course-groups">
            <el-card
              v-for="courseGroup in studentDetail.course_groups"
              :key="`${studentDetail.student.id}_${courseGroup.course_id || 'none'}`"
              class="course-group-card"
              shadow="never"
            >
              <template #header>
                <div class="course-group-card__header">
                  <div>
                    <span class="course-group-card__title">{{ courseGroup.course_name }}</span>
                    <p class="course-group-card__meta">
                      预警 {{ courseGroup.warning_count }} 组
                      <template v-if="(courseGroup.occurrence_count || 0) > 0">
                        / 本周期异常 <b>{{ courseGroup.occurrence_count }}</b> 次课
                      </template>
                      <template v-else>
                        / 累计次数 {{ courseGroup.warning_total_count || 0 }} 次
                      </template>
                    </p>
                  </div>
                  <el-tag
                    v-if="(courseGroup.warning_count || 0) > 0 && courseGroup.highest_level"
                    :color="getWarningLevelColor(courseGroup.highest_level)"
                    effect="dark"
                    style="border: none"
                    size="small"
                  >
                    {{ getWarningLevelText(courseGroup.highest_level) }}
                  </el-tag>
                </div>
              </template>

              <div v-if="courseGroup.warning_items.length > 0" class="course-group-block">
                <el-table :data="courseGroup.warning_items" size="small" border>
                  <el-table-column label="级别" width="132" align="center">
                    <template #default="{ row }">
                      <el-tag
                        :color="getWarningLevelColor(row.level)"
                        effect="dark"
                        class="warning-level-badge"
                        style="border: none"
                      >
                        {{ row.level_text }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="指标" width="92" align="center">
                    <template #default="{ row }">
                      {{ row.metric_text }}
                    </template>
                  </el-table-column>
                  <el-table-column label="时间窗" width="92" align="center">
                    <template #default="{ row }">
                      {{ row.window_text }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="violation_count" label="次数" width="70" align="center" />
                  <el-table-column label="触发原因" min-width="280" show-overflow-tooltip>
                    <template #default="{ row }">
                      {{ formatWarningSummary(row) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="状态" width="124" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getStatusTagType(row.status)" size="small">
                        {{ row.status_text }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="预警时间" min-width="176">
                    <template #default="{ row }">
                      {{ formatDateTime(row.created_at) }}
                    </template>
                  </el-table-column>
                  <el-table-column label="相关信息同步" width="104" align="center">
                    <template #default="{ row }">
                      <span v-if="row.processing_status === 'processing'" class="sync-status-text">{{ buildProcessingText(courseGroup, row) }}</span>
                      <span v-else-if="row.processing_status === 'failed'" class="sync-status-text sync-status-text--error">{{ row.processing_text || '失败' }}</span>
                      <span v-else class="sync-status-text">已完成</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="140" align="center" fixed="right">
                    <template #default="{ row }">
                      <div class="row-actions">
                        <el-button v-if="row.status === 'open'" type="primary" size="small" @click="onAck(row)">
                          确认
                        </el-button>
                        <el-button
                          v-if="canDeleteWarnings"
                          type="danger"
                          size="small"
                          @click="onDelete(row)"
                        >
                          删除
                        </el-button>
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

            </el-card>
          </div>
        </div>
      </el-card>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { takePreloadedValue } from '../preload-cache';
import {
  clearWarningStudentDetailCache,
  clearWarningStudentsCache,
  clearWarningsPageCache,
  getCachedWarningStudentDetail,
  getCachedWarningStudents,
  setCachedWarningStudentDetail,
  setCachedWarningStudents,
} from '../warnings-page-cache';
import {
  ackWarning,
  clearWarnings,
  deleteWarning,
  getWarningClassViewStudentDetail,
  getWarningClassViewStudents,
  listClasses,
  listOrgs,
} from '../api';
import { getWarningLevelColor, getWarningLevelText } from '../lib/warning-level';
import { formatDateTime } from '../lib/format';

const STUDENTS_PAGE_SIZE = 500;

const orgList = ref<any[]>([]);
const classList = ref<any[]>([]);
const majorList = ref<string[]>([]);
const students = ref<any[]>([]);
const studentTotal = ref(0);
const studentsPage = ref(1);
const studentsHasMore = ref(false);
const loadingMoreStudents = ref(false);
const studentDetail = ref<any | null>(null);
const selectedStudentId = ref('');
const selectedClassName = ref('');
const weekLabel = ref('第1周');
const loadingStudents = ref(false);
const detailLoading = ref(false);
const lastUpdatedAt = ref<Date | null>(null);
const currentRoles = ref<string[]>([]);
const lockedHeadTeacherOrgId = ref('');
const studentListFilter = ref<'all' | 'warned'>('all');

const warnedStudentCount = computed(
  () => students.value.filter((item) => (item.warning_count || 0) > 0).length,
);

const displayedStudents = computed(() => {
  if (studentListFilter.value === 'warned') {
    return students.value.filter((item) => (item.warning_count || 0) > 0);
  }
  return students.value;
});

const query = reactive({
  scope: 'all',
  orgId: '',
  major: '',
  classId: '',
  keyword: '',
});

const detailView = ref('all');
const detailViewOptions = [
  { label: '今日预警', value: 'day' },
  { label: '本周累计', value: 'week' },
  { label: '本月累计', value: 'month' },
  { label: '全部预警', value: 'all' },
];

let studentsRequestSeq = 0;
let detailRequestSeq = 0;
let detailRequestKey = '';

const buildDetailRequestKey = (studentId: string, scope = query.scope, view = detailView.value) =>
  `${String(studentId || '')}::${scope}::${view}`;

const buildStudentsRequestKey = (page = studentsPage.value) =>
  [
    query.orgId || '',
    query.classId || '',
    query.scope || 'all',
    (query.keyword || '').trim().toLowerCase(),
    page,
    STUDENTS_PAGE_SIZE,
  ].join('::');

const canDeleteWarnings = computed(() =>
  currentRoles.value.some((role) => ['sys_admin', 'student_admin', 'head_teacher'].includes(role)),
);
const isHeadTeacherView = computed(
  () =>
    currentRoles.value.includes('head_teacher') &&
    !currentRoles.value.some((role) =>
      ['sys_admin', 'student_admin', 'teaching_admin', 'dean', 'vice_dean'].includes(role),
    ),
);

const displayedOrgList = computed(() => {
  if (!isHeadTeacherView.value || !lockedHeadTeacherOrgId.value) {
    return orgList.value;
  }
  return orgList.value.filter((org) => String(org.id) === String(lockedHeadTeacherOrgId.value));
});

const filteredClasses = computed(() => {
  if (!query.major) {
    return classList.value;
  }
  return classList.value.filter((item) => item.major === query.major);
});

const scopeLabel = computed(() => {
  const map: Record<string, string> = {
    active: '当前预警',
    history: '历史预警',
    all: '全部预警',
  };
  return map[query.scope] || '班级预警';
});

const selectedOrgName = computed(() => {
  if (!query.orgId) {
    return '';
  }
  const found = orgList.value.find((org) => String(org.id) === String(query.orgId));
  return found ? String(found.org_name || found.name || '') : '';
});

const lastUpdatedText = computed(() => {
  if (!lastUpdatedAt.value) {
    return '尚未查询';
  }
  return formatDateTime(lastUpdatedAt.value);
});

const resetStudentsPaging = () => {
  studentsPage.value = 1;
  studentTotal.value = 0;
  studentsHasMore.value = false;
};

const applyStudentsResponse = (data: any, options?: { append?: boolean }) => {
  const incomingStudents = Array.isArray(data?.students) ? data.students : [];
  students.value = options?.append ? [...students.value, ...incomingStudents] : incomingStudents;
  studentTotal.value = Number(data?.total || students.value.length || 0);
  studentsHasMore.value = Boolean(data?.has_more);
  selectedClassName.value = data?.class_name || selectedClassName.value || '';
  weekLabel.value = data?.week_label || weekLabel.value;
};

const removeWarningFromCurrentDetail = (warningId: string) => {
  if (!studentDetail.value?.course_groups) {
    return;
  }

  let removed = false;
  studentDetail.value.course_groups = studentDetail.value.course_groups
    .map((group: any) => {
      const warningItems = Array.isArray(group.warning_items) ? group.warning_items : [];
      const nextItems = warningItems.filter((item: any) => String(item.id) !== String(warningId));
      if (nextItems.length !== warningItems.length) {
        removed = true;
      }
      return {
        ...group,
        warning_items: nextItems,
        warning_count: Math.max(0, Number(group.warning_count || 0) - (warningItems.length - nextItems.length)),
      };
    })
    .filter((group: any) => Number(group.warning_count || 0) > 0 || (group.warning_items || []).length > 0);

  if (removed && studentDetail.value?.summary) {
    studentDetail.value.summary.warning_count = Math.max(0, Number(studentDetail.value.summary.warning_count || 0) - 1);
  }
};

const clearCurrentWarningCaches = () => {
  clearWarningStudentsCache();
  if (selectedStudentId.value) {
    clearWarningStudentDetailCache(buildDetailRequestKey(selectedStudentId.value));
  }
};



const loadCurrentRoles = () => {
  try {
    const rolesFullRaw = localStorage.getItem('admin_roles_full');
    if (rolesFullRaw) {
      const rolesFull = JSON.parse(rolesFullRaw);
      if (Array.isArray(rolesFull)) {
        currentRoles.value = rolesFull
          .map((item: any) => String(item?.role || ''))
          .filter(Boolean);
        return;
      }
    }

    const rolesRaw = localStorage.getItem('admin_roles');
    currentRoles.value = rolesRaw ? JSON.parse(rolesRaw) : [];
  } catch {
    currentRoles.value = [];
  }
};

const syncHeadTeacherOrgLock = () => {
  if (!isHeadTeacherView.value) {
    lockedHeadTeacherOrgId.value = '';
    return;
  }

  const accessibleOrgIds = Array.from(
    new Set(
      classList.value
        .map((item: any) => String(item.org_id || '').trim())
        .filter(Boolean),
    ),
  );

  lockedHeadTeacherOrgId.value = accessibleOrgIds[0] || '';
  if (lockedHeadTeacherOrgId.value) {
    query.orgId = lockedHeadTeacherOrgId.value;
  }
};

const loadOrgs = async () => {
  const preloadedOrgs = takePreloadedValue('orgs');
  if (Array.isArray(preloadedOrgs) && preloadedOrgs.length > 0) {
    orgList.value = preloadedOrgs;
    return;
  }

  const response = await listOrgs();
  if (response.code === 0) {
    orgList.value = response.data || [];
  }
};

const loadClasses = async () => {
  const preloadedClasses = takePreloadedValue('classes');
  if ((!query.orgId || query.orgId === '') && Array.isArray(preloadedClasses) && preloadedClasses.length > 0) {
    classList.value = preloadedClasses;
    majorList.value = [...new Set((preloadedClasses || []).map((item: any) => item.major).filter(Boolean))];
    syncHeadTeacherOrgLock();
    return;
  }

  const params: Record<string, any> = {};
  if (query.orgId) {
    params.org_id = query.orgId;
  }

  const response = await listClasses(params);
  if (response.code === 0) {
    classList.value = response.data || [];
    majorList.value = [...new Set((response.data || []).map((item: any) => item.major).filter(Boolean))];
    syncHeadTeacherOrgLock();
  } else {
    classList.value = [];
    majorList.value = [];
  }
};

const loadStudents = async (options?: { loadDetail?: boolean; silent?: boolean; force?: boolean; append?: boolean }) => {
  const append = Boolean(options?.append);
  const targetPage = append ? studentsPage.value + 1 : 1;
  if (!append) {
    resetStudentsPaging();
  }

  const studentsCacheKey = buildStudentsRequestKey(targetPage);
  const cachedStudents = !options?.force ? getCachedWarningStudents(studentsCacheKey) : null;
  if (cachedStudents && !options?.silent) {
    const previousSelectedStudentId = String(selectedStudentId.value || '');
    applyStudentsResponse(cachedStudents, { append });
    studentsPage.value = targetPage;
    const nextStudentId =
      students.value.find((item: any) => String(item.id) === previousSelectedStudentId)?.id ||
      students.value[0]?.id ||
      '';
    selectedStudentId.value = String(nextStudentId || '');
    lastUpdatedAt.value = new Date();
    if (!selectedStudentId.value) {
      studentDetail.value = null;
      detailRequestKey = '';
    }
    if (!append && options?.loadDetail !== false && selectedStudentId.value) {
      void loadStudentDetail({
        silent: true,
        studentId: selectedStudentId.value,
      });
    }
    return;
  }

  const requestSeq = ++studentsRequestSeq;
  const silent = Boolean(options?.silent) && students.value.length > 0;
  if (append) {
    loadingMoreStudents.value = true;
  } else if (!silent) {
    loadingStudents.value = true;
  }

  let shouldForceDetailReload = false;
  try {
    const response = await getWarningClassViewStudents({
      org_id: query.orgId || undefined,
      class_id: query.classId || undefined,
      scope: query.scope,
      keyword: query.keyword || undefined,
      page: targetPage,
      page_size: STUDENTS_PAGE_SIZE,
    });
    if (requestSeq !== studentsRequestSeq) {
      return;
    }

    if (response.code === 0) {
      setCachedWarningStudents(studentsCacheKey, response.data);
      const previousSelectedStudentId = String(selectedStudentId.value || '');
      applyStudentsResponse(response.data, { append });
      studentsPage.value = targetPage;
      const nextStudentId =
        students.value.find((item: any) => String(item.id) === previousSelectedStudentId)?.id ||
        students.value[0]?.id ||
        '';
      selectedStudentId.value = String(nextStudentId || '');
      lastUpdatedAt.value = new Date();
      if (!selectedStudentId.value) {
        studentDetail.value = null;
        detailRequestKey = '';
      } else if (!append) {
        shouldForceDetailReload =
          selectedStudentId.value !== previousSelectedStudentId ||
          String(studentDetail.value?.student?.id || '') !== selectedStudentId.value ||
          detailRequestKey !== buildDetailRequestKey(selectedStudentId.value);
      }
    } else {
      ElMessage.error(response.message || '加载学生预警失败');
    }
  } catch (error: any) {
    if (requestSeq === studentsRequestSeq) {
      ElMessage.error(error?.message || '加载学生预警失败');
    }
  } finally {
    if (requestSeq === studentsRequestSeq) {
      loadingStudents.value = false;
      loadingMoreStudents.value = false;
    }
  }

  if (!append && requestSeq === studentsRequestSeq && options?.loadDetail !== false && selectedStudentId.value) {
    void loadStudentDetail({
      silent: Boolean(options?.silent) && !shouldForceDetailReload,
      force: shouldForceDetailReload,
      studentId: selectedStudentId.value,
    });
  }
};

const loadStudentDetail = async (options?: { silent?: boolean; force?: boolean; studentId?: string }) => {
  const targetStudentId = String(options?.studentId || selectedStudentId.value || '');
  if (!targetStudentId) {
    studentDetail.value = null;
    detailRequestKey = '';
    return;
  }

  const requestKey = buildDetailRequestKey(targetStudentId);
  const cachedDetail = !options?.force ? getCachedWarningStudentDetail(requestKey) : null;
  if (cachedDetail && !options?.silent) {
    studentDetail.value = cachedDetail;
    return;
  }
  const requestSeq = ++detailRequestSeq;
  detailRequestKey = requestKey;
  const silent = Boolean(options?.silent) && Boolean(studentDetail.value);
  if (!silent) {
    if (options?.force) {
      studentDetail.value = null;
    }
    detailLoading.value = true;
  }

  try {
    const response = await getWarningClassViewStudentDetail(targetStudentId, {
      scope: query.scope,
      view: detailView.value,
    });
    if (requestSeq !== detailRequestSeq) {
      return;
    }

    if (response.code === 0) {
      if (
        String(selectedStudentId.value || '') !== targetStudentId ||
        buildDetailRequestKey(targetStudentId) !== requestKey
      ) {
        return;
      }
      setCachedWarningStudentDetail(requestKey, response.data);
      studentDetail.value = response.data;
      weekLabel.value = response.data?.summary?.week_label || weekLabel.value;
    } else {
      ElMessage.error(response.message || '加载学生预警详情失败');
    }
  } catch (error: any) {
    if (requestSeq === detailRequestSeq) {
      ElMessage.error(error?.message || '加载学生预警详情失败');
    }
  } finally {
    if (requestSeq === detailRequestSeq) {
      detailLoading.value = false;
    }
  }
};

const loadMoreStudents = async () => {
  if (!studentsHasMore.value || loadingMoreStudents.value) {
    return;
  }
  await loadStudents({ append: true, loadDetail: false });
};

const selectStudent = async (studentId: string) => {
  const nextStudentId = String(studentId || '');
  if (!nextStudentId) {
    return;
  }

  selectedStudentId.value = nextStudentId;
  await loadStudentDetail({
    force: true,
    studentId: nextStudentId,
  });
};

const onOrgChange = async () => {
  query.major = '';
  query.classId = '';
  students.value = [];
  resetStudentsPaging();
  selectedStudentId.value = '';
  studentDetail.value = null;
  detailRequestKey = '';
  clearWarningStudentsCache();
  await loadClasses();
};

const onMajorChange = () => {
  if (query.classId && !filteredClasses.value.find((item: any) => item.id === query.classId)) {
    query.classId = '';
  }
  students.value = [];
  resetStudentsPaging();
  selectedStudentId.value = '';
  studentDetail.value = null;
  detailRequestKey = '';
};

const onClassChange = async () => {
  students.value = [];
  resetStudentsPaging();
  selectedStudentId.value = '';
  studentDetail.value = null;
  detailRequestKey = '';
  clearWarningStudentsCache();
  await loadStudents({ loadDetail: true, force: true });
};

const onAck = async (row: any) => {
  const response = await ackWarning(String(row.id));
  if (response.code === 0) {
    ElMessage.success('已确认');
    clearCurrentWarningCaches();
    await loadStudentDetail({ force: true, studentId: selectedStudentId.value });
    void loadStudents({ silent: true, loadDetail: false, force: true });
  } else {
    ElMessage.error(response.message || '确认失败');
  }
};

const onDelete = async (row: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除预警 ${row.id} 吗？删除后会同步清理该预警关联的通知任务和通知日志。`,
      '确认删除',
      { type: 'warning' },
    );

    const response = await deleteWarning(String(row.id));
    if (response.code === 0) {
      ElMessage.success(response.message || '删除成功');
      removeWarningFromCurrentDetail(String(row.id));
      clearCurrentWarningCaches();
      void loadStudentDetail({ silent: true, force: true, studentId: selectedStudentId.value });
      void loadStudents({ silent: true, loadDetail: false, force: true });
    } else {
      ElMessage.error(response.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const onClearAllWarnings = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要一键删除当前筛选范围内的所有预警吗？删除后会同步清理当前活跃预警、历史预警、关联通知任务和通知日志。',
      '删除所有预警',
      { type: 'warning' },
    );

    const response = await clearWarnings({
      scope: 'all',
      org_id: query.orgId || undefined,
      major: query.major || undefined,
      class_id: query.classId || undefined,
    });
    if (response.code === 0) {
      ElMessage.success(response.message || '所有预警删除成功');
      clearWarningsPageCache();
      await loadStudents({ loadDetail: true, force: true });
    } else {
      ElMessage.error(response.message || '删除所有预警失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error?.message !== 'cancel') {
      ElMessage.error(error?.message || '删除所有预警失败');
    }
  }
};

const refreshStudents = async () => {
  clearWarningsPageCache();
  await loadStudents({ loadDetail: true, force: true });
};

const reset = async () => {
  clearWarningsPageCache();
  query.scope = 'all';
  query.orgId = isHeadTeacherView.value ? lockedHeadTeacherOrgId.value : '';
  query.major = '';
  query.classId = '';
  query.keyword = '';
  detailView.value = 'day';
  selectedStudentId.value = '';
  studentDetail.value = null;
  students.value = [];
  await loadClasses();
  await loadStudents({ loadDetail: true, force: true });
};

const formatGender = (gender?: string) => {
  if (gender === 'male') return '男';
  if (gender === 'female') return '女';
  return '未知';
};

const countWarningCourses = (groups: any[]) =>
  Array.isArray(groups) ? groups.filter((item: any) => Number(item?.warning_count || 0) > 0).length : 0;

const buildProcessingText = (courseGroup: any, row: any) => {
  if (row?.processing_text) {
    return row.processing_text;
  }
  const courseName = String(courseGroup?.course_name || '').trim() || '该课程';
  return `正在完善《${courseName}》预警的相关信息`;
};

const buildStudentProcessingText = (summary: any) => {
  if (summary?.processing_status === 'processing') {
    return summary.processing_text || '正在完善预警相关信息';
  }
  if (summary?.processing_status === 'failed') {
    return summary.processing_text || '完善预警相关信息失败';
  }
  return '已完成';
};

const formatWarningSummary = (row: any) => {
  const summary = String(row?.trigger_summary || '').trim();
  if (summary) {
    return summary;
  }

  const detail = row?.trigger_detail_json || {};
  const hasMetricCounts =
    detail.late_count !== undefined ||
    detail.absent_count !== undefined ||
    detail.early_leave_count !== undefined;

  if (hasMetricCounts) {
    return [
      `迟到${Number(detail.late_count || 0)}次`,
      `缺勤${Number(detail.absent_count || 0)}次`,
      `早退${Number(detail.early_leave_count || 0)}次`,
    ].join('，');
  }

  return '-';
};

const getMetricText = (metric: string) => {
  const map: Record<string, string> = {
    late: '迟到',
    absent: '缺勤',
    early_leave: '早退',
    warning_total: '累计预警',
  };
  return map[metric] || metric || '-';
};

const getStatusTagType = (status: string) => {
  const map: Record<string, string> = {
    open: 'warning',
    acknowledged: 'success',
    closed: 'info',
  };
  return map[status] || 'info';
};

const formatCompactTime = (value: any) => {
  if (!value) {
    return '-';
  }
  const formatted = formatDateTime(value);
  const match = /^\d{4}-(\d{2}-\d{2}\s+\d{2}:\d{2})/.exec(String(formatted || ''));
  return match ? match[1] : formatted || '-';
};

onMounted(async () => {
  loadCurrentRoles();
  await loadOrgs();
  await loadClasses();
  await loadStudents({ loadDetail: true, force: true });
});

onActivated(() => {
  clearWarningsPageCache();
  void loadStudents({ silent: true, loadDetail: true, force: true });
});
</script>

<style scoped>
.warnings-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.warnings-page :deep(.el-tag) {
  white-space: nowrap;
}

.warnings-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 18px 22px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 16px 34px rgba(34, 59, 78, 0.08);
}

.warnings-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 680px;
}

.warnings-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.warnings-hero__title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #173145;
}

.warnings-hero__desc {
  margin: 0;
  color: #5d7283;
  font-size: 13px;
  line-height: 1.5;
}

.warnings-hero__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
}

.warnings-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 150px;
  padding: 9px 12px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 11px;
}

.warnings-hero__meta strong {
  color: #173145;
  font-size: 18px;
  line-height: 1.15;
}

.warnings-filter-card,
.warnings-student-card,
.warnings-detail-card {
  border-radius: 20px;
  border: 1px solid rgba(109, 140, 158, 0.16);
  box-shadow: 0 14px 28px rgba(34, 59, 78, 0.07);
}

.warnings-filter-card__header,
.panel-header,
.course-group-card__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.panel-header--compact {
  align-items: center;
}

.filter-summary-pills {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(241, 246, 249, 0.92);
  border: 1px solid rgba(108, 140, 158, 0.16);
  color: #5d7283;
  font-size: 12px;
  white-space: nowrap;
}

.filter-crumb b {
  color: #173145;
  font-weight: 600;
}

.warnings-filter-card__title,
.panel-title {
  font-size: 15px;
  font-weight: 700;
  color: #173145;
}

.panel-title--small {
  font-size: 14px;
}

.warnings-filter-card__desc,
.panel-desc,
.course-group-card__meta {
  margin: 2px 0 0;
  color: #6b7f8e;
  font-size: 12px;
  line-height: 1.45;
}

.filter-label {
  color: #5f7485;
  font-size: 12px;
  font-weight: 600;
}

.filter-row {
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-item--actions {
  justify-content: flex-end;
}

.warnings-layout {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-header__right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.student-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
  max-height: 256px;
  overflow-y: auto;
  padding-right: 4px;
}

.student-list__item {
  width: 100%;
  border: 1px solid rgba(108, 140, 158, 0.18);
  border-radius: 12px;
  background: #fff;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.student-list__item--warned {
  border-color: rgba(217, 119, 6, 0.24);
  background: rgba(255, 251, 235, 0.55);
}

.student-list__item:hover,
.student-list__item--active {
  border-color: rgba(15, 118, 110, 0.58);
  background: rgba(240, 253, 249, 0.92);
  box-shadow: 0 6px 14px rgba(15, 118, 110, 0.12);
}

.student-list__main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.student-list__avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 700;
  background: #e7f3ec;
  color: #2f7a53;
}

.student-list__avatar--warned {
  background: #fef3c7;
  color: #b45309;
}

.student-list__identity {
  min-width: 0;
  flex: 1;
}

.student-list__stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: nowrap;
  align-items: center;
  margin-top: 7px;
  color: #5f7485;
  font-size: 11px;
  white-space: nowrap;
}

.detail-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.detail-toolbar__hint {
  margin-left: 6px;
  color: #6b7f8e;
  font-size: 12px;
}

.student-list__name {
  font-size: 13px;
  font-weight: 700;
  color: #173145;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.student-profile__name,
.course-group-card__title {
  font-size: 15px;
  font-weight: 700;
  color: #173145;
}

.student-list__meta {
  margin-top: 2px;
  font-size: 11px;
  color: #6b7f8e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.student-list__load-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 2px;
}

.student-list__level {
  font-size: 11px;
  color: #6b7f8e;
  flex-shrink: 0;
}

.student-list__level--normal {
  font-weight: 600;
}

.student-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.student-overview-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.07), transparent 45%),
    rgba(247, 250, 252, 0.92);
  border: 1px solid rgba(109, 140, 158, 0.16);
}

.student-overview-bar__left {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.student-overview-bar__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.student-overview-bar__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #5f7485;
}

.student-overview-bar__kpis {
  display: flex;
  align-items: stretch;
  gap: 8px;
  flex-wrap: wrap;
}

.mini-kpi {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 92px;
  padding: 7px 11px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(109, 140, 158, 0.14);
}

.mini-kpi span {
  color: #6b7f8e;
  font-size: 11px;
  line-height: 1.2;
}

.mini-kpi strong {
  color: #173145;
  font-size: 15px;
  line-height: 1.25;
  white-space: nowrap;
}

.mini-kpi__hint {
  color: #b45309;
  font-size: 11px;
  font-style: normal;
  line-height: 1.2;
}

.student-list__occurrence {
  color: #b45309;
  font-weight: 600;
}

.course-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.course-group-card {
  border-radius: 16px;
}

.course-group-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warning-level-badge {
  height: 26px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
}

.sync-status-text {
  font-size: 12px;
  color: #5f7485;
  white-space: nowrap;
}

.sync-status-text--error {
  color: #dc2626;
}

.row-actions {
  display: inline-flex;
  justify-content: center;
  gap: 6px;
  flex-wrap: nowrap;
}

@media (max-width: 1200px) {
  .student-overview-bar {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 768px) {
  .warnings-hero {
    padding: 16px;
  }

  .student-overview-bar__kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
