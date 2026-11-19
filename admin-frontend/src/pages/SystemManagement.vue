<template>
  <div class="system-management-page">
    <h2 class="page-title">系统管理</h2>

    <div ref="shellRef" class="tab-shell">
      <!-- 滑动胶囊：跟随当前页签平滑移动，替代背景硬切 -->
      <span class="tab-glider" :style="gliderStyle" aria-hidden="true" />
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
  </div>
</template>

<script setup lang="ts">
import {
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';

const UserManagement = defineAsyncComponent(() => import('./system/UserManagement.vue'));
const RoleManagement = defineAsyncComponent(() => import('./system/RoleManagement.vue'));
const PermissionManagement = defineAsyncComponent(() => import('./system/PermissionManagement.vue'));
const TemplateManagement = defineAsyncComponent(() => import('./system/TemplateManagement.vue'));
const TwoFactorManagement = defineAsyncComponent(() => import('./system/TwoFactorManagement.vue'));
const SystemConfig = defineAsyncComponent(() => import('./system/SystemConfig.vue'));

const route = useRoute();

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

  // 关键：用 history.replaceState 只同步地址栏，不走 vue-router 导航。
  // 走 router.replace 会改变 currentRoute.fullPath，而 Dashboard 的 router-view
  // 以 fullPath 作 key，会导致整页销毁重建（滚动归零 + 全部面板重载），
  // 这就是切换页签时「页面大幅跳动」的真正原因。
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', url);
  }
});

// ============================================================
// 滑动胶囊指示器：测量当前页签的位置与宽度，用 transform/width 过渡
// 让它像 iOS 分段控件一样滑过去，而不是瞬间跳色。
// ============================================================
const shellRef = ref<HTMLElement | null>(null);
const gliderStyle = ref<Record<string, string>>({
  opacity: '0',
  transform: 'translateX(0px)',
  width: '0px',
});

const moveGlider = (animated = true) => {
  const shell = shellRef.value;
  if (!shell) {
    return;
  }

  const active = shell.querySelector<HTMLElement>('.el-tabs__item.is-active');
  if (!active) {
    gliderStyle.value = { ...gliderStyle.value, opacity: '0' };
    return;
  }

  const shellRect = shell.getBoundingClientRect();
  const rect = active.getBoundingClientRect();
  const next: Record<string, string> = {
    opacity: '1',
    transform: `translateX(${Math.round(rect.left - shellRect.left)}px)`,
    width: `${Math.round(rect.width)}px`,
    height: `${Math.round(rect.height)}px`,
    top: `${Math.round(rect.top - shellRect.top)}px`,
  };

  if (!animated) {
    next.transition = 'none';
    gliderStyle.value = next;
    // 强制一次回流后再恢复过渡，避免首帧从 0 滑入
    requestAnimationFrame(() => {
      gliderStyle.value = { ...next, transition: '' };
    });
    return;
  }

  gliderStyle.value = next;
};

const handleResize = () => moveGlider();

onMounted(() => {
  moveGlider(false);
  requestAnimationFrame(() => moveGlider(false));
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});

watch(activeTab, async () => {
  // 记录外层滚动位置，切换后原样恢复：即使某个面板首帧高度不同，
  // 也不会把用户「弹」到别的位置。
  const outerY = typeof window !== 'undefined' ? window.scrollY : 0;
  await nextTick();
  const scroller = shellRef.value?.querySelector<HTMLElement>('.el-tabs__content');
  if (scroller) {
    scroller.scrollTop = 0;
  }
  if (typeof window !== 'undefined' && window.scrollY !== outerY) {
    window.scrollTo({ top: outerY, behavior: 'auto' });
  }
  moveGlider();
});
</script>

<style scoped>
.system-management-page {
  padding: 20px;
  display: flex;
  flex-direction: column;
  /* 关键：页面自身高度固定，切换页签时文档高度不再变化，
     避免出现「短页签→长页签」的整页拉伸跳动。
     内容超出时只让页签内部滚动。 */
  height: calc(100dvh - 180px);
  min-height: 520px;
  box-sizing: border-box;
  overflow: hidden;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 20px;
  color: #303133;
}

.tab-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 滑动胶囊：iOS 分段控件质感 */
.tab-glider {
  position: absolute;
  left: 0;
  border-radius: 999px;
  background: var(--dp-color-accent, #8ed3a5);
  box-shadow: 0 8px 18px rgba(79, 158, 111, 0.28);
  transition:
    transform 420ms cubic-bezier(0.32, 0.72, 0, 1),
    width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    height 260ms ease,
    top 260ms ease,
    opacity 180ms ease;
  pointer-events: none;
  z-index: 0;
}

.management-tabs {
  flex: 1;
  min-height: 0;
  overflow: visible;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
}

.management-tabs :deep(.el-tabs__header) {
  background: transparent;
  border-bottom: none;
  margin-bottom: 16px;
  flex: 0 0 auto;
}

.management-tabs :deep(.el-tabs__nav) {
  background: transparent;
  border: none;
  /* 保证页签在滑块之上，点击不会被遮挡 */
  position: relative;
  z-index: 2;
}

/* 页签本体透明，高亮全交给下滑块 */
.management-tabs :deep(.el-tabs__item) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 20px !important;
  height: 40px !important;
  line-height: 40px !important;
  color: var(--dp-color-ink-secondary, #48404b) !important;
  transition: color 220ms ease !important;
}

.management-tabs :deep(.el-tabs__item.is-active) {
  color: var(--dp-color-ink, #383139) !important;
  font-weight: 700 !important;
}

.management-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

/* 页签内容区自己滚动：文档高度恒定，切页只换内容不推页面 */
.management-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  height: auto;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-right: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .tab-glider {
    transition: none;
  }
}
</style>
