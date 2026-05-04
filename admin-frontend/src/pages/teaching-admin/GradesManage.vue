<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2>成绩管理</h2>
        <p>支持手动维护、CSV 导入、模板配置和成绩导出。</p>
      </div>
    </div>

    <div class="toolbar">
      <el-button type="warning" plain @click="openImportDialog('xlsx')">导入 XLSX</el-button>
      <el-input
        v-model="searchKeyword"
        placeholder="搜索学号或姓名"
        style="width: 220px"
        clearable
        @keyup.enter="loadGrades"
      />
      <el-select-v2
        v-model="searchClassId"
        placeholder="选择班级"
        style="width: 180px"
        clearable
        filterable
        :options="searchClassOptions"
      />
      <el-select-v2
        v-model="searchCourseId"
        placeholder="选择课程"
        style="width: 180px"
        clearable
        filterable
        :options="searchCourseOptions"
      />
      <el-select v-model="searchTermCode" placeholder="选择学期" style="width: 170px" clearable>
        <el-option v-for="term in termOptions" :key="term" :label="term" :value="term" />
      </el-select>
      <el-button type="primary" @click="loadGrades">搜索</el-button>
      <el-button @click="loadStats">刷新统计</el-button>
      <el-button type="success" @click="openCreateDialog">新增成绩</el-button>
      <el-button type="warning" @click="openImportDialog">导入 CSV</el-button>
      <el-button @click="downloadTemplate">下载模板</el-button>
      <el-button type="info" @click="exportGrades">导出成绩</el-button>
    </div>

    <el-card class="stats-card" v-loading="statsLoading">
      <template #header>
        <span>成绩统计</span>
      </template>
      <el-row :gutter="16">
        <el-col :span="4"><div class="stat-item"><div class="label">总记录数</div><div class="value">{{ stats.totalCount }}</div></div></el-col>
        <el-col :span="4"><div class="stat-item"><div class="label">平均分</div><div class="value">{{ stats.avgScore }}</div></div></el-col>
        <el-col :span="4"><div class="stat-item"><div class="label">最高分</div><div class="value">{{ stats.maxScore }}</div></div></el-col>
        <el-col :span="4"><div class="stat-item"><div class="label">最低分</div><div class="value">{{ stats.minScore }}</div></div></el-col>
        <el-col :span="4"><div class="stat-item"><div class="label">及格数</div><div class="value success">{{ stats.passCount }}</div></div></el-col>
        <el-col :span="4"><div class="stat-item"><div class="label">及格率</div><div class="value success">{{ stats.passRate }}</div></div></el-col>
      </el-row>
    </el-card>

    <div class="table-shell">
    <el-table :data="grades" v-loading="loading" border stripe style="margin-top: 20px">
      <el-table-column prop="student_no" label="学号" width="130" />
      <el-table-column prop="student_name" label="姓名" width="110" />
      <el-table-column prop="class_name" label="班级" width="180" />
      <el-table-column prop="course_name" label="课程" min-width="180" />
      <el-table-column prop="term_code" label="学期" width="150" />
      <el-table-column prop="score" label="成绩" width="100">
        <template #default="{ row }">
          <el-tag :type="Number(row.score) >= 60 ? 'success' : 'danger'">
            {{ row.score }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="pass_status" label="状态" width="100">
        <template #default="{ row }">
          {{ row.pass_status === 'pass' ? '及格' : '不及格' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="editGrade(row)">编辑</el-button>
          <el-button type="danger" size="small" @click="removeGrade(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-pagination
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      style="margin-top: 20px; justify-content: flex-end"
      @size-change="loadGrades"
      @current-change="loadGrades"
    />

    <el-dialog v-model="showCreateDialog" title="新增成绩" width="560px">
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="学院">
          <el-select-v2
            v-model="createForm.org_id"
            placeholder="请选择学院"
            style="width: 100%"
            filterable
            :options="orgOptions"
            @change="onCreateOrgChange"
          />
        </el-form-item>
        <el-form-item label="班级">
          <el-select-v2
            v-model="createForm.class_id"
            placeholder="请选择班级"
            style="width: 100%"
            :disabled="!createForm.org_id"
            filterable
            :options="filteredClassOptions"
            @change="onCreateClassChange"
          />
        </el-form-item>
        <el-form-item label="学生">
          <el-select-v2
            v-model="createForm.student_id"
            placeholder="请选择学生"
            style="width: 100%"
            :disabled="!createForm.class_id"
            filterable
            :options="studentOptions"
          />
        </el-form-item>
        <el-form-item label="课程">
          <el-select-v2
            v-model="createForm.course_id"
            placeholder="请选择课程"
            style="width: 100%"
            :disabled="!createForm.org_id"
            filterable
            :options="filteredCourseOptions"
          />
        </el-form-item>
        <el-form-item label="学期">
          <el-select v-model="createForm.term_code" placeholder="请选择学期" style="width: 100%">
            <el-option v-for="term in termOptions" :key="term" :label="term" :value="term" />
          </el-select>
        </el-form-item>
        <el-form-item label="成绩">
          <el-input-number v-model="createForm.score" :min="0" :max="100" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="createGrade">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDialog" title="编辑成绩" width="420px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="学号"><span>{{ editForm.student_no }}</span></el-form-item>
        <el-form-item label="姓名"><span>{{ editForm.student_name }}</span></el-form-item>
        <el-form-item label="课程"><span>{{ editForm.course_name }}</span></el-form-item>
        <el-form-item label="成绩">
          <el-input-number v-model="editForm.score" :min="0" :max="100" style="width: 100%" />
        </el-form-item>
      </el-form>
      <el-alert
        :title="requiresSpecialApproval ? '提交后将进入特殊审批流程' : '系统管理员保存后会直接生效'"
        :description="gradeEditHintText"
        :type="requiresSpecialApproval ? 'warning' : 'success'"
        :closable="false"
      />
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" :loading="saveLoading" @click="saveGrade">
          {{ gradeEditActionText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showTemplateDialog" title="导入模板设置" width="760px">
      <el-alert
        title="模板说明"
        type="info"
        :closable="false"
        description="学号、学期、成绩为必需列，课程代码和课程名称至少启用一个。列名可按你自己的 CSV 表头修改。"
        style="margin-bottom: 16px"
      />
      <div class="table-shell">
      <el-table :data="gradeImportTemplate.fields" border>
        <el-table-column prop="label" label="字段" width="120" />
        <el-table-column prop="description" label="说明" min-width="180" />
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" :disabled="isRequiredTemplateField(row.key)" />
          </template>
        </el-table-column>
        <el-table-column label="必填" width="90">
          <template #default="{ row }">
            <el-switch v-model="row.required" :disabled="isRequiredTemplateField(row.key)" />
          </template>
        </el-table-column>
        <el-table-column label="CSV 列名" min-width="180">
          <template #default="{ row }">
            <el-input v-model.trim="row.columnName" placeholder="请输入 CSV 表头" />
          </template>
        </el-table-column>
      </el-table>
      </div>
      <template #footer>
        <el-button @click="showTemplateDialog = false">取消</el-button>
        <el-button type="primary" :loading="templateSaving" @click="saveTemplate">保存模板</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImportDialog" :title="importDialogTitle" width="700px">
      <el-alert
        title="导入要求"
        type="warning"
        :closable="false"
        :description="importHint"
        style="margin-bottom: 16px"
      />

      <el-upload
        drag
        :auto-upload="false"
        :limit="1"
        :accept="importFileAccept"
        :show-file-list="true"
        :on-change="handleImportFileChange"
        :on-remove="resetImportFile"
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">拖拽表格文件到这里，或 <em>点击选择</em></div>
      </el-upload>

      <div v-if="importPreviewHeaders.length" class="import-preview">
        <div class="preview-title">检测到的表头</div>
        <el-tag v-for="header in importPreviewHeaders" :key="header" style="margin: 0 8px 8px 0">
          {{ header }}
        </el-tag>
        <p class="preview-meta">共解析 {{ importRows.length }} 行数据。</p>
      </div>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { UploadFilled } from '@element-plus/icons-vue';
import { computed, onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { parseSpreadsheetFile } from '../../lib/spreadsheet';
import {
  createTeachingAdminGrade,
  deleteTeachingAdminGrade,
  getTeachingAdminClasses,
  exportTeachingAdminGrades,
  getTeachingAdminCourses,
  getTeachingAdminGradeImportTemplate,
  getTeachingAdminOrgs,
  getTeachingAdminGrades,
  getTeachingAdminGradesStats,
  getTeachingAdminSemesterConfig,
  getTeachingAdminStudents,
  importTeachingAdminGrades,
  setTeachingAdminGradeImportTemplate,
  updateTeachingAdminGrade,
} from '../../api';

const loading = ref(false);
const statsLoading = ref(false);
const createLoading = ref(false);
const saveLoading = ref(false);
const importing = ref(false);
const templateSaving = ref(false);
const grades = ref<any[]>([]);
const classes = ref<any[]>([]);
const orgs = ref<any[]>([]);
const courses = ref<any[]>([]);
const createStudents = ref<any[]>([]);
const createStudentCache = ref<Record<string, any[]>>({});
const importRows = ref<Array<Record<string, string>>>([]);
const importPreviewHeaders = ref<string[]>([]);

const searchKeyword = ref('');
const searchClassId = ref('');
const searchCourseId = ref('');
const searchTermCode = ref('');
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);

const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const showImportDialog = ref(false);
const showTemplateDialog = ref(false);
const importFileAccept = ref('.csv');
const importDialogTitle = computed(() =>
  importFileAccept.value.includes('xlsx') ? '导入成绩 XLSX' : '导入成绩 CSV',
);
const requiresSpecialApproval = computed(() => {
  try {
    const roles = JSON.parse(localStorage.getItem('admin_roles_full') || '[]');
    return !Array.isArray(roles) || !roles.some((item: any) => item.role === 'sys_admin');
  } catch {
    return true;
  }
});
const gradeEditActionText = computed(() => (requiresSpecialApproval.value ? '提交审批' : '保存'));
const gradeEditHintText = computed(() =>
  requiresSpecialApproval.value
    ? '当前角色保存后不会直接改成绩，而是提交到特殊审批，由教学副院长或系统管理员处理。'
    : '当前角色保存后会直接更新成绩数据。',
);

const stats = ref({
  totalCount: 0,
  avgScore: 0,
  maxScore: 0,
  minScore: 0,
  passCount: 0,
  passRate: '0%',
});

const termOptions = ref<string[]>([]);
const gradeImportTemplate = reactive({
  fields: [] as Array<any>,
});

const createDefaultGradeImportFields = () => ([
  { key: 'student_no', label: '学号', columnName: '学号', enabled: true, required: true },
  { key: 'student_name', label: '姓名', columnName: '姓名', enabled: true, required: false },
  { key: 'class_name', label: '班级', columnName: '班级', enabled: true, required: false },
  { key: 'course_code', label: '课程代码', columnName: '课程代码', enabled: true, required: false },
  { key: 'course_name', label: '课程名称', columnName: '课程名称', enabled: true, required: true },
  { key: 'term_code', label: '学期', columnName: '学期', enabled: true, required: true },
  { key: 'score', label: '成绩', columnName: '成绩', enabled: true, required: true },
]);

const deriveTermCode = (dateText?: string) => {
  const date = dayjs(dateText || undefined);
  const year = date.year();
  const month = date.month() + 1;
  if (month >= 2 && month <= 7) {
    return `${year}-SPRING`;
  }
  if (month >= 8) {
    return `${year}-FALL`;
  }
  return `${year - 1}-FALL`;
};

const shiftTermCode = (termCode: string, offset: number) => {
  const match = /^(\d{4})-(SPRING|FALL)$/.exec(String(termCode || '').trim());
  if (!match) {
    return termCode;
  }

  let year = Number(match[1]);
  let season = match[2];
  let steps = offset;

  while (steps !== 0) {
    if (steps > 0) {
      if (season === 'SPRING') {
        season = 'FALL';
      } else {
        year += 1;
        season = 'SPRING';
      }
      steps -= 1;
    } else {
      if (season === 'FALL') {
        season = 'SPRING';
      } else {
        year -= 1;
        season = 'FALL';
      }
      steps += 1;
    }
  }

  return `${year}-${season}`;
};

const createForm = reactive({
  org_id: '',
  class_id: '',
  student_id: '',
  course_id: '',
  term_code: '',
  score: 0,
});

const editForm = reactive({
  id: '',
  student_no: '',
  student_name: '',
  course_name: '',
  score: 0,
});

const filteredClasses = computed(() => {
  if (!createForm.org_id) return [];
  return classes.value.filter((item) => String(item.org_id) === String(createForm.org_id));
});

const filteredCourses = computed(() => {
  if (!createForm.org_id) return [];
  return courses.value.filter((item) => String(item.org_id) === String(createForm.org_id));
});

const toOption = (value: string, label: string, raw: any) => ({ value, label, raw });
const searchClassOptions = computed(() =>
  classes.value.map((item: any) => toOption(String(item.id), item.class_name || String(item.id), item)),
);
const searchCourseOptions = computed(() =>
  courses.value.map((item: any) => toOption(String(item.id), item.course_name || String(item.id), item)),
);
const orgOptions = computed(() =>
  orgs.value.map((item: any) => toOption(String(item.id), item.org_name || item.name || String(item.id), item)),
);
const filteredClassOptions = computed(() =>
  filteredClasses.value.map((item: any) => toOption(String(item.id), item.class_name || String(item.id), item)),
);
const filteredCourseOptions = computed(() =>
  filteredCourses.value.map((item: any) => toOption(String(item.id), item.course_name || String(item.id), item)),
);
const studentOptions = computed(() =>
  createStudents.value.map((item: any) =>
    toOption(String(item.user_id), `${item.student_no} - ${item.name}`, item),
  ),
);

const importHint = computed(() => {
  const enabledFields = gradeImportTemplate.fields
    .filter((field) => field.enabled)
    .map((field) => `${field.label}:${field.columnName}`);
  return enabledFields.length > 0
    ? `当前模板列为 ${enabledFields.join('，')}。`
    : '请先配置导入模板。';
});

const isRequiredTemplateField = (key: string) =>
  ['student_no', 'term_code', 'score'].includes(String(key || ''));

const buildTermOptions = async () => {
  let baseTerm = deriveTermCode();
  try {
    const response = await getTeachingAdminSemesterConfig();
    if (response.code === 0 && response.data?.semester_start_date) {
      baseTerm = deriveTermCode(response.data.semester_start_date);
    }
  } catch (error) {
    console.error('加载学期配置失败:', error);
  }

  termOptions.value = [
    shiftTermCode(baseTerm, -2),
    shiftTermCode(baseTerm, -1),
    baseTerm,
    shiftTermCode(baseTerm, 1),
  ];
};

const loadGrades = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: currentPage.value,
      pageSize: pageSize.value,
    };
    if (searchKeyword.value) params.keyword = searchKeyword.value;
    if (searchClassId.value) params.class_id = searchClassId.value;
    if (searchCourseId.value) params.course_id = searchCourseId.value;
    if (searchTermCode.value) params.term_code = searchTermCode.value;

    const response = await getTeachingAdminGrades(params);
    if (response.code === 0) {
      grades.value = response.data.list || [];
      total.value = response.data.total || 0;
    }
  } catch (error) {
    ElMessage.error('获取成绩列表失败');
  } finally {
    loading.value = false;
  }
};

const loadStats = async () => {
  statsLoading.value = true;
  try {
    const params: any = {};
    if (searchClassId.value) params.class_id = searchClassId.value;
    if (searchCourseId.value) params.course_id = searchCourseId.value;
    if (searchTermCode.value) params.term_code = searchTermCode.value;

    const response = await getTeachingAdminGradesStats(params);
    if (response.code === 0) {
      stats.value = response.data || stats.value;
    }
  } catch (error) {
    ElMessage.error('获取成绩统计失败');
  } finally {
    statsLoading.value = false;
  }
};

const loadOrgs = async () => {
  try {
    const response = await getTeachingAdminOrgs();
    if (response.code === 0) {
      orgs.value = response.data || [];
    }
  } catch (error) {
    console.error('加载学院列表失败:', error);
    ElMessage.error('加载学院列表失败');
  }
};

const loadClasses = async () => {
  try {
    const response = await getTeachingAdminClasses();
    if (response.code === 0) {
      classes.value = response.data || [];
    }
  } catch (error) {
    console.error('加载班级列表失败:', error);
    ElMessage.error('加载班级列表失败');
  }
};

const loadCourses = async () => {
  try {
    const response = await getTeachingAdminCourses();
    if (response.code === 0) {
      courses.value = response.data || [];
    }
  } catch (error) {
    console.error('加载课程列表失败:', error);
    ElMessage.error('加载课程列表失败');
  }
};

const loadCreateStudents = async () => {
  if (!createForm.class_id) {
    createStudents.value = [];
    return;
  }

  const cacheKey = `${String(createForm.org_id || '')}:${String(createForm.class_id || '')}`;
  if (createStudentCache.value[cacheKey]) {
    createStudents.value = createStudentCache.value[cacheKey];
    return;
  }

  const response = await getTeachingAdminStudents({
    pageSize: 1000,
    org_id: createForm.org_id || undefined,
    class_id: createForm.class_id || undefined,
  });
  if (response.code === 0) {
    const list = response.data.list || [];
    createStudentCache.value = {
      ...createStudentCache.value,
      [cacheKey]: list,
    };
    createStudents.value = list;
  }
};

const loadTemplate = async () => {
  try {
    const response = await getTeachingAdminGradeImportTemplate();
    if (response.code === 0) {
      const fields = Array.isArray(response.data?.fields) ? response.data.fields : [];
      gradeImportTemplate.fields = fields.length ? fields : createDefaultGradeImportFields();
    } else {
      gradeImportTemplate.fields = createDefaultGradeImportFields();
    }
  } catch (error) {
    console.error('加载成绩导入模板失败:', error);
    gradeImportTemplate.fields = createDefaultGradeImportFields();
  }
};

const onCreateOrgChange = async () => {
  createForm.class_id = '';
  createForm.student_id = '';
  createForm.course_id = '';
  createStudents.value = [];
};

const onCreateClassChange = async () => {
  createForm.student_id = '';
  await loadCreateStudents();
};

const openCreateDialog = () => {
  createForm.org_id = '';
  createForm.class_id = '';
  createForm.student_id = '';
  createForm.course_id = '';
  createForm.term_code = termOptions.value[0] || '';
  createForm.score = 0;
  createStudents.value = [];
  showCreateDialog.value = true;
};

const createGrade = async () => {
  if (!createForm.org_id || !createForm.class_id || !createForm.student_id || !createForm.course_id || !createForm.term_code) {
    ElMessage.warning('请填写完整信息');
    return;
  }

  createLoading.value = true;
  try {
    await createTeachingAdminGrade({
      student_id: createForm.student_id,
      course_id: createForm.course_id,
      term_code: createForm.term_code,
      score: createForm.score,
    });
    showCreateDialog.value = false;
    ElMessage.success('成绩新增成功');
    await Promise.all([loadGrades(), loadStats()]);
  } catch (error) {
    ElMessage.error('创建成绩失败');
  } finally {
    createLoading.value = false;
  }
};

const editGrade = (row: any) => {
  editForm.id = row.id;
  editForm.student_no = row.student_no;
  editForm.student_name = row.student_name;
  editForm.course_name = row.course_name;
  editForm.score = Number(row.score) || 0;
  showEditDialog.value = true;
};

const saveGrade = async () => {
  saveLoading.value = true;
  try {
    const response = await updateTeachingAdminGrade(editForm.id, editForm.score);
    if (response.code !== 0) {
      throw new Error(response.message || '保存成绩失败');
    }
    showEditDialog.value = false;
    ElMessage.success(
      response.message || (requiresSpecialApproval.value ? '已提交成绩修正审批' : '成绩保存成功'),
    );
    await Promise.all([loadGrades(), loadStats()]);
  } catch (error: any) {
    ElMessage.error(error?.message || '保存成绩失败');
  } finally {
    saveLoading.value = false;
  }
};

const removeGrade = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定删除这条成绩记录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await deleteTeachingAdminGrade(row.id);
    ElMessage.success('删除成功');
    await Promise.all([loadGrades(), loadStats()]);
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除成绩失败');
    }
  }
};

const escapeCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const exportGrades = async () => {
  try {
    const response = await exportTeachingAdminGrades({
      class_id: searchClassId.value || undefined,
      course_id: searchCourseId.value || undefined,
      term_code: searchTermCode.value || undefined,
    });

    if (response.code !== 0 || !response.data?.length) {
      ElMessage.warning('暂无可导出的成绩数据');
      return;
    }

    const headers = Object.keys(response.data[0]);
    const rows = response.data.map((item: any) => headers.map((header) => escapeCsvCell(item[header])).join(','));
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `成绩导出_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    ElMessage.error('导出成绩失败');
  }
};

const openTemplateDialog = async () => {
  await loadTemplate();
  showTemplateDialog.value = true;
};

const saveTemplate = async () => {
  if (!gradeImportTemplate.fields.length) {
    ElMessage.warning('模板字段不能为空');
    return;
  }

  const hasCourseMatcher = gradeImportTemplate.fields.some(
    (field) => field.enabled && (field.key === 'course_code' || field.key === 'course_name'),
  );
  if (!hasCourseMatcher) {
    ElMessage.warning('课程代码和课程名称至少启用一个');
    return;
  }

  const duplicateNames = gradeImportTemplate.fields
    .filter((field) => field.enabled)
    .map((field) => String(field.columnName || '').trim().toLowerCase())
    .filter((name, index, list) => !!name && list.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    ElMessage.warning('启用字段的 CSV 列名不能重复');
    return;
  }

  templateSaving.value = true;
  try {
    const response = await setTeachingAdminGradeImportTemplate({
      fields: gradeImportTemplate.fields.map((field) => ({
        key: field.key,
        label: field.label,
        columnName: field.columnName,
        enabled: field.enabled,
        required: field.required,
      })),
    });
    if (response.code !== 0) {
      throw new Error(response.message || '保存模板失败');
    }
    gradeImportTemplate.fields = response.data.fields || gradeImportTemplate.fields;
    ElMessage.success('导入模板已保存');
    showTemplateDialog.value = false;
  } catch (error: any) {
    ElMessage.error(error?.message || '保存模板失败');
  } finally {
    templateSaving.value = false;
  }
};

const downloadTemplateLegacy = async () => {
  await loadTemplate();
  const headers = gradeImportTemplate.fields
    .filter((field) => field.enabled)
    .map((field) => field.columnName);
  const sample = gradeImportTemplate.fields
    .filter((field) => field.enabled)
    .map((field) => {
      switch (field.key) {
        case 'student_no':
          return '20250001';
        case 'student_name':
          return '张三';
        case 'class_name':
          return '计算机 2025-1 班';
        case 'course_code':
          return 'CS101';
        case 'course_name':
          return '高等数学';
        case 'term_code':
          return termOptions.value[0] || deriveTermCode();
        case 'score':
          return '85';
        default:
          return '';
      }
    });
  const csvContent = [headers.join(','), sample.map((item) => escapeCsvCell(item)).join(',')].join('\n');
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '成绩导入模板.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const downloadTemplate = async () => {
  try {
    await loadTemplate();
    const fields = gradeImportTemplate.fields.length
      ? gradeImportTemplate.fields
      : createDefaultGradeImportFields();
    const headers = fields
      .filter((field) => field.enabled)
      .map((field) => field.columnName);
    const sample = fields
      .filter((field) => field.enabled)
      .map((field) => {
        switch (field.key) {
          case 'student_no':
            return '20250001';
          case 'student_name':
            return '张三';
          case 'class_name':
            return '计算机 2025-1 班';
          case 'course_code':
            return 'CS101';
          case 'course_name':
            return '高等数学';
          case 'term_code':
            return termOptions.value[0] || deriveTermCode();
          case 'score':
            return '85';
          default:
            return '';
        }
      });
    const csvContent = [headers.join(','), sample.map((item) => escapeCsvCell(item)).join(',')].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '成绩导入模板.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error: any) {
    ElMessage.error(error?.message || '下载模板失败');
  }
};

const parseCsvLine = (line: string) => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((item) => item.trim());
};

const parseCsvText = (text: string) => {
  const normalized = text.replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV 至少需要表头和一行数据');
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });

  return { headers, rows };
};

const resetImportFile = () => {
  importRows.value = [];
  importPreviewHeaders.value = [];
};

const handleImportFileChange = async (file: UploadFile) => {
  const rawFile = file.raw;
  if (!rawFile) {
    return;
  }

  if (
    !rawFile.name.toLowerCase().endsWith('.csv') &&
    !rawFile.name.toLowerCase().endsWith('.xlsx') &&
    !rawFile.name.toLowerCase().endsWith('.xls')
  ) {
    ElMessage.error('仅支持上传 CSV、XLSX、XLS 文件');
    resetImportFile();
    return;
  }

  try {
    const parsed = await parseSpreadsheetFile(rawFile as File);
    importPreviewHeaders.value = parsed.headers;
    importRows.value = parsed.rows;
  } catch (error: any) {
    resetImportFile();
    ElMessage.error(error?.message || '表格解析失败');
  }
};

const openImportDialog = async (fileType: 'csv' | 'xlsx' = 'csv') => {
  await loadTemplate();
  resetImportFile();
  importFileAccept.value = fileType === 'xlsx' ? '.xlsx,.xls' : '.csv';
  showImportDialog.value = true;
};

const submitImport = async () => {
  if (!importRows.value.length) {
    ElMessage.warning('请先选择 CSV 文件');
    return;
  }

  importing.value = true;
  try {
    const response = await importTeachingAdminGrades({ rows: importRows.value });
    const result = response.data || {};
    if (response.code !== 0 && !(result.success || result.updated)) {
      throw new Error(response.message || '导入失败');
    }

    if (result.failed > 0) {
      await ElMessageBox.alert(
        [
          `新增 ${result.success || 0} 条，更新 ${result.updated || 0} 条，失败 ${result.failed || 0} 条。`,
          ...(Array.isArray(result.errors) ? result.errors.slice(0, 20) : []),
        ].join('\n'),
        '导入结果',
        { confirmButtonText: '知道了' },
      );
    } else {
      ElMessage.success(`导入完成，新增 ${result.success || 0} 条，更新 ${result.updated || 0} 条`);
    }

    showImportDialog.value = false;
    await Promise.all([loadGrades(), loadStats()]);
  } catch (error: any) {
    ElMessage.error(error?.message || '导入失败');
  } finally {
    importing.value = false;
  }
};

onMounted(async () => {
  await buildTermOptions();
  await Promise.allSettled([loadOrgs(), loadClasses(), loadCourses(), loadTemplate()]);
  await Promise.allSettled([loadGrades(), loadStats()]);
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0 0 8px;
}

.page-header p {
  margin: 0;
  color: #606266;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 20px;
}

.stats-card {
  margin-bottom: 20px;
}

.stat-item {
  padding: 14px;
  text-align: center;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.14);
  border-radius: 8px;
  backdrop-filter: blur(12px);
}

.stat-item .label {
  font-size: 14px;
  color: #606266;
  margin-bottom: 8px;
}

.stat-item .value {
  font-size: 24px;
  font-weight: 700;
  color: #409eff;
}

.stat-item .value.success {
  color: #67c23a;
}

.import-preview {
  margin-top: 16px;
}

.preview-title {
  margin-bottom: 10px;
  font-weight: 600;
}

.preview-meta {
  margin-top: 8px;
  color: #606266;
}
</style>
