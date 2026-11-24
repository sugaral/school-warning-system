<template>
  <div class="approvals-page">
    <section class="approvals-hero">
      <div>
        <span class="approvals-hero__eyebrow">Workflow Hub</span>
        <h2 class="approvals-hero__title">审批中心</h2>
        <p class="approvals-hero__desc">左侧按审批类型切换，右侧只展示当前审批内容。</p>
      </div>
      <el-button type="primary" :loading="loading" @click="loadAll">刷新数据</el-button>
    </section>

    <section class="approval-layout">
      <aside class="approval-nav">
        <button
          v-for="item in sectionItems"
          :key="item.key"
          type="button"
          class="approval-nav__item"
          :class="{ 'is-active': activeSection === item.key }"
          @click="activeSection = item.key"
        >
          {{ item.label }}
        </button>
      </aside>

      <section class="approval-content">
        <el-card v-if="activeSection === 'leave'" class="section-card">
          <template #header><span>请假审批</span></template>
          <div class="table-shell">
            <el-table :data="leaveItems" v-loading="loading" stripe>
              <el-table-column prop="student_name" label="学生" width="120" />
              <el-table-column prop="class_name" label="班级" width="160" />
              <el-table-column prop="reason" label="请假原因" min-width="220" show-overflow-tooltip />
              <el-table-column label="开始时间" width="180"><template #default="{ row }">{{ formatDateTime(row.from_date) }}</template></el-table-column>
              <el-table-column label="结束时间" width="180"><template #default="{ row }">{{ formatDateTime(row.to_date) }}</template></el-table-column>
              <el-table-column label="证明图片" width="120" align="center">
                <template #default="{ row }">
                  <el-button v-if="row.proof_file_ids?.length" link type="primary" @click="openFilePreview(row.proof_file_ids, '请假证明')">查看图片</el-button>
                  <span v-else class="muted-text">未上传</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onLeaveApprove(row, true)">通过</el-button>
                    <el-button size="small" type="danger" @click="onLeaveApprove(row, false)">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-card v-else-if="activeSection === 'makeup'" class="section-card">
          <template #header><span>补录审批</span></template>
          <div class="table-shell">
            <el-table :data="makeupItems" v-loading="loading" stripe>
              <el-table-column prop="student_name" label="学生" width="120" />
              <el-table-column prop="class_name" label="班级" width="160" />
              <el-table-column prop="record_date" label="日期" width="120" />
              <el-table-column prop="course_id" label="课程 ID" width="120" />
              <el-table-column prop="reason" label="补录原因" min-width="220" show-overflow-tooltip />
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onMakeupApprove(row, true)">通过</el-button>
                    <el-button size="small" type="danger" @click="onMakeupApprove(row, false)">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-card v-else-if="activeSection === 'appeal'" class="section-card">
          <template #header><span>申诉处理</span></template>
          <div class="table-shell">
            <el-table :data="appealItems" v-loading="loading" stripe>
              <el-table-column prop="student_name" label="学生" width="120" />
              <el-table-column prop="class_name" label="班级" width="160" />
              <el-table-column prop="appeal_type" label="申诉类型" width="140" />
              <el-table-column prop="content" label="申诉内容" min-width="240" show-overflow-tooltip />
              <el-table-column label="申诉图片" width="120" align="center">
                <template #default="{ row }">
                  <el-button v-if="row.evidence_file_ids?.length" link type="primary" @click="openFilePreview(row.evidence_file_ids, '申诉凭证')">查看图片</el-button>
                  <span v-else class="muted-text">未上传</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onAppealHandle(row, 'resolved')">已受理</el-button>
                    <el-button size="small" type="danger" @click="onAppealHandle(row, 'rejected')">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-card v-else-if="activeSection === 'class-change'" class="section-card">
          <template #header><span>换班初审</span></template>
          <div class="table-shell">
            <el-table :data="classChangeItems" v-loading="loading" stripe>
              <el-table-column prop="student_name" label="学生" width="120" />
              <el-table-column prop="student_no" label="学号" width="140" />
              <el-table-column prop="current_class_name" label="当前班级" width="160" />
              <el-table-column prop="target_class_name" label="申请班级" width="160" />
              <el-table-column prop="reason" label="申请原因" min-width="220" show-overflow-tooltip />
              <el-table-column label="提交图片" width="120" align="center">
                <template #default="{ row }">
                  <el-button v-if="row.evidence_file_ids?.length" link type="primary" @click="openFilePreview(row.evidence_file_ids, '换班佐证')">查看图片</el-button>
                  <span v-else class="muted-text">未上传</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="220" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onClassChangeReview(row, true)">转交特殊审批</el-button>
                    <el-button size="small" type="danger" @click="onClassChangeReview(row, false)">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-card v-else-if="activeSection === 'course-binding'" class="section-card">
          <template #header><span>课程变更审批</span></template>
          <div class="table-shell">
            <el-table :data="courseBindingItems" v-loading="loading" stripe>
              <el-table-column prop="teacher_name" label="申请人" width="140" />
              <el-table-column prop="teacher_account" label="账号" width="160" />
              <el-table-column label="当前绑定" min-width="300">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.current_value)" :key="`c-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="申请变更为" min-width="300">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.target_value)" :key="`t-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="申请说明" min-width="240">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.reason)" :key="`r-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onCourseBindingApprove(row)">通过</el-button>
                    <el-button size="small" type="danger" @click="onCourseBindingReject(row)">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-card v-else-if="activeSection === 'special'" class="section-card">
          <template #header><span>特殊审批</span></template>
          <el-alert title="学生换班和教师学院变更统一进入这里。" type="info" :closable="false" class="page-alert" />
          <div class="table-shell">
            <el-table :data="specialApprovalItems" v-loading="loading" stripe>
              <el-table-column label="申请类型" width="160">
                <template #default="{ row }"><el-tag>{{ getTypeText(row.apply_type) }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="subject_name" label="申请对象" width="140" />
              <el-table-column label="当前信息" min-width="260">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.current_value)" :key="`sc-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="目标信息" min-width="260">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.target_value)" :key="`st-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="申请原因" min-width="240">
                <template #default="{ row }"><div class="rich-lines"><span v-for="(line, index) in formatRichText(row.apply_reason)" :key="`sr-${row.id}-${index}`">{{ line }}</span></div></template>
              </el-table-column>
              <el-table-column label="操作" width="180" fixed="right">
                <template #default="{ row }">
                  <div class="action-group">
                    <el-button size="small" type="primary" @click="onSpecialApprove(row)">批准</el-button>
                    <el-button size="small" type="danger" @click="onSpecialReject(row)">驳回</el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>

        <el-empty v-else description="当前角色暂无可处理审批" />
      </section>
    </section>

    <el-dialog v-model="previewVisible" :title="previewTitle" width="720px" @closed="clearPreview">
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  approveTeachingAdminCourseBindingRequest,
  approveLeaveRequest,
  approveMakeupRequest,
  approveSpecialApproval,
  getTeachingAdminCourseBindingRequests,
  handleAppeal,
  listAppeals,
  listHeadTeacherClassChangeRequests,
  listLeaveRequests,
  listMakeupRequests,
  listSpecialApprovals,
  rejectTeachingAdminCourseBindingRequest,
  rejectSpecialApproval,
  reviewHeadTeacherClassChangeRequest,
} from '../api';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../lib/uploaded-files';
import { formatDateTime } from '../lib/format';

const loading = ref(false);
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewTitle = ref('');
const previewUrls = ref<string[]>([]);
const leaveItems = ref<any[]>([]);
const makeupItems = ref<any[]>([]);
const appealItems = ref<any[]>([]);
const classChangeItems = ref<any[]>([]);
const specialApprovalItems = ref<any[]>([]);
const courseBindingItems = ref<any[]>([]);

const getStoredRoles = () => {
  try {
    const parsedFull = JSON.parse(localStorage.getItem('admin_roles_full') || '[]');
    if (Array.isArray(parsedFull) && parsedFull.length > 0) {
      return Array.from(new Set(parsedFull.map((item: any) => String(item?.role || '').trim()).filter(Boolean)));
    }
    const parsed = JSON.parse(localStorage.getItem('admin_roles') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const roleCodes = getStoredRoles();
const activeSection = ref('leave');

const showStandardApprovalSections = computed(() => roleCodes.includes('head_teacher') || roleCodes.includes('sys_admin'));
const showClassChangeSection = computed(() => roleCodes.includes('head_teacher') && !roleCodes.includes('sys_admin'));
const showCourseBindingSection = computed(() => roleCodes.includes('teaching_admin') || roleCodes.includes('dean') || roleCodes.includes('sys_admin'));
const showSpecialApprovalsSection = computed(
  () => roleCodes.includes('vice_dean') || roleCodes.includes('sys_admin'),
);

const sectionItems = computed(() => {
  const items: Array<{ key: string; label: string }> = [];
  if (showStandardApprovalSections.value) {
    items.push({ key: 'leave', label: `请假申请(${leaveItems.value.length})` });
    items.push({ key: 'makeup', label: `补录申请(${makeupItems.value.length})` });
    items.push({ key: 'appeal', label: `申诉处理(${appealItems.value.length})` });
  }
  if (showClassChangeSection.value) items.push({ key: 'class-change', label: `换班初审(${classChangeItems.value.length})` });
  if (showCourseBindingSection.value) items.push({ key: 'course-binding', label: `课程变更(${courseBindingItems.value.length})` });
  if (showSpecialApprovalsSection.value) items.push({ key: 'special', label: `特殊审批(${specialApprovalItems.value.length})` });
  return items;
});

const visibleSections = computed(() => sectionItems.value.map((item) => item.key));

const clearPreview = () => {
  revokeObjectUrls(previewUrls.value);
  previewUrls.value = [];
  previewTitle.value = '';
};



const formatRichText = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return ['-'];
  return raw.split(/[；;]\s*/).map((item) => item.trim()).filter(Boolean);
};

const getTypeText = (type: string) => {
  const map: Record<string, string> = {
    grade_change: '成绩修正',
    status_change: '学籍变更',
    student_class_change: '学生换班',
    teacher_org_change: '教师学院变更',
    teacher_course_binding_change: '课程变更',
  };
  return map[type] || type || '-';
};

const formatHeadTeacherReview = (review: any) => {
  if (!review) return '-';
  return `${review.reviewer_name || '班主任'}${review.approved ? '同意转交' : '驳回'}${review.note ? `（${review.note}）` : ''}`;
};

const promptReason = async (title: string, placeholder: string, required = false) => {
  const { value } = await ElMessageBox.prompt(title, '填写处理意见', {
    inputType: 'textarea',
    inputPlaceholder: placeholder,
    inputValidator: required ? (inputValue) => (String(inputValue || '').trim() ? true : '请填写原因') : undefined,
  });
  return String(value || '').trim();
};

const loadAll = async () => {
  loading.value = true;
  try {
    const results = await Promise.allSettled([
      showStandardApprovalSections.value ? listLeaveRequests() : Promise.resolve({ code: 0, data: [] as any[] }),
      showStandardApprovalSections.value ? listMakeupRequests() : Promise.resolve({ code: 0, data: [] as any[] }),
      showStandardApprovalSections.value ? listAppeals() : Promise.resolve({ code: 0, data: [] as any[] }),
      showClassChangeSection.value ? listHeadTeacherClassChangeRequests() : Promise.resolve({ code: 0, data: [] as any[] }),
      showCourseBindingSection.value ? getTeachingAdminCourseBindingRequests() : Promise.resolve({ code: 0, data: [] as any[] }),
      showSpecialApprovalsSection.value ? listSpecialApprovals() : Promise.resolve({ code: 0, data: { list: [] as any[] } }),
    ]);

    const [leaveResp, makeupResp, appealResp, classChangeResp, courseBindingResp, specialResp] = results;
    leaveItems.value = leaveResp.status === 'fulfilled' && Array.isArray(leaveResp.value.data) ? leaveResp.value.data : [];
    makeupItems.value = makeupResp.status === 'fulfilled' && Array.isArray(makeupResp.value.data) ? makeupResp.value.data : [];
    appealItems.value = appealResp.status === 'fulfilled' && Array.isArray(appealResp.value.data) ? appealResp.value.data : [];
    classChangeItems.value = classChangeResp.status === 'fulfilled' && Array.isArray(classChangeResp.value.data) ? classChangeResp.value.data : [];
    courseBindingItems.value = courseBindingResp.status === 'fulfilled' && Array.isArray(courseBindingResp.value.data) ? courseBindingResp.value.data : [];
    specialApprovalItems.value = specialResp.status === 'fulfilled' && Array.isArray(specialResp.value.data?.list) ? specialResp.value.data.list : [];
  } catch (error: any) {
    ElMessage.error(error?.message || '加载审批数据失败');
  } finally {
    loading.value = false;
  }
};

const openFilePreview = async (fileIds: string[] | string, title: string) => {
  previewVisible.value = true;
  previewLoading.value = true;
  previewTitle.value = title;
  clearPreview();
  previewTitle.value = title;
  try {
    previewUrls.value = await loadUploadedFileObjectUrls(fileIds);
  } catch (error: any) {
    previewVisible.value = false;
    ElMessage.error(error?.message || '加载图片失败');
  } finally {
    previewLoading.value = false;
  }
};

const onLeaveApprove = async (row: any, approve: boolean) => {
  let note: string | undefined;
  try {
    note = await promptReason(approve ? '请输入处理说明' : '请输入驳回原因', approve ? '可填写通过说明' : '请填写驳回原因', !approve);
  } catch {
    return;
  }
  const resp = await approveLeaveRequest(String(row.id), approve, note);
  if (resp.code === 0) {
    ElMessage.success('处理成功');
    await loadAll();
  } else {
    ElMessage.error(resp.message || '处理失败');
  }
};

const onMakeupApprove = async (row: any, approve: boolean) => {
  let reason: string | undefined;
  if (!approve) {
    try {
      reason = await promptReason('请输入驳回原因', '请填写驳回原因', true);
    } catch {
      return;
    }
  }
  const resp = await approveMakeupRequest(String(row.id), approve, reason);
  if (resp.code === 0) {
    ElMessage.success('处理成功');
    await loadAll();
  } else {
    ElMessage.error(resp.message || '处理失败');
  }
};

const onAppealHandle = async (row: any, status: string) => {
  let note = '';
  try {
    note = await promptReason(status === 'resolved' ? '请输入受理说明' : '请输入驳回原因', status === 'resolved' ? '请填写受理说明' : '请填写驳回原因', status !== 'resolved');
  } catch {
    return;
  }
  const resp = await handleAppeal(String(row.id), status, note);
  if (resp.code === 0) {
    ElMessage.success('处理成功');
    await loadAll();
  } else {
    ElMessage.error(resp.message || '处理失败');
  }
};

const onClassChangeReview = async (row: any, approve: boolean) => {
  let note = '';
  try {
    note = await promptReason(approve ? '可填写补充说明' : '请输入驳回原因', approve ? '可选：填写班主任意见' : '请填写驳回原因', !approve);
  } catch {
    return;
  }
  const resp = await reviewHeadTeacherClassChangeRequest(String(row.id), { approve, note: note || undefined });
  if (resp.code === 0) {
    ElMessage.success(approve ? '已转交特殊审批' : '已驳回该申请');
    await loadAll();
  } else {
    ElMessage.error(resp.message || '处理失败');
  }
};

const onCourseBindingApprove = async (row: any) => {
  try {
    await ElMessageBox.confirm('确认批准该课程变更申请吗？', '确认审批', { type: 'warning' });
    const resp = await approveTeachingAdminCourseBindingRequest(String(row.id));
    if (resp.code !== 0) throw new Error(resp.message || '操作失败');
    ElMessage.success('课程变更申请已批准');
    await loadAll();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error?.message || '操作失败');
  }
};

const onCourseBindingReject = async (row: any) => {
  try {
    const reason = await promptReason('请输入驳回原因', '请填写驳回原因', true);
    const resp = await rejectTeachingAdminCourseBindingRequest(String(row.id), { reason });
    if (resp.code !== 0) throw new Error(resp.message || '操作失败');
    ElMessage.success('课程变更申请已驳回');
    await loadAll();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error?.message || '操作失败');
  }
};

const onSpecialApprove = async (row: any) => {
  try {
    await ElMessageBox.confirm('确认批准该申请吗？', '确认审批', { type: 'warning' });
    const resp = await approveSpecialApproval(String(row.id));
    if (resp.code !== 0) throw new Error(resp.message || '操作失败');
    ElMessage.success('审批通过');
    await loadAll();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error?.message || '操作失败');
  }
};

const onSpecialReject = async (row: any) => {
  try {
    const reason = await promptReason('请输入驳回原因', '请填写驳回原因', true);
    const resp = await rejectSpecialApproval(String(row.id), { reason });
    if (resp.code !== 0) throw new Error(resp.message || '操作失败');
    ElMessage.success('已驳回');
    await loadAll();
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error?.message || '操作失败');
  }
};

onMounted(loadAll);

watch(
  visibleSections,
  (sections) => {
    if (!sections.includes(activeSection.value)) {
      activeSection.value = sections[0] || 'leave';
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearPreview();
});
</script>

<style scoped>
.approvals-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.approvals-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  padding: 24px 26px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 24px 48px rgba(34, 59, 78, 0.1);
}

.approvals-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.approvals-hero__title {
  margin: 6px 0 0;
  font-size: 30px;
  font-weight: 700;
  color: #173145;
}

.approvals-hero__desc {
  margin: 8px 0 0;
  color: #5d7283;
  line-height: 1.6;
}

.approvals-hero__actions {
  display: flex;
  align-items: flex-end;
}

.approvals-hero__meta {
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

.approvals-hero__meta strong {
  color: #173145;
  font-size: 14px;
}

.approval-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.approval-nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: sticky;
  top: 20px;
}

.approval-nav__item {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 16px;
  background: #fff;
  color: #51697a;
  text-align: left;
  line-height: 1.45;
  cursor: pointer;
}

.approval-nav__item.is-active {
  color: #173145;
  border-color: rgba(15, 118, 110, 0.24);
  background: linear-gradient(180deg, rgba(221, 247, 243, 0.98), rgba(235, 250, 247, 0.9));
  box-shadow: 0 14px 28px rgba(15, 118, 110, 0.14);
}

.approval-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-alert {
  margin-bottom: 16px;
}

.section-card {
  overflow: hidden;
}

.section-heading__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.section-heading__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

.table-shell {
  overflow-x: auto;
}

.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rich-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
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

@media (max-width: 960px) {
  .approval-layout {
    grid-template-columns: 1fr;
  }

  .approval-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .approval-nav__item {
    width: auto;
    min-width: 160px;
  }
}

@media (max-width: 768px) {
  .approvals-hero {
    padding: 20px;
  }

  .approvals-hero__actions {
    width: 100%;
  }

  .approval-nav__item {
    min-width: 100%;
  }
}
</style>
