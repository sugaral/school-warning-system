<template>
  <div class="multi-image-upload-field">
    <div class="image-grid">
      <div
        v-for="(previewUrl, index) in previewUrls"
        :key="`${fileIds[index] || 'image'}-${index}`"
        class="preview-card"
      >
        <el-image
          class="preview-image"
          :src="previewUrl"
          fit="cover"
          :preview-src-list="previewUrls"
          :initial-index="index"
          preview-teleported
        />
        <div class="preview-footer">
          <span class="preview-text">已上传图片 {{ index + 1 }}</span>
          <el-button
            link
            type="danger"
            size="small"
            @click.stop.prevent="removeImage(index)"
          >
            移除
          </el-button>
        </div>
      </div>

      <el-upload
        v-if="canUploadMore"
        class="image-uploader"
        accept="image/jpeg,image/png,image/webp,image/gif"
        :show-file-list="false"
        :disabled="disabled || uploading"
        :multiple="remainingCount > 1"
        :http-request="handleUpload"
        :before-upload="beforeUpload"
      >
        <div class="upload-placeholder">
          <el-icon class="upload-icon"><Plus /></el-icon>
          <span>{{ uploading ? '上传中...' : placeholderText }}</span>
          <span class="upload-count">{{ fileIds.length }}/{{ maxCount }}</span>
        </div>
      </el-upload>
    </div>

    <div class="upload-tip">
      选填，支持 JPG、PNG、WEBP、GIF，单张 5MB 以内，最多 {{ maxCount }} 张
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { uploadImageFile } from '../api';
import { revokeObjectUrls } from '../lib/uploaded-files';

const props = defineProps<{
  modelValue?: string[];
  fileUrls?: string[];
  source?: string;
  placeholder?: string;
  disabled?: boolean;
  maxCount?: number;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void;
  (event: 'update:fileUrls', value: string[]): void;
}>();

const uploading = ref(false);
const internalFileIds = ref<string[]>([]);
const internalPreviewUrls = ref<string[]>([]);

const fileIds = computed(() => internalFileIds.value);
const previewUrls = computed(() => internalPreviewUrls.value);

const placeholderText = computed(() => props.placeholder || '点击上传图片');
const maxCount = computed(() => {
  const value = Number(props.maxCount || 6);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 6;
});
const remainingCount = computed(() => Math.max(0, maxCount.value - fileIds.value.length));
const canUploadMore = computed(() => !props.disabled && remainingCount.value > 0);

watch(
  () => props.modelValue,
  (value) => {
    internalFileIds.value = Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  },
  { immediate: true },
);

watch(
  () => props.fileUrls,
  (value) => {
    internalPreviewUrls.value = Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  },
  { immediate: true },
);

watch(
  previewUrls,
  (next, previous) => {
    const removedUrls = previous.filter((url) => !next.includes(url));
    revokeObjectUrls(removedUrls);
  },
  { deep: false },
);

const beforeUpload = (rawFile: File) => {
  const isImage = rawFile.type.startsWith('image/');
  if (!isImage) {
    ElMessage.warning('只能上传图片文件');
    return false;
  }

  const isWithinLimit = rawFile.size / 1024 / 1024 <= 5;
  if (!isWithinLimit) {
    ElMessage.warning('图片大小不能超过 5MB');
    return false;
  }

  if (remainingCount.value <= 0) {
    ElMessage.warning(`最多只能上传 ${maxCount.value} 张图片`);
    return false;
  }

  return true;
};

const emitNextState = (nextIds: string[], nextUrls: string[]) => {
  internalFileIds.value = nextIds;
  internalPreviewUrls.value = nextUrls;
  emit('update:modelValue', nextIds);
  emit('update:fileUrls', nextUrls);
};

const handleUpload = async (options: UploadRequestOptions) => {
  uploading.value = true;
  try {
    const rawFile = options.file as File;
    const resp = await uploadImageFile(rawFile, props.source || 'upload');
    if (resp.code !== 0 || !resp.data) {
      throw new Error(resp.message || '图片上传失败');
    }

    const nextIds = [...fileIds.value, resp.data.id];
    const nextUrls = [...previewUrls.value, URL.createObjectURL(rawFile)];
    emitNextState(nextIds, nextUrls);
    ElMessage.success('图片上传成功');
    options.onSuccess?.(resp.data as any);
  } catch (error: any) {
    ElMessage.error(error?.message || '图片上传失败');
    options.onError?.(error);
  } finally {
    uploading.value = false;
  }
};

const removeImage = (index: number) => {
  const nextIds = [...fileIds.value];
  const nextUrls = [...previewUrls.value];
  nextIds.splice(index, 1);
  nextUrls.splice(index, 1);
  emitNextState(nextIds, nextUrls);
};

onBeforeUnmount(() => {
  revokeObjectUrls(previewUrls.value);
});
</script>

<style scoped>
.multi-image-upload-field {
  width: 100%;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.preview-card,
.image-uploader :deep(.el-upload) {
  width: 100%;
  min-height: 188px;
  border: 1px dashed rgba(107, 140, 158, 0.34);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.preview-card {
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: 144px;
  display: block;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
}

.preview-text {
  color: #425466;
  font-size: 13px;
}

.upload-placeholder {
  min-height: 188px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #5f7281;
  text-align: center;
  padding: 16px;
}

.upload-icon {
  font-size: 22px;
}

.upload-count {
  color: #748494;
  font-size: 12px;
}

.upload-tip {
  margin-top: 8px;
  color: #748494;
  font-size: 12px;
  line-height: 1.5;
}
</style>
