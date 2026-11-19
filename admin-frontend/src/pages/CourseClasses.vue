<template>
  <div class="course-classes-page">
    <section class="course-classes-hero">
      <div class="course-classes-hero__copy">
        <span class="course-classes-hero__eyebrow">Teaching Matrix</span>
        <h2 class="course-classes-hero__title">课程与开课班管理</h2>
        <p class="course-classes-hero__desc">统一维护课程、开课班、任课教师和学期关系，方便后续课表与成绩链路联动。</p>
      </div>
      <div class="course-classes-hero__actions">
        <div class="course-classes-hero__meta">
          <span>当前结果</span>
          <strong>{{ courseClasses.length }}</strong>
          <small>覆盖 {{ uniqueClassCount }} 个班级</small>
        </div>
        <el-button type="primary" @click="openCreateDialog">创建课程与开课班</el-button>
        <el-button type="success" icon="Upload" @click="showImportDialog = true">
          导入课程与开课班
        </el-button>
        <el-button type="info" icon="Refresh" @click="loadCourseClasses">刷新</el-button>
      </div>
    </section>

    <section class="course-classes-overview">
      <article class="course-classes-overview__card">
        <span class="course-classes-overview__label">开课记录</span>
        <strong class="course-classes-overview__value">{{ courseClasses.length }}</strong>
        <p class="course-classes-overview__desc">当前已加载的课程与班级绑定关系</p>
      </article>
      <article class="course-classes-overview__card">
        <span class="course-classes-overview__label">涉及学期</span>
        <strong class="course-classes-overview__value">{{ uniqueTermCount }}</strong>
        <p class="course-classes-overview__desc">当前结果覆盖的学期数量</p>
      </article>
      <article class="course-classes-overview__card">
        <span class="course-classes-overview__label">涉及班级</span>
        <strong class="course-classes-overview__value">{{ uniqueClassCount }}</strong>
        <p class="course-classes-overview__desc">当前结果覆盖的班级数量</p>
      </article>
      <article class="course-classes-overview__card">
        <span class="course-classes-overview__label">涉及教师</span>
        <strong class="course-classes-overview__value">{{ uniqueTeacherCount }}</strong>
        <p class="course-classes-overview__desc">当前结果关联的任课教师数量</p>
      </article>
    </section>

    <el-card class="course-classes-table-card">
      <template #header>
        <div class="course-classes-table-card__header">
          <div>
            <span class="course-classes-table-card__title">开课班列表</span>
            <p class="course-classes-table-card__desc">桌面端支持快速查看课程、班级、教师和学期的绑定关系。</p>
          </div>
          <el-tag type="primary" effect="plain">当前页 {{ courseClasses.length }} 条</el-tag>
        </div>
      </template>

      <div class="course-classes-filters">
        <el-select
          v-model="selectedClassId"
          clearable
          filterable
          placeholder="按班级筛选开课班"
          style="width: 280px"
          @change="handleClassFilterChange"
        >
          <el-option
            v-for="classItem in classes"
            :key="classItem.id"
            :label="classItem.class_name"
            :value="classItem.id"
          />
        </el-select>
        <el-button @click="resetClassFilter">查看全部</el-button>
        <el-tag v-if="selectedClassId" type="info" effect="plain">已按班级筛选</el-tag>
      </div>

      <div class="table-shell">
        <el-table :data="courseClasses" border>
          <el-table-column prop="course_code" label="课程ID" width="120" />
          <el-table-column prop="course_name" label="课程名称" min-width="180" />
          <el-table-column prop="credit" label="学分" width="90" />
          <el-table-column prop="class_name" label="班级名称" min-width="160" />
          <el-table-column prop="teacher_name" label="任课教师" min-width="120" />
          <el-table-column prop="term_code" label="学期" width="140" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link @click="editCourseClass(row)">编辑</el-button>
              <el-button link style="color: #f56c6c" @click="deleteCourseClass(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog
      v-model="showCreateDialog"
      :title="isEdit ? '编辑课程与开课班' : '创建课程与开课班'"
      width="620px"
      @closed="resetForm"
    >
      <el-form :model="form" label-width="100px">
        <el-form-item label="所属学院">
          <el-select v-model="form.org_id" placeholder="请选择学院" @change="handleOrgChange">
            <el-option
              v-for="org in orgs"
              :key="org.id"
              :label="org.org_name"
              :value="org.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="课程ID">
          <el-input v-model="form.course_code" placeholder="例如：CS101" />
        </el-form-item>

        <el-form-item label="课程名称">
          <el-input v-model="form.course_name" placeholder="请输入课程名称" />
        </el-form-item>

        <el-form-item label="学分">
          <el-input-number v-model="form.credit" :min="0" :max="10" :step="0.5" />
        </el-form-item>

        <el-form-item label="班级">
          <el-select v-model="form.class_id" placeholder="请选择班级">
            <el-option
              v-for="classItem in filteredClasses"
              :key="classItem.id"
              :label="classItem.class_name"
              :value="classItem.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="任课教师">
          <el-select v-model="form.teacher_id" placeholder="请选择教师">
            <el-option
              v-for="teacher in teachers"
              :key="teacher.id"
              :label="teacher.name"
              :value="teacher.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="学期">
          <el-input v-model="form.term_code" placeholder="例如：2025-FALL" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImportDialog" title="导入课程与开课班" width="800px">
      <div style="padding: 20px">
        <ImportCsv @file-selected="handleFileChange" @data-parsed="handleDataParsed" />
        <p style="color: #999; margin-top: 16px">请上传包含以下字段的表格文件：</p>
        <p style="color: #999">
          org_name, course_code, course_name, credit, class_name, teacher_name, term_code
        </p>
      </div>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" @click="handleImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ImportCsv from '../components/ImportCsv.vue';
import {
  createCourseClass,
  deleteCourseClass as apiDeleteCourseClass,
  importCourseClasses as apiImportCourseClasses,
  listClasses,
  listCourseClasses,
  listOrgs,
  listTeachers,
  updateCourseClass,
} from '../api';

type IdNameRecord = {
  id: string;
  name?: string;
  org_id?: string;
  org_name?: string;
  class_name?: string;
};

type CourseClassRecord = {
  id: string;
  org_id?: string;
  course_code?: string;
  course_name?: string;
  credit?: number | string;
  class_id?: string;
  class_name?: string;
  teacher_id?: string;
  teacher_name?: string;
  term_code?: string;
  status?: string;
};

type CourseClassQuery = {
  class_id?: string;
};

const courseClasses = ref<CourseClassRecord[]>([]);
const classes = ref<IdNameRecord[]>([]);
const teachers = ref<IdNameRecord[]>([]);
const orgs = ref<IdNameRecord[]>([]);
const showCreateDialog = ref(false);
const showImportDialog = ref(false);
const isEdit = ref(false);
const importFile = ref<File | null>(null);
const parsedData = ref<any[]>([]);
const query = ref<CourseClassQuery>({
  class_id: '',
});
const selectedClassId = computed({
  get: () => query.value.class_id || '',
  set: (value: string) => {
    query.value.class_id = value || '';
  },
});

const createEmptyForm = () => ({
  id: '',
  org_id: '',
  course_code: '',
  course_name: '',
  credit: 0,
  class_id: '',
  teacher_id: '',
  term_code: '',
});

const form = ref(createEmptyForm());

const filteredClasses = computed(() => {
  if (!form.value.org_id) {
    return classes.value;
  }
  return classes.value.filter((classItem) => String(classItem.org_id || '') === String(form.value.org_id));
});

const uniqueClassCount = computed(
  () => new Set(courseClasses.value.map((item) => String(item.class_id || item.class_name || '')).filter(Boolean)).size,
);

const uniqueTeacherCount = computed(
  () => new Set(courseClasses.value.map((item) => String(item.teacher_id || item.teacher_name || '')).filter(Boolean)).size,
);

const uniqueTermCount = computed(
  () => new Set(courseClasses.value.map((item) => String(item.term_code || '')).filter(Boolean)).size,
);

const parseCourseCode = (value: unknown) => {
  const code = String(value || '').trim().toUpperCase();
  const match = code.match(/^([A-Z]+)(\d+)(.*)$/);

  if (!match) {
    return {
      prefix: code,
      number: Number.POSITIVE_INFINITY,
      suffix: '',
      raw: code,
    };
  }

  return {
    prefix: match[1],
    number: Number(match[2]),
    suffix: match[3] || '',
    raw: code,
  };
};

const compareCourseCode = (left: unknown, right: unknown) => {
  const leftParsed = parseCourseCode(left);
  const rightParsed = parseCourseCode(right);

  if (leftParsed.prefix !== rightParsed.prefix) {
    return leftParsed.prefix.localeCompare(rightParsed.prefix, 'zh-CN');
  }
  if (leftParsed.number !== rightParsed.number) {
    return leftParsed.number - rightParsed.number;
  }
  if (leftParsed.suffix !== rightParsed.suffix) {
    return leftParsed.suffix.localeCompare(rightParsed.suffix, 'zh-CN');
  }

  return leftParsed.raw.localeCompare(rightParsed.raw, 'zh-CN', { numeric: true });
};

const sortCourseClasses = (list: CourseClassRecord[]) => {
  return [...list].sort((left, right) => {
    const codeDiff = compareCourseCode(left.course_code, right.course_code);
    if (codeDiff !== 0) {
      return codeDiff;
    }

    const classDiff = String(left.class_name || '').localeCompare(String(right.class_name || ''), 'zh-CN', {
      numeric: true,
    });
    if (classDiff !== 0) {
      return classDiff;
    }

    return String(left.term_code || '').localeCompare(String(right.term_code || ''), 'zh-CN', {
      numeric: true,
    });
  });
};

const resetForm = () => {
  form.value = createEmptyForm();
  isEdit.value = false;
};

const openCreateDialog = () => {
  resetForm();
  showCreateDialog.value = true;
};

const loadCourseClasses = async () => {
  try {
    const resp = await listCourseClasses({
      class_id: query.value.class_id || undefined,
      pageSize: 200,
    });
    if (resp.code === 0) {
      const list = Array.isArray(resp.data?.list) ? resp.data.list : [];
      courseClasses.value = sortCourseClasses(list);
    } else {
      ElMessage.error(resp.message || '加载失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
  }
};

const handleClassFilterChange = async () => {
  await loadCourseClasses();
};

const resetClassFilter = async () => {
  query.value.class_id = '';
  await loadCourseClasses();
};

const loadClasses = async () => {
  try {
    const resp = await listClasses();
    if (resp.code === 0) {
      classes.value = Array.isArray(resp.data) ? resp.data : [];
    } else {
      ElMessage.error(resp.message || '加载班级失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载班级失败');
  }
};

const loadTeachers = async () => {
  try {
    const resp = await listTeachers();
    if (resp.code === 0) {
      teachers.value = Array.isArray(resp.data?.list) ? resp.data.list : [];
    } else {
      ElMessage.error(resp.message || '加载教师失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载教师失败');
  }
};

const loadOrgs = async () => {
  try {
    const resp = await listOrgs();
    if (resp.code === 0) {
      orgs.value = Array.isArray(resp.data) ? resp.data : [];
    } else {
      ElMessage.error(resp.message || '加载学院失败');
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载学院失败');
  }
};

const handleOrgChange = () => {
  form.value.class_id = '';
};

const submitForm = async () => {
  try {
    if (!form.value.org_id) {
      ElMessage.warning('请选择所属学院');
      return;
    }
    if (!form.value.course_code) {
      ElMessage.warning('请输入课程ID');
      return;
    }
    if (!form.value.course_name) {
      ElMessage.warning('请输入课程名称');
      return;
    }
    if (!form.value.class_id) {
      ElMessage.warning('请选择班级');
      return;
    }
    if (!form.value.teacher_id) {
      ElMessage.warning('请选择任课教师');
      return;
    }
    if (!form.value.term_code) {
      ElMessage.warning('请填写学期');
      return;
    }

    const payload = {
      org_id: form.value.org_id,
      course_code: form.value.course_code.trim(),
      course_name: form.value.course_name.trim(),
      credit: form.value.credit,
      class_id: form.value.class_id,
      teacher_id: form.value.teacher_id,
      term_code: form.value.term_code.trim(),
    };

    const resp = isEdit.value
      ? await updateCourseClass(form.value.id, payload)
      : await createCourseClass(payload);

    if (resp.code === 0) {
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      showCreateDialog.value = false;
      resetForm();
      await loadCourseClasses();
      return;
    }

    ElMessage.error(resp.message || (isEdit.value ? '更新失败' : '创建失败'));
  } catch (e: any) {
    ElMessage.error(e?.message || (isEdit.value ? '更新失败' : '创建失败'));
  }
};

const editCourseClass = (courseClass: CourseClassRecord) => {
  isEdit.value = true;
  form.value = {
    id: String(courseClass.id || ''),
    org_id: String(courseClass.org_id || ''),
    course_code: String(courseClass.course_code || ''),
    course_name: String(courseClass.course_name || ''),
    credit: Number(courseClass.credit || 0),
    class_id: String(courseClass.class_id || ''),
    teacher_id: String(courseClass.teacher_id || ''),
    term_code: String(courseClass.term_code || ''),
  };
  showCreateDialog.value = true;
};

const deleteCourseClass = async (courseClass: CourseClassRecord) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除课程与开课班 ${courseClass.course_name || ''} - ${courseClass.class_name || ''} 吗？`,
      '确认删除',
      { type: 'warning' },
    );

    const resp = await apiDeleteCourseClass(String(courseClass.id));
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      await loadCourseClasses();
      return;
    }

    ElMessage.error(resp.message || '删除失败');
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') {
      ElMessage.error(e?.message || '删除失败');
    }
  }
};

const handleFileChange = (file: File) => {
  importFile.value = file;
  ElMessage.success('文件已选择');
};

const handleDataParsed = (data: any[]) => {
  parsedData.value = Array.isArray(data) ? data : [];
  ElMessage.success(`成功解析 ${parsedData.value.length} 条数据`);
};

const handleImport = async () => {
  if (!importFile.value || parsedData.value.length === 0) {
    ElMessage.warning('请先选择并解析表格文件');
    return;
  }

  try {
    const processedData = parsedData.value.map((row: any) => ({
      org_name: row.org_name || '',
      course_code: row.course_code || '',
      course_name: row.course_name || '',
      credit: row.credit || '',
      class_name: row.class_name || '',
      teacher_name: row.teacher_name || '',
      term_code: row.term_code || '',
    }));

    const resp = await apiImportCourseClasses(processedData);
    if (resp.code === 0) {
      const success = Number(resp.data?.success || 0);
      const failed = Number(resp.data?.failed || 0);
      const errors = Array.isArray(resp.data?.errors) ? resp.data.errors : [];

      if (errors.length > 0) {
        ElMessage({
          type: 'warning',
          duration: 5000,
          message: `导入完成，成功 ${success} 条，失败 ${failed} 条。失败原因：${errors.join('；')}`,
        });
      } else {
        ElMessage.success(`导入完成，成功 ${success} 条，失败 ${failed} 条`);
      }

      showImportDialog.value = false;
      importFile.value = null;
      parsedData.value = [];
      await loadCourseClasses();
      return;
    }

    ElMessage.error(resp.message || '导入失败');
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败');
  }
};

onMounted(async () => {
  await loadOrgs();
  await loadClasses();
  await loadTeachers();
  await loadCourseClasses();
});
</script>

<style scoped>
.course-classes-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.course-classes-hero {
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

.course-classes-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.course-classes-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.course-classes-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.course-classes-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.course-classes-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.course-classes-hero__meta {
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

.course-classes-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.course-classes-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.course-classes-overview__card {
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

.course-classes-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.course-classes-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.course-classes-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.course-classes-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.course-classes-table-card {
  overflow: hidden;
}

.course-classes-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.course-classes-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.course-classes-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1200px) {
  .course-classes-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .course-classes-hero {
    padding: 20px;
  }

  .course-classes-overview {
    grid-template-columns: 1fr;
  }

  .course-classes-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .course-classes-hero__actions > * {
    width: 100%;
  }
}
</style>
