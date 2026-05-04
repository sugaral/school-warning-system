<template>
  <div class="bind-courses-page">
    <section class="bind-courses-hero">
      <div class="bind-courses-hero__copy">
        <span class="bind-courses-hero__eyebrow">Course Workspace</span>
        <h2 class="bind-courses-hero__title">绑定课程与班级</h2>
        <p class="bind-courses-hero__desc">
          左侧选择课程，右侧为每门课程配置班级。已有绑定时再次保存会提交课程变更申请，不会直接改动正式数据。
        </p>
      </div>
      <div class="bind-courses-hero__meta">
        <span>已选课程</span>
        <strong>{{ selectedCourses.length }}</strong>
        <small>已选班级 {{ totalSelectedClasses }}</small>
      </div>
    </section>

    <el-alert
      v-if="hasExistingBindings"
      title="当前为课程变更模式"
      type="warning"
      :closable="false"
      class="page-alert"
    >
      当前账号已经存在课程绑定。重新提交后会进入教务管理员审批，不会立即覆盖现有课程安排。
    </el-alert>

    <section class="bind-courses-layout">
      <el-card class="layout-card courses-card">
        <template #header>
          <div class="card-header">
            <div>
              <span class="card-title">课程清单</span>
              <p class="card-desc">勾选需要绑定或调整的课程。</p>
            </div>
            <el-input
              v-model="courseKeyword"
              placeholder="搜索课程代码或课程名称"
              clearable
              class="course-search"
            />
          </div>
        </template>

        <el-empty
          v-if="!filteredCourses.length && !loading"
          description="当前没有可绑定课程，请先确认学院已绑定，或联系管理员配置开课班。"
        />

        <div v-else class="table-shell">
          <el-table
            ref="coursesTableRef"
            :data="filteredCourses"
            style="width: 100%"
            height="480"
            row-key="id"
            @selection-change="handleCourseSelection"
          >
            <el-table-column type="selection" width="52" :reserve-selection="true" />
            <el-table-column prop="course_code" label="课程代码" width="130" />
            <el-table-column prop="course_name" label="课程名称" min-width="180" show-overflow-tooltip />
            <el-table-column label="学分" width="110" align="center">
              <template #default="{ row }">
                {{ formatCredit(row.credit) }}
              </template>
            </el-table-column>
            <el-table-column label="已选班级" width="110">
              <template #default="{ row }">
                <el-tag size="small" type="success">{{ getSelectedClassCount(row.id) }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <el-card class="layout-card bindings-card">
        <template #header>
          <div class="card-header">
            <div>
              <span class="card-title">班级配置</span>
              <p class="card-desc">为已选择的课程分配班级，所有数据都直接在这里展开显示。</p>
            </div>
            <el-tag type="primary" effect="plain">{{ selectedCourses.length }} 门课程</el-tag>
          </div>
        </template>

        <el-empty
          v-if="selectedCourses.length === 0"
          description="先从左侧勾选课程，再在这里为每门课程选择班级。"
        />

        <div v-else class="binding-course-list">
          <article
            v-for="course in selectedCourses"
            :key="course.id"
            class="binding-course-card"
          >
            <header class="binding-course-card__header">
              <div>
                <h3>{{ course.course_name }}</h3>
                <p>{{ course.course_code || '未设置课程代码' }}</p>
              </div>
              <el-tag type="success" effect="plain">
                已选 {{ getSelectedClassCount(course.id) }} 个班级
              </el-tag>
            </header>

            <el-checkbox-group v-model="courseClassMap[course.id]" class="class-choice-grid">
              <el-checkbox-button
                v-for="cls in allClasses"
                :key="cls.id"
                :label="cls.id"
              >
                {{ cls.class_name }}
              </el-checkbox-button>
            </el-checkbox-group>
          </article>
        </div>

        <footer v-if="selectedCourses.length > 0" class="bindings-footer">
          <div class="bindings-footer__meta">
            <span>当前共选择 {{ selectedCourses.length }} 门课程，{{ totalSelectedClasses }} 个班级。</span>
          </div>
          <div class="bindings-footer__actions">
            <el-button @click="goBackAttendance">返回签到管理</el-button>
            <el-button type="primary" :loading="saving" @click="onSave">
              {{ hasExistingBindings ? '提交变更申请' : '保存绑定' }}
            </el-button>
          </div>
        </footer>
      </el-card>
    </section>

    <el-card class="current-bindings-card">
      <template #header>
        <div class="card-header">
          <div>
            <span class="card-title">当前已绑定</span>
            <p class="card-desc">这里展示当前已经正式生效的课程与班级绑定，方便和本次待提交内容对照查看。</p>
          </div>
          <el-tag type="success" effect="plain">{{ currentBindingCourses.length }} 门课程</el-tag>
        </div>
      </template>

      <el-empty
        v-if="currentBindingCourses.length === 0"
        description="当前暂无已生效的课程绑定"
      />

      <div v-else class="current-bindings-list">
        <article
          v-for="course in currentBindingCourses"
          :key="`current-${course.id}`"
          class="current-binding-card"
        >
          <header class="current-binding-card__header">
            <div>
              <h3>{{ course.course_name }}</h3>
              <p>
                {{ course.course_code || '未设置课程代码' }}
                <span class="current-binding-card__dot">·</span>
                学分 {{ formatCredit(course.credit) }}
              </p>
            </div>
            <el-tag type="success" effect="plain">
              {{ getCurrentBindingClassCount(course.id) }} 个班级
            </el-tag>
          </header>

          <div class="current-binding-classes">
            <el-tag
              v-for="cls in currentBindingClassMap[course.id] || []"
              :key="`current-${course.id}-${cls.id}`"
              class="current-binding-classes__tag"
              effect="plain"
            >
              {{ cls.class_name }}
            </el-tag>
          </div>
        </article>
      </div>
    </el-card>

    <el-card v-if="bindingRequests.length > 0" class="requests-card">
      <template #header>
        <div class="card-header">
          <div>
            <span class="card-title">课程变更申请记录</span>
            <p class="card-desc">方便确认最近提交的变更是否已批准或被驳回。</p>
          </div>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="bindingRequests" style="width: 100%" stripe>
          <el-table-column label="状态" width="140">
            <template #default="{ row }">
              <el-tag :type="getRequestStatusType(row.status)">{{ formatRequestStatus(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="当前绑定" min-width="220">
            <template #default="{ row }">
              <div class="rich-text-list">
                <span v-for="(line, index) in formatRichText(row.current_value)" :key="`current-${row.id}-${index}`">
                  {{ line }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="申请变更为" min-width="220">
            <template #default="{ row }">
              <div class="rich-text-list">
                <span v-for="(line, index) in formatRichText(row.target_value)" :key="`target-${row.id}-${index}`">
                  {{ line }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="驳回原因" min-width="220">
            <template #default="{ row }">
              <div class="rich-text-list">
                <span v-for="(line, index) in formatRichText(row.reject_reason)" :key="`reject-${row.id}-${index}`">
                  {{ line }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.created_at) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  getTeacherClasses,
  getTeacherCourseBindingRequests,
  getTeacherCourses,
  getTeacherMyBindings,
  teacherBindCourses,
} from '../../api';
import { setTeacherBindingState } from '../../lib/binding';

const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const courseKeyword = ref('');
const coursesTableRef = ref();
const coursesList = ref<any[]>([]);
const allClasses = ref<any[]>([]);
const selectedCourseIds = ref<string[]>([]);
const courseClassMap = reactive<Record<string, string[]>>({});
const currentBindingCourses = ref<any[]>([]);
const currentBindingClassMap = ref<Record<string, any[]>>({});
const bindingRequests = ref<any[]>([]);
const hasExistingBindings = ref(false);

const filteredCourses = computed(() => {
  const keyword = courseKeyword.value.trim().toLowerCase();
  if (!keyword) {
    return coursesList.value;
  }

  return coursesList.value.filter((item: any) => {
    const code = String(item.course_code || '').toLowerCase();
    const name = String(item.course_name || '').toLowerCase();
    return code.includes(keyword) || name.includes(keyword);
  });
});

const selectedCourses = computed(() => {
  const courseMap = new Map(coursesList.value.map((item: any) => [String(item.id), item]));
  return selectedCourseIds.value
    .map((id) => courseMap.get(String(id)))
    .filter(Boolean);
});

const totalSelectedClasses = computed(() =>
  selectedCourseIds.value.reduce((sum, courseId) => sum + (courseClassMap[courseId]?.length || 0), 0),
);

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const formatCredit = (value: any) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  let normalized = '';
  if (typeof value === 'object') {
    if (typeof value?.toNumber === 'function') {
      try {
        const numericValue = value.toNumber();
        if (Number.isFinite(numericValue)) {
          normalized = String(numericValue);
        }
      } catch {
        // ignore and continue fallback handling
      }
    }

    if (!normalized && typeof value?.toString === 'function') {
      const stringValue = value.toString();
      if (stringValue && stringValue !== '[object Object]') {
        normalized = stringValue;
      }
    }
  }

  if (!normalized) {
    normalized = String(value);
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    return '-';
  }
  if (Number.isInteger(numericValue)) {
    return String(numericValue);
  }
  return numericValue.toFixed(1).replace(/\.0$/, '');
};

const formatRichText = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return ['-'];
  return raw
    .split(/[；;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const formatRequestStatus = (status?: string) => {
  const map: Record<string, string> = {
    submitted: '待教务审批',
    pending_dean: '待教务审批',
    approved: '已批准',
    rejected: '已驳回',
  };
  return map[String(status || '')] || status || '-';
};

const getRequestStatusType = (status?: string) => {
  const map: Record<string, string> = {
    submitted: 'warning',
    pending_dean: 'warning',
    approved: 'success',
    rejected: 'danger',
  };
  return map[String(status || '')] || 'info';
};

const getSelectedClassCount = (courseId: string) => courseClassMap[courseId]?.length || 0;
const getCurrentBindingClassCount = (courseId: string) => currentBindingClassMap.value[courseId]?.length || 0;

const syncTableSelection = async () => {
  await nextTick();
  if (!coursesTableRef.value) {
    return;
  }

  coursesTableRef.value.clearSelection();
  coursesList.value.forEach((course: any) => {
    if (selectedCourseIds.value.includes(String(course.id))) {
      coursesTableRef.value.toggleRowSelection(course, true);
    }
  });
};

const loadCourses = async () => {
  loading.value = true;
  try {
    const resp = await getTeacherCourses();
    if (resp.code === 0) {
      coursesList.value = Array.isArray(resp.data) ? resp.data : [];
      await syncTableSelection();
    } else {
      ElMessage.error(resp.message || '加载课程列表失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载课程列表失败');
  } finally {
    loading.value = false;
  }
};

const loadClasses = async () => {
  try {
    const resp = await getTeacherClasses();
    if (resp.code === 0) {
      allClasses.value = Array.isArray(resp.data) ? resp.data : [];
    } else {
      ElMessage.error(resp.message || '加载班级列表失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载班级列表失败');
  }
};

const loadCourseBindingRequests = async () => {
  try {
    const resp = await getTeacherCourseBindingRequests();
    if (resp.code === 0) {
      bindingRequests.value = Array.isArray(resp.data) ? resp.data : [];
    }
  } catch (error) {
    console.error('加载课程变更申请失败:', error);
  }
};

const loadMyBindings = async () => {
  try {
    const resp = await getTeacherMyBindings();
    if (resp.code !== 0 || !resp.data) {
      return;
    }

    const { courses, classes_by_course: classesByCourse } = resp.data;
    if (!Array.isArray(courses) || courses.length === 0) {
      hasExistingBindings.value = false;
      currentBindingCourses.value = [];
      currentBindingClassMap.value = {};
      setTeacherBindingState({
        hasBoundOrg: true,
        hasBoundCourses: false,
      });
      return;
    }

    currentBindingCourses.value = courses.map((item: any) => ({
      ...item,
      id: String(item.id),
    }));
    currentBindingClassMap.value = Object.fromEntries(
      currentBindingCourses.value.map((course: any) => [
        course.id,
        Array.isArray(classesByCourse?.[course.id] || classesByCourse?.[Number(course.id)])
          ? (classesByCourse?.[course.id] || classesByCourse?.[Number(course.id)]).map((cls: any) => ({
              id: String(cls.id),
              class_name: cls.class_name || '',
            }))
          : [],
      ]),
    );

    hasExistingBindings.value = true;
    selectedCourseIds.value = courses.map((item: any) => String(item.id));
    courses.forEach((course: any) => {
      const currentClasses =
        currentBindingClassMap.value[String(course.id)] || [];
      courseClassMap[String(course.id)] = currentClasses.map((cls: any) => String(cls.id));
    });

    setTeacherBindingState({
      hasBoundOrg: true,
      hasBoundCourses: true,
    });
    await syncTableSelection();
  } catch (error) {
    console.error('加载绑定信息失败:', error);
  }
};

const handleCourseSelection = (selection: any[]) => {
  selectedCourseIds.value = selection.map((course) => String(course.id));
  selectedCourseIds.value.forEach((courseId) => {
    if (!courseClassMap[courseId]) {
      courseClassMap[courseId] = [];
    }
  });
};

const goBackAttendance = () => {
  router.push('/teacher-attendance');
};

const onSave = async () => {
  if (selectedCourses.value.length === 0) {
    ElMessage.warning('请至少选择一门课程');
    return;
  }

  const hasNoClass = selectedCourses.value.some(
    (course: any) => !courseClassMap[String(course.id)] || courseClassMap[String(course.id)].length === 0,
  );
  if (hasNoClass) {
    ElMessage.warning('请为每门课程至少选择一个班级');
    return;
  }

  saving.value = true;
  try {
    const bindings = selectedCourses.value.map((course: any) => ({
      course_id: course.id,
      class_ids: courseClassMap[String(course.id)],
    }));

    const resp = await teacherBindCourses(bindings);
    if (resp.code !== 0) {
      ElMessage.error(resp.message || '保存失败');
      return;
    }

    if (resp.data?.approval_submitted) {
      ElMessage.success(resp.message || '课程变更申请已提交');
      await loadCourseBindingRequests();
      return;
    }

    hasExistingBindings.value = true;
    setTeacherBindingState({
      hasBoundOrg: true,
      hasBoundCourses: true,
    });
    ElMessage.success('绑定成功');
    router.replace('/teacher-attendance');
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  await Promise.all([
    loadCourses(),
    loadClasses(),
    loadCourseBindingRequests(),
  ]);
  await loadMyBindings();
});
</script>

<style scoped>
.bind-courses-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}

.bind-courses-hero {
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

.bind-courses-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.bind-courses-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.bind-courses-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.bind-courses-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.7;
}

.bind-courses-hero__meta {
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

.bind-courses-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.page-alert {
  margin: 0;
}

.bind-courses-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.3fr);
  gap: 18px;
}

.layout-card,
.requests-card {
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.card-title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.card-desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.course-search {
  width: 260px;
  max-width: 100%;
}

.binding-course-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 520px;
  overflow: auto;
  padding-right: 4px;
}

.binding-course-card {
  padding: 16px 18px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 251, 252, 0.88));
}

.binding-course-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.binding-course-card__header h3 {
  margin: 0;
  font-size: 16px;
  color: #173145;
}

.binding-course-card__header p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #68808f;
}

.current-bindings-card {
  overflow: hidden;
}

.current-bindings-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.current-binding-card {
  padding: 16px 18px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 251, 252, 0.88));
}

.current-binding-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.current-binding-card__header h3 {
  margin: 0;
  font-size: 16px;
  color: #173145;
}

.current-binding-card__header p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #68808f;
}

.current-binding-card__dot {
  margin: 0 6px;
}

.current-binding-classes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.current-binding-classes__tag {
  margin: 0;
}

.class-choice-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.class-choice-grid :deep(.el-checkbox-button__inner) {
  border-radius: 12px;
  padding: 10px 14px;
}

.bindings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(108, 140, 158, 0.12);
  flex-wrap: wrap;
}

.bindings-footer__meta {
  color: #627888;
  font-size: 13px;
}

.bindings-footer__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.rich-text-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
}

@media (max-width: 1180px) {
  .bind-courses-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .bind-courses-page {
    padding: 16px;
  }

  .bind-courses-hero {
    padding: 20px;
  }

  .bindings-footer {
    align-items: stretch;
  }

  .bindings-footer__actions {
    width: 100%;
  }

  .bindings-footer__actions > * {
    flex: 1;
  }
}
</style>
