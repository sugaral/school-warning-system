<template>
  <div class="page-container">
    <div class="page-header">
      <div>
        <h2>规则覆盖</h2>
        <p>按学院覆盖默认预警阈值。保存后仅对当前学院生效，不影响全校默认规则。</p>
      </div>
      <el-button @click="loadRules" :loading="loading">刷新</el-button>
    </div>

    <el-alert
      title="使用说明"
      type="warning"
      :closable="false"
      description="分级阈值需满足“红色 <= 橙色 <= 黄色”。数值越低表示越严重。"
      style="margin-bottom: 20px"
    />

    <el-card v-loading="loading">
      <el-form ref="formRef" :model="ruleOverride" :rules="rules" label-width="160px">
        <el-form-item label="启用学院覆盖" prop="enabled">
          <el-switch v-model="ruleOverride.enabled" />
        </el-form-item>

        <template v-if="ruleOverride.enabled">
          <el-form-item label="成绩预警阈值" prop="gradeThreshold">
            <el-input-number v-model="ruleOverride.gradeThreshold" :min="0" :max="100" />
            <span class="suffix">分</span>
          </el-form-item>

          <el-form-item label="出勤率预警阈值" prop="attendanceThreshold">
            <el-input-number v-model="ruleOverride.attendanceThreshold" :min="0" :max="100" />
            <span class="suffix">%</span>
          </el-form-item>

          <el-form-item label="预警分级阈值" prop="yellowThreshold">
            <div class="levels">
              <div class="level-card">
                <el-tag type="danger">红色预警</el-tag>
                <el-input-number v-model="ruleOverride.redThreshold" :min="0" :max="100" />
              </div>
              <div class="level-card">
                <el-tag color="#ff8f1f" effect="dark" style="border: none">橙色预警</el-tag>
                <el-input-number v-model="ruleOverride.orangeThreshold" :min="0" :max="100" />
              </div>
              <div class="level-card">
                <el-tag type="warning">黄色预警</el-tag>
                <el-input-number v-model="ruleOverride.yellowThreshold" :min="0" :max="100" />
              </div>
            </div>
          </el-form-item>
        </template>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveRules">保存规则</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { getStudentAdminRulesOverride, setStudentAdminRulesOverride } from '../../api';

const loading = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();

const ruleOverride = reactive({
  enabled: false,
  gradeThreshold: 60,
  attendanceThreshold: 70,
  redThreshold: 50,
  orangeThreshold: 60,
  yellowThreshold: 70,
});

const validateThresholdOrder = (_rule: any, _value: number, callback: (error?: Error) => void) => {
  if (!ruleOverride.enabled) {
    callback();
    return;
  }

  if (
    ruleOverride.redThreshold <= ruleOverride.orangeThreshold &&
    ruleOverride.orangeThreshold <= ruleOverride.yellowThreshold
  ) {
    callback();
    return;
  }

  callback(new Error('分级阈值需满足 红色 <= 橙色 <= 黄色'));
};

const rules: FormRules = {
  gradeThreshold: [{ required: true, message: '请填写成绩预警阈值', trigger: 'change' }],
  attendanceThreshold: [{ required: true, message: '请填写出勤率预警阈值', trigger: 'change' }],
  yellowThreshold: [{ validator: validateThresholdOrder, trigger: 'change' }],
};

const loadRules = async () => {
  loading.value = true;
  try {
    const response = await getStudentAdminRulesOverride();
    if (response.code !== 0) {
      throw new Error(response.message || '加载规则覆盖失败');
    }

    Object.assign(ruleOverride, {
      enabled: response.data?.enabled ?? false,
      gradeThreshold: response.data?.gradeThreshold ?? 60,
      attendanceThreshold: response.data?.attendanceThreshold ?? 70,
      redThreshold: response.data?.redThreshold ?? 50,
      orangeThreshold: response.data?.orangeThreshold ?? 60,
      yellowThreshold: response.data?.yellowThreshold ?? 70,
    });
  } catch (error: any) {
    ElMessage.error(error?.message || '加载规则覆盖失败');
  } finally {
    loading.value = false;
  }
};

const saveRules = async () => {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    return;
  }

  saving.value = true;
  try {
    const response = await setStudentAdminRulesOverride({ ...ruleOverride });
    if (response.code !== 0) {
      throw new Error(response.message || '保存失败');
    }
    ElMessage.success('规则覆盖已保存');
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  loadRules();
});
</script>

<style scoped>
.page-container {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0 0 8px;
}

.page-header p {
  margin: 0;
  color: #606266;
  line-height: 1.6;
}

.suffix {
  margin-left: 10px;
  color: #606266;
}

.levels {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.level-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.46);
  border: 1px solid rgba(107, 140, 158, 0.16);
  border-radius: 12px;
  backdrop-filter: blur(14px);
}

@media (max-width: 768px) {
  .levels {
    grid-template-columns: 1fr;
  }
}
</style>
