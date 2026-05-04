<template>
  <div class="page-container semester-settings-page">
    <h2 class="page-title">学期起始设置</h2>

    <el-card class="settings-card">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="周报、预警统计-1 和第 N 周显示都会基于这里的学期起始日期计算。"
      />

      <el-form label-width="140px" class="settings-form">
        <el-form-item label="学期起始日期">
          <el-date-picker
            v-model="semesterStartDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择学期起始日期"
          />
        </el-form-item>
        <el-form-item label="本学期周数">
          <el-input-number
            v-model="semesterTotalWeeks"
            :min="1"
            :max="40"
            :step="1"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="当前第几周">
          <el-input :model-value="currentWeekLabel" readonly />
        </el-form-item>
      </el-form>

      <div class="actions">
        <el-button @click="loadConfig">重新加载</el-button>
        <el-button type="primary" :loading="saving" @click="saveConfig">
          保存设置
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getTeachingAdminSemesterConfig,
  updateTeachingAdminSemesterConfig,
} from '../../api';

const semesterStartDate = ref('');
const semesterTotalWeeks = ref(20);
const saving = ref(false);

const currentWeekLabel = computed(() => {
  if (!semesterStartDate.value) {
    return '-';
  }

  const start = new Date(semesterStartDate.value);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  if (Number.isNaN(start.getTime())) {
    return '-';
  }

  if (today.getTime() < start.getTime()) {
    return '第1周（未到开学日期）';
  }

  const weekday = today.getDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(currentWeekStart.getDate() + diffToMonday);
  currentWeekStart.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((currentWeekStart.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.floor(diffDays / 7) + 1;
  return `第${weekNumber}周`;
});

const loadConfig = async () => {
  try {
    const response = await getTeachingAdminSemesterConfig();
    if (response.code === 0) {
      semesterStartDate.value = response.data?.semester_start_date || '';
      semesterTotalWeeks.value = Number(response.data?.semester_total_weeks || 20);
    } else {
      ElMessage.error(response.message || '获取学期起始设置失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '获取学期起始设置失败');
  }
};

const saveConfig = async () => {
  if (!semesterStartDate.value) {
    ElMessage.warning('请先选择学期起始日期');
    return;
  }
  if (!Number.isFinite(Number(semesterTotalWeeks.value)) || Number(semesterTotalWeeks.value) <= 0) {
    ElMessage.warning('请填写正确的本学期总周数');
    return;
  }

  saving.value = true;
  try {
    const response = await updateTeachingAdminSemesterConfig({
      semester_start_date: semesterStartDate.value,
      semester_total_weeks: semesterTotalWeeks.value,
    });
    if (response.code === 0) {
      ElMessage.success('学期起始设置已保存');
      await loadConfig();
    } else {
      ElMessage.error(response.message || '保存学期起始设置失败');
    }
  } catch (error: any) {
    ElMessage.error(error?.message || '保存学期起始设置失败');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  loadConfig();
});
</script>

<style scoped>
.semester-settings-page {
  padding: 20px;
}

.settings-card {
  max-width: 720px;
}

.settings-form {
  margin-top: 20px;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
</style>
