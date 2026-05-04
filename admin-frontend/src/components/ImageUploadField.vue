<template>
  <div class="image-upload-field">
    <el-upload
      class="image-uploader"
      accept="image/jpeg,image/png,image/webp,image/gif"
      :show-file-list="false"
      :disabled="disabled || uploading"
      :http-request="handleUpload"
      :before-upload="beforeUpload"
    >
      <div v-if="previewUrl" class="preview-card">
        <el-image
          class="preview-image"
          :src="previewUrl"
          fit="cover"
          :preview-src-list="[previewUrl]"
          preview-teleported
        />
        <div class="preview-footer">
          <span class="preview-text">已上传图片</span>
          <el-button
            link
            type="danger"
            size="small"
            @click.stop.prevent="clearImage"
          >
            移除
          </el-button>
        </div>
      </div>
      <div v-else class="upload-placeholder">
        <el-icon class="upload-icon"><Plus /></el-icon>
        <span>{{ uploading ? '上传中...' : placeholderText }}</span>
      </div>
    </el-upload>

    <div class="upload-tip">
      选填，支持 JPG、PNG、WEBP、GIF，单张 5MB 以内
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { UploadRequestOptions } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { uploadImageFile, type UploadedFileRecord } from '../api';

const props = defineProps<{
  modelValue?: string;
  fileUrl?: string;
  source?: string;
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'update:fileUrl', value: string): void;
  (event: 'change', value: UploadedFileRecord | null): void;
}>();

const uploading = ref(false);
const localPreviewUrl = ref('');

const placeholderText = computed(() => props.placeholder || '点击上传图片');
const previewUrl = computed(() => props.fileUrl || localPreviewUrl.value);

const revokeLocalPreview = () => {
  if (localPreviewUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(localPreviewUrl.value);
  }
  localPreviewUrl.value = '';
};

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

  return true;
};

const handleUpload = async (options: UploadRequestOptions) => {
  uploading.value = true;
  try {
    const rawFile = options.file as File;
    const resp = await uploadImageFile(rawFile, props.source || 'upload');
    if (resp.code !== 0 || !resp.data) {
      throw new Error(resp.message || '图片上传失败');
    }

    revokeLocalPreview();
    localPreviewUrl.value = URL.createObjectURL(rawFile);
    emit('update:modelValue', resp.data.id);
    emit('update:fileUrl', localPreviewUrl.value);
    emit('change', resp.data);
    ElMessage.success('图片上传成功');
    options.onSuccess?.(resp.data as any);
  } catch (error: any) {
    ElMessage.error(error?.message || '图片上传失败');
    options.onError?.(error);
  } finally {
    uploading.value = false;
  }
};

const clearImage = () => {
  revokeLocalPreview();
  emit('update:modelValue', '');
  emit('update:fileUrl', '');
  emit('change', null);
};

onBeforeUnmount(() => {
  revokeLocalPreview();
});
</script>

<style scoped>
.image-upload-field {
  width: 100%;
}

.image-uploader {
  width: 100%;
}

.image-uploader :deep(.el-upload) {
  width: 100%;
}

.upload-placeholder,
.preview-card {
  width: 100%;
  border: 1px dashed rgba(107, 140, 158, 0.34);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.upload-placeholder {
  min-height: 148px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #5f7281;
}

.upload-icon {
  font-size: 22px;
}

.preview-card {
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: 180px;
  display: block;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
}

.preview-text {
  color: #425466;
  font-size: 13px;
}

.upload-tip {
  margin-top: 8px;
  color: #748494;
  font-size: 12px;
  line-height: 1.5;
}
</style>
