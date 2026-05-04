<template>
  <div class="calendar-management">
    <div class="toolbar">
      <el-date-picker
        v-model="selectedDate"
        type="date"
        placeholder="筛选日期"
        value-format="YYYY-MM-DD"
        style="width: 180px"
      />

      <el-select v-model="filterScope" placeholder="作用范围" clearable style="width: 150px">
        <el-option label="学校" value="school" />
        <el-option label="学院" value="org" />
      </el-select>

      <el-select
        v-model="filterOrgId"
        placeholder="选择学院"
        clearable
        filterable
        style="width: 220px"
        :disabled="filterScope !== 'org'"
      >
        <el-option
          v-for="org in orgOptions"
          :key="org.id"
          :label="org.org_name || org.name"
          :value="org.id"
        />
      </el-select>

      <el-button type="primary" @click="openCreateDialog">
        <el-icon><Plus /></el-icon>
        新增排除日期
      </el-button>

      <el-button @click="fetchExclusions">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <el-calendar v-model="calendarDate" class="calendar-panel">
      <template #date-cell="{ data }">
        <div class="calendar-cell">
          <div class="date-number">{{ data.day.split('-').pop() }}</div>
          <div v-if="isExcludedDate(data.day)" class="excluded-tag">排除</div>
        </div>
      </template>
    </el-calendar>

    <el-divider>排除日期列表</el-divider>

    <div class="table-shell">
    <el-table v-loading="loading" :data="filteredExclusions" stripe style="width: 100%">
      <el-table-column prop="exclusion_date" label="日期" width="120" />
      <el-table-column prop="reason" label="原因" min-width="220" />
      <el-table-column label="作用范围" width="180">
        <template #default="{ row }">
          <el-tag size="small" :type="row.scope === 'org' ? 'warning' : 'success'">
            {{ row.scope === 'org' ? '学院' : '学校' }}
          </el-tag>
          <span class="scope-name">{{ row.scope_name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="danger" @click="deleteExclusion(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="新增排除日期" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="日期" prop="exclusion_date">
          <el-date-picker
            v-model="form.exclusion_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择排除日期"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="作用范围" prop="scope">
          <el-radio-group v-model="form.scope">
            <el-radio label="school">学校</el-radio>
            <el-radio label="org">学院</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.scope === 'org'" label="学院" prop="scope_id">
          <el-select v-model="form.scope_id" filterable placeholder="选择学院" style="width: 100%">
            <el-option
              v-for="org in orgOptions"
              :key="org.id"
              :label="org.org_name || org.name"
              :value="org.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="原因" prop="reason">
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            maxlength="255"
            show-word-limit
            placeholder="例如：节假日、校庆停课、调休日"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitExclusion">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { api, listOrgs } from '../../api';

type CalendarExclusion = {
  id: string;
  scope: 'school' | 'org';
  scope_id: string | null;
  scope_name: string;
  exclusion_date: string;
  reason: string;
  created_at: string;
};

const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const calendarDate = ref(new Date());
const selectedDate = ref('');
const filterScope = ref('');
const filterOrgId = ref('');
const monthExclusions = ref<CalendarExclusion[]>([]);
const orgOptions = ref<any[]>([]);
const formRef = ref<FormInstance>();

const form = reactive({
  exclusion_date: '',
  scope: 'school',
  scope_id: '',
  reason: '',
});

const rules: FormRules = {
  exclusion_date: [{ required: true, message: '请选择排除日期', trigger: 'change' }],
  scope: [{ required: true, message: '请选择作用范围', trigger: 'change' }],
  scope_id: [
    {
      validator: (_rule, value, callback) => {
        if (form.scope === 'org' && !value) {
          callback(new Error('请选择学院'));
          return;
        }
        callback();
      },
      trigger: 'change',
    },
  ],
};

const getMonthValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const fetchExclusions = async () => {
  loading.value = true;
  try {
    const response = await api.get('/admin/config/calendar-exclusions', {
      params: {
        month: getMonthValue(calendarDate.value),
      },
    });
    monthExclusions.value = response.data.data || [];
  } catch (error: any) {
    console.error('获取排除日期失败:', error);
    monthExclusions.value = [];
    ElMessage.error(error?.message || '获取排除日期失败');
  } finally {
    loading.value = false;
  }
};

const fetchOrgs = async () => {
  try {
    const response = await listOrgs();
    orgOptions.value = response.data || [];
  } catch (error) {
    console.error('获取学院列表失败:', error);
    orgOptions.value = [];
  }
};

const filteredExclusions = computed(() => {
  return monthExclusions.value.filter((item) => {
    if (selectedDate.value && item.exclusion_date !== selectedDate.value) {
      return false;
    }
    if (filterScope.value && item.scope !== filterScope.value) {
      return false;
    }
    if (filterScope.value === 'org' && filterOrgId.value && item.scope_id !== filterOrgId.value) {
      return false;
    }
    return true;
  });
});

const isExcludedDate = (date: string) => {
  return monthExclusions.value.some((item) => item.exclusion_date === date);
};

const resetForm = () => {
  form.exclusion_date = selectedDate.value || formatDateOnly(new Date());
  form.scope = 'school';
  form.scope_id = '';
  form.reason = '';
};

const openCreateDialog = () => {
  resetForm();
  dialogVisible.value = true;
};

const submitExclusion = async () => {
  if (!formRef.value) {
    return;
  }

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  saving.value = true;
  try {
    await api.post('/admin/config/calendar-exclusions', {
      exclusion_date: form.exclusion_date,
      scope: form.scope,
      scope_id: form.scope === 'org' ? form.scope_id : null,
      reason: form.reason,
    });
    ElMessage.success('新增排除日期成功');
    dialogVisible.value = false;
    calendarDate.value = new Date(form.exclusion_date);
    await fetchExclusions();
  } catch (error: any) {
    console.error('新增排除日期失败:', error);
    ElMessage.error(error?.message || '新增排除日期失败');
  } finally {
    saving.value = false;
  }
};

const deleteExclusion = async (item: CalendarExclusion) => {
  try {
    await ElMessageBox.confirm(`确定删除 ${item.exclusion_date} 的排除配置吗？`, '提示', {
      type: 'warning',
    });
    await api.delete(`/admin/config/calendar-exclusions/${item.id}`);
    ElMessage.success('删除成功');
    await fetchExclusions();
  } catch (error: any) {
    if (error === 'cancel') {
      return;
    }
    console.error('删除排除日期失败:', error);
    ElMessage.error(error?.message || '删除排除日期失败');
  }
};

const formatDateOnly = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN');
};

watch(
  () => calendarDate.value,
  () => {
    fetchExclusions();
  },
);

watch(
  () => form.scope,
  (value) => {
    if (value !== 'org') {
      form.scope_id = '';
    }
  },
);

watch(
  () => filterScope.value,
  (value) => {
    if (value !== 'org') {
      filterOrgId.value = '';
    }
  },
);

onMounted(async () => {
  resetForm();
  await Promise.all([fetchOrgs(), fetchExclusions()]);
});
</script>

<style scoped>
.calendar-management {
  height: 100%;
  overflow-y: auto;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.calendar-panel {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}

.calendar-cell {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.date-number {
  font-size: 14px;
  font-weight: 600;
}

.excluded-tag {
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  color: #c45656;
  background: #fef0f0;
}

.scope-name {
  margin-left: 8px;
  color: #606266;
}
</style>
