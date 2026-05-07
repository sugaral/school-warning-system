import { onBeforeUnmount, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { loadUploadedFileObjectUrls, revokeObjectUrls } from '../lib/uploaded-files';

/**
 * Reusable composable for image preview dialogs.
 * Eliminates duplicated preview logic across student pages.
 */
export function usePreview() {
  const previewVisible = ref(false);
  const previewLoading = ref(false);
  const previewTitle = ref('');
  const previewUrls = ref<string[]>([]);

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

  onBeforeUnmount(() => {
    revokeObjectUrls(previewUrls.value);
  });

  return {
    previewVisible,
    previewLoading,
    previewTitle,
    previewUrls,
    openPreview,
  };
}
