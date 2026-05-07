<template>
  <div class="page-container">
    <el-alert
      v-if="profileLoaded && !profile.org_id"
      title="当前尚未绑定学院"
      description="请先完成学院绑定，之后再进行课程绑定和考勤管理。"
      type="warning"
      show-icon
      class="page-alert"
    >
      <template #default>
        <el-button type="primary" size="small" @click="goToBindOrg">立即绑定</el-button>
      </template>
    </el-alert>

    <el-card class="panel-card">
      <template #header>
        <div class="card-header">
          <div>
            <h2 class="page-title">个人资料</h2>
            <p class="page-desc">可维护教师个人信息，也可以发起学院变更申请并上传证明图片。</p>
          </div>
          <div class="header-actions">
            <el-button
              v-if="profileLoaded && profile.org_id && !editing"
              type="warning"
              plain
              @click="openOrgChangeDialog"
            >
              申请变更学院
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
        <el-descriptions-item label="姓名">
          <el-input
            v-if="editing"
            v-model="form.name"
            size="small"
            placeholder="请输入姓名"
          />
          <span v-else>{{ profile.name || '-' }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="账号">{{ profile.account || '-' }}</el-descriptions-item>
        <el-descriptions-item label="用户类型">教师</el-descriptions-item>
        <el-descriptions-item label="学院">{{ profile.org_name || '未绑定' }}</el-descriptions-item>
        <el-descriptions-item label="职称">{{ profile.teacher_position || '-' }}</el-descriptions-item>
        <el-descriptions-item label="手机号">
          <span>{{ profile.mobile || '-' }}</span>
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
        <el-descriptions-item label="账号状态">
          <el-tag :type="profile.status === 'active' ? 'success' : 'danger'">
            {{ profile.status === 'active' ? '正常' : '停用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="创建时间">
          {{ formatDateTime(profile.created_at) }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="panel-card">
      <template #header>
        <div class="section-header">
          <span>学院变更申请记录</span>
        </div>
      </template>

      <el-empty v-if="!orgChangeRequests.length" description="暂无学院变更申请记录" />
      <div v-else class="table-shell">
        <el-table :data="orgChangeRequests" stripe>
          <el-table-column prop="current_org_name" label="当前学院" min-width="180" />
          <el-table-column prop="target_org_name" label="申请学院" min-width="180" />
          <el-table-column prop="reason" label="申请原因" min-width="260" show-overflow-tooltip />
          <el-table-column label="证明图片" width="120" align="center">
            <template #default="{ row }">
              <el-button
                v-if="row.evidence_file_ids?.length"
                link
                type="primary"
                @click="openPreview(row.evidence_file_ids, '学院变更证明')"
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

    <el-dialog v-model="orgChangeDialogVisible" title="提交学院变更申请" width="620px">
      <el-form label-width="100px">
        <el-form-item label="目标学院" required>
          <el-select
            v-model="orgChangeForm.target_org_id"
            placeholder="请选择目标学院"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="org in availableOrgs"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="申请原因" required>
          <el-input
            v-model="orgChangeForm.reason"
            type="textarea"
            :rows="4"
            maxlength="200"
            show-word-limit
            placeholder="请说明需要变更学院的原因"
          />
        </el-form-item>

        <el-form-item label="证明图片">
          <MultiImageUploadField
            v-model="orgChangeForm.evidence_file_ids"
            v-model:file-urls="orgChangeForm.evidence_file_urls"
            source="teacher-org-change"
            placeholder="点击上传学院变更证明"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="orgChangeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submittingOrgChange" @click="submitOrgChangeRequest">
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
  createTeacherOrgChangeRequest,
  getTeacherOrgs,
  getTeacherProfile,
  listTeacherOrgChangeRequests,
  updateTeacherProfile,
} from '../../api';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../../lib/uploaded-files';
import { formatDateTime } from '../../lib/format';

const router = useRouter();
const saving = ref(false);
const editing = ref(false);
const profileLoaded = ref(false);
const orgChangeDialogVisible = ref(false);
const submittingOrgChange = ref(false);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref('');
const previewUrls = ref<string[]>([]);
const orgOptions = ref<any[]>([]);
const orgChangeRequests = ref<any[]>([]);

const profile = ref<any>({
  id: '',
  account: '',
  name: '',
  mobile: '',
  email: '',
  teacher_position: '',
  org_id: null,
  org_name: '',
  user_type: '',
  status: '',
  created_at: '',
});

const form = reactive({
  name: '',
  mobile: '',
  email: '',
});

const orgChangeForm = reactive({
  target_org_id: '',
  reason: '',
  evidence_file_ids: [] as string[],
  evidence_file_urls: [] as string[],
});

const availableOrgs = computed(() =>
  orgOptions.value.filter((item) => String(item.id) !== String(profile.value.org_id || '')),
);



const getRequestStatusText = (status: string) => {
  const map: Record<string, string> = {
    pending_dean: '待副院长审批',
    pending_vice_dean: '待副院长审批',
    approved: '已通过',
    rejected: '已驳回',
  };
  return map[status] || status || '-';
};

const getRequestTagType = (status: string) => {
  const map: Record<string, string> = {
    pending_dean: 'warning',
    pending_vice_dean: 'warning',
    approved: 'success',
    rejected: 'danger',
  };
  return map[status] || 'info';
};

const goToBindOrg = () => {
  router.push('/teacher-bind-org');
};

const fillEditForm = () => {
  form.name = profile.value.name || '';
  form.email = profile.value.email || '';
};

const loadProfile = async () => {
  try {
    const resp = await getTeacherProfile();
    if (resp.code === 0) {
      profile.value = resp.data;
      fillEditForm();
    } else {
      ElMessage.error(resp.message || '加载个人资料失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '加载个人资料失败');
  } finally {
    profileLoaded.value = true;
  }
};

const loadOrgOptions = async () => {
  try {
    const resp = await getTeacherOrgs();
    if (resp.code === 0) {
      orgOptions.value = Array.isArray(resp.data) ? resp.data : [];
    }
  } catch (error) {
    console.error('加载可选学院失败', error);
  }
};

const loadOrgChangeRequests = async () => {
  try {
    const resp = await listTeacherOrgChangeRequests();
    if (resp.code === 0) {
      orgChangeRequests.value = Array.isArray(resp.data) ? resp.data : [];
    }
  } catch (error) {
    console.error('加载学院变更申请记录失败', error);
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
  saving.value = true;
  try {
    const payload: any = {
      name: form.name,
      email: form.email,
    };

    const resp = await updateTeacherProfile(payload);

    if (resp.code !== 0) {
      ElMessage.error(resp.message || '保存失败');
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

const openOrgChangeDialog = () => {
  orgChangeForm.target_org_id = '';
  orgChangeForm.reason = '';
  orgChangeForm.evidence_file_ids = [];
  orgChangeForm.evidence_file_urls = [];
  orgChangeDialogVisible.value = true;
};

const submitOrgChangeRequest = async () => {
  if (!orgChangeForm.target_org_id) {
    ElMessage.warning('请选择目标学院');
    return;
  }
  if (!orgChangeForm.reason.trim()) {
    ElMessage.warning('请填写申请原因');
    return;
  }

  submittingOrgChange.value = true;
  try {
    const resp = await createTeacherOrgChangeRequest({
      target_org_id: orgChangeForm.target_org_id,
      reason: orgChangeForm.reason.trim(),
      evidence_file_id: orgChangeForm.evidence_file_ids[0] || undefined,
      evidence_file_ids: orgChangeForm.evidence_file_ids.length
        ? orgChangeForm.evidence_file_ids
        : undefined,
    });

    if (resp.code !== 0) {
      ElMessage.error(resp.message || '提交失败');
      return;
    }

    ElMessage.success('学院变更申请已提交');
    orgChangeDialogVisible.value = false;
    await loadOrgChangeRequests();
  } catch (error: any) {
    ElMessage.error(error?.message || '提交失败');
  } finally {
    submittingOrgChange.value = false;
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
  await Promise.all([loadProfile(), loadOrgOptions(), loadOrgChangeRequests()]);
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
