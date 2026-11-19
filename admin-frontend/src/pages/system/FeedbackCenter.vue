<template>
  <div class="feedback-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">反馈中心</h2>
        <p class="page-desc">集中查看各端提交的建议与问题，并支持认领、处理和图片预览。</p>
      </div>
      <div class="header-actions">
        <el-select v-model="filters.source" clearable placeholder="来源" style="width: 180px">
          <el-option label="管理端" value="admin-frontend" />
          <el-option label="微信小程序" value="miniapp-wechat" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" style="width: 160px">
          <el-option
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-button type="primary" @click="applyFilters">筛选</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-button @click="loadFeedbacks">刷新</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">全部反馈</div>
        <div class="summary-value">{{ summary.total }}</div>
      </div>
      <div class="summary-card warning">
        <div class="summary-label">待认领</div>
        <div class="summary-value">{{ summary.pending }}</div>
      </div>
      <div class="summary-card primary">
        <div class="summary-label">已认领</div>
        <div class="summary-value">{{ summary.claimed }}</div>
      </div>
      <div class="summary-card success">
        <div class="summary-label">已解决</div>
        <div class="summary-value">{{ summary.resolved }}</div>
      </div>
    </div>

    <el-card class="list-card" shadow="never">
      <div class="table-shell">
        <el-table v-loading="loading" :data="feedbacks" stripe>
          <el-table-column prop="user" label="提交人" width="140" />
          <el-table-column label="身份" width="220">
            <template #default="{ row }">
              <span>{{ formatIdentity(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="140">
            <template #default="{ row }">
              <el-tag size="small" :type="row.source === 'miniapp-wechat' ? 'success' : 'primary'">
                {{ formatSource(row.source) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag size="small" :type="getStatusTagType(row.status)">
                {{ formatStatus(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="页面" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span>{{ row.page_title || row.page_path || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="content" label="反馈内容" min-width="320" show-overflow-tooltip />
          <el-table-column label="截图" width="110" align="center">
            <template #default="{ row }">
              <el-button
                v-if="row.image_file_id || row.image_file_ids?.length"
                link
                type="primary"
                @click="openImage(row.image_file_ids, row.image_file_id)"
              >
                查看图片
              </el-button>
              <span v-else class="muted-text">未上传</span>
            </template>
          </el-table-column>
          <el-table-column label="认领信息" width="180">
            <template #default="{ row }">
              <span v-if="row.handled_at">
                {{ row.handled_by_name || '管理员' }}<br />
                {{ formatDateTime(row.handled_at) }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.timestamp) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button v-if="row.status === 'pending'" link size="small" @click="claimFeedback(row)">
                认领
              </el-button>
              <el-button link size="small" @click="showDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pagination-row">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadFeedbacks"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="反馈详情" width="900px" @closed="clearDetailImages">
      <div v-loading="detailLoading" class="detail-body">
        <template v-if="detail">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="提交人">{{ detail.user || '-' }}</el-descriptions-item>
            <el-descriptions-item label="用户 ID">{{ detail.user_id || '-' }}</el-descriptions-item>
            <el-descriptions-item label="身份">{{ formatIdentity(detail) }}</el-descriptions-item>
            <el-descriptions-item label="来源">{{ formatSource(detail.source) }}</el-descriptions-item>
            <el-descriptions-item label="当前状态">
              <el-tag size="small" :type="getStatusTagType(detail.status)">
                {{ formatStatus(detail.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="提交时间">
              {{ formatDateTime(detail.timestamp) }}
            </el-descriptions-item>
            <el-descriptions-item label="页面名称">{{ detail.page_title || '-' }}</el-descriptions-item>
            <el-descriptions-item label="页面路径">{{ detail.page_path || '-' }}</el-descriptions-item>
            <el-descriptions-item label="邮箱">{{ detail.user_email || '-' }}</el-descriptions-item>
            <el-descriptions-item label="手机号">{{ detail.user_mobile || '-' }}</el-descriptions-item>
            <el-descriptions-item label="IP">{{ detail.ip || '-' }}</el-descriptions-item>
            <el-descriptions-item label="认领信息">
              {{ detail.handled_by_name || '-' }}
              <span v-if="detail.handled_at"> / {{ formatDateTime(detail.handled_at) }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="User-Agent" :span="2">
              <span class="break-all">{{ detail.user_agent || '-' }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <div class="detail-grid">
            <div class="content-block">
              <div class="content-label">反馈内容</div>
              <div class="content-value">{{ detail.content || '-' }}</div>
            </div>

            <div class="content-block">
              <div class="content-label">问题截图</div>
              <div v-if="detailImageUrls.length" class="preview-grid">
                <el-image
                  v-for="(url, index) in detailImageUrls"
                  :key="`${url}-${index}`"
                  :src="url"
                  fit="cover"
                  :preview-src-list="detailImageUrls"
                  :initial-index="index"
                  preview-teleported
                  class="detail-image"
                />
              </div>
              <div v-else class="content-empty">未上传图片</div>
            </div>
          </div>

          <div class="content-block">
            <div class="content-label">处理备注</div>
            <div class="handle-panel">
              <div class="status-row">
                <el-select v-model="handleForm.status" style="width: 180px">
                  <el-option
                    v-for="option in statusOptions"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-button
                  v-if="detail.status === 'pending'"
                  type="primary"
                  plain
                  :loading="handleSaving"
                  @click="claimFeedback(detail)"
                >
                  立即认领
                </el-button>
              </div>
              <el-input
                v-model="handleForm.handle_note"
                type="textarea"
                :rows="5"
                maxlength="2000"
                show-word-limit
                placeholder="记录认领说明、排查过程、修复进展或回访结论"
              />
              <div class="handle-actions">
                <el-button @click="fillStatus('claimed')">标记已认领</el-button>
                <el-button @click="fillStatus('resolved')">标记已解决</el-button>
                <el-button type="primary" :loading="handleSaving" @click="saveHandle">
                  保存状态
                </el-button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </el-dialog>

    <el-dialog v-model="imageVisible" title="问题截图" width="720px" @closed="clearImagePreview">
      <div class="image-dialog">
        <div v-if="imagePreviewUrls.length" class="preview-grid">
          <el-image
            v-for="(url, index) in imagePreviewUrls"
            :key="`${url}-${index}`"
            :src="url"
            fit="contain"
            :preview-src-list="imagePreviewUrls"
            :initial-index="index"
            preview-teleported
            class="dialog-image"
          />
        </div>
        <el-empty v-else description="暂无图片" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getAdminFeedbackDetail,
  getAdminFeedbacks,
  handleAdminFeedback,
} from '../../api';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../../lib/uploaded-files';
import { formatDateTime } from '../../lib/format';

type FeedbackStatus = 'pending' | 'claimed' | 'resolved';

interface FeedbackItem {
  id: string;
  user: string;
  user_id: string;
  user_type: string;
  user_email?: string;
  user_mobile?: string;
  roles: string[];
  source: string;
  page_path: string;
  page_title: string;
  content: string;
  status: FeedbackStatus;
  handle_note?: string;
  handled_at?: string | null;
  handled_by_name?: string;
  handled_by_user_id?: string;
  image_file_id?: string;
  image_file_ids?: string[];
  image_file?: { url?: string } | null;
  image_files?: Array<{ url?: string } | null>;
  ip?: string;
  user_agent?: string;
  timestamp: string;
}

const statusOptions: Array<{ label: string; value: FeedbackStatus }> = [
  { label: '待认领', value: 'pending' },
  { label: '已认领', value: 'claimed' },
  { label: '已解决', value: 'resolved' },
];

const loading = ref(false);
const detailLoading = ref(false);
const handleSaving = ref(false);
const detailVisible = ref(false);
const imageVisible = ref(false);
const imagePreviewUrls = ref<string[]>([]);
const detailImageUrls = ref<string[]>([]);
const feedbacks = ref<FeedbackItem[]>([]);
const detail = ref<FeedbackItem | null>(null);

const filters = reactive({
  source: '',
  status: '',
});

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0,
});

const summary = reactive({
  total: 0,
  pending: 0,
  claimed: 0,
  resolved: 0,
});

const handleForm = reactive<{
  status: FeedbackStatus;
  handle_note: string;
}>({
  status: 'pending',
  handle_note: '',
});

const clearDetailImages = () => {
  revokeObjectUrls(detailImageUrls.value);
  detailImageUrls.value = [];
};

const clearImagePreview = () => {
  revokeObjectUrls(imagePreviewUrls.value);
  imagePreviewUrls.value = [];
};

const formatSource = (value?: string) => {
  if (value === 'miniapp-wechat') {
    return '微信小程序';
  }
  if (value === 'admin-frontend') {
    return '管理端';
  }
  return value || '-';
};

const formatStatus = (value?: string) => {
  if (value === 'claimed') {
    return '已认领';
  }
  if (value === 'resolved') {
    return '已解决';
  }
  return '待认领';
};

const getStatusTagType = (value?: string) => {
  if (value === 'resolved') {
    return 'success';
  }
  if (value === 'claimed') {
    return 'primary';
  }
  return 'warning';
};

const formatIdentity = (row: Partial<FeedbackItem>) => {
  const userType = row?.user_type ? String(row.user_type) : '';
  const roles = Array.isArray(row?.roles) ? row.roles.filter(Boolean) : [];
  const roleText = roles.length ? roles.join(' / ') : '';
  return [userType, roleText].filter(Boolean).join(' / ') || '-';
};



const syncHandleForm = (row?: Partial<FeedbackItem> | null) => {
  handleForm.status = (row?.status || 'pending') as FeedbackStatus;
  handleForm.handle_note = String(row?.handle_note || '');
};

const loadFeedbacks = async () => {
  loading.value = true;
  try {
    const resp = await getAdminFeedbacks({
      page: pagination.page,
      pageSize: pagination.pageSize,
      source: filters.source || undefined,
      status: filters.status || undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '获取反馈列表失败');
    }

    feedbacks.value = Array.isArray(resp.data?.list) ? resp.data.list : [];
    pagination.total = Number(resp.data?.pagination?.total || 0);
    summary.total = Number(resp.data?.summary?.total || 0);
    summary.pending = Number(resp.data?.summary?.pending || 0);
    summary.claimed = Number(resp.data?.summary?.claimed || 0);
    summary.resolved = Number(resp.data?.summary?.resolved || 0);
  } catch (error: any) {
    ElMessage.error(error?.message || '获取反馈列表失败');
  } finally {
    loading.value = false;
  }
};

const loadFeedbackDetail = async (id: string) => {
  detailLoading.value = true;
  clearDetailImages();
  try {
    const resp = await getAdminFeedbackDetail(id);
    if (resp.code !== 0) {
      throw new Error(resp.message || '获取反馈详情失败');
    }
    detail.value = resp.data;
    detailImageUrls.value = await loadUploadedFileObjectUrls(
      resp.data?.image_file_ids,
      resp.data?.image_file_id,
    );
    syncHandleForm(resp.data);
  } catch (error: any) {
    ElMessage.error(error?.message || '获取反馈详情失败');
  } finally {
    detailLoading.value = false;
  }
};

const applyFilters = () => {
  pagination.page = 1;
  loadFeedbacks();
};

const resetFilters = () => {
  filters.source = '';
  filters.status = '';
  pagination.page = 1;
  loadFeedbacks();
};

const handleSizeChange = () => {
  pagination.page = 1;
  loadFeedbacks();
};

const showDetail = async (row: FeedbackItem) => {
  detailVisible.value = true;
  await loadFeedbackDetail(row.id);
};

const fillStatus = (status: FeedbackStatus) => {
  handleForm.status = status;
};

const saveHandle = async () => {
  if (!detail.value) {
    return;
  }

  handleSaving.value = true;
  try {
    const resp = await handleAdminFeedback(detail.value.id, {
      status: handleForm.status,
      handle_note: handleForm.handle_note.trim() || undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '保存状态失败');
    }

    ElMessage.success(handleForm.status === 'claimed' ? '反馈已认领' : '状态已保存');
    await Promise.all([loadFeedbacks(), loadFeedbackDetail(detail.value.id)]);
  } catch (error: any) {
    ElMessage.error(error?.message || '保存状态失败');
  } finally {
    handleSaving.value = false;
  }
};

const claimFeedback = async (row: FeedbackItem | null) => {
  if (!row) {
    return;
  }

  handleSaving.value = true;
  try {
    const note = row.id === detail.value?.id ? handleForm.handle_note.trim() : '';
    const resp = await handleAdminFeedback(row.id, {
      status: 'claimed',
      handle_note: note || undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '认领失败');
    }

    ElMessage.success('反馈已认领');
    await loadFeedbacks();
    if (detailVisible.value && detail.value?.id === row.id) {
      await loadFeedbackDetail(row.id);
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '认领失败');
  } finally {
    handleSaving.value = false;
  }
};

const openImage = async (fileIds?: string[] | string, legacyFileId?: string) => {
  clearImagePreview();
  try {
    imagePreviewUrls.value = await loadUploadedFileObjectUrls(fileIds, legacyFileId);
    imageVisible.value = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '加载图片失败');
  }
};

onMounted(() => {
  loadFeedbacks();
});

onBeforeUnmount(() => {
  clearDetailImages();
  clearImagePreview();
});
</script>

<style scoped>
.feedback-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
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

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card {
  border-radius: 18px;
  padding: 18px 20px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(246, 250, 252, 0.74));
  border: 1px solid rgba(107, 140, 158, 0.16);
}

.summary-card.warning {
  background: linear-gradient(135deg, rgba(255, 247, 237, 0.9), rgba(254, 243, 199, 0.72));
}

.summary-card.primary {
  background: linear-gradient(135deg, rgba(239, 246, 255, 0.92), rgba(219, 234, 254, 0.72));
}

.summary-card.success {
  background: linear-gradient(135deg, rgba(236, 253, 245, 0.92), rgba(209, 250, 229, 0.74));
}

.summary-label {
  font-size: 13px;
  color: #6b7280;
}

.summary-value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 700;
  color: #111827;
}

.list-card {
  overflow: hidden;
}

.table-shell {
  overflow-x: auto;
}

.pagination-row {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.detail-body {
  min-height: 200px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.content-block {
  margin-top: 16px;
  border: 1px solid rgba(107, 140, 158, 0.16);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.52);
}

.content-label {
  margin-bottom: 10px;
  font-weight: 600;
  color: #111827;
}

.content-value {
  white-space: pre-wrap;
  line-height: 1.7;
  color: #374151;
}

.content-empty,
.muted-text {
  color: #8b98a7;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.detail-image,
.dialog-image {
  width: 100%;
  min-height: 240px;
}

.handle-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.handle-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.break-all {
  word-break: break-all;
}

.image-dialog {
  min-height: 220px;
}

@media (max-width: 900px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
