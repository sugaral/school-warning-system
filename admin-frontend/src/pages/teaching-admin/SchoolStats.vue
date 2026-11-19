<template>
  <div class="school-stats-page">
    <section class="school-stats-hero">
      <div class="school-stats-hero__copy">
        <span class="school-stats-hero__eyebrow">Campus Overview</span>
        <h2 class="school-stats-hero__title">全校统计</h2>
        <p class="school-stats-hero__desc">汇总全校学生、教师、学院、班级、课程和预警总体情况，并快速对比各学院预警率。</p>
      </div>
      <div class="school-stats-hero__actions">
        <div class="school-stats-hero__meta">
          <span>统计口径</span>
          <strong>全校汇总</strong>
          <small>按当前系统实时数据生成</small>
        </div>
        <el-button type="info" :loading="loading" @click="loadStats">刷新</el-button>
      </div>
    </section>

    <section class="school-stats-overview">
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">学生总数</span>
        <strong class="school-stats-overview__value">{{ stats.totalStudents || 0 }}</strong>
        <p class="school-stats-overview__desc">当前系统内在册学生人数</p>
      </article>
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">教师总数</span>
        <strong class="school-stats-overview__value">{{ stats.totalTeachers || 0 }}</strong>
        <p class="school-stats-overview__desc">当前系统内教师账号数量</p>
      </article>
      <article class="school-stats-overview__card school-stats-overview__card--warning">
        <span class="school-stats-overview__label">预警率</span>
        <strong class="school-stats-overview__value">{{ stats.warningRate || '0%' }}</strong>
        <p class="school-stats-overview__desc">当前全校预警人数占比</p>
      </article>
      <article class="school-stats-overview__card school-stats-overview__card--success">
        <span class="school-stats-overview__label">解除率</span>
        <strong class="school-stats-overview__value">{{ stats.closureRate || '0%' }}</strong>
        <p class="school-stats-overview__desc">当前预警记录闭环比例</p>
      </article>
    </section>

    <section class="school-stats-overview school-stats-overview--secondary">
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">学院总数</span>
        <strong class="school-stats-overview__value">{{ stats.totalOrgs || 0 }}</strong>
        <p class="school-stats-overview__desc">当前启用的学院数量</p>
      </article>
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">班级总数</span>
        <strong class="school-stats-overview__value">{{ stats.totalClasses || 0 }}</strong>
        <p class="school-stats-overview__desc">当前启用的班级数量</p>
      </article>
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">课程总数</span>
        <strong class="school-stats-overview__value">{{ stats.totalCourses || 0 }}</strong>
        <p class="school-stats-overview__desc">当前启用的课程数量</p>
      </article>
      <article class="school-stats-overview__card">
        <span class="school-stats-overview__label">学院预警排行</span>
        <strong class="school-stats-overview__value">{{ collegeStats.length }}</strong>
        <p class="school-stats-overview__desc">当前表格中展示的学院记录数</p>
      </article>
    </section>

    <el-card class="school-stats-table-card">
      <template #header>
        <div class="school-stats-table-card__header">
          <div>
            <span class="school-stats-table-card__title">各学院预警情况</span>
            <p class="school-stats-table-card__desc">按学院维度查看学生数、预警数和预警率。</p>
          </div>
          <el-tag type="primary" effect="plain">当前 {{ collegeStats.length }} 条</el-tag>
        </div>
      </template>

      <div class="table-shell">
        <el-table :data="collegeStats" border stripe v-loading="loading">
          <el-table-column prop="org_name" label="学院" width="200" />
          <el-table-column prop="student_count" label="学生数" width="120" />
          <el-table-column prop="warning_count" label="预警数" width="120" />
          <el-table-column prop="warning_rate" label="预警率" width="120" />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getTeachingAdminSchoolStats } from '../../api';

const loading = ref(false);
const stats = ref<any>({});
const collegeStats = ref<any[]>([]);

const loadStats = async () => {
  loading.value = true;
  try {
    const response = await getTeachingAdminSchoolStats();
    if (response.code === 0) {
      stats.value = response.data.stats || {};
      collegeStats.value = response.data.collegeStats || [];
    }
  } catch (error) {
    console.error('获取全校统计失败:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadStats();
});
</script>

<style scoped>
.school-stats-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.school-stats-hero {
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

.school-stats-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 760px;
}

.school-stats-hero__eyebrow {
  color: #5c7284;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.school-stats-hero__title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #173145;
}

.school-stats-hero__desc {
  margin: 0;
  color: #5d7283;
  line-height: 1.6;
}

.school-stats-hero__actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
}

.school-stats-hero__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  padding: 14px 16px;
  border: 1px solid rgba(108, 140, 158, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.68);
  color: #5e7384;
  font-size: 12px;
}

.school-stats-hero__meta strong {
  color: #173145;
  font-size: 20px;
  line-height: 1.2;
}

.school-stats-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.school-stats-overview__card {
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

.school-stats-overview__card--warning {
  background: linear-gradient(180deg, rgba(255, 247, 237, 0.94), rgba(255, 237, 213, 0.82));
}

.school-stats-overview__card--success {
  background: linear-gradient(180deg, rgba(236, 253, 245, 0.94), rgba(209, 250, 229, 0.82));
}

.school-stats-overview__label {
  color: #678090;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.school-stats-overview__value {
  color: #173145;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.school-stats-overview__desc {
  margin: 0;
  color: #607384;
  font-size: 13px;
  line-height: 1.6;
}

.school-stats-table-card {
  overflow: hidden;
}

.school-stats-table-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.school-stats-table-card__title {
  display: block;
  font-size: 18px;
  font-weight: 700;
  color: #1d3648;
}

.school-stats-table-card__desc {
  margin: 6px 0 0;
  color: #66798a;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 1200px) {
  .school-stats-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .school-stats-hero {
    padding: 20px;
  }

  .school-stats-overview {
    grid-template-columns: 1fr;
  }

  .school-stats-hero__actions {
    width: 100%;
    justify-content: stretch;
  }

  .school-stats-hero__actions > * {
    width: 100%;
  }
}
</style>
