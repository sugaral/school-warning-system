<template>
  <el-container class="dashboard-layout">
    <el-aside width="248px" class="dashboard-aside">
      <div class="brand-panel">
        <p class="brand-eyebrow">WARNSYS</p>
        <h3 class="logo">{{ currentTitle }}</h3>
        <p class="brand-subtitle">Morning mist data console</p>
      </div>
      <el-menu router :default-active="activeMenu" class="menu">
        <template v-for="menu in currentMenus" :key="menu.path">
          <el-menu-item v-if="!menu.children" :index="menu.path">
            <span>{{ menu.name }}</span>
          </el-menu-item>
          <el-sub-menu v-else :index="menu.path">
            <template #title>
              <span>{{ menu.name }}</span>
            </template>
            <el-menu-item v-for="child in menu.children" :key="child.path" :index="child.path">
              <span>{{ child.name }}</span>
            </el-menu-item>
          </el-sub-menu>
        </template>
      </el-menu>
    </el-aside>

    <el-container class="dashboard-content">
      <el-header class="header">
        <div class="header-copy">
          <span class="header-eyebrow">Control Surface</span>
          <div class="header-title-row">
            <span class="header-title">{{ currentPageName }}</span>
            <span class="header-chip">{{ currentTitle }}</span>
          </div>
        </div>
        <span class="spacer" />
        <div class="user-info">
          <span class="user-label">用户：</span>
          <span class="user-name">{{ currentUser.name }}</span>
          <el-button link class="feedback-btn" @click="openFeedbackDialog">我要反馈</el-button>
          <el-button link class="logout-btn" @click="logout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="main dashboard-main-shell">
        <router-view v-slot="{ Component, route: currentRoute }">
          <keep-alive :max="12">
            <component
              :is="Component"
              v-if="currentRoute.meta?.keepAlive"
              :key="String(currentRoute.name || currentRoute.path)"
            />
          </keep-alive>
          <component
            :is="Component"
            v-if="!currentRoute.meta?.keepAlive"
            :key="currentRoute.fullPath"
          />
        </router-view>
      </el-main>
    </el-container>
  </el-container>

  <el-dialog v-model="feedbackDialogVisible" title="我要反馈" width="560px">
    <el-input
      v-model="feedbackContent"
      type="textarea"
      :rows="8"
      maxlength="2000"
      show-word-limit
      placeholder="请输入你的建议、遇到的问题，或希望优化的地方"
    />
    <div class="feedback-upload">
      <MultiImageUploadField
        v-model="feedbackImageIds"
        v-model:file-urls="feedbackImageUrls"
        source="feedback"
        placeholder="可选上传问题截图"
      />
    </div>
    <template #footer>
      <el-button @click="closeFeedbackDialog">取消</el-button>
      <el-button type="primary" :loading="feedbackSubmitting" @click="submitFeedback">
        提交建议
      </el-button>
    </template>
  </el-dialog>

  <TableSpacingControl />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import MultiImageUploadField from '../components/MultiImageUploadField.vue';
import TableSpacingControl from '../components/TableSpacingControl.vue';
import { submitUserFeedback } from '../api';
import { roleMenuConfig } from '../config/menus';
import {
  clearBindingStateCache,
  getHeadTeacherBoundState,
  getStudentAdminBoundState,
  getStudentBoundState,
  getTeacherBindingState,
} from '../lib/binding';

const router = useRouter();
const route = useRoute();
const LOGIN_PROMPT_SESSION_KEY = 'admin_login_prompt';

const currentUser = ref<any>({ name: '加载中...' });
const userType = ref('');
const feedbackDialogVisible = ref(false);
const feedbackSubmitting = ref(false);
const feedbackContent = ref('');
const feedbackImageIds = ref<string[]>([]);
const feedbackImageUrls = ref<string[]>([]);

const activeMenu = computed(() => route.path);

const currentTitle = computed(() => {
  if (userType.value === 'student') return '学生端';
  if (userType.value === 'class_monitor') return '班干端';
  if (userType.value === 'head_teacher') return '班主任端';
  if (userType.value === 'student_admin') return '学工管理员端';
  if (userType.value === 'dean' || userType.value === 'teaching_admin') return '教务管理员端';
  if (userType.value === 'vice_dean') return '教学副院长端';
  if (userType.value === 'sys_admin') return '系统管理端';
  if (userType.value === 'teacher') return '教师端';
  if (userType.value === 'admin') return '管理端';
  return '管理端';
});

const currentMenus = computed(() => {
  const matched = roleMenuConfig.find((config) => config.role === userType.value);
  const baseMenus =
    matched?.menus || roleMenuConfig.find((config) => config.role === 'sys_admin')?.menus || [];
  const sysAdminMenuOrder = ['warning', 'org', 'course', 'teaching', 'processing', 'system-ops'];
  const orderedBaseMenus =
    userType.value === 'sys_admin'
      ? [...baseMenus].sort((left, right) => {
          const leftIndex = sysAdminMenuOrder.indexOf(left.path);
          const rightIndex = sysAdminMenuOrder.indexOf(right.path);
          const safeLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
          const safeRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
          return safeLeftIndex - safeRightIndex;
        })
      : baseMenus;

  if (userType.value === 'head_teacher') {
    if (getHeadTeacherBoundState() === true) {
      return orderedBaseMenus.filter((menu) => menu.path !== '/teacher-bind-class');
    }
    return orderedBaseMenus;
  }

  if (userType.value === 'teacher') {
    const binding = getTeacherBindingState();
    if (binding.hasBoundOrg === true && binding.hasBoundCourses === true) {
      return orderedBaseMenus.filter((menu) => menu.path !== '/teacher-bind-org');
    }

    if (binding.hasBoundOrg === true) {
      return orderedBaseMenus.filter((menu) => menu.path !== '/teacher-bind-org');
    }

    return orderedBaseMenus;
  }

  if (userType.value === 'student_admin') {
    if (getStudentAdminBoundState() === true) {
      return orderedBaseMenus.filter((menu) => menu.path !== '/student-admin-bind-org');
    }
    return orderedBaseMenus;
  }

  if (userType.value === 'student' || userType.value === 'class_monitor') {
    if (getStudentBoundState() === true) {
      return orderedBaseMenus.filter((menu) => menu.path !== '/bind-class');
    }
    return orderedBaseMenus;
  }

  return orderedBaseMenus;
});

const currentPageName = computed(() => {
  const findMenuName = (items: any[]): string => {
    for (const item of items) {
      if (item.path === route.path) {
        return item.name;
      }
      if (item.children?.length) {
        const childName = findMenuName(item.children);
        if (childName) {
          return childName;
        }
      }
    }
    return '';
  };

  return findMenuName(currentMenus.value) || String(route.name || route.path);
});

const logout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
  localStorage.removeItem('admin_roles');
  localStorage.removeItem('admin_role_names');
  localStorage.removeItem('admin_roles_full');
  localStorage.removeItem('student_id');
  sessionStorage.removeItem(LOGIN_PROMPT_SESSION_KEY);
  clearBindingStateCache();
  router.push('/login');
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const showPendingLoginPrompt = async () => {
  const rawPrompt = sessionStorage.getItem(LOGIN_PROMPT_SESSION_KEY);
  if (!rawPrompt) {
    return;
  }

  sessionStorage.removeItem(LOGIN_PROMPT_SESSION_KEY);

  try {
    const parsed = JSON.parse(rawPrompt);
    const title = String(parsed?.title || '系统提示').trim() || '系统提示';
    const content = String(parsed?.content || '').trim();
    if (!content) {
      return;
    }

    await ElMessageBox.alert(
      `<div style="line-height: 1.8; white-space: normal;">${escapeHtml(content).replace(/\n/g, '<br />')}</div>`,
      title,
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '我知道了',
      },
    );
  } catch {
    // ignore invalid prompt payload
  }
};

const openFeedbackDialog = () => {
  feedbackDialogVisible.value = true;
};

const closeFeedbackDialog = () => {
  feedbackDialogVisible.value = false;
  feedbackContent.value = '';
  feedbackImageIds.value = [];
  feedbackImageUrls.value = [];
};

const submitFeedback = async () => {
  const content = feedbackContent.value.trim();
  if (!content) {
    ElMessage.warning('请先填写建议内容');
    return;
  }

  feedbackSubmitting.value = true;
  try {
    const resp = await submitUserFeedback({
      content,
      source: 'admin-frontend',
      page_path: route.fullPath,
      page_title: String(currentPageName.value || currentTitle.value || ''),
      image_file_id: feedbackImageIds.value[0] || undefined,
      image_file_ids: feedbackImageIds.value.length ? feedbackImageIds.value : undefined,
    });
    if (resp.code !== 0) {
      throw new Error(resp.message || '提交建议失败');
    }
    ElMessage.success('建议已发送到管理端，等待认领');
    closeFeedbackDialog();
  } catch (error: any) {
    ElMessage.error(error?.message || '提交建议失败');
  } finally {
    feedbackSubmitting.value = false;
  }
};

const inferUserTypeFromRoles = (rolesFull: any[]) => {
  if (rolesFull.find((role) => role.role === 'class_monitor')) return 'class_monitor';
  if (rolesFull.find((role) => role.role === 'head_teacher')) return 'head_teacher';
  if (rolesFull.find((role) => role.role === 'student_admin')) return 'student_admin';
  if (rolesFull.find((role) => role.role === 'dean' || role.role === 'teaching_admin')) return 'teaching_admin';
  if (rolesFull.find((role) => role.role === 'vice_dean')) return 'vice_dean';
  if (rolesFull.find((role) => role.role === 'sys_admin')) return 'sys_admin';
  if (rolesFull.find((role) => role.role === 'teacher')) return 'teacher';
  if (rolesFull.find((role) => role.role === 'student')) return 'student';
  return '';
};

const checkTeacherBinding = () => {
  if (userType.value !== 'teacher') {
    return;
  }

  const bindPages = ['/teacher-bind-org', '/teacher-bind-courses'];
  if (bindPages.includes(route.path)) {
    return;
  }

  const binding = getTeacherBindingState();
  if (binding.hasBoundOrg === false) {
    router.push('/teacher-bind-org');
    return;
  }

  if (binding.hasBoundOrg === true && binding.hasBoundCourses === false) {
    router.push('/teacher-bind-courses');
  }
};

onMounted(() => {
  const token = localStorage.getItem('admin_token');
  const userInfo = localStorage.getItem('admin_user');
  const rolesFullStr = localStorage.getItem('admin_roles_full');

  if (!token) {
    router.push('/login');
    return;
  }

  if (userInfo) {
    try {
      currentUser.value = JSON.parse(userInfo);
      userType.value = currentUser.value.user_type || '';
    } catch {
      currentUser.value = { name: '未知用户' };
    }
  } else {
    currentUser.value = { name: '用户' };
  }

  if (rolesFullStr) {
    try {
      const rolesFull = JSON.parse(rolesFullStr);
      const inferredType = inferUserTypeFromRoles(rolesFull);
      if (inferredType) {
        userType.value = inferredType;
      }
    } catch {
      // Ignore invalid cached role data.
    }
  }

  checkTeacherBinding();
  void showPendingLoginPrompt();
});
</script>

<style scoped>
.dashboard-layout {
  position: relative;
  min-height: 100vh;
  padding: 22px;
  gap: 18px;
}

.dashboard-layout::before,
.dashboard-layout::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.dashboard-layout::before {
  inset: 12px;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 36px;
  background: linear-gradient(
    140deg,
    rgba(255, 255, 255, 0.38),
    rgba(255, 255, 255, 0.1)
  );
  box-shadow: 0 28px 80px rgba(39, 66, 84, 0.1);
}

.dashboard-layout::after {
  inset: 0;
  background:
    radial-gradient(circle at 12% 16%, rgba(45, 212, 191, 0.16), transparent 18%),
    radial-gradient(circle at 88% 16%, rgba(251, 191, 36, 0.14), transparent 16%),
    radial-gradient(circle at 80% 88%, rgba(14, 165, 233, 0.12), transparent 18%);
  opacity: 0.92;
  animation: dashboardGlowFloat 18s ease-in-out infinite alternate;
}

.dashboard-aside,
.dashboard-content {
  position: relative;
  z-index: 1;
}

.dashboard-aside {
  overflow: hidden;
  border: 1px solid rgba(165, 220, 239, 0.16);
  border-radius: 30px;
  background: linear-gradient(180deg, rgba(10, 37, 54, 0.78), rgba(14, 55, 77, 0.68));
  box-shadow: 0 26px 54px rgba(12, 31, 47, 0.28);
  backdrop-filter: blur(26px);
}

.dashboard-aside::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(140deg, rgba(255, 255, 255, 0.12), transparent 34%),
    linear-gradient(rgba(153, 211, 232, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(153, 211, 232, 0.08) 1px, transparent 1px);
  background-size: auto, 24px 24px, 24px 24px;
  opacity: 0.5;
}

.brand-panel {
  position: relative;
  padding: 24px 20px 18px;
  border-bottom: 1px solid rgba(177, 223, 241, 0.12);
}

.brand-eyebrow {
  margin: 0 0 8px;
  color: rgba(207, 241, 248, 0.72);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.logo {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.2;
  color: #f4fbfd;
}

.brand-subtitle {
  margin: 10px 0 0;
  color: rgba(210, 232, 239, 0.72);
  font-size: 13px;
  line-height: 1.6;
}

.menu {
  padding: 14px 12px 18px;
  background: transparent;
  border-right: none;
}

.menu :deep(.el-menu) {
  background: transparent;
  border-right: none;
}

.menu :deep(.el-menu-item),
.menu :deep(.el-sub-menu__title) {
  height: 48px;
  margin: 0 0 8px;
  border-radius: 16px;
  color: rgba(217, 235, 241, 0.8);
  transition: all 0.25s ease;
}

.menu :deep(.el-menu-item:hover),
.menu :deep(.el-sub-menu__title:hover) {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
}

.menu :deep(.el-menu-item.is-active) {
  color: #ffffff;
  background: linear-gradient(
    135deg,
    rgba(52, 211, 153, 0.16),
    rgba(255, 255, 255, 0.08)
  );
  box-shadow:
    inset 0 0 0 1px rgba(211, 245, 255, 0.12),
    0 14px 24px rgba(4, 21, 32, 0.18);
}

.menu :deep(.el-sub-menu.is-opened > .el-sub-menu__title) {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
}

.menu :deep(.el-sub-menu__title .el-sub-menu__icon-arrow) {
  color: rgba(217, 235, 241, 0.8);
}

.menu :deep(.el-sub-menu .el-menu) {
  margin: -2px 0 10px;
  padding: 6px;
  border-radius: 18px;
  background: rgba(5, 23, 35, 0.22);
  box-shadow: inset 0 0 0 1px rgba(194, 232, 243, 0.06);
}

.menu :deep(.el-sub-menu .el-menu-item) {
  min-width: auto;
  height: 42px;
  margin: 0 0 6px;
  padding-left: 18px !important;
  color: rgba(217, 235, 241, 0.76);
  background: transparent;
}

.menu :deep(.el-sub-menu .el-menu-item:last-child) {
  margin-bottom: 0;
}

.menu :deep(.el-sub-menu .el-menu-item:hover) {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
}

.menu :deep(.el-sub-menu .el-menu-item.is-active) {
  color: #ffffff;
  background: linear-gradient(
    135deg,
    rgba(52, 211, 153, 0.16),
    rgba(255, 255, 255, 0.08)
  );
  box-shadow:
    inset 0 0 0 1px rgba(211, 245, 255, 0.1),
    0 10px 18px rgba(4, 21, 32, 0.14);
}

.dashboard-content {
  min-width: 0;
}

.header {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 92px;
  margin-bottom: 18px;
  padding: 20px 24px;
  border: 1px solid rgba(109, 143, 162, 0.16);
  border-radius: 28px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.72),
    rgba(255, 255, 255, 0.48)
  );
  box-shadow: 0 20px 44px rgba(37, 61, 79, 0.12);
  backdrop-filter: blur(18px);
}

.header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.32), transparent 42%),
    radial-gradient(circle at 100% 0%, rgba(20, 184, 166, 0.12), transparent 34%);
}

.header-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.header-eyebrow {
  color: #5a7080;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.header-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #122536;
}

.header-chip {
  padding: 8px 12px;
  border: 1px solid rgba(14, 116, 144, 0.16);
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.06);
  color: #0f766e;
  font-size: 12px;
  font-weight: 700;
}

.spacer {
  flex: 1;
}

.user-info {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 16px;
  border: 1px solid rgba(108, 140, 159, 0.14);
  border-radius: 18px;
  background: rgba(246, 250, 252, 0.58);
  color: #607384;
}

.user-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #6b7f8f;
}

.user-name {
  font-weight: 600;
  color: #122536;
}

.feedback-btn,
.logout-btn {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.56);
  color: #335063;
  transition: all 0.2s ease;
}

.feedback-btn:hover,
.logout-btn:hover {
  background: rgba(255, 255, 255, 0.78);
  color: #0f766e;
}

.feedback-upload {
  margin-top: 16px;
}

.user-info :deep(.el-button + .el-button) {
  margin-left: 0;
}

.main {
  position: relative;
  padding: 0;
  background: transparent;
  overflow: auto;
}

.main::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 30px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.14),
    rgba(255, 255, 255, 0.04)
  );
  opacity: 0.8;
}

@keyframes dashboardGlowFloat {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(1.5%, -1%, 0) scale(1.04);
  }
  100% {
    transform: translate3d(-1%, 1.5%, 0) scale(1.02);
  }
}

@media (max-width: 1080px) {
  .dashboard-layout {
    padding: 16px;
    gap: 14px;
  }

  .header {
    padding: 18px 20px;
  }

  .user-info {
    align-items: flex-start;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (max-width: 860px) {
  .dashboard-layout {
    display: block;
    padding: 14px;
  }

  .dashboard-aside {
    width: 100% !important;
    margin-bottom: 14px;
  }

  .header {
    flex-wrap: wrap;
    gap: 14px;
  }

  .spacer {
    display: none;
  }

  .user-info {
    width: 100%;
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-layout::after {
    animation: none;
  }
}
</style>
