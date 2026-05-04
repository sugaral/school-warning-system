<template>
  <div class="rules-page">
    <section class="rules-hero">
      <div class="rules-hero__copy">
        <span class="rules-hero__eyebrow">Rule Matrix</span>
        <h2 class="rules-hero__title">预警规则配置</h2>
        <p class="rules-hero__desc">维护预警级别、时间窗口、指标和阈值，作为整套预警引擎的核心配置。</p>
      </div>
      <div class="rules-hero__actions">
        <div class="rules-hero__meta">
          <span>当前规则</span>
          <strong>{{ rules.length }}</strong>
          <small>启用规则 {{ enabledRuleCount }}</small>
        </div>
        <el-button type="primary" @click="showCreateDialog = true">创建规则</el-button>
        <el-button type="info" @click="loadRules" icon="Refresh">
          刷新
        </el-button>
      </div>
    </section>

    <section class="rules-overview">
      <article class="rules-overview__card">
        <span class="rules-overview__label">规则总数</span>
        <strong class="rules-overview__value">{{ rules.length }}</strong>
        <p class="rules-overview__desc">当前已配置的预警规则数量</p>
      </article>
      <article class="rules-overview__card">
        <span class="rules-overview__label">启用中</span>
        <strong class="rules-overview__value">{{ enabledRuleCount }}</strong>
        <p class="rules-overview__desc">当前仍生效中的规则数量</p>
      </article>
      <article class="rules-overview__card">
        <span class="rules-overview__label">最高阈值</span>
        <strong class="rules-overview__value">{{ maxThreshold }}</strong>
        <p class="rules-overview__desc">当前规则里设置的最大阈值</p>
      </article>
      <article class="rules-overview__card">
        <span class="rules-overview__label">指标覆盖</span>
        <strong class="rules-overview__value">{{ uniqueMetricCount }}</strong>
        <p class="rules-overview__desc">当前规则覆盖的不同预警指标数量</p>
      </article>
    </section>

    <el-card class="rules-table-card">
      <template #header>
        <div class="rules-table-card__header">
          <div>
            <span class="rules-table-card__title">规则列表</span>
            <p class="rules-table-card__desc">桌面端可直接管理级别、窗口、指标与启停状态。</p>
          </div>
          <el-tag type="primary" effect="plain">当前 {{ rules.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="rules">
          <el-table-column prop="level" label="级别">
            <template #default="{ row }">
              <el-tag :color="getLevelColor(row.level)" effect="dark" style="border: none;">
                {{ getLevelText(row.level) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="window" label="窗口" />
          <el-table-column label="指标">
            <template #default="{ row }">
              {{ getMetricText(row.metric) }}
            </template>
          </el-table-column>
          <el-table-column prop="threshold" label="阈值" />
          <el-table-column prop="enabled" label="状态">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">
                {{ row.enabled ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作">
            <template #default="{ row }">
              <el-button link @click="toggleEnabled(row)">
                {{ row.enabled ? '停用' : '启用' }}
              </el-button>
              <el-button link @click="confirmDelete(row)" style="color: #f56c6c;">
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="showCreateDialog" title="创建预警规则">
      <el-form :model="form" label-width="100px">
        <el-form-item label="级别">
          <el-select v-model="form.level">
            <el-option label="黄色" value="yellow" />
            <el-option label="橙色" value="orange" />
            <el-option label="红色" value="red" />
            <el-option label="严重" value="severe" />
          </el-select>
        </el-form-item>
        <el-form-item label="窗口">
          <el-select v-model="form.window">
            <el-option label="日" value="day" />
            <el-option label="周" value="week" />
            <el-option label="月" value="month" />
            <el-option label="学期" value="term" />
          </el-select>
        </el-form-item>
        <el-form-item label="指标">
          <el-select v-model="form.metric">
            <el-option label="迟到" value="late" />
            <el-option label="缺勤" value="absent" />
            <el-option label="早退" value="early_leave" />
            <el-option label="累计预警" value="warning_total" />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值">
          <el-input-number v-model="form.threshold" :min="1" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createRule">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listRules, createRule as apiCreateRule, updateRule, deleteRule } from '../api';

const rules = ref<any[]>([]);
const showCreateDialog = ref(false);
const form = ref({
  level: 'yellow',
  window: 'day',
  metric: 'late',
  threshold: 1,
});

const enabledRuleCount = computed(
  () => rules.value.filter((item: any) => Boolean(item.enabled)).length,
);

const maxThreshold = computed(() => {
  if (!rules.value.length) return 0;
  return Math.max(...rules.value.map((item: any) => Number(item.threshold || 0)));
});

const uniqueMetricCount = computed(
  () => new Set(rules.value.map((item: any) => String(item.metric || '')).filter(Boolean)).size,
);

const loadRules = async () => {
  try {
    const resp = await listRules();
    if (resp.code === 0) {
      rules.value = resp.data;
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
  }
};

const createRule = async () => {
  try {
    const resp = await apiCreateRule(form.value);
    if (resp.code === 0) {
      ElMessage.success('创建成功');
      showCreateDialog.value = false;
      loadRules();
    } else {
      ElMessage.error(resp.message);
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '创建失败');
  }
};

const toggleEnabled = async (rule: any) => {
  try {
    const resp = await updateRule(rule.id, { enabled: !rule.enabled });
    if (resp.code === 0) {
      ElMessage.success('更新成功');
      loadRules();
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '更新失败');
  }
};

const confirmDelete = async (rule: any) => {
  try {
    await ElMessageBox.confirm('确定要删除该规则吗？', '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });

    const resp = await deleteRule(rule.id);
    if (resp.code === 0) {
      ElMessage.success('删除成功');
      loadRules();
    }
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e?.message || '删除失败');
    }
  }
};

const getLevelColor = (level: string) => {
  const map: Record<string, string> = {
    yellow: '#d4a017',
    orange: '#f97316',
    red: '#dc2626',
    severe: '#7c3aed',
  };
  return map[level] || '#909399';
};

const getLevelText = (level: string) => {
  const map: Record<string, string> = {
    yellow: '黄色',
    orange: '橙色',
    red: '红色',
    severe: '严重',
  };
  return map[level] || level;
};

const getMetricText = (metric: string) => {
  const map: Record<string, string> = {
    late: '迟到',
    absent: '缺勤',
    early_leave: '早退',
    warning_total: '累计预警',
  };
  return map[metric] || metric;
};

onMounted(loadRules);
</script>

<style scoped>
.rules-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.rules-hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 18px;
  flex-wrap: wrap;
  padding: 24px 26px;
  border: 1px solid rgba(108, 140, 158, 0.16);
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 250, 252, 0.82));
  box-shadow: 0 24px 48px rgba(34, 59, 78, 0.1);
}

.rules-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.rules-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.rules-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.rules-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.rules-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.rules-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.rules-hero__meta strong {
  color: #173145;
  font-size: 26px;
  line-height: 1;
}

.rules-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.rules-overview__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.88),
    rgba(247, 251, 252, 0.8)
  );
  box-shadow: 0 18px 36px rgba(34, 59, 78, 0.08);
}

.rules-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rules-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.rules-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.rules-table-card {
  overflow: hidden;
}

.rules-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.rules-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.rules-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1200px) {
  .rules-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .rules-hero {
    padding: 20px;
  }

  .rules-overview {
    grid-template-columns: 1fr;
  }

  .rules-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .rules-hero__actions > * {
    width: 100%;
  }
}
</style>
