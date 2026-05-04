<template>
  <div class="page-container">
    <el-alert
      v-if="profileLoaded && !profile.is_bound"
      title="当前尚未绑定班级"
      description="请先完成班级绑定，后续的预警、请假和审批信息才会按真实班级范围展示。"
      type="warning"
      show-icon
      class="page-alert"
    >
      <template #default>
        <el-button type="primary" size="small" @click="goToBind">立即绑定</el-button>
      </template>
    </el-alert>

    <el-card class="panel-card">
      <template #header>
        <div class="card-header">
          <div>
            <h2 class="page-title">个人资料</h2>
            <p class="page-desc">可维护联系方式，也可以发起换班申请并上传佐证图片。</p>
          </div>
          <div class="header-actions">
            <el-button
              v-if="profileLoaded && profile.is_bound && !editing"
              type="warning"
              plain
              @click="openClassChangeDialog"
            >
              申请换班
            </el-button>
            <el-button v-if="!editing" type="primary" @click="startEdit">编辑资料</el-button>
            <template v-else>
              <el-button @click="cancelEdit">取消</el-button>
              <el-button type="primary" :loading="saving" @click="saveProfile">保存</el-button>
            </template>
          </div>
        </div>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="学号">{{ profile.student_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ profile.name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="账号">{{ profile.account || '-' }}</el-descriptions-item>
        <el-descriptions-item label="性别">
          <el-select
            v-if="editing"
            v-model="form.gender"
            placeholder="请选择性别"
            size="small"
            style="width: 100%"
          >
            <el-option label="男" value="male" />
            <el-option label="女" value="female" />
          </el-select>
          <span v-else>{{ genderText }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="班级">{{ profile.class_name || '未绑定' }}</el-descriptions-item>
        <el-descriptions-item label="学院">{{ profile.org_name || '未绑定' }}</el-descriptions-item>
        <el-descriptions-item label="专业">{{ profile.major || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入学年份">{{ profile.enroll_year || '-' }}</el-descriptions-item>
        <el-descriptions-item label="手机号">
          <el-input
            v-if="editing"
            v-model="form.mobile"
            size="small"
            placeholder="请输入手机号"
          />
          <span v-else>{{ profile.mobile || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="邮箱">
          <el-input
            v-if="editing"
            v-model="form.email"
            size="small"
            placeholder="请输入邮箱"
          />
          <span v-else>{{ profile.email || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="职务">
          <el-input
            v-if="editing"
            v-model="form.student_position"
            size="small"
            placeholder="例如：班长、学习委员"
          />
          <span v-else>{{ profile.student_position || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="紧急联系人">
          <el-input
            v-if="editing"
            v-model="form.emergency_contact_name"
            size="small"
            placeholder="请输入紧急联系人姓名"
          />
          <span v-else>{{ profile.emergency_contact_name || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="紧急联系电话">
          <el-input
            v-if="editing"
            v-model="form.emergency_contact_mobile"
            size="small"
            placeholder="请输入紧急联系电话"
          />
          <span v-else>{{ profile.emergency_contact_mobile || '-' }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="panel-card">
      <template #header>
        <div class="section-header">
          <span>换班申请记录</span>
        </div>
      </template>

      <el-empty v-if="!classChangeRequests.length" description="暂无换班申请记录" />
      <div v-else class="table-shell">
        <el-table :data="classChangeRequests" stripe>
          <el-table-column prop="current_class_name" label="当前班级" min-width="160" />
          <el-table-column prop="target_class_name" label="申请班级" min-width="160" />
          <el-table-column prop="target_org_name" label="目标学院" min-width="160" />
          <el-table-column prop="requested_head_teacher_name" label="审核班主任" min-width="140" />
          <el-table-column prop="reason" label="申请原因" min-width="240" show-overflow-tooltip />
          <el-table-column label="佐证图片" width="120" align="center">
            <template #default="{ row }">
              <el-button
                v-if="row.evidence_file_ids?.length"
                link
                type="primary"
                @click="openPreview(row.evidence_file_ids, '换班佐证')"
              >
                查看图片
              </el-button>
              <span v-else class="muted-text">未上传</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="140" align="center">
            <template #default="{ row }">
              <el-tag :type="getRequestTagType(row.status)">
                {{ getRequestStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column label="驳回原因" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.reject_reason || '-' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="classChangeDialogVisible" title="提交换班申请" width="620px">
      <el-form label-width="100px">
        <el-form-item label="目标班级" required>
          <el-select
            v-model="classChangeForm.target_class_id"
            placeholder="请选择目标班级"
            filterable
            style="width: 100%"
            @change="handleTargetClassChange"
          >
            <el-option
              v-for="item in classOptions"
              :key="item.id"
              :label="`${item.org_name} / ${item.class_name}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="审核班主任" required>
          <el-input
            :model-value="profile.head_teacher_name || '当前班级未绑定班主任'"
            disabled
          />
          <div v-if="!profile.head_teacher_user_id" class="field-tip">
            当前班级暂未绑定班主任，当前无法提交换班申请。
          </div>
        </el-form-item>

        <el-form-item label="申请原因" required>
          <el-input
            v-model="classChangeForm.reason"
            type="textarea"
            :rows="4"
            maxlength="200"
            show-word-limit
            placeholder="请说明需要更换班级的原因"
          />
        </el-form-item>

        <el-form-item label="佐证图片">
          <MultiImageUploadField
            v-model="classChangeForm.evidence_file_ids"
            v-model:file-urls="classChangeForm.evidence_file_urls"
            source="class-change-request"
            placeholder="点击上传换班佐证"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="classChangeDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submittingClassChange"
          @click="submitClassChangeRequest"
        >
          提交申请
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="previewVisible" :title="previewTitle" width="720px">
      <div v-loading="previewLoading" class="preview-wrapper">
        <div v-if="previewUrls.length" class="preview-grid">
          <el-image
            v-for="(url, index) in previewUrls"
            :key="`${url}-${index}`"
            :src="url"
            fit="contain"
            :preview-src-list="previewUrls"
            :initial-index="index"
            preview-teleported
            class="preview-image"
          />
        </div>
        <el-empty v-else description="暂无图片" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import MultiImageUploadField from '../../components/MultiImageUploadField.vue';
import {
  api,
  createStudentClassChangeRequest,
  listStudentAvailableClasses,
  listStudentClassChangeRequests,
} from '../../api';
import { setStudentBoundState } from '../../lib/binding';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../../lib/uploaded-files';

const router = useRouter();
const saving = ref(false);
const editing = ref(false);
const profileLoaded = ref(false);
const classChangeDialogVisible = ref(false);
const submittingClassChange = ref(false);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref('');
const previewUrls = ref<string[]>([]);
const availableClasses = ref<any[]>([]);
const classChangeRequests = ref<any[]>([]);

const profile = ref<any>({
  account: '',
  student_no: '',
  name: '',
  gender: '',
  class_id: '',
  class_name: '',
  org_name: '',
  major: '',
  enroll_year: '',
  mobile: '',
  email: '',
  student_position: '',
  emergency_contact_name: '',
  emergency_contact_mobile: '',
  is_bound: false,
});

const form = reactive({
  gender: '',
  mobile: '',
  email: '',
  student_position: '',
  emergency_contact_name: '',
  emergency_contact_mobile: '',
});

const classChangeForm = reactive({
  target_class_id: '',
  head_teacher_user_id: '',
  reason: '',
  evidence_file_ids: [] as string[],
  evidence_file_urls: [] as string[],
});

const genderText = computed(() => {
  if (profile.value.gender === 'male') return '男';
  if (profile.value.gender === 'female') return '女';
  return '未设置';
});

const classOptions = computed(() =>
  availableClasses.value.filter((item) => String(item.id) !== String(profile.value.class_id || '')),
);

const selectedClass = computed(() =>
  classOptions.value.find((item) => String(item.id) === String(classChangeForm.target_class_id)),
);

const goToBind = () => {
  router.push('/bind-class');
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
};

const getRequestStatusText = (status: string) => {
  const map: Record<string, string> = {
    pending_head: '待班主任审核',
    pending_head_teacher: '待班主任审核',
    pending_dean: '待副院长审批',
    pending_vice_dean: '待副院长审批',
    approved: '已通过',
    rejected: '已驳回',
  };
  return map[status] || status || '-';
};

const getRequestTagType = (status: string) => {
  const map: Record<string, string> = {
    pending_head: 'warning',
    pending_head_teacher: 'warning',
    pending_dean: 'primary',
    pending_vice_dean: 'primary',
    approved: 'success',
    rejected: 'danger',
  };
  return map[status] || 'info';
};

const fillEditForm = () => {
  form.gender = profile.value.gender || '';
  form.mobile = profile.value.mobile || '';
  form.email = profile.value.email || '';
  form.student_position = profile.value.student_position || '';
  form.emergency_contact_name = profile.value.emergency_contact_name || '';
  form.emergency_contact_mobile = profile.value.emergency_contact_mobile || '';
};

const loadProfile = async () => {
  try {
    const response = await api.get('/student/profile');
    if (response.data.code === 0) {
      profile.value = response.data.data;
      setStudentBoundState(Boolean(profile.value.is_bound));
      fillEditForm();
    } else {
      ElMessage.error(response.data.message || '加载个人资料失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载个人资料失败');
  } finally {
    profileLoaded.value = true;
  }
};

const loadAvailableClasses = async () => {
  try {
    const response = await listStudentAvailableClasses();
    if (response.code === 0) {
      availableClasses.value = Array.isArray(response.data) ? response.data : [];
    }
  } catch (error) {
    console.error('加载可选班级失败', error);
  }
};

const loadClassChangeRequests = async () => {
  try {
    const response = await listStudentClassChangeRequests();
    if (response.code === 0) {
      classChangeRequests.value = Array.isArray(response.data) ? response.data : [];
    }
  } catch (error) {
    console.error('加载换班申请记录失败', error);
  }
};

const startEdit = () => {
  fillEditForm();
  editing.value = true;
};

const cancelEdit = () => {
  fillEditForm();
  editing.value = false;
};

const saveProfile = async () => {
  const currentMobile = String(profile.value.mobile || '').trim();
  const nextMobile = String(form.mobile || '').trim();
  if (nextMobile !== currentMobile) {
    ElMessage.warning('手机号请在小程序中通过验证流程修改');
    return;
  }

  const currentEmail = String(profile.value.email || '').trim();
  const nextEmail = String(form.email || '').trim();
  if (nextEmail !== currentEmail) {
    ElMessage.warning('邮箱请通过绑定邮箱流程修改');
    return;
  }

  saving.value = true;
  try {
    const response = await api.put('/student/profile', {
      gender: form.gender,
      student_position: form.student_position,
      emergency_contact_name: form.emergency_contact_name,
      emergency_contact_mobile: form.emergency_contact_mobile,
    });

    if (response.data.code !== 0) {
      ElMessage.error(response.data.message || '保存失败');
      return;
    }

    ElMessage.success('资料已更新');
    editing.value = false;
    await loadProfile();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saving.value = false;
  }
};

const resetClassChangeForm = () => {
  classChangeForm.target_class_id = '';
  classChangeForm.head_teacher_user_id = String(profile.value.head_teacher_user_id || '');
  classChangeForm.reason = '';
  classChangeForm.evidence_file_ids = [];
  classChangeForm.evidence_file_urls = [];
};

const handleTargetClassChange = () => {
  classChangeForm.head_teacher_user_id = String(profile.value.head_teacher_user_id || '');
};

const openClassChangeDialog = () => {
  resetClassChangeForm();
  classChangeDialogVisible.value = true;
};

const submitClassChangeRequest = async () => {
  if (!classChangeForm.target_class_id) {
    ElMessage.warning('请选择目标班级');
    return;
  }
  if (!profile.value.head_teacher_user_id) {
    ElMessage.warning('当前班级尚未绑定班主任，暂时无法提交申请');
    return;
  }
  if (!classChangeForm.reason.trim()) {
    ElMessage.warning('请填写申请原因');
    return;
  }

  submittingClassChange.value = true;
  try {
    const response = await createStudentClassChangeRequest({
      target_class_id: classChangeForm.target_class_id,
      reason: classChangeForm.reason.trim(),
      evidence_file_id: classChangeForm.evidence_file_ids[0] || undefined,
      evidence_file_ids: classChangeForm.evidence_file_ids.length
        ? classChangeForm.evidence_file_ids
        : undefined,
    });

    if (response.code !== 0) {
      ElMessage.error(response.message || '提交失败');
      return;
    }

    ElMessage.success('换班申请已提交');
    classChangeDialogVisible.value = false;
    resetClassChangeForm();
    await loadClassChangeRequests();
  } catch (error: any) {
    ElMessage.error(error?.message || '提交失败');
  } finally {
    submittingClassChange.value = false;
  }
};

const openPreview = async (fileIds: string[] | string, title: string) => {
  previewVisible.value = true;
  previewLoading.value = true;
  previewTitle.value = title;
  revokeObjectUrls(previewUrls.value);
  previewUrls.value = [];

  try {
    previewUrls.value = await loadUploadedFileObjectUrls(fileIds);
  } catch (error: any) {
    previewVisible.value = false;
    ElMessage.error(error?.message || '加载图片失败');
  } finally {
    previewLoading.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadProfile(), loadAvailableClasses(), loadClassChangeRequests()]);
});

onBeforeUnmount(() => {
  revokeObjectUrls(previewUrls.value);
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-alert {
  margin-bottom: 0;
}

.panel-card {
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.page-desc {
  margin: 6px 0 0;
  color: #66798a;
  line-height: 1.6;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.table-shell {
  overflow-x: auto;
}

.field-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #d97706;
}

.muted-text {
  color: #8b98a7;
}

.preview-wrapper {
  min-height: 240px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.preview-image {
  width: 100%;
  min-height: 260px;
}
</style>
