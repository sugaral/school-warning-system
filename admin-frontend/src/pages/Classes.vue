<template>
  <div class="classes-page">
    <section class="classes-hero">
      <div class="classes-hero__copy">
        <span class="classes-hero__eyebrow">Class Console</span>
        <h2 class="classes-hero__title">班级管理</h2>
        <p class="classes-hero__desc">查看班级信息、维护班主任，并导出学生账号列表。</p>
      </div>
      <div class="classes-hero__actions">
        <div class="classes-hero__meta">
          <span>当前页</span>
          <strong>{{ page }}</strong>
          <small>共 {{ total }} 个班级</small>
        </div>
        <el-button @click="loadClasses">刷新</el-button>
        <el-button type="primary" @click="handleExportAccounts()">导出全部账号列表</el-button>
        <el-button type="success" @click="openCreateDialog">新增班级</el-button>
      </div>
    </section>

    <section class="classes-overview">
      <article class="classes-overview__card">
        <span class="classes-overview__label">班级总数</span>
        <strong class="classes-overview__value">{{ total }}</strong>
        <p class="classes-overview__desc">当前分页条件下的班级总量</p>
      </article>
      <article class="classes-overview__card">
        <span class="classes-overview__label">当前页结果</span>
        <strong class="classes-overview__value">{{ classes.length }}</strong>
        <p class="classes-overview__desc">当前页展示的班级条数</p>
      </article>
      <article class="classes-overview__card">
        <span class="classes-overview__label">启用班级</span>
        <strong class="classes-overview__value">{{ activeClassCount }}</strong>
        <p class="classes-overview__desc">当前页处于正常状态的班级数量</p>
      </article>
      <article class="classes-overview__card">
        <span class="classes-overview__label">学生人数</span>
        <strong class="classes-overview__value">{{ totalStudentCount }}</strong>
        <p class="classes-overview__desc">当前页班级合计学生人数</p>
      </article>
    </section>

    <el-card class="classes-toolbar-card">
      <div class="toolbar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索班级名称、学院或专业"
          clearable
          @keyup.enter="loadClasses"
          @clear="loadClasses"
        >
          <template #append>
            <el-button @click="loadClasses">搜索</el-button>
          </template>
        </el-input>
      </div>
    </el-card>

    <el-card class="classes-table-card">
      <template #header>
        <div class="classes-table-card__header">
          <div>
            <span class="classes-table-card__title">班级列表</span>
            <p class="classes-table-card__desc">桌面端支持快速查看班级、学院、专业、班主任和学生人数。</p>
          </div>
          <el-tag type="primary" effect="plain">当前页 {{ classes.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="classes" v-loading="loading" border>
          <el-table-column prop="class_name" label="班级名称" min-width="180" />
          <el-table-column prop="org_name" label="所属学院" min-width="160" />
          <el-table-column prop="enroll_year" label="入学年份" width="110" />
          <el-table-column prop="major" label="专业" min-width="160" />
          <el-table-column label="年级" width="100">
            <template #default="{ row }">
              {{ formatGrade(row.grade_level) }}
            </template>
          </el-table-column>
          <el-table-column prop="student_count" label="学生人数" width="100" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'">
                {{ formatStatus(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="340" fixed="right">
            <template #default="{ row }">
              <div class="action-group">
                <el-button type="primary" link @click="openDetailDialog(row)">详情</el-button>
                <el-button type="primary" link @click="openEditDialog(row)">编辑</el-button>
                <el-button type="success" link @click="handleExportAccounts(row)">导出账号列表</el-button>
                <el-button type="danger" link @click="handleDelete(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadClasses"
        />
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" :title="isEdit ? '编辑班级' : '新增班级'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="所属学院" prop="org_id">
          <el-select v-model="form.org_id" placeholder="请选择学院" style="width: 100%" @change="handleOrgChange">
            <el-option v-for="org in orgs" :key="org.id" :label="org.org_name" :value="org.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级名称" prop="class_name">
          <el-input v-model="form.class_name" placeholder="例如：计算机科学与技术 1 班" />
        </el-form-item>
        <el-form-item label="入学年份" prop="enroll_year">
          <el-input-number v-model="form.enroll_year" :min="2000" :max="2100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="专业">
          <el-select v-model="form.major" placeholder="请选择专业" style="width: 100%" clearable :disabled="!form.org_id">
            <el-option v-for="major in majors" :key="major.id" :label="major.name" :value="major.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级">
          <el-select v-model="form.grade_level" style="width: 100%">
            <el-option label="大一" value="1" />
            <el-option label="大二" value="2" />
            <el-option label="大三" value="3" />
            <el-option label="大四" value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="班主任">
          <el-select
            v-model="form.counselor_user_id"
            placeholder="请选择班主任"
            style="width: 100%"
            filterable
            clearable
            :disabled="!form.org_id"
          >
            <el-option v-for="teacher in filteredTeachers" :key="teacher.id" :label="teacher.name" :value="teacher.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">正常</el-radio>
            <el-radio value="inactive">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showDetailDialog" :title="`班级详情 - ${classDetails.class_name || ''}`" width="900px">
      <el-descriptions title="基础信息" :column="2" border>
        <el-descriptions-item label="班级名称">{{ classDetails.class_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="所属学院">{{ classDetails.org_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入学年份">{{ classDetails.enroll_year || '-' }}</el-descriptions-item>
        <el-descriptions-item label="专业">{{ classDetails.major || '-' }}</el-descriptions-item>
        <el-descriptions-item label="年级">{{ formatGrade(classDetails.grade_level) }}</el-descriptions-item>
        <el-descriptions-item label="学生人数">{{ classDetails.student_count || 0 }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ formatStatus(classDetails.status) }}</el-descriptions-item>
        <el-descriptions-item label="班主任">{{ classDetails.teacher_name || '未设置' }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-section">
        <div class="section-header">
          <h3>班级学生</h3>
        </div>
        <div class="table-shell">
          <el-table :data="classStudents" v-loading="loadingStudents" border>
            <el-table-column prop="student_name" label="姓名" min-width="120" />
            <el-table-column prop="student_id" label="学号" min-width="120" />
            <el-table-column label="性别" width="90">
              <template #default="{ row }">
                {{ formatGender(row.gender) }}
              </template>
            </el-table-column>
            <el-table-column label="最近签到时间" min-width="180">
              <template #default="{ row }">
                {{ row.last_checkin_time ? formatDateTime(row.last_checkin_time) : '暂无' }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="pagination">
          <el-pagination
            v-model:current-page="studentPage"
            v-model:page-size="studentPageSize"
            :total="studentTotal"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @size-change="loadClassStudents"
            @current-change="loadClassStudents"
          />
        </div>
      </div>

      <div class="detail-section">
        <div class="section-header">
          <h3>班级课程</h3>
        </div>
        <div class="table-shell">
          <el-table :data="classCourses" border>
            <el-table-column prop="course_code" label="课程编码" min-width="120" />
            <el-table-column prop="course_name" label="课程名称" min-width="180" />
            <el-table-column prop="credit" label="学分" width="90" />
            <el-table-column prop="teacher_name" label="任课教师" min-width="140" />
            <el-table-column prop="term_code" label="学期" min-width="120" />
          </el-table>
        </div>
        <el-empty v-if="classCourses.length === 0" description="暂无课程数据" />
      </div>

      <template #footer>
        <el-button @click="showDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FormInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  api,
  createClass,
  deleteClass as deleteClassApi,
  exportStudentAccounts,
  listClassesAdmin,
  listMajors,
  listOrgs,
  listStudents,
  listTeachers,
  updateClass,
} from '../api';

type OrgItem = { id: string; org_name: string };
type TeacherItem = { id: string; name: string; org_id?: string };
type MajorItem = { id: string; name: string };

type ClassForm = {
  id: string;
  org_id: string;
  class_name: string;
  enroll_year: number;
  major: string;
  grade_level: string;
  counselor_user_id: string;
  status: string;
};

const classes = ref<any[]>([]);
const orgs = ref<OrgItem[]>([]);
const allTeachers = ref<TeacherItem[]>([]);
const majors = ref<MajorItem[]>([]);
const classStudents = ref<any[]>([]);
const classCourses = ref<any[]>([]);

const loading = ref(false);
const loadingStudents = ref(false);
const submitting = ref(false);
const showCreateDialog = ref(false);
const showDetailDialog = ref(false);
const isEdit = ref(false);

const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const studentPage = ref(1);
const studentPageSize = ref(10);
const studentTotal = ref(0);
const searchKeyword = ref('');

const formRef = ref<FormInstance>();

const form = reactive<ClassForm>({
  id: '',
  org_id: '',
  class_name: '',
  enroll_year: new Date().getFullYear(),
  major: '',
  grade_level: '1',
  counselor_user_id: '',
  status: 'active',
});

const classDetails = reactive<any>({
  id: '',
  class_name: '',
  org_id: '',
  org_name: '',
  enroll_year: '',
  major: '',
  grade_level: '',
  student_count: 0,
  status: '',
  teacher_name: '',
});

const filteredTeachers = computed(() => {
  if (!form.org_id) {
    return allTeachers.value;
  }
  const matched = allTeachers.value.filter(
    (teacher) => String(teacher.org_id || '') === String(form.org_id),
  );
  return matched.length > 0 ? matched : allTeachers.value;
});

const activeClassCount = computed(
  () => classes.value.filter((item: any) => String(item.status || '') === 'active').length,
);

const totalStudentCount = computed(
  () =>
    classes.value.reduce(
      (sum: number, item: any) => sum + Number(item.student_count || 0),
      0,
    ),
);

const rules = {
  org_id: [{ required: true, message: '请选择所属学院', trigger: 'change' }],
  class_name: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  enroll_year: [{ required: true, message: '请输入入学年份', trigger: 'change' }],
};

function formatGrade(value?: string) {
  const map: Record<string, string> = {
    '1': '大一',
    '2': '大二',
    '3': '大三',
    '4': '大四',
  };
  return map[String(value || '')] || value || '-';
}

function formatStatus(value?: string) {
  return value === 'active' ? '正常' : value === 'inactive' ? '停用' : value || '-';
}

function formatGender(value?: string) {
  if (value === 'male') return '男';
  if (value === 'female') return '女';
  return '未知';
}

function formatDateTime(dateTime: string) {
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function resetForm() {
  form.id = '';
  form.org_id = '';
  form.class_name = '';
  form.enroll_year = new Date().getFullYear();
  form.major = '';
  form.grade_level = '1';
  form.counselor_user_id = '';
  form.status = 'active';
  majors.value = [];
}

async function loadOrgs() {
  const resp = await listOrgs();
  if (resp.code === 0) {
    orgs.value = resp.data || [];
  }
}

async function loadTeachers() {
  const resp = await listTeachers({ page: 1, pageSize: 1000 });
  if (resp.code === 0) {
    allTeachers.value = resp.data?.list || [];
  }
}

async function loadMajorsByOrg(orgId: string) {
  if (!orgId) {
    majors.value = [];
    return;
  }
  const resp = await listMajors(orgId);
  majors.value = resp.code === 0 ? resp.data || [] : [];
}

async function handleOrgChange(orgId: string) {
  form.major = '';
  form.counselor_user_id = '';
  await loadMajorsByOrg(orgId);
}

async function loadClasses() {
  loading.value = true;
  try {
    const resp = await listClassesAdmin({
      page: page.value,
      pageSize: pageSize.value,
      keyword: searchKeyword.value,
    });
    if (resp.code === 0) {
      classes.value = resp.data?.list || [];
      total.value = resp.data?.total || 0;
    } else {
      ElMessage.error(resp.message || '加载班级列表失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载班级列表失败');
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  resetForm();
  isEdit.value = false;
  showCreateDialog.value = true;
}

async function openEditDialog(row: any) {
  resetForm();
  isEdit.value = true;
  form.id = String(row.id || '');
  form.org_id = String(row.org_id || '');
  form.class_name = row.class_name || '';
  form.enroll_year = Number(row.enroll_year || new Date().getFullYear());
  form.major = row.major || '';
  form.grade_level = String(row.grade_level || '1');
  form.counselor_user_id = row.counselor_user_id ? String(row.counselor_user_id) : '';
  form.status = row.status || 'active';
  if (form.org_id) {
    await loadMajorsByOrg(form.org_id);
  }
  showCreateDialog.value = true;
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      org_id: form.org_id,
      class_name: form.class_name,
      enroll_year: form.enroll_year,
      major: form.major || undefined,
      grade_level: form.grade_level || undefined,
      counselor_user_id: form.counselor_user_id || undefined,
      status: form.status,
    };

    const resp = isEdit.value
      ? await updateClass(form.id, payload)
      : await createClass(payload);

    if (resp.code === 0) {
      ElMessage.success(isEdit.value ? '班级更新成功' : '班级创建成功');
      showCreateDialog.value = false;
      await loadClasses();
    } else {
      ElMessage.error(resp.message || '保存失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除班级“${row.class_name}”吗？`, '确认删除', {
      type: 'warning',
    });
    const resp = await deleteClassApi(String(row.id));
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      await loadClasses();
    } else {
      ElMessage.error(resp.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
}

async function handleExportAccounts(row?: any) {
  try {
    loading.value = true;
    const resp = await exportStudentAccounts(row?.id ? String(row.id) : undefined);
    const list = resp.code === 0 ? resp.data || [] : [];
    if (!list.length) {
      ElMessage.warning('没有可导出的账号列表');
      return;
    }

    const lines = [
      ['学院', '班级', '学号', '姓名', '账号', '初始密码', '密码状态'].join(','),
      ...list.map((item: any) =>
        [
          item.org_name || '',
          item.class_name || '',
          item.student_no || '',
          item.name || '',
          item.account || '',
          item.initial_password || '',
          item.password_status || '',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ];

    const blob = new Blob(['\ufeff' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = row?.class_name ? `${row.class_name}-账号列表.csv` : '班级账号列表.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    ElMessage.success('账号列表导出成功');
  } catch (error: any) {
    ElMessage.error(error?.message || '账号列表导出失败');
  } finally {
    loading.value = false;
  }
}

async function loadClassStudents() {
  if (!classDetails.id) return;
  loadingStudents.value = true;
  try {
    const resp = await listStudents({
      class_id: String(classDetails.id),
      page: studentPage.value,
      pageSize: studentPageSize.value,
    });
    if (resp.code === 0) {
      classStudents.value = (resp.data?.list || []).map((student: any) => ({
        student_id: student.student_no,
        student_name: student.name,
        gender: student.gender,
        last_checkin_time: student.last_checkin_time || null,
      }));
      studentTotal.value = resp.data?.total || 0;
    } else {
      classStudents.value = [];
      studentTotal.value = 0;
      ElMessage.error(resp.message || '加载班级学生失败');
    }
  } catch (error: any) {
    classStudents.value = [];
    studentTotal.value = 0;
    ElMessage.error(error?.message || '加载班级学生失败');
  } finally {
    loadingStudents.value = false;
  }
}

async function loadClassCourses() {
  if (!classDetails.id) return;
  try {
    const response = await api.get('/admin/course-classes', {
      params: {
        class_id: classDetails.id,
        page: 1,
        pageSize: 200,
      },
    });
    const list = response.data?.data?.list || [];
    classCourses.value = list.map((item: any) => ({
      course_code: item.course_code || item.courses?.course_code || '',
      course_name: item.course_name || item.courses?.course_name || '',
      credit: item.credit || item.courses?.credit || '',
      teacher_name: item.teacher_name || item.users?.name || '',
      term_code: item.term_code || '',
    }));
  } catch (error) {
    console.error('加载班级课程失败:', error);
    classCourses.value = [];
  }
}

async function openDetailDialog(row: any) {
  Object.assign(classDetails, {
    id: String(row.id || ''),
    class_name: row.class_name || '',
    org_id: String(row.org_id || ''),
    org_name: row.org_name || '',
    enroll_year: row.enroll_year || '',
    major: row.major || '',
    grade_level: row.grade_level || '',
    student_count: row.student_count || 0,
    status: row.status || '',
    teacher_name: row.teacher_name || '',
  });
  showDetailDialog.value = true;
  studentPage.value = 1;
  await Promise.all([loadClassStudents(), loadClassCourses()]);
}

onMounted(async () => {
  await Promise.all([loadOrgs(), loadTeachers()]);
  await loadClasses();
});
</script>

<style scoped>
.classes-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.classes-hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 18px;
  flex-wrap: wrap;
  padding: 24px 26px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(14, 165, 164, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 24px 48px rgba(34, 59, 78, 0.1);
}

.classes-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.classes-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.classes-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.classes-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.classes-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.classes-hero__meta {
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

.classes-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.classes-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.classes-overview__card {
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

.classes-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.classes-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.classes-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.classes-toolbar-card,
.classes-table-card {
  overflow: hidden;
}

.toolbar {
  max-width: 420px;
}

.classes-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.classes-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.classes-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-section {
  margin-top: 24px;
}

.section-header {
  margin-bottom: 12px;
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
}

.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 1200px) {
  .classes-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .classes-hero {
    padding: 20px;
  }

  .classes-overview {
    grid-template-columns: 1fr;
  }

  .classes-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .classes-hero__actions > * {
    width: 100%;
  }

  .toolbar {
    max-width: none;
  }

  .pagination {
    justify-content: flex-start;
  }
}
</style>
