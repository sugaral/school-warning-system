<template>
  <div class="table-spacing-control">
    <el-popover
      placement="left-start"
      :width="340"
      trigger="click"
      popper-class="table-spacing-control__popover"
    >
      <template #reference>
        <el-button class="table-spacing-control__trigger" type="primary" circle>
          表
        </el-button>
      </template>

      <div class="table-spacing-control__panel">
        <div class="table-spacing-control__header">
          <div>
            <strong>表格间距</strong>
            <p>调整后立即作用于全站表格，并自动记住当前设置。</p>
          </div>
          <el-button text @click="resetToDefault">恢复默认</el-button>
        </div>

        <div class="table-spacing-control__item">
          <span>表头左右间距</span>
          <el-slider v-model="settings.headerPaddingX" :min="8" :max="40" @input="applyChanges" />
        </div>
        <div class="table-spacing-control__item">
          <span>表头上下间距</span>
          <el-slider v-model="settings.headerPaddingY" :min="8" :max="28" @input="applyChanges" />
        </div>
        <div class="table-spacing-control__item">
          <span>内容左右间距</span>
          <el-slider v-model="settings.bodyPaddingX" :min="8" :max="40" @input="applyChanges" />
        </div>
        <div class="table-spacing-control__item">
          <span>内容上下间距</span>
          <el-slider v-model="settings.bodyPaddingY" :min="8" :max="28" @input="applyChanges" />
        </div>

        <div class="table-spacing-control__preset">
          <el-button size="small" @click="applyPreset('compact')">紧凑</el-button>
          <el-button size="small" @click="applyPreset('default')">默认</el-button>
          <el-button size="small" @click="applyPreset('loose')">宽松</el-button>
        </div>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import {
  DEFAULT_TABLE_SPACING,
  applyTableSpacingSettings,
  normalizeTableSpacing,
  readTableSpacingSettings,
  saveTableSpacingSettings,
  type TableSpacingSettings,
} from '../lib/table-spacing';

const settings = reactive<TableSpacingSettings>({ ...DEFAULT_TABLE_SPACING });

const applyChanges = () => {
  const normalized = applyTableSpacingSettings(settings);
  Object.assign(settings, normalized);
  saveTableSpacingSettings(normalized);
};

const resetToDefault = () => {
  Object.assign(settings, { ...DEFAULT_TABLE_SPACING });
  applyChanges();
};

const applyPreset = (type: 'compact' | 'default' | 'loose') => {
  if (type === 'compact') {
    Object.assign(settings, normalizeTableSpacing({
      headerPaddingX: 12,
      headerPaddingY: 12,
      bodyPaddingX: 12,
      bodyPaddingY: 11,
    }));
  } else if (type === 'loose') {
    Object.assign(settings, normalizeTableSpacing({
      headerPaddingX: 24,
      headerPaddingY: 18,
      bodyPaddingX: 24,
      bodyPaddingY: 18,
    }));
  } else {
    Object.assign(settings, { ...DEFAULT_TABLE_SPACING });
  }
  applyChanges();
};

onMounted(() => {
  const stored = readTableSpacingSettings();
  Object.assign(settings, stored);
  applyTableSpacingSettings(stored);
});
</script>

<style scoped>
.table-spacing-control {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 3000;
}

.table-spacing-control__trigger {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  box-shadow: 0 18px 32px rgba(15, 118, 110, 0.25);
  font-weight: 700;
}

.table-spacing-control__panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.table-spacing-control__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.table-spacing-control__header strong {
  font-size: 16px;
  color: #173145;
}

.table-spacing-control__header p {
  margin: 6px 0 0;
  color: #647686;
  font-size: 12px;
  line-height: 1.6;
}

.table-spacing-control__item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.table-spacing-control__item span {
  font-size: 13px;
  color: #365164;
  font-weight: 600;
}

.table-spacing-control__preset {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

:global(.table-spacing-control__popover.el-popover) {
  border-radius: 20px;
}

@media (max-width: 768px) {
  .table-spacing-control {
    right: 18px;
    bottom: 18px;
  }
}
</style>
