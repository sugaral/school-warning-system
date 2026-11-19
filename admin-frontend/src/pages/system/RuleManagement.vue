<template>
  <div class="rule-management">
    <div class="toolbar">
      <el-select v-model="filterScope" placeholder="作用域" clearable style="width: 160px" @change="fetchRules">
        <el-option label="学校" value="school" />
        <el-option label="学院" value="org" />
      </el-select>

      <el-select v-model="filterLevel" placeholder="预警级别" clearable style="width: 160px" @change="fetchRules">
        <el-option label="低" value="low" />
        <el-option label="中" value="medium" />
        <el-option label="高" value="high" />
      </el-select>

      <el-button type="primary" @click="showCreateDialog">
        <el-icon><Plus /></el-icon>
        新增规则
      </el-button>

      <el-button @click="fetchRules">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-shell">
    <el-table v-loading="loading" :data="filteredRulesList" stripe style="width: 100%; margin-top: 20px">
      <el-table-column prop="level" label="级别" width="90">
        <template #default="{ row }">
          <el-tag :color="getLevelColor(row.level)" effect="dark" style="border: none" size="small">
            {{ getLevelText(row.level) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="window" label="时间窗口" width="120" />
      <el-table-column prop="metric" label="指标" min-width="180" />
      <el-table-column prop="threshold" label="阈值" width="90" />
      <el-table-column prop="scope" label="作用域" width="100">
        <template #default="{ row }">{{ getScopeText(row.scope) }}</template>
      </el-table-column>
      <el-table-column prop="enabled" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
            {{ row.enabled ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="editRule(row)">编辑</el-button>
          <el-button size="small" type="warning" @click="toggleRule(row)">
            {{ row.enabled ? '禁用' : '启用' }}
          </el-button>
          <el-button size="small" type="danger" @click="deleteRule(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog v-model="ruleDialogVisible" :title="isEditMode ? '编辑规则' : '新增规则'" width="520px">
      <el-form ref="ruleFormRef" :model="ruleForm" :rules="ruleRules" label-width="100px">
        <el-form-item label="预警级别" prop="level">
          <el-select v-model="ruleForm.level" placeholder="请选择预警级别" style="width: 100%">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间窗口" prop="window">
          <el-input v-model="ruleForm.window" placeholder="例如：7天" />
        </el-form-item>
        <el-form-item label="指标" prop="metric">
          <el-input v-model="ruleForm.metric" placeholder="例如：连续旷课" />
        </el-form-item>
        <el-form-item label="阈值" prop="threshold">
          <el-input-number v-model="ruleForm.threshold" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="作用域" prop="scope">
          <el-select v-model="ruleForm.scope" placeholder="请选择作用域" style="width: 100%">
            <el-option label="学校" value="school" />
            <el-option label="学院" value="org" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="enabled">
          <el-radio-group v-model="ruleForm.enabled">
            <el-radio :value="true">启用</el-radio>
            <el-radio :value="false">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="ruleDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveRule">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';

const loading = ref(false);
const rulesList = ref<any[]>([]);
const filterScope = ref('');
const filterLevel = ref('');
const ruleDialogVisible = ref(false);
const isEditMode = ref(false);
const ruleFormRef = ref();
const currentRuleId = ref('');

const ruleForm = ref({
  level: 'medium',
  window: '',
  metric: '',
  threshold: 1,
  scope: 'school',
  enabled: true,
});

const ruleRules = {
  level: [{ required: true, message: '请选择预警级别', trigger: 'change' }],
  window: [{ required: true, message: '请输入时间窗口', trigger: 'blur' }],
  metric: [{ required: true, message: '请输入指标', trigger: 'blur' }],
  threshold: [{ required: true, message: '请输入阈值', trigger: 'blur' }],
  scope: [{ required: true, message: '请选择作用域', trigger: 'change' }],
};

const filteredRulesList = computed(() =>
  rulesList.value.filter((rule) => {
    if (filterScope.value && rule.scope !== filterScope.value) {
      return false;
    }
    if (filterLevel.value && rule.level !== filterLevel.value) {
      return false;
    }
    return true;
  }),
);

const fetchRules = async () => {
  loading.value = true;
  try {
    const response = await api.get('/warning-rules');
    rulesList.value = Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (error) {
    console.error('获取规则列表失败:', error);
    rulesList.value = [];
    ElMessage.error('获取规则列表失败');
  } finally {
    loading.value = false;
  }
};

const showCreateDialog = () => {
  isEditMode.value = false;
  currentRuleId.value = '';
  ruleForm.value = {
    level: 'medium',
    window: '',
    metric: '',
    threshold: 1,
    scope: 'school',
    enabled: true,
  };
  ruleDialogVisible.value = true;
};

const editRule = (rule: any) => {
  isEditMode.value = true;
  currentRuleId.value = rule.id;
  ruleForm.value = {
    level: rule.level,
    window: rule.window,
    metric: rule.metric,
    threshold: rule.threshold,
    scope: rule.scope,
    enabled: rule.enabled,
  };
  ruleDialogVisible.value = true;
};

const saveRule = async () => {
  try {
    await ruleFormRef.value.validate();

    if (isEditMode.value) {
      await api.put(`/warning-rules/${currentRuleId.value}`, {
        enabled: ruleForm.value.enabled,
        threshold: ruleForm.value.threshold,
      });
      ElMessage.success('规则更新成功');
    } else {
      await api.post('/warning-rules', ruleForm.value);
      ElMessage.success('规则创建成功');
    }

    ruleDialogVisible.value = false;
    fetchRules();
  } catch (error: any) {
    if (error !== false) {
      console.error(isEditMode.value ? '更新规则失败:' : '创建规则失败:', error);
      ElMessage.error(isEditMode.value ? '更新规则失败' : '创建规则失败');
    }
  }
};

const toggleRule = async (rule: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要${rule.enabled ? '禁用' : '启用'}该规则吗？`,
      '确认操作',
      { type: 'warning' },
    );

    await api.put(`/warning-rules/${rule.id}`, {
      enabled: !rule.enabled,
    });

    ElMessage.success(`${rule.enabled ? '禁用' : '启用'}规则成功`);
    fetchRules();
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('切换规则状态失败:', error);
      ElMessage.error('切换规则状态失败');
    }
  }
};

const deleteRule = async (rule: any) => {
  try {
    await ElMessageBox.confirm('确定要删除该规则吗？', '确认操作', { type: 'warning' });

    await api.delete(`/warning-rules/${rule.id}`);
    ElMessage.success('删除规则成功');
    fetchRules();
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除规则失败:', error);
      ElMessage.error('删除规则失败');
    }
  }
};

const getLevelText = (level: string) => {
  const textMap: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
  };
  return textMap[level] || level;
};

const getScopeText = (scope: string) => {
  const textMap: Record<string, string> = {
    school: '学校',
    org: '学院',
  };
  return textMap[scope] || scope;
};

const getLevelColor = (level: string) => {
  const colorMap: Record<string, string> = {
    low: '#d4a017',
    medium: '#f97316',
    high: '#dc2626',
  };
  return colorMap[level] || '#909399';
};

const formatDate = (date: string) => new Date(date).toLocaleString('zh-CN');

onMounted(() => {
  fetchRules();
});
</script>

<style scoped>
.rule-management {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
