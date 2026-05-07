<template>
  <div>
    <h2>学生违规记录查询</h2>
    
    <el-form :model="searchForm" label-width="100px" style="margin-bottom: 20px; max-width: 600px;">
      <el-form-item label="学生姓名" prop="name">
        <el-input v-model="searchForm.name" placeholder="请输入学生姓名" />
      </el-form-item>
      <el-form-item label="学号" prop="student_no">
        <el-input v-model="searchForm.student_no" placeholder="请输入学号" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="searchWarnings" :loading="searching">查询</el-button>
        <el-button type="info" @click="searchWarnings" :loading="searching" icon="Refresh">
          刷新
        </el-button>
        <el-button @click="resetForm">重置</el-button>
      </el-form-item>
    </el-form>

    <div v-if="studentInfo" style="margin-bottom: 20px; padding: 16px; border: 1px solid #e4e7ed; border-radius: 4px;">
      <h3>学生信息</h3>
      <el-descriptions :column="3">
        <el-descriptions-item label="姓名">{{ studentInfo.name }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ studentInfo.student_no }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ studentInfo.class_name }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <div v-if="warnings.length > 0" class="table-shell">
    <el-table :data="warnings" style="margin-top: 16px">
      <el-table-column prop="id" label="违规ID" width="100" />
      <el-table-column prop="level" label="级别" width="100">
        <template #default="{ row }">
          <el-tag :color="getLevelColor(row.level)" effect="dark" style="border: none;">
            {{ getLevelText(row.level) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="trigger_summary" label="违规原因" min-width="200" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-empty v-else-if="searched" description="未查询到违规记录" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { getStudentWarnings } from '../api';
import { getWarningLevelColor, getWarningLevelText } from '../lib/warning-level';
import { formatDateTime } from '../lib/format';

const searchForm = reactive({
  name: '',
  student_no: '',
});

const searching = ref(false);
const searched = ref(false);
const studentInfo = ref<any>(null);
const warnings = ref<any[]>([]);

const searchWarnings = async () => {
  if (!searchForm.name || !searchForm.student_no) {
    ElMessage.warning('请输入学生姓名和学号');
    return;
  }

  searching.value = true;
  try {
    const resp = await getStudentWarnings(searchForm);
    if (resp.code === 0) {
      studentInfo.value = resp.data.student;
      warnings.value = resp.data.warnings;
      searched.value = true;
    } else {
      ElMessage.error(resp.message);
      searched.value = true;
      studentInfo.value = null;
      warnings.value = [];
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '查询失败');
  } finally {
    searching.value = false;
  }
};

const resetForm = () => {
  searchForm.name = '';
  searchForm.student_no = '';
  searched.value = false;
  studentInfo.value = null;
  warnings.value = [];
};

const getLevelColor = getWarningLevelColor;

const getLevelText = (level: string) =>
  getWarningLevelText(level).replace('预警', '');

const getStatusType = (status: string) => {
  switch (status) {
    case 'open': return 'danger';
    case 'acknowledged': return 'warning';
    case 'closed': return 'success';
    default: return '';
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'open': return '未处理';
    case 'acknowledged': return '已确认';
    case 'closed': return '已关闭';
    default: return status;
  }
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN');
};


</script>
