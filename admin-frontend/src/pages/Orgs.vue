<template>
  <div class="orgs-page">
    <section class="orgs-hero">
      <div class="orgs-hero__copy">
        <span class="orgs-hero__eyebrow">College Directory</span>
        <h2 class="orgs-hero__title">学院管理</h2>
        <p class="orgs-hero__desc">维护学院主数据，并在编辑时直接管理该学院下的专业目录。</p>
      </div>
      <div class="orgs-hero__actions">
        <div class="orgs-hero__meta">
          <span>当前结果</span>
          <strong>{{ orgs.length }}</strong>
          <small>启用学院 {{ activeOrgCount }}</small>
        </div>
        <el-button type="primary" @click="showCreateDialog = true">添加学院</el-button>
        <el-button type="info" @click="loadOrgs" icon="Refresh">
          刷新
        </el-button>
      </div>
    </section>

    <section class="orgs-overview">
      <article class="orgs-overview__card">
        <span class="orgs-overview__label">学院数量</span>
        <strong class="orgs-overview__value">{{ orgs.length }}</strong>
        <p class="orgs-overview__desc">当前已加载的学院主数据总数</p>
      </article>
      <article class="orgs-overview__card">
        <span class="orgs-overview__label">学院代码</span>
        <strong class="orgs-overview__value">{{ orgCodeCount }}</strong>
        <p class="orgs-overview__desc">当前已配置学院代码的学院数量</p>
      </article>
      <article class="orgs-overview__card">
        <span class="orgs-overview__label">当前专业数</span>
        <strong class="orgs-overview__value">{{ currentMajors.length }}</strong>
        <p class="orgs-overview__desc">当前编辑学院下的专业数量</p>
      </article>
      <article class="orgs-overview__card">
        <span class="orgs-overview__label">组织类型</span>
        <strong class="orgs-overview__value">{{ uniqueOrgTypeCount }}</strong>
        <p class="orgs-overview__desc">当前学院列表覆盖的组织类型数量</p>
      </article>
    </section>

    <el-card class="orgs-table-card">
      <template #header>
        <div class="orgs-table-card__header">
          <div>
            <span class="orgs-table-card__title">学院列表</span>
            <p class="orgs-table-card__desc">桌面端支持快速查看学院代码和基础操作。</p>
          </div>
          <el-tag type="primary" effect="plain">当前 {{ orgs.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="orgs" v-loading="loading" border>
          <el-table-column prop="org_name" label="学院名称" />
          <el-table-column prop="org_code" label="学院代码" width="140" />
          <el-table-column label="操作" width="160">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="editOrg(row)">编辑</el-button>
              <el-button type="danger" size="small" @click="deleteOrg(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" :title="isEdit ? '编辑学院' : '添加学院'" width="700px">
      <el-form :model="form" label-width="100px" :rules="rules" ref="formRef">
        <el-form-item label="学院名称" prop="org_name">
          <el-input v-model="form.org_name" placeholder="例如：计算机学院" />
        </el-form-item>
        <el-form-item label="学院编码" prop="org_code">
          <el-input v-model="form.org_code" placeholder="例如：CS" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">正常</el-radio>
            <el-radio value="inactive">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <div v-if="isEdit" class="orgs-major-panel">
        <div class="orgs-major-panel__header">
          <h4>专业管理</h4>
          <el-button type="primary" size="small" @click="showAddMajorDialog">
            添加专业
          </el-button>
        </div>
        <div class="table-shell">
          <el-table :data="currentMajors" border style="width: 100%">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="专业名称" />
            <el-table-column prop="code" label="专业编码" width="120" />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
                  {{ row.status === 'active' ? '正常' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click="editMajor(row)">编辑</el-button>
                <el-button type="danger" size="small" @click="deleteMajor(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showMajorDialog" :title="isEditMajor ? '编辑专业' : '添加专业'" width="500px">
      <el-form :model="majorForm" label-width="100px" :rules="majorRules" ref="majorFormRef">
        <el-form-item label="专业名称" prop="name">
          <el-input v-model="majorForm.name" placeholder="例如：计算机科学与技术" />
        </el-form-item>
        <el-form-item label="专业编码" prop="code">
          <el-input v-model="majorForm.code" placeholder="例如：CS001" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="majorForm.status">
            <el-radio value="active">正常</el-radio>
            <el-radio value="inactive">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMajorDialog = false">取消</el-button>
        <el-button type="primary" @click="submitMajorForm" :loading="majorSubmitting">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listOrgs,
  createOrg,
  updateOrg,
  deleteOrg as apiDeleteOrg,
  listMajors,
  createMajor,
  updateMajor,
  deleteMajor as apiDeleteMajor,
} from '../api';

const orgs = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const majorSubmitting = ref(false);
const showCreateDialog = ref(false);
const showMajorDialog = ref(false);
const isEdit = ref(false);
const isEditMajor = ref(false);
const formRef = ref();
const majorFormRef = ref();
const currentOrgId = ref('');
const currentMajors = ref<any[]>([]);

const form = reactive({
  id: '',
  org_name: '',
  org_code: '',
  status: 'active',
});

const majorForm = reactive({
  id: '',
  name: '',
  code: '',
  status: 'active',
});

const rules = {
  org_name: [{ required: true, message: '请输入学院名称', trigger: 'blur' }],
  org_code: [{ required: true, message: '请输入学院编码', trigger: 'blur' }],
};

const majorRules = {
  name: [{ required: true, message: '请输入专业名称', trigger: 'blur' }],
};

const orgCodeCount = computed(
  () => orgs.value.filter((item: any) => String(item.org_code || '').trim()).length,
);

const uniqueOrgTypeCount = computed(
  () =>
    new Set(
      orgs.value.map((item: any) => String(item.org_code || '').trim()).filter(Boolean),
    ).size,
);

const loadOrgs = async () => {
  loading.value = true;
  try {
    const resp = await listOrgs();
    if (resp.code === 0) {
      orgs.value = resp.data;
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const loadMajors = async (orgId: string) => {
  try {
    const resp = await listMajors(orgId);
    if (resp.code === 0) {
      currentMajors.value = resp.data;
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载专业失败');
  }
};

const resetForm = () => {
  form.id = '';
  form.org_name = '';
  form.org_code = '';
  form.status = 'active';
  isEdit.value = false;
  currentOrgId.value = '';
  currentMajors.value = [];
};

const resetMajorForm = () => {
  majorForm.id = '';
  majorForm.name = '';
  majorForm.code = '';
  majorForm.status = 'active';
  isEditMajor.value = false;
};

const editOrg = (row: any) => {
  isEdit.value = true;
  form.id = row.id;
  form.org_name = row.org_name;
  form.org_code = row.org_code;
  form.status = row.status;
  currentOrgId.value = row.id;
  showCreateDialog.value = true;
  loadMajors(row.id);
};

const submitForm = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    let resp;
    if (isEdit.value) {
      resp = await updateOrg(form.id, form);
    } else {
      resp = await createOrg(form);
    }

    if (resp.code === 0) {
      ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
      showCreateDialog.value = false;
      resetForm();
      loadOrgs();
    } else {
      ElMessage.error(resp.message);
    }
  } catch (e: any) {
    ElMessage.error(e?.message || (isEdit.value ? '更新失败' : '创建失败'));
  } finally {
    submitting.value = false;
  }
};

const deleteOrg = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除学院 ${row.org_name} 吗？`, '确认删除', {
      type: 'warning',
    });

    const resp = await apiDeleteOrg(row.id);
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      loadOrgs();
    } else {
      ElMessage.error(resp.message);
    }
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e?.message || '删除失败');
    }
  }
};

const showAddMajorDialog = () => {
  resetMajorForm();
  showMajorDialog.value = true;
};

const editMajor = (row: any) => {
  isEditMajor.value = true;
  majorForm.id = row.id;
  majorForm.name = row.name;
  majorForm.code = row.code;
  majorForm.status = row.status;
  showMajorDialog.value = true;
};

const submitMajorForm = async () => {
  const valid = await majorFormRef.value?.validate().catch(() => false);
  if (!valid) return;

  majorSubmitting.value = true;
  try {
    let resp;
    if (majorForm.id) {
      resp = await updateMajor(majorForm.id, majorForm);
    } else {
      resp = await createMajor(currentOrgId.value, majorForm);
    }

    if (resp.code === 0) {
      ElMessage.success(majorForm.id ? '更新成功' : '创建成功');
      showMajorDialog.value = false;
      resetMajorForm();
      loadMajors(currentOrgId.value);
    } else {
      ElMessage.error(resp.message);
    }
  } catch (e: any) {
    ElMessage.error(e?.message || (majorForm.id ? '更新失败' : '创建失败'));
  } finally {
    majorSubmitting.value = false;
  }
};

const deleteMajor = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定要删除专业 ${row.name} 吗？`, '确认删除', {
      type: 'warning',
    });

    const resp = await apiDeleteMajor(row.id);
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      loadMajors(currentOrgId.value);
    } else {
      ElMessage.error(resp.message);
    }
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e?.message || '删除失败');
    }
  }
};

onMounted(loadOrgs);
</script>

<style scoped>
.orgs-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.orgs-hero {
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

.orgs-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.orgs-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.orgs-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.orgs-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.orgs-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.orgs-hero__meta {
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

.orgs-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.orgs-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.orgs-overview__card {
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

.orgs-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.orgs-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.orgs-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.orgs-table-card {
  overflow: hidden;
}

.orgs-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.orgs-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.orgs-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.orgs-major-panel {
  margin-top: 20px;
  border-top: 1px solid #ebeef5;
  padding-top: 20px;
}

.orgs-major-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.orgs-major-panel__header h4 {
  margin: 0;
}

@media (max-width: 1200px) {
  .orgs-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .orgs-hero {
    padding: 20px;
  }

  .orgs-overview {
    grid-template-columns: 1fr;
  }

  .orgs-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .orgs-hero__actions > * {
    width: 100%;
  }
}
</style>
