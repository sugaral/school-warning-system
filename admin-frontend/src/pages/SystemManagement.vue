<template>
  <div class="system-management-page">
    <h2 class="page-title">系统管理</h2>

    <el-tabs v-model="activeTab" type="card" class="management-tabs" lazy>
      <el-tab-pane label="用户管理" name="users">
        <UserManagement />
      </el-tab-pane>

      <el-tab-pane label="角色管理" name="roles">
        <RoleManagement />
      </el-tab-pane>

      <el-tab-pane label="权限管理" name="permissions">
        <PermissionManagement />
      </el-tab-pane>

      <el-tab-pane label="消息模板" name="templates">
        <TemplateManagement />
      </el-tab-pane>

      <el-tab-pane label="2FA 管理" name="two-factor">
        <TwoFactorManagement />
      </el-tab-pane>

      <el-tab-pane label="系统配置" name="config">
        <SystemConfig />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const UserManagement = defineAsyncComponent(() => import('./system/UserManagement.vue'));
const RoleManagement = defineAsyncComponent(() => import('./system/RoleManagement.vue'));
const PermissionManagement = defineAsyncComponent(() => import('./system/PermissionManagement.vue'));
const TemplateManagement = defineAsyncComponent(() => import('./system/TemplateManagement.vue'));
const TwoFactorManagement = defineAsyncComponent(() => import('./system/TwoFactorManagement.vue'));
const SystemConfig = defineAsyncComponent(() => import('./system/SystemConfig.vue'));

const route = useRoute();
const router = useRouter();

const validTabs = new Set(['users', 'roles', 'permissions', 'templates', 'two-factor', 'config']);

const resolveTab = (value: unknown) => {
  const normalized = String(value || '').trim();
  return validTabs.has(normalized) ? normalized : 'users';
};

const activeTab = ref(resolveTab(route.query.tab));

watch(
  () => route.query.tab,
  (tab) => {
    const nextTab = resolveTab(tab);
    if (nextTab !== activeTab.value) {
      activeTab.value = nextTab;
    }
  },
  { immediate: true },
);

watch(activeTab, (tab) => {
  if (route.query.tab === tab) {
    return;
  }

  router.replace({
    path: route.path,
    query: {
      ...route.query,
      tab,
    },
  });
});
</script>

<style scoped>
.system-management-page {
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 20px;
  color: #303133;
}

.management-tabs {
  flex: 1;
  overflow: visible;
}

.management-tabs :deep(.el-tabs__content) {
  height: auto;
  overflow: visible;
}
</style>
