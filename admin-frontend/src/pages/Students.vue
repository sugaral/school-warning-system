<template>
  <div class="students-page">
    <section class="students-hero">
      <div class="students-hero__copy">
        <span class="students-hero__eyebrow">Roster Console</span>
        <h2 class="students-hero__title">{{ pageTitle }}</h2>
        <p class="students-hero__desc">
          统一管理学生档案、班级归属、联系方式和微信绑定状态。
        </p>
        <p v-if="pageTip" class="students-page__tip">{{ pageTip }}</p>
      </div>
      <div class="students-hero__meta">
        <span>当前页</span>
        <strong>{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize || 1)) }}</strong>
        <small>共 {{ total }} 名学生</small>
      </div>
    </section>

    <section class="students-overview">
      <article class="students-overview__card">
        <span class="students-overview__label">当前结果</span>
        <strong class="students-overview__value">{{ students.length }}</strong>
        <p class="students-overview__desc">当前筛选条件下的页面数据量</p>
      </article>
      <article class="students-overview__card">
        <span class="students-overview__label">已绑微信</span>
        <strong class="students-overview__value">{{ boundWechatCount }}</strong>
        <p class="students-overview__desc">已完成微信绑定的学生数量</p>
      </article>
      <article class="students-overview__card">
        <span class="students-overview__label">未绑班级</span>
        <strong class="students-overview__value">{{ unboundClassCount }}</strong>
        <p class="students-overview__desc">仍处于仅注册或未绑定班级状态的学生</p>
      </article>
      <article class="students-overview__card">
        <span class="students-overview__label">当前选中</span>
        <strong class="students-overview__value">{{ selectedStudents.length }}</strong>
        <p class="students-overview__desc">可用于批量删除的当前勾选数量</p>
      </article>
    </section>

    <el-card class="students-toolbar-card">
      <div class="students-toolbar-grid">
        <div class="students-toolbar-grid__search">
          <el-input v-model="searchKeyword" placeholder="搜索学号/姓名" clearable @keyup.enter="loadStudents">
            <template #append>
              <el-button @click="loadStudents">搜索</el-button>
            </template>
          </el-input>
        </div>
        <div class="students-toolbar-grid__filter">
          <el-select v-model="searchClassId" placeholder="选择班级" clearable style="width: 100%" @change="loadStudents">
            <el-option v-for="item in allClasses" :key="item.id" :label="item.class_name" :value="item.id" />
          </el-select>
        </div>
        <div class="students-toolbar-actions">
          <el-button type="info" icon="Refresh" @click="loadDashboardData">刷新</el-button>
          <el-button v-if="canImportStudents" type="success" plain icon="Upload" @click="triggerUpload('.xlsx,.xls')">导入 XLSX</el-button>
          <el-button v-if="canImportStudents" type="success" icon="Upload" @click="triggerUpload">导入 CSV</el-button>
          <el-button v-if="canBatchCreateStudents" type="warning" @click="showBatchDialog = true">批量创建</el-button>
          <el-button
            v-if="canDeleteStudents"
            type="danger"
            :disabled="selectedStudents.length === 0"
            @click="batchDeleteSelectedStudents"
          >
            批量删除{{ selectedStudents.length > 0 ? `(${selectedStudents.length})` : '' }}
          </el-button>
          <el-button v-if="canCreateStudents" type="primary" @click="openCreateDialog">添加学生</el-button>
          <input ref="fileInput" type="file" style="display: none" :accept="fileInputAccept" @change="handleFileChange" />
        </div>
      </div>
    </el-card>

    <el-card class="students-table-card">
      <template #header>
        <div class="students-table-card__header">
          <div>
            <span class="students-table-card__title">学生列表</span>
            <p class="students-table-card__desc">桌面端支持一屏查看关键信息，窄屏会自动切换到堆叠卡片。</p>
          </div>
          <el-tag type="primary" effect="plain">总计 {{ total }} 人</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="students" v-loading="loading" border @selection-change="handleSelectionChange">
          <el-table-column v-if="canDeleteStudents" type="selection" width="55" />
          <el-table-column prop="account" label="账号" width="220">
            <template #default="{ row }">
              <div class="account-cell">
                <span>{{ row.account || row.student_no || '-' }}</span>
                <small v-if="row.student_no && row.student_no !== row.account">学号：{{ row.student_no }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="姓名" width="140" />
          <el-table-column prop="gender" label="性别" width="80">
            <template #default="{ row }">
              {{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="class_name" label="班级" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.class_name || '未绑定班级' }}</span>
              <el-tag v-if="row.is_registered_only" size="small" type="warning" class="row-tag">仅注册</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="mobile" label="手机号" width="170">
            <template #default="{ row }">
              <span class="mobile-cell">{{ row.mobile || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="email" label="邮箱" min-width="130" show-overflow-tooltip />
          <el-table-column prop="wx_openid" label="微信绑定" width="180">
            <template #default="{ row }">
              <div class="wechat-cell">
                <el-tag :type="row.wx_openid ? 'success' : 'info'">
                  {{ row.wx_openid ? '已绑定' : '未绑定' }}
                </el-tag>
                <small v-if="row.wx_openid">{{ row.wx_openid }}</small>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="actionColumnWidth">
            <template #default="{ row }">
              <el-button
                v-if="canEditStudents && !row.is_registered_only"
                type="primary"
                size="small"
                @click="editStudent(row)"
              >
                编辑
              </el-button>
              <el-button v-if="canDeleteStudents" type="danger" size="small" @click="deleteStudent(row)">删除</el-button>
              <el-button
                v-if="canUnbindWechat && row.wx_openid && !row.is_registered_only"
                type="warning"
                size="small"
                @click="unbindWechat(row)"
              >
                解绑微信
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <div v-if="showDeleteProgress" class="progress-block">
      <el-progress :percentage="batchProgress" :status="batchProgress === 100 ? 'success' : ''" />
      <div class="progress-text">正在删除学生...</div>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      class="pager"
      @change="loadStudents"
    />

    <el-dialog v-model="showCreateDialog" :title="editDialogTitle" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="学号" prop="student_no">
              <el-input v-model="form.student_no" :disabled="isEdit || isHeadTeacher" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" :disabled="isHeadTeacher && isEdit" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="性别">
              <el-select v-model="form.gender" style="width: 100%" :disabled="isHeadTeacher && isEdit">
                <el-option label="男" value="male" />
                <el-option label="女" value="female" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="学院" prop="org_id">
              <el-select v-model="form.org_id" style="width: 100%" :disabled="isHeadTeacher && isEdit" @change="handleFormOrgChange">
                <el-option v-for="org in orgList" :key="org.id" :label="org.org_name || org.name" :value="org.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="班级" prop="class_id">
              <el-select v-model="form.class_id" style="width: 100%" :disabled="!form.org_id">
                <el-option v-for="item in formClassOptions" :key="item.id" :label="item.class_name" :value="item.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态">
              <el-radio-group v-model="form.status">
                <el-radio value="active">正常</el-radio>
                <el-radio value="inactive">停用</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="手机号">
              <el-input v-model="form.mobile" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="form.email" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="紧急联系人">
              <el-input v-model="form.emergency_contact_name" placeholder="姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="紧急电话">
              <el-input v-model="form.emergency_contact_mobile" placeholder="电话" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBatchDialog" title="批量创建学生" width="520px" @open="onBatchDialogOpen">
      <el-form :model="batchForm" label-width="100px">
        <el-form-item label="选择学院">
          <el-select v-model="batchForm.org_id" placeholder="选择学院" style="width: 100%" @change="handleBatchOrgChange">
            <el-option v-for="org in orgList" :key="org.id" :label="org.org_name || org.name" :value="org.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="选择班级">
          <el-select v-model="batchForm.class_id" placeholder="选择班级" style="width: 100%" :disabled="!batchForm.org_id" @change="handleBatchClassChange">
            <el-option v-for="item in batchClassOptions" :key="item.id" :label="item.class_name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="batchForm.enroll_year" :min="2000" :max="2030" style="width: 100%" />
        </el-form-item>
        <el-form-item label="学生数量">
          <el-input-number v-model="batchForm.count" :min="1" :max="500" style="width: 100%" />
        </el-form-item>
        <el-form-item label="姓名前缀">
          <el-input v-model="batchForm.name_prefix" placeholder="可选，如：2024级" />
        </el-form-item>
        <el-form-item label="账号规则">
          <div class="account-tip">
            账号格式：当前年份({{ new Date().getFullYear() }}) + 学院ID(3位) + 班级ID(3位) + 序号(2位)
            <br>
            例如：2026001001 表示 2026 年入学，学院ID=001，班级ID=001，第 01 个学生
            <br>
            <span>密码设置请在“系统管理 → 系统配置 → 账号配置”中调整</span>
          </div>
        </el-form-item>
        <el-form-item v-if="batchProgress > 0" label="创建进度">
          <el-progress :percentage="batchProgress" :status="batchProgress === 100 ? 'success' : ''" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button :disabled="batchLoading" @click="showBatchDialog = false">取消</el-button>
        <el-button type="primary" :loading="batchLoading" @click="submitBatchCreate">开始创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, buildApiUrl } from '../api';
import { parseSpreadsheetFile } from '../lib/spreadsheet';
import { escapeHtml } from '../lib/format';
import {
  batchDeleteStudents as batchDeleteStudentProfiles,
  createStudent,
  deleteStudent as apiDeleteStudentProfile,
  importStudents,
  listClassesAdmin,
  listOrgs,
  listStudents,
  unbindWechat as apiUnbindWechat,
  updateStudent,
} from '../api';

const students = ref<any[]>([]);
const selectedStudents = ref<any[]>([]);
const allClasses = ref<any[]>([]);
const orgList = ref<any[]>([]);
const loading = ref(false);
const submitting = ref(false);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const searchKeyword = ref('');
const searchClassId = ref('');
const showCreateDialog = ref(false);
const isEdit = ref(false);
const formRef = ref();
const fileInput = ref<HTMLInputElement>();
const fileInputAccept = ref('.csv');
const currentRoles = ref<string[]>([]);
const showBatchDialog = ref(false);
const showDeleteProgress = ref(false);
const batchLoading = ref(false);
const batchProgress = ref(0);

const form = reactive({
  id: '',
  user_id: '',
  profile_id: '',
  student_no: '',
  name: '',
  gender: '',
  org_id: '',
  class_id: '',
  mobile: '',
  email: '',
  emergency_contact_name: '',
  emergency_contact_mobile: '',
  status: 'active',
});

const batchForm = reactive({
  org_id: '',
  class_id: '',
  enroll_year: new Date().getFullYear(),
  count: 30,
  name_prefix: '',
  password_type: 'digits',
  password_length: 8,
});

const rules = {
  org_id: [{ required: true, message: '请选择学院', trigger: 'change' }],
  student_no: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  class_id: [{ required: true, message: '请选择班级', trigger: 'change' }],
};

const isHeadTeacher = computed(() => currentRoles.value.includes('head_teacher'));
const canEditStudents = computed(() => currentRoles.value.includes('sys_admin') || currentRoles.value.includes('student_admin'));
const canCreateStudents = computed(() => canEditStudents.value);
const canImportStudents = computed(() => canCreateStudents.value);
const canBatchCreateStudents = computed(() => canCreateStudents.value);
const canDeleteStudents = computed(() => currentRoles.value.includes('sys_admin'));
const canUnbindWechat = computed(() => canEditStudents.value || isHeadTeacher.value);
const canLoadAccountConfig = computed(() => currentRoles.value.includes('sys_admin'));
const pageTitle = computed(() => (isHeadTeacher.value ? '本班学生' : '学生管理'));
const pageTip = computed(() => (isHeadTeacher.value ? '仅显示班主任权限范围内的本班学生，支持协助解绑微信。' : ''));
const editDialogTitle = computed(() => (isEdit.value ? '编辑学生' : '添加学生'));
const actionColumnWidth = computed(() => (canDeleteStudents.value ? 240 : canUnbindWechat.value ? 180 : 130));
const formClassOptions = computed(() => (!form.org_id ? [] : allClasses.value.filter((item: any) => String(item.org_id) === String(form.org_id))));
const batchClassOptions = computed(() => (!batchForm.org_id ? [] : allClasses.value.filter((item: any) => String(item.org_id) === String(batchForm.org_id))));
const boundWechatCount = computed(() => students.value.filter((item: any) => Boolean(item.wx_openid)).length);
const registeredOnlyCount = computed(() => students.value.filter((item: any) => Boolean(item.is_registered_only)).length);
const unboundClassCount = computed(() =>
  students.value.filter((item: any) => !item.class_name || item.is_registered_only).length,
);

const loadCurrentRoles = () => {
  try {
    const rolesFullRaw = localStorage.getItem('admin_roles_full');
    if (rolesFullRaw) {
      const rolesFull = JSON.parse(rolesFullRaw);
      if (Array.isArray(rolesFull)) {
        currentRoles.value = rolesFull.map((item: any) => String(item?.role || '')).filter(Boolean);
        return;
      }
    }
    const rolesRaw = localStorage.getItem('admin_roles');
    currentRoles.value = rolesRaw ? JSON.parse(rolesRaw) : [];
  } catch {
    currentRoles.value = [];
  }
};

const loadStudents = async () => {
  loading.value = true;
  try {
    const resp = await listStudents({
      page: page.value,
      pageSize: pageSize.value,
      keyword: searchKeyword.value,
      class_id: searchClassId.value,
    });
    if (resp.code === 0) {
      students.value = resp.data.list || [];
      total.value = resp.data.total || 0;
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载学生列表失败');
  } finally {
    loading.value = false;
  }
};

const loadClasses = async () => {
  const resp = await listClassesAdmin({ page: 1, pageSize: 200 });
  if (resp.code === 0) {
    allClasses.value = resp.data.list || [];
  }
};

const loadOrgs = async () => {
  const resp = await listOrgs();
  if (resp.code === 0) {
    orgList.value = resp.data || [];
  }
};

const loadAccountConfig = async () => {
  if (!canLoadAccountConfig.value) return;
  const resp = await api.get('/admin/config');
  if (resp.data.code === 0 && resp.data.data.account) {
    batchForm.password_type = resp.data.data.account.defaultPasswordType || 'digits';
    batchForm.password_length = resp.data.data.account.defaultPasswordLength || 8;
  }
};

const downloadStudentAccountCsv = (rows: Array<{ student_no: string; name: string; password: string }>, filenamePrefix = '学生账号') => {
  if (!rows.length) return;
  const csvContent = [
    ['学号', '姓名', '密码'].join(','),
    ...rows.map((row) => [row.student_no, row.name, row.password].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const handleSelectionChange = (selection: any[]) => {
  selectedStudents.value = selection;
};

const resetForm = () => {
  form.id = '';
  form.user_id = '';
  form.profile_id = '';
  form.student_no = '';
  form.name = '';
  form.gender = '';
  form.org_id = '';
  form.class_id = '';
  form.mobile = '';
  form.email = '';
  form.emergency_contact_name = '';
  form.emergency_contact_mobile = '';
  form.status = 'active';
  isEdit.value = false;
};

const openCreateDialog = () => {
  resetForm();
  showCreateDialog.value = true;
};

const handleFormOrgChange = () => {
  form.class_id = '';
};

const editStudent = (row: any) => {
  if (!canEditStudents.value || row.is_registered_only) return;
  isEdit.value = true;
  form.id = row.id;
  form.user_id = row.user_id || '';
  form.profile_id = row.profile_id || row.id;
  form.student_no = row.student_no || '';
  form.name = row.name || '';
  form.gender = row.gender || '';
  form.org_id = row.org_id || allClasses.value.find((item: any) => String(item.id) === String(row.class_id))?.org_id || '';
  form.class_id = row.class_id || '';
  form.mobile = row.mobile || '';
  form.email = row.email || '';
  form.emergency_contact_name = row.emergency_contact_name || '';
  form.emergency_contact_mobile = row.emergency_contact_mobile || '';
  form.status = row.status || 'active';
  showCreateDialog.value = true;
};

const submitForm = async () => {
  if (!isEdit.value && !canCreateStudents.value) {
    ElMessage.warning('当前无权新增学生');
    return;
  }
  if (isEdit.value && !canEditStudents.value) {
    ElMessage.warning('当前无权编辑学生');
    return;
  }
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const payload = {
      student_no: form.student_no,
      name: form.name,
      gender: form.gender,
      class_id: form.class_id,
      mobile: form.mobile,
      email: form.email,
      emergency_contact_name: form.emergency_contact_name,
      emergency_contact_mobile: form.emergency_contact_mobile,
      status: form.status,
    };
    const resp = isEdit.value ? await updateStudent(form.profile_id || form.id, payload) : await createStudent(payload);
    if (resp.code !== 0) {
      ElMessage.error(resp.message || '保存失败');
      return;
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功');
    showCreateDialog.value = false;
    const studentNo = resp.data?.student_no || form.student_no;
    const initialPassword = resp.data?.initial_password;
    resetForm();
    await loadStudents();
    if (!isEdit.value && initialPassword) {
      await ElMessageBox.alert(
        ['初始密码仅显示一次，请立即保存。', `学号：${escapeHtml(studentNo)}`, `初始密码：${escapeHtml(initialPassword)}`].join('<br/>'),
        '请立即保存账号密码',
        { confirmButtonText: '我已记录', dangerouslyUseHTMLString: true },
      );
    }
  } catch (error: any) {
    ElMessage.error(error?.message || (isEdit.value ? '更新失败' : '创建失败'));
  } finally {
    submitting.value = false;
  }
};

const deleteStudent = async (row: any) => {
  if (!canDeleteStudents.value) {
    ElMessage.warning('当前无权删除学生');
    return;
  }
  try {
     await ElMessageBox.confirm(`确定要删除学生 ${row.name}（${row.account || row.student_no || '-'}）吗？`, '确认删除', { type: 'warning' });
    const resp = row.is_registered_only ? await api.delete(`/admin/users/${row.user_id}`) : await apiDeleteStudentProfile(row.profile_id || row.id);
    const code = Number(resp?.data?.code ?? resp?.code ?? 0);
    if (code === 0) {
      ElMessage.success('删除成功');
      await loadStudents();
    } else {
      ElMessage.error(resp?.data?.message || resp?.message || '删除失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '删除失败');
    }
  }
};

const batchDeleteSelectedStudents = async () => {
  if (!canDeleteStudents.value) {
    ElMessage.warning('当前无权批量删除学生');
    return;
  }
  if (selectedStudents.value.length === 0) {
    ElMessage.warning('请选择要删除的学生');
    return;
  }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedStudents.value.length} 名学生吗？此操作不可恢复。`, '批量删除确认', { type: 'warning' });
    loading.value = true;
    showDeleteProgress.value = true;
    batchProgress.value = 0;
    const profileIds = selectedStudents.value.filter((item: any) => !item.is_registered_only).map((item: any) => item.profile_id || item.id);
    const userOnlyRows = selectedStudents.value.filter((item: any) => item.is_registered_only);
    if (profileIds.length > 0) {
      const resp = await batchDeleteStudentProfiles(profileIds);
      if (resp.code !== 0) {
        throw new Error(resp.message || '批量删除学生失败');
      }
    }
    for (const row of userOnlyRows) {
      const resp = await api.delete(`/admin/users/${row.user_id}`);
      if (Number(resp?.data?.code ?? 0) !== 0) {
        throw new Error(resp?.data?.message || '删除注册学生账号失败');
      }
    }
    batchProgress.value = 100;
    selectedStudents.value = [];
    ElMessage.success('批量删除成功');
    await loadStudents();
  } catch (error: any) {
    ElMessage.error(error?.message || '批量删除失败');
  } finally {
    loading.value = false;
    showDeleteProgress.value = false;
    batchProgress.value = 0;
  }
};

const unbindWechat = async (row: any) => {
  if (!canUnbindWechat.value || row.is_registered_only) return;
  try {
    await ElMessageBox.confirm(`确定要为学生 ${row.name}（${row.account || row.student_no || '-'}）解绑微信吗？`, '确认解绑', { type: 'warning' });
    const resp = await apiUnbindWechat(row.profile_id || row.id);
    if (resp.code === 0) {
      ElMessage.success('微信解绑成功');
      await loadStudents();
    } else {
      ElMessage.error(resp.message || '解绑失败');
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.message || '解绑失败');
    }
  }
};

const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target?.files?.[0];
  if (!file) return;
  try {
    const parsed = await parseSpreadsheetFile(file);
    target.value = '';
    const headers = parsed.headers.map((header) => header.trim().toLowerCase());
    const studentsData = parsed.rows.map((row) => {
      const rowData: Record<string, string> = {};
      headers.forEach((header, headerIndex) => {
        rowData[header] = String(row[parsed.headers[headerIndex]] || '').trim();
      });
      const student: any = {
        student_no: rowData.student_no || rowData['学号'],
        name: rowData.name || rowData['姓名'],
        gender: rowData.gender || rowData['性别'],
        mobile: rowData.mobile || rowData['手机号'],
        email: rowData.email || rowData['邮箱'],
        class_name: rowData.class_name || rowData['班级名称'],
        enroll_year: rowData.enroll_year || rowData['入学年份'],
        major: rowData.major || rowData['专业'],
        emergency_contact_name: rowData.emergency_contact_name || rowData['紧急联系人姓名'],
        emergency_contact_mobile: rowData.emergency_contact_mobile || rowData['紧急联系人电话'],
      };
      if (student.gender === '男') student.gender = 'male';
      if (student.gender === '女') student.gender = 'female';
      return student;
    }).filter((item) => item.student_no || item.name);

    if (studentsData.length === 0) {
      ElMessage.error('解析失败，未找到学生数据');
      return;
    }

    loading.value = true;
    try {
      const resp = await importStudents(studentsData);
      if (resp.code === 0) {
        if (resp.data?.students?.length > 0) {
          downloadStudentAccountCsv(resp.data.students, '导入学生账号');
        }
        if (resp.data?.errors?.length > 0) {
          const errorMessage = resp.data.errors.join('，');
          ElMessage({ message: `导入成功 ${resp.data.success} 条，失败 ${resp.data.failed} 条。失败原因：${errorMessage}`, type: 'warning', duration: 5000 });
        } else {
          ElMessage.success(`导入成功，成功 ${resp.data.success} 条，失败 ${resp.data.failed} 条`);
        }
        await loadStudents();
      } else {
        ElMessage.error(resp.message || '导入失败');
      }
    } finally {
      loading.value = false;
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '文件解析失败');
  }
};

const triggerUpload = (accept = '.csv') => {
  if (!canImportStudents.value) {
    ElMessage.warning('当前无权导入学生');
    return;
  }
  fileInputAccept.value = accept;
  fileInput.value?.click();
};

const handleBatchOrgChange = () => {
  batchForm.class_id = '';
  batchForm.enroll_year = new Date().getFullYear();
};

const handleBatchClassChange = () => {
  const selectedClass = batchClassOptions.value.find((item: any) => item.id === batchForm.class_id);
  if (selectedClass?.enroll_year) {
    batchForm.enroll_year = selectedClass.enroll_year;
  }
};

const onBatchDialogOpen = async () => {
  await loadAccountConfig();
  batchForm.org_id = '';
  batchForm.class_id = '';
  batchForm.enroll_year = new Date().getFullYear();
  batchForm.count = 30;
  batchForm.name_prefix = '';
};

const submitBatchCreate = async () => {
  if (!canBatchCreateStudents.value) {
    ElMessage.warning('当前无权批量创建学生');
    return;
  }
  if (!batchForm.class_id) {
    ElMessage.warning('请选择班级');
    return;
  }
  if (batchForm.count < 1 || batchForm.count > 500) {
    ElMessage.warning('请输入正确的学生数量（1-500）');
    return;
  }

  batchLoading.value = true;
  batchProgress.value = 0;
  const token = localStorage.getItem('admin_token');
  if (!token) {
    ElMessage.error('请先登录');
    batchLoading.value = false;
    return;
  }
  try {
    const response = await fetch(buildApiUrl('/admin/students/batch-create'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        class_id: batchForm.class_id,
        count: batchForm.count,
        password_type: batchForm.password_type,
        password_length: batchForm.password_length,
        name_prefix: batchForm.name_prefix,
        enroll_year: batchForm.enroll_year,
      }),
    });
    if (!response.ok) {
      throw new Error('请求失败');
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const eventData = JSON.parse(line.slice(6));
          if (eventData.progress > 0) {
            batchProgress.value = eventData.progress;
          }
          if (eventData.progress === 100 || eventData.progress === -1) {
            if (eventData.data) {
              ElMessage.success(`创建完成：成功 ${eventData.data.success} 个，失败 ${eventData.data.failed} 个`);
              if (eventData.data.students?.length > 0) {
                downloadStudentAccountCsv(eventData.data.students, '学生账号');
              }
            }
            if (eventData.progress === -1) {
              ElMessage.error(eventData.message || '批量创建失败');
            }
            await loadStudents();
            batchForm.org_id = '';
            batchForm.class_id = '';
            batchForm.count = 30;
            batchForm.name_prefix = '';
            batchProgress.value = 0;
            showBatchDialog.value = false;
          }
        } catch (error) {
          console.error('解析创建进度失败', error);
        }
      }
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '批量创建失败');
  } finally {
    batchLoading.value = false;
    batchProgress.value = 0;
  }
};

const loadDashboardData = async () => {
  await Promise.all([
    loadStudents(),
    loadClasses(),
    loadOrgs(),
  ]);
  if (canLoadAccountConfig.value) {
    await loadAccountConfig();
  }
};

onMounted(() => {
  loadCurrentRoles();
  void loadDashboardData();
});
</script>

<style scoped>
.students-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.students-hero {
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

.students-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.students-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.students-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.students-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.students-hero__meta {
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

.students-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.students-page__tip {
  margin: 0;
  color: #6b7280;
  line-height: 1.7;
}

.students-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.students-overview__card {
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

.students-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.students-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.students-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.students-toolbar-card,
.students-table-card {
  overflow: hidden;
}

.students-toolbar-grid {
  display: grid;
  grid-template-columns: minmax(240px, 1.1fr) minmax(220px, 0.9fr) 1.8fr;
  gap: 14px;
  align-items: center;
}

.students-toolbar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.students-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.students-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.students-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.row-tag {
  margin-left: 8px;
}

.account-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-cell small {
  color: #94a3b8;
  font-size: 12px;
}

.mobile-cell {
  display: inline-block;
  white-space: nowrap;
  word-break: normal;
  letter-spacing: 0.01em;
}

.wechat-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wechat-cell small {
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-all;
}

.progress-block {
  margin-top: 20px;
}

.progress-text {
  text-align: center;
  margin-top: 10px;
  color: #909399;
}

.pager {
  margin-top: 16px;
  justify-content: flex-end;
}

.account-tip {
  color: #909399;
  font-size: 12px;
  line-height: 1.7;
}

.account-tip span {
  color: #e6a23c;
}

@media (max-width: 1200px) {
  .students-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .students-toolbar-grid {
    grid-template-columns: 1fr 1fr;
  }

  .students-toolbar-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  .students-hero {
    padding: 20px;
  }

  .students-overview {
    grid-template-columns: 1fr;
  }

  .students-toolbar-grid {
    grid-template-columns: 1fr;
  }

  .students-toolbar-actions {
    justify-content: stretch;
  }

  .students-toolbar-actions > * {
    flex: 1 1 100%;
  }

  .pager {
    justify-content: flex-start;
  }
}
</style>
