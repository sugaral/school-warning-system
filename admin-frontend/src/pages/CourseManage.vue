<template>
  <div class="course-manage-page">
    <section class="course-manage-hero">
      <div class="course-manage-hero__copy">
        <span class="course-manage-hero__eyebrow">Course Catalog</span>
        <h2 class="course-manage-hero__title">课程管理</h2>
        <p class="course-manage-hero__desc">维护课程主数据、所属学院和状态，作为开课班、课表和成绩的基础目录。</p>
      </div>
      <div class="course-manage-hero__actions">
        <div class="course-manage-hero__meta">
          <span>当前结果</span>
          <strong>{{ courses.length }}</strong>
          <small>已编码课程 {{ activeCourseCount }}</small>
        </div>
        <el-button type="primary" @click="showCreateDialog = true">创建课程</el-button>
        <el-button type="success" @click="showImportDialog = true" icon="Upload">
          导入课程
        </el-button>
        <el-button type="info" @click="loadCourses" icon="Refresh">
          刷新
        </el-button>
      </div>
    </section>

    <section class="course-manage-overview">
      <article class="course-manage-overview__card">
        <span class="course-manage-overview__label">课程数量</span>
        <strong class="course-manage-overview__value">{{ courses.length }}</strong>
        <p class="course-manage-overview__desc">当前加载到页面的课程总数</p>
      </article>
      <article class="course-manage-overview__card">
        <span class="course-manage-overview__label">已编码课程</span>
        <strong class="course-manage-overview__value">{{ activeCourseCount }}</strong>
        <p class="course-manage-overview__desc">当前已录入课程代码的课程数量</p>
      </article>
      <article class="course-manage-overview__card">
        <span class="course-manage-overview__label">学院覆盖</span>
        <strong class="course-manage-overview__value">{{ uniqueOrgCount }}</strong>
        <p class="course-manage-overview__desc">当前结果涉及的学院数量</p>
      </article>
      <article class="course-manage-overview__card">
        <span class="course-manage-overview__label">平均学分</span>
        <strong class="course-manage-overview__value">{{ averageCreditText }}</strong>
        <p class="course-manage-overview__desc">当前结果中的平均课程学分</p>
      </article>
    </section>

    <el-card class="course-manage-table-card">
      <template #header>
        <div class="course-manage-table-card__header">
          <div>
            <span class="course-manage-table-card__title">课程目录</span>
            <p class="course-manage-table-card__desc">桌面端支持快速浏览课程编码、学分、学院和当前状态。</p>
          </div>
          <el-tag type="primary" effect="plain">当前页 {{ courses.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="courses" v-loading="loading">
          <el-table-column prop="course_code" label="课程ID" width="120" />
          <el-table-column prop="course_name" label="课程名称" />
          <el-table-column prop="credit" label="学分" width="80" />
          <el-table-column prop="org_name" label="所属学院" />
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button link @click="editCourse(row)">编辑</el-button>
              <el-button link @click="deleteCourse(row)" style="color: #f56c6c">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" :title="isEdit ? '编辑课程' : '创建课程'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="所属学院">
          <el-select v-model="form.org_id" placeholder="请选择学院">
            <el-option v-for="org in orgs" :key="org.id" :label="org.org_name" :value="org.id" />
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
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImportDialog" title="导入课程" width="500px">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :on-change="handleFileChange"
        accept=".csv,.xlsx,.xls"
        :limit="1"
      >
        <el-button type="primary">选择文件</el-button>
        <template #tip>
          <div class="el-upload__tip">支持 CSV、Excel 格式</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" @click="handleImport" :loading="importing">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const loading = ref(false);
const courses = ref<any[]>([]);
const orgs = ref<any[]>([]);
const showCreateDialog = ref(false);
const showImportDialog = ref(false);
const isEdit = ref(false);
const importing = ref(false);

const form = reactive({
  id: null as number | null,
  org_id: null as number | null,
  course_code: '',
  course_name: '',
  credit: 0,
  file: null as File | null
});

const activeCourseCount = computed(
  () => courses.value.filter((item: any) => String(item.course_code || '').trim().length > 0).length,
);

const uniqueOrgCount = computed(
  () => new Set(courses.value.map((item: any) => String(item.org_id || item.org_name || '')).filter(Boolean)).size,
);

const averageCreditText = computed(() => {
  if (!courses.value.length) return '0';
  const totalCredit = courses.value.reduce((sum: number, item: any) => sum + Number(item.credit || 0), 0);
  return (totalCredit / courses.value.length).toFixed(1);
});

const loadCourses = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/courses');
    if (response.data.code === 0) {
      courses.value = response.data.data;
    }
  } catch (error) {
    ElMessage.error('加载课程失败');
  } finally {
    loading.value = false;
  }
};

const loadOrgs = async () => {
  try {
    const response = await api.get('/orgs');
    if (response.data.code === 0) {
      orgs.value = response.data.data;
    }
  } catch (error) {
    console.error('加载学院失败', error);
  }
};

const submitForm = async () => {
  try {
    const url = isEdit.value ? `/admin/courses/${form.id}` : '/admin/courses';
    const method = isEdit.value ? 'put' : 'post';
    const response = await api[method](url, form);
    if (response.data.code === 0) {
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      showCreateDialog.value = false;
      loadCourses();
      resetForm();
    } else {
      ElMessage.error(response.data.message || '操作失败');
    }
  } catch (error) {
    ElMessage.error('操作失败');
  }
};

const editCourse = (row: any) => {
  isEdit.value = true;
  Object.assign(form, row);
  showCreateDialog.value = true;
};

const deleteCourse = async (row: any) => {
  try {
    await ElMessageBox.confirm('确定要删除该课程吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });
    const response = await api.delete('/admin/courses/' + row.id);
    if (response.data.code === 0) {
      ElMessage.success('删除成功');
      loadCourses();
    }
  } catch (error) {
    // 用户取消
  }
};

const handleFileChange = (file: any) => {
  form.file = file.raw;
};

const handleImport = async () => {
  if (!form.file) {
    ElMessage.warning('请选择文件');
    return;
  }
  importing.value = true;
  try {
    const formData = new FormData();
    formData.append('file', form.file);
    const response = await api.post('/admin/courses/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    if (response.data.code === 0) {
      ElMessage.success('导入成功');
      showImportDialog.value = false;
      loadCourses();
    } else {
      ElMessage.error(response.data.message || '导入失败');
    }
  } catch (error) {
    ElMessage.error('导入失败');
  } finally {
    importing.value = false;
  }
};

const resetForm = () => {
  isEdit.value = false;
  form.id = null;
  form.org_id = null;
  form.course_code = '';
  form.course_name = '';
  form.credit = 0;
};

onMounted(() => {
  loadCourses();
  loadOrgs();
});
</script>

<style scoped>
.course-manage-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.course-manage-hero {
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

.course-manage-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.course-manage-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.course-manage-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.course-manage-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.course-manage-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.course-manage-hero__meta {
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

.course-manage-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.course-manage-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.course-manage-overview__card {
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

.course-manage-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.course-manage-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.course-manage-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.course-manage-table-card {
  overflow: hidden;
}

.course-manage-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.course-manage-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.course-manage-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1200px) {
  .course-manage-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .course-manage-hero {
    padding: 20px;
  }

  .course-manage-overview {
    grid-template-columns: 1fr;
  }

  .course-manage-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .course-manage-hero__actions > * {
    width: 100%;
  }
}
</style>
