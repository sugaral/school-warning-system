<template>
  <div class="template-management">
    <el-alert
      title="模板变量说明"
      type="info"
      :closable="false"
      show-icon
      class="tips"
    >
      <template #default>
        常用变量包括 `{{ '{code}' }}`、`{{ '{email}' }}`、`{{ '{expire_minutes}' }}`、
        `{{ '{expire_seconds}' }}`、`{{ '{system_name}' }}`、`{{ '{timestamp}' }}`、
        `{{ '{student_name}' }}`、`{{ '{absent_count}' }}`、`{{ '{warning_level_text}' }}`、
        `{{ '{warning_window_text}' }}`、`{{ '{trigger_summary}' }}`。
      </template>
    </el-alert>

    <div class="toolbar">
      <el-select v-model="filters.channel" placeholder="渠道" clearable style="width: 160px">
        <el-option label="邮件" value="email" />
        <el-option label="短信" value="sms" />
        <el-option label="微信" value="wechat" />
      </el-select>

      <el-input
        v-model="filters.keyword"
        placeholder="搜索模板代码或内容"
        clearable
        style="width: 320px"
        @keyup.enter="fetchTemplates"
      />

      <el-button type="primary" @click="openCreateDialog">新增模板</el-button>
      <el-button @click="bootstrapTemplates">初始化内置模板</el-button>
      <el-button @click="fetchTemplates">刷新</el-button>
    </div>

    <div class="table-shell">
    <el-table v-loading="loading" :data="templatesList" stripe style="width: 100%">
      <el-table-column prop="channel" label="渠道" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ channelLabelMap[row.channel] || row.channel }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="template_code" label="模板代码" min-width="190" />
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column prop="content" label="内容" min-width="340" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.updated_at || row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="removeTemplate(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增模板' : '编辑模板'"
      width="720px"
    >
      <el-form :model="form" label-width="120px">
        <el-form-item label="渠道">
          <el-select v-model="form.channel" style="width: 100%">
            <el-option label="邮件" value="email" />
            <el-option label="短信" value="sms" />
            <el-option label="微信" value="wechat" />
          </el-select>
        </el-form-item>
        <el-form-item label="模板代码">
          <el-input v-model="form.template_code" placeholder="如 AUTH_BIND_EMAIL_CODE" />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="短信模板可留空" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="8" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitTemplate">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';

const channelLabelMap: Record<string, string> = {
  email: '邮件',
  sms: '短信',
  wechat: '微信',
};

const loading = ref(false);
const submitting = ref(false);
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref('');

const templatesList = ref<any[]>([]);
const filters = reactive({
  channel: '',
  keyword: '',
});

const createEmptyForm = () => ({
  channel: 'email',
  template_code: '',
  title: '',
  content: '',
  status: 'active',
});

const form = reactive(createEmptyForm());

const resetForm = () => {
  Object.assign(form, createEmptyForm());
  editingId.value = '';
};

const fetchTemplates = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/config/templates', {
      params: {
        channel: filters.channel || undefined,
        keyword: filters.keyword || undefined,
      },
    });
    templatesList.value = response.data.data || [];
  } catch (error: any) {
    ElMessage.error(error?.message || '获取模板列表失败');
  } finally {
    loading.value = false;
  }
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  resetForm();
  dialogVisible.value = true;
};

const openEditDialog = (row: any) => {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(form, {
    channel: row.channel,
    template_code: row.template_code,
    title: row.title || '',
    content: row.content || '',
    status: row.status || 'active',
  });
  dialogVisible.value = true;
};

const submitTemplate = async () => {
  if (!form.channel || !form.template_code.trim() || !form.content.trim()) {
    ElMessage.warning('请完整填写渠道、模板代码和模板内容');
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      channel: form.channel,
      template_code: form.template_code.trim(),
      title: form.title?.trim() || '',
      content: form.content.trim(),
      status: form.status,
    };

    if (dialogMode.value === 'create') {
      await api.post('/admin/config/templates', payload);
      ElMessage.success('模板创建成功');
    } else {
      await api.put(`/admin/config/templates/${editingId.value}`, payload);
      ElMessage.success('模板更新成功');
    }

    dialogVisible.value = false;
    await fetchTemplates();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存模板失败');
  } finally {
    submitting.value = false;
  }
};

const removeTemplate = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确定删除模板 ${row.template_code} 吗？`, '提示', {
      type: 'warning',
    });
    await api.delete(`/admin/config/templates/${row.id}`);
    ElMessage.success('模板已删除');
    await fetchTemplates();
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.message || '删除模板失败');
    }
  }
};

const bootstrapTemplates = async () => {
  try {
    await ElMessageBox.confirm(
      '将重新初始化系统内置模板。已存在的同名模板会被覆盖，是否继续？',
      '提示',
      { type: 'warning' },
    );
    await api.post('/admin/config/templates/bootstrap');
    ElMessage.success('内置模板已初始化');
    await fetchTemplates();
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error?.message || '初始化模板失败');
    }
  }
};

const formatDate = (value: string) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN');
};

onMounted(() => {
  fetchTemplates();
});
</script>

<style scoped>
.template-management {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tips {
  margin-bottom: 4px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
