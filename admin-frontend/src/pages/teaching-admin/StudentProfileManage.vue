<template>
  <div class="page-container">
    <h2>学籍变更</h2>
    
    <div class="toolbar">
      <el-input v-model="searchKeyword" placeholder="搜索学号或姓名" style="width: 200px; margin-right: 10px" />
      <el-select-v2
        v-model="searchClassId"
        placeholder="选择班级"
        style="width: 180px; margin-right: 10px"
        clearable
        filterable
        :options="searchClassOptions"
      />
      <el-select-v2
        v-model="searchOrgId"
        placeholder="选择学院"
        style="width: 180px; margin-right: 10px"
        clearable
        filterable
        :options="searchOrgOptions"
      />
      <el-button type="primary" @click="loadStudents">搜索</el-button>
      <el-button type="danger" @click="deleteStudents" :disabled="selectedStudents.length === 0" :loading="deleteLoading">
        删除 ({{ selectedStudents.length }})
      </el-button>
    </div>

    <div class="table-shell">
    <el-table :data="students" v-loading="loading" border stripe style="margin-top: 20px;" @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="55" />
      <el-table-column prop="student_no" label="学号" width="120" />
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column prop="gender" label="性别" width="80">
        <template #default="{ row }">
          {{ row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="org_name" label="学院" width="150" />
      <el-table-column prop="class_name" label="班级" width="150" />
      <el-table-column prop="major" label="专业" width="150" />
      <el-table-column prop="enroll_year" label="入学年份" width="100" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getStudentStatusTagType(row.status)">
            {{ formatStudentStatus(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="editStudent(row)">变更</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-pagination
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      @size-change="handleSizeChange"
      @current-change="handleCurrentChange"
      style="margin-top: 20px; justify-content: flex-end;"
    />

    <el-dialog v-model="showEditDialog" title="学籍变更" width="600px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="学号">
          <span>{{ editForm.student_no }}</span>
        </el-form-item>
        <el-form-item label="姓名">
          <span>{{ editForm.name }}</span>
        </el-form-item>
        <el-form-item label="性别">
          <span>{{ editForm.gender === 'male' ? '男' : editForm.gender === 'female' ? '女' : '-' }}</span>
        </el-form-item>
        <el-form-item label="学院">
          <el-select-v2
            v-model="editForm.org_id"
            placeholder="请选择学院"
            style="width: 100%;"
            filterable
            :options="searchOrgOptions"
            @change="onOrgChange"
          />
        </el-form-item>
        <el-form-item label="班级">
          <el-select-v2
            v-model="editForm.class_id"
            placeholder="请选择班级"
            style="width: 100%;"
            :disabled="!editForm.org_id"
            filterable
            :options="filteredClassOptions"
          />
        </el-form-item>
        <el-form-item label="专业">
          <el-select-v2
            v-model="editForm.major"
            placeholder="请选择专业"
            style="width: 100%;"
            :disabled="!editForm.org_id"
            filterable
            :options="filteredMajorOptions"
          />
        </el-form-item>
        <el-form-item label="入学年份">
          <el-input-number v-model="editForm.enroll_year" :min="2000" :max="2030" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status" placeholder="请选择状态" style="width: 100%;">
            <el-option label="在读" value="active" />
            <el-option label="休学" value="inactive" />
            <el-option label="毕业" value="graduated" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        :title="requiresSpecialApproval ? '提交后将进入特殊审批流程' : '系统管理员保存后会直接生效'"
        :description="studentProfileHintText"
        :type="requiresSpecialApproval ? 'warning' : 'success'"
        :closable="false"
      />
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveStudent" :loading="saveLoading">
          {{ studentProfileActionText }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { 
  getTeachingAdminClasses,
  getTeachingAdminOrgs,
  getTeachingAdminStudents, 
  updateTeachingAdminStudentProfile,
  listMajors,
  batchDeleteStudents
} from '../../api';

const loading = ref(false);
const saveLoading = ref(false);
const deleteLoading = ref(false);
const students = ref<any[]>([]);
const classes = ref<any[]>([]);
const orgs = ref<any[]>([]);
const majorsByOrg = ref<Record<string, any[]>>({});
const selectedStudents = ref<any[]>([]);
const searchKeyword = ref('');
const searchClassId = ref('');
const searchOrgId = ref('');
const currentPage = ref(1);
const pageSize = ref(10);
const total = ref(0);

const showEditDialog = ref(false);
const requiresSpecialApproval = computed(() => {
  try {
    const roles = JSON.parse(localStorage.getItem('admin_roles_full') || '[]');
    return !Array.isArray(roles) || !roles.some((item: any) => item.role === 'sys_admin');
  } catch {
    return true;
  }
});
const studentProfileActionText = computed(() =>
  requiresSpecialApproval.value ? '提交审批' : '保存',
);
const studentProfileHintText = computed(() =>
  requiresSpecialApproval.value
    ? '当前角色保存后不会直接改学籍，而是提交到特殊审批，由教学副院长或系统管理员处理。'
    : '当前角色保存后会直接更新学生学籍信息。',
);

const editForm = reactive({
  id: '',
  student_no: '',
  name: '',
  gender: '',
  org_id: '',
  class_id: '',
  major: '',
  enroll_year: new Date().getFullYear(),
  status: 'active',
});

const filteredClasses = computed(() => {
  if (!editForm.org_id) return [];
  return classes.value.filter(c => String(c.org_id) === String(editForm.org_id));
});

const filteredMajors = computed(() => {
  if (!editForm.org_id) return [];
  return majorsByOrg.value[String(editForm.org_id)] || [];
});

const toOption = (value: string, label: string, raw: any) => ({ value, label, raw });
const searchClassOptions = computed(() =>
  classes.value.map((c: any) => toOption(String(c.id), c.class_name || String(c.id), c)),
);
const searchOrgOptions = computed(() =>
  orgs.value.map((o: any) => toOption(String(o.id), o.org_name || o.name || String(o.id), o)),
);
const filteredClassOptions = computed(() =>
  filteredClasses.value.map((c: any) => toOption(String(c.id), c.class_name || String(c.id), c)),
);
const filteredMajorOptions = computed(() =>
  filteredMajors.value.map((m: any) => toOption(String(m.name || ''), m.name || '', m)),
);

const formatStudentStatus = (status?: string) => {
  const map: Record<string, string> = {
    active: '在读',
    inactive: '休学',
    graduated: '毕业',
  };
  return map[String(status || '')] || '-';
};

const getStudentStatusTagType = (status?: string) => {
  const map: Record<string, string> = {
    active: 'success',
    inactive: 'warning',
    graduated: 'info',
  };
  return map[String(status || '')] || 'info';
};

const loadStudents = async () => {
  loading.value = true;
  try {
    const params: any = {
      page: currentPage.value,
      pageSize: pageSize.value,
    };
    if (searchKeyword.value) params.keyword = searchKeyword.value;
    if (searchClassId.value) params.class_id = searchClassId.value;
    if (searchOrgId.value) params.org_id = searchOrgId.value;
    
    const response = await getTeachingAdminStudents(params);
    if (response.code === 0) {
      students.value = response.data.list || [];
      total.value = response.data.total || 0;
    }
  } catch (error) {
    console.error('获取学生列表失败:', error);
    ElMessage.error('获取学生列表失败');
  } finally {
    loading.value = false;
  }
};

const loadClasses = async () => {
  try {
    const response = await getTeachingAdminClasses();
    if (response.code === 0) {
      classes.value = response.data || [];
    }
  } catch (error) {
    console.error('获取班级列表失败:', error);
  }
};

const loadOrgs = async () => {
  try {
    const response = await getTeachingAdminOrgs();
    if (response.code === 0) {
      orgs.value = response.data || [];
    }
  } catch (error) {
    console.error('获取学院列表失败:', error);
  }
};

const ensureMajorsLoaded = async (orgId?: string) => {
  const normalizedOrgId = String(orgId || '').trim();
  if (!normalizedOrgId || majorsByOrg.value[normalizedOrgId]) {
    return;
  }

  try {
    const response = await listMajors(normalizedOrgId);
    if (response.code === 0 && response.data) {
      majorsByOrg.value = {
        ...majorsByOrg.value,
        [normalizedOrgId]: response.data,
      };
    }
  } catch (error) {
    console.error('获取专业列表失败:', error);
  }
};

const editStudent = (row: any) => {
  editForm.id = row.id;
  editForm.student_no = row.student_no;
  editForm.name = row.name;
  editForm.gender = row.gender || '';
  editForm.org_id = row.org_id;
  editForm.class_id = row.class_id;
  editForm.major = row.major;
  editForm.enroll_year = row.enroll_year || new Date().getFullYear();
  editForm.status = row.status || 'active';
  showEditDialog.value = true;
  void ensureMajorsLoaded(String(editForm.org_id || ''));
};

const onOrgChange = () => {
  editForm.class_id = '';
  editForm.major = '';
  void ensureMajorsLoaded(String(editForm.org_id || ''));
};

const saveStudent = async () => {
  if (!editForm.class_id) {
    ElMessage.warning('请选择班级');
    return;
  }
  
  saveLoading.value = true;
  try {
    const response = await updateTeachingAdminStudentProfile(editForm.id, {
      class_id: editForm.class_id,
      major: editForm.major,
      enroll_year: editForm.enroll_year,
      status: editForm.status,
    });
    if (response.code !== 0) {
      throw new Error(response.message || '保存失败');
    }
    ElMessage.success(
      response.message || (requiresSpecialApproval.value ? '已提交学籍变更审批' : '保存成功'),
    );
    showEditDialog.value = false;
    await loadStudents();
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saveLoading.value = false;
  }
};

const handleSizeChange = (val: number) => {
  pageSize.value = val;
  loadStudents();
};

const handleCurrentChange = (val: number) => {
  currentPage.value = val;
  loadStudents();
};

const handleSelectionChange = (selection: any[]) => {
  selectedStudents.value = selection;
};

const deleteStudents = async () => {
  if (selectedStudents.value.length === 0) {
    ElMessage.warning('请先选择要删除的学生');
    return;
  }
  
  const count = selectedStudents.value.length;
  const message = count === 1 
    ? '确定要删除该学生吗？删除后无法恢复！'
    : `确定要删除选中的 ${count} 个学生吗？删除后无法恢复！`;
  
  try {
    await ElMessageBox.confirm(message, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    
    deleteLoading.value = true;
    const studentIds = selectedStudents.value.map((s: any) => s.id);
    await batchDeleteStudents(studentIds);
    ElMessage.success(count === 1 ? '删除成功' : '批量删除成功');
    selectedStudents.value = [];
    loadStudents();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(count === 1 ? '删除失败' : '批量删除失败');
    }
  } finally {
    deleteLoading.value = false;
  }
};

onMounted(async () => {
  await loadOrgs();
  await Promise.allSettled([
    loadStudents(),
    loadClasses()
  ]);
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.toolbar {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
