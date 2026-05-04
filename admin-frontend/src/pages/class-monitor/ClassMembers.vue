<template>
  <div class="page-container">
    <h2>班级成员</h2>
    
    <div class="table-shell">
    <el-table :data="members" v-loading="loading" border>
      <el-table-column prop="student_no" label="学号" width="120" />
      <el-table-column prop="name" label="姓名" width="80" />
      <el-table-column prop="gender" label="性别" width="60">
        <template #default="{ row }">
          {{ row.gender === 'male' ? '男' : '女' }}
        </template>
      </el-table-column>
      <el-table-column prop="mobile" label="手机号" width="120" />
      <el-table-column prop="student_position" label="职务" width="100" />
      <el-table-column prop="status" label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
            {{ row.status === 'active' ? '正常' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../api';

const loading = ref(false);
const members = ref<any[]>([]);

const loadMembers = async () => {
  loading.value = true;
  try {
    const response = await api.get('/class-monitor/members');
    if (response.data.code === 0) {
      members.value = response.data.data.list || [];
    }
  } catch (error) {
    console.error('获取班级成员失败:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadMembers();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}
</style>
