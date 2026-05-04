<template>
  <div class="teachers-page">
    <section class="teachers-hero">
      <div class="teachers-hero__copy">
        <span class="teachers-hero__eyebrow">Faculty Desk</span>
        <h2 class="teachers-hero__title">教师管理</h2>
        <p class="teachers-hero__desc">统一维护教师档案、所属学院、职位和账号联系方式。</p>
      </div>
      <div class="teachers-hero__actions">
        <div class="teachers-hero__meta">
          <span>当前页</span>
          <strong>{{ page }}</strong>
          <small>共 {{ total }} 名教师</small>
        </div>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="info" @click="loadTeachers">刷新</el-button>
        <el-button type="primary" @click="openCreateDialog">添加教师</el-button>
      </div>
    </section>

    <section class="teachers-overview">
      <article class="teachers-overview__card">
        <span class="teachers-overview__label">教师总量</span>
        <strong class="teachers-overview__value">{{ total }}</strong>
        <p class="teachers-overview__desc">当前筛选条件下的教师总数</p>
      </article>
      <article class="teachers-overview__card">
        <span class="teachers-overview__label">当前页结果</span>
        <strong class="teachers-overview__value">{{ teachers.length }}</strong>
        <p class="teachers-overview__desc">当前分页中展示的教师数量</p>
      </article>
      <article class="teachers-overview__card">
        <span class="teachers-overview__label">正常状态</span>
        <strong class="teachers-overview__value">{{ activeTeacherCount }}</strong>
        <p class="teachers-overview__desc">当前页处于正常状态的教师数量</p>
      </article>
      <article class="teachers-overview__card">
        <span class="teachers-overview__label">学院覆盖</span>
        <strong class="teachers-overview__value">{{ uniqueOrgCount }}</strong>
        <p class="teachers-overview__desc">当前结果覆盖的学院数量</p>
      </article>
    </section>

    <el-card class="teachers-toolbar-card">
      <div class="teachers-toolbar-grid">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索姓名/手机号/邮箱"
          clearable
          @keyup.enter="handleSearch"
        >
          <template #append>
            <el-button @click="handleSearch">搜索</el-button>
          </template>
        </el-input>
        <el-select
          v-model="selectedOrgId"
          placeholder="按学院筛选"
          clearable
          filterable
          style="width: 100%"
          @change="handleFilterChange"
        >
          <el-option
            v-for="org in orgs"
            :key="org.id"
            :label="org.org_name || org.name"
            :value="org.id"
          />
        </el-select>
      </div>
    </el-card>

    <el-card class="teachers-table-card">
      <template #header>
        <div class="teachers-table-card__header">
          <div>
            <span class="teachers-table-card__title">教师列表</span>
            <p class="teachers-table-card__desc">桌面端支持快速查看职位、学院、联系方式和状态。</p>
          </div>
          <el-tag type="primary" effect="plain">当前页 {{ teachers.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="teachers" v-loading="loading" border>
          <el-table-column prop="id" label="教师 ID" width="120" />
          <el-table-column prop="name" label="姓名" width="120" />
          <el-table-column prop="teacher_position" label="职位" width="140">
            <template #default="{ row }">
              {{ row.teacher_position || '未设置' }}
            </template>
          </el-table-column>
          <el-table-column prop="org_name" label="所在学院" width="180">
            <template #default="{ row }">
              {{ row.org_name || '未设置' }}
            </template>
          </el-table-column>
          <el-table-column prop="mobile" label="账号/手机号" width="160" />
          <el-table-column prop="email" label="邮箱" min-width="180" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
                {{ row.status === 'active' ? '正常' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="editTeacher(row)">编辑</el-button>
              <el-button type="danger" size="small" @click="deleteTeacherRecord(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        class="pagination"
        @change="loadTeachers"
      />
    </el-card>

    <el-dialog
      v-model="showCreateDialog"
      :title="isEdit ? '编辑教师' : '添加教师'"
      width="600px"
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" label-width="100px" :rules="rules">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="教师职位" prop="teacher_position">
              <el-select v-model="form.teacher_position" placeholder="选择职位" style="width: 100%">
                <el-option label="院长" value="院长" />
                <el-option label="副院长" value="副院长" />
                <el-option label="系主任" value="系主任" />
                <el-option label="副系主任" value="副系主任" />
                <el-option label="教授" value="教授" />
                <el-option label="副教授" value="副教授" />
                <el-option label="讲师" value="讲师" />
                <el-option label="助教" value="助教" />
                <el-option label="辅导员" value="辅导员" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="所在学院">
              <el-select v-model="form.org_id" placeholder="选择学院" style="width: 100%" clearable>
                <el-option
                  v-for="org in orgs"
                  :key="org.id"
                  :label="org.org_name || org.name"
                  :value="org.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号">
              <el-input v-model="form.mobile" placeholder="不填则自动分配账号" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
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
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createTeacher,
  deleteTeacher as apiDeleteTeacher,
  listOrgs,
  listTeachers,
  updateTeacher,
} from '../api';

const teachers = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const searchKeyword = ref('');
const selectedOrgId = ref('');
const showCreateDialog = ref(false);
const isEdit = ref(false);
const formRef = ref();
const orgs = ref<any[]>([]);

const form = reactive({
  id: '',
  name: '',
  teacher_position: '',
  org_id: '',
  mobile: '',
  email: '',
  status: 'active',
});

const rules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  teacher_position: [{ required: true, message: '请选择教师职位', trigger: 'change' }],
};

const activeTeacherCount = computed(
  () => teachers.value.filter((item: any) => String(item.status || '') === 'active').length,
);

const uniqueOrgCount = computed(
  () =>
    new Set(
      teachers.value
        .map((item: any) => String(item.org_id || item.org_name || ''))
        .filter(Boolean),
    ).size,
);

const loadTeachers = async () => {
  loading.value = true;
  try {
    const resp = await listTeachers({
      page: page.value,
      pageSize: pageSize.value,
      keyword: searchKeyword.value || undefined,
      org_id: selectedOrgId.value || undefined,
    });
    if (resp.code === 0) {
      teachers.value = resp.data.list || [];
      total.value = Number(resp.data.total || 0);
    } else {
      ElMessage.error(resp.message || '加载失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const loadOrgs = async () => {
  try {
    const resp = await listOrgs();
    if (resp.code === 0) {
      orgs.value = Array.isArray(resp.data) ? resp.data : [];
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载学院列表失败');
  }
};

const resetForm = () => {
  form.id = '';
  form.name = '';
  form.teacher_position = '';
  form.org_id = '';
  form.mobile = '';
  form.email = '';
  form.status = 'active';
  isEdit.value = false;
};

const openCreateDialog = () => {
  resetForm();
  showCreateDialog.value = true;
};

const editTeacher = (row: any) => {
  isEdit.value = true;
  form.id = String(row.id || '');
  form.name = row.name || '';
  form.teacher_position = row.teacher_position || '';
  form.org_id = row.org_id || '';
  form.mobile = row.mobile || '';
  form.email = row.email || '';
  form.status = row.status || 'active';
  showCreateDialog.value = true;
};

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      name: form.name,
      teacher_position: form.teacher_position,
      org_id: form.org_id || undefined,
      mobile: form.mobile || undefined,
      email: form.email || undefined,
      status: form.status,
    };

    const wasEditMode = isEdit.value;
    const resp = wasEditMode
      ? await updateTeacher(form.id, payload)
      : await createTeacher(payload);

    if (resp.code === 0) {
      ElMessage.success(wasEditMode ? '更新成功' : '创建成功');
      showCreateDialog.value = false;
      resetForm();
      await loadTeachers();

      if (!wasEditMode) {
        const accountText = String(resp.data?.account || payload.mobile || '').trim() || '-';
        const passwordText = String(resp.data?.initial_password || '').trim() || '-';
        await ElMessageBox.alert(
          [`账号：${accountText}`, `初始密码：${passwordText}`].join('<br/>'),
          '请立即保存账号密码',
          {
            dangerouslyUseHTMLString: true,
            confirmButtonText: '我已记录',
          },
        );
      }
    } else {
      ElMessage.error(resp.message || (wasEditMode ? '更新失败' : '创建失败'));
    }
  } catch (error: any) {
    ElMessage.error(error?.message || (isEdit.value ? '更新失败' : '创建失败'));
  } finally {
    submitting.value = false;
  }
};

const deleteTeacherRecord = async (row: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除教师 ${row.name}（${row.id}）吗？`,
      '确认删除',
      { type: 'warning' },
    );

    const resp = await apiDeleteTeacher(row.id);
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      await loadTeachers();
    } else {
      ElMessage.error(resp.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const handleSearch = async () => {
  page.value = 1;
  await loadTeachers();
};

const handleFilterChange = async () => {
  page.value = 1;
  await loadTeachers();
};

const resetFilters = async () => {
  searchKeyword.value = '';
  selectedOrgId.value = '';
  page.value = 1;
  await loadTeachers();
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

onMounted(async () => {
  await Promise.all([loadOrgs(), loadTeachers()]);
});
</script>

<style scoped>
.teachers-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.teachers-hero {
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

.teachers-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.teachers-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.teachers-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.teachers-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.teachers-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.teachers-hero__meta {
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

.teachers-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.teachers-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.teachers-overview__card {
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

.teachers-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.teachers-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.teachers-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.teachers-toolbar-card,
.teachers-table-card {
  overflow: hidden;
}

.teachers-toolbar-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1.2fr) minmax(220px, 0.8fr);
  gap: 14px;
}

.teachers-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.teachers-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.teachers-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}

@media (max-width: 1200px) {
  .teachers-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .teachers-toolbar-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .teachers-hero {
    padding: 20px;
  }

  .teachers-overview {
    grid-template-columns: 1fr;
  }

  .teachers-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .teachers-hero__actions > * {
    width: 100%;
  }
}
</style>
