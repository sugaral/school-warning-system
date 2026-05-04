import axios from 'axios';
import { clearBindingStateCache } from './lib/binding';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthRedirect?: boolean;
  }
}

const resolvedApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim();

const api = axios.create({
  baseURL: resolvedApiBaseUrl,
  timeout: 60000, // 60秒超时，支持批量操作
  withCredentials: true, // 支持跨域凭证
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
});

export const buildApiUrl = (url: string) => api.getUri({ url });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }

  // 如果是学生请求，添加学生ID
  return config;
});

api.interceptors.response.use(
  (resp) => {
    return resp;
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      const config = error.config;
      // 检查是否禁用了 401 自动跳转
      const skipRedirect = config?.skipAuthRedirect;
      if (status === 401 && !skipRedirect) {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        localStorage.removeItem('admin_roles');
        localStorage.removeItem('admin_roles_full');
        localStorage.removeItem('admin_role_names');
        localStorage.removeItem('student_id');
        clearBindingStateCache();
        window.location.href = '/login';
      }
      if (data && data.message) {
        error.message = data.message;
      } else {
        error.message = `请求失败 (${status})`;
      }
    } else if (error.request) {
      error.message = '网络错误，请检查连接';
    } else {
      error.message = '请求配置错误';
    }
    return Promise.reject(error);
  },
);

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  trace_id: string;
}

export interface UploadedFileRecord {
  id: string;
  file_name: string;
  file_key: string;
  file_size: string;
  mime_type: string;
  source: string;
  url: string;
  created_at: string;
}

export { api };

export async function loginAdmin(payload: {
  account: string;
  password: string;
  captcha_id?: string;
  captcha_code?: string;
  sms_ticket?: string;
  email_ticket?: string;
}) {
  const { data } = await api.post<ApiResponse<{
    token: string;
    user_type?: string;
    student_id?: string | null;
    role_names?: string[];
    roles?: Array<{
      role: string;
      role_name?: string;
      scope_type?: string;
      scope_id?: string | null;
    }>;
    login_prompt?: {
      title?: string;
      content?: string;
    } | null;
    user?: {
      id: string;
      name: string;
      email?: string | null;
      mobile?: string | null;
      user_type?: string;
    };
  }>>(
    '/auth/login_admin',
    payload,
    { skipAuthRedirect: true },
  );
  return data;
}

export async function uploadImageFile(file: File, source = 'upload') {
  const submitPaths = ['/admin/files/images', '/files/images'];
  let lastError: any = null;

  for (const path of submitPaths) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source', source);

      const { data } = await api.post<ApiResponse<UploadedFileRecord>>(path, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return data;
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError || new Error('图片上传失败');
}

export async function getUploadedFile(id: string) {
  const paths = [`/admin/files/${id}`, `/files/${id}`];
  let lastError: any = null;

  for (const path of paths) {
    try {
      const { data } = await api.get<ApiResponse<UploadedFileRecord>>(path);
      return data;
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError || new Error('获取文件信息失败');
}

export async function downloadUploadedFileBlob(id: string) {
  const paths = [`/admin/files/${id}/download`, `/files/${id}/download`];
  let lastError: any = null;

  for (const path of paths) {
    try {
      const response = await api.get(path, {
        responseType: 'blob',
      });
      return response.data as Blob;
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError || new Error('下载文件失败');
}

export async function createUploadedFileObjectUrl(id: string) {
  const blob = await downloadUploadedFileBlob(id);
  return URL.createObjectURL(blob);
}

export async function getLoginSecurityConfig() {
  const { data } = await api.get<ApiResponse<{
    secondFactorMode: 'none' | 'email' | 'sms' | 'email_sms';
    captchaEnabled: boolean;
    captchaLength: number;
    captchaExpireSeconds: number;
    captchaRefreshLimit: number;
    captchaRefreshWindowSeconds: number;
    captchaMaxVerifyAttempts: number;
    emailCodeExpireSeconds: number;
    emailCodeCooldownSeconds: number;
    emailServiceReady: boolean;
    smsServiceReady: boolean;
  }>>('/auth/login-security', {
    skipAuthRedirect: true,
  });
  return data;
}

export async function getLoginCaptcha() {
  const { data } = await api.get<ApiResponse<{
    captchaId: string;
    image: string;
    expireSeconds: number;
  }>>('/auth/captcha', {
    skipAuthRedirect: true,
  });
  return data;
}

export async function sendAdminLoginCode(payload: {
  account: string;
  password: string;
  captcha_id?: string;
  captcha_code?: string;
}) {
  const { data } = await api.post<ApiResponse<{
    challenge_id: string;
    target: string;
    expire_seconds: number;
    cooldown_seconds: number;
  }>>('/auth/send_login_code', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function verifyCode(payload: {
  challenge_id: string;
  code: string;
}) {
  const { data } = await api.post<ApiResponse<{
    ticket: string;
  }>>('/auth/verify_code', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function getPasswordRecoveryOptions(payload: {
  account: string;
}) {
  const { data } = await api.post<ApiResponse<{
    account: string;
    email: {
      bound: boolean;
      masked: string;
      enabled: boolean;
      reason: string;
    };
    sms: {
      bound: boolean;
      masked: string;
      enabled: boolean;
      reason: string;
    };
    cooldown_seconds: number;
    expire_seconds: number;
  }>>('/auth/recovery/options', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function sendPasswordRecoveryEmailCode(payload: {
  account: string;
  email: string;
}) {
  const { data } = await api.post<ApiResponse<{
    challenge_id: string;
    target: string;
    expire_seconds: number;
    cooldown_seconds: number;
  }>>('/auth/recovery/send-email-code', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function sendPasswordRecoverySmsCode(payload: {
  account: string;
  mobile: string;
}) {
  const { data } = await api.post<ApiResponse<{
    challenge_id: string;
    target: string;
    expire_seconds: number;
    cooldown_seconds: number;
  }>>('/auth/recovery/send-sms-code', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function resetPasswordByEmail(payload: {
  account: string;
  email: string;
  ticket: string;
  new_password: string;
}) {
  const { data } = await api.post<ApiResponse<null>>('/auth/recovery/reset-password', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function resetPasswordByChannel(payload: {
  account: string;
  channel: 'email' | 'sms';
  email?: string;
  mobile?: string;
  ticket: string;
  new_password: string;
}) {
  const { data } = await api.post<ApiResponse<null>>('/auth/recovery/reset-password', payload, {
    skipAuthRedirect: true,
  });
  return data;
}

export async function register(payload: {
  account: string;
  email?: string;
  password: string;
  name: string;
  user_type: string;
  role?: string;
  scope_type?: string;
  org_id?: string;
  class_id?: string;
}) {
  const { data } = await api.post<ApiResponse<{ user_id: string; name: string; account: string }>>(
    '/auth/register',
    payload,
    { skipAuthRedirect: true },
  );
  return data;
}

// 获取注册时可用的角色列表
export async function getRolesForRegister() {
  const { data } = await api.get<ApiResponse<Array<{
    code: string;
    name: string;
    description: string;
    userType: string;
    scopeType: string;
  }>>>('/auth/roles', { skipAuthRedirect: true });
  return data;
}

export async function getRegisterStatus() {
  const { data } = await api.get<ApiResponse<{
    openRegistration: boolean;
  }>>('/auth/register-status', { skipAuthRedirect: true });
  return data;
}

export async function listWarnings(params: {
  org_id?: string;
  major?: string;
  class_id?: string;
  status?: string;
  scope?: string;
  course_id?: string;
  level?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await api.get<ApiResponse<any>>('/warnings', { params });
  return data;
}

export async function listWarningCourses(params: {
  org_id?: string;
  class_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any[]>>('/warnings/courses', { params });
  return data;
}

export async function ackWarning(id: string) {
  const { data } = await api.post<ApiResponse<{ id: string }>>(
    `/warnings/${id}/ack`,
  );
  return data;
}

export async function getWarningScanStatus() {
  const { data } = await api.get<ApiResponse<{
    interval_minutes: number;
    next_scan_at?: string | null;
  }>>('/jobs/scan-status');
  return data;
}

export async function deleteWarning(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/warnings/${id}`);
  return data;
}

export async function batchDeleteWarnings(ids: string[]) {
  const { data } = await api.post<ApiResponse<any>>(
    '/admin/warnings/batch-delete',
    { ids },
  );
  return data;
}

export async function clearWarnings(payload: {
  scope?: string;
  org_id?: string;
  major?: string;
  class_id?: string;
  status?: string;
  course_id?: string;
  level?: string;
  batch_size?: number;
}) {
  const { data } = await api.post<ApiResponse<any>>(
    '/admin/warnings/clear',
    payload,
  );
  return data;
}

export async function getWarningClassViewStudents(params: {
  org_id?: string;
  class_id?: string;
  scope?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await api.get<ApiResponse<any>>('/warnings/class-view/students', { params });
  return data;
}

export async function getWarningClassViewStudentDetail(
  studentId: string,
  params?: {
    scope?: string;
    view?: string;
  },
) {
  const { data } = await api.get<ApiResponse<any>>(`/warnings/class-view/students/${studentId}/detail`, { params });
  return data;
}

export async function listWarningCases(params?: {
  status?: string;
  keyword?: string;
  page?: number;
  page_size?: number;
  include_inactive?: string | number;
  org_id?: string;
  class_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/warning-cases', { params });
  return data;
}

export async function getWarningCasesSummary(params?: {
  status?: string;
  keyword?: string;
  include_inactive?: string | number;
  org_id?: string;
  class_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/warning-cases/summary', { params });
  return data;
}

export async function getHighRiskStudents(limit = 10) {
  const { data } = await api.get<ApiResponse<any>>('/warning-cases/high-risk', {
    params: { limit },
  });
  return data;
}

export async function getWarningCaseDetail(id: string) {
  const { data } = await api.get<ApiResponse<any>>(`/warning-cases/${id}`);
  return data;
}

export async function getWarningCaseLogs(id: string) {
  const { data } = await api.get<ApiResponse<any>>(`/warning-cases/${id}/logs`);
  return data;
}

export async function deleteWarningCase(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/warning-cases/${id}`);
  return data;
}

export async function batchDeleteWarningCases(ids: string[]) {
  const { data } = await api.post<ApiResponse<any>>('/warning-cases/batch-delete', { ids });
  return data;
}

export async function assignWarningCase(id: string, payload?: { handler_user_id?: string; note?: string }) {
  const { data } = await api.post<ApiResponse<any>>(`/warning-cases/${id}/assign`, payload || {});
  return data;
}

export async function acceptWarningCase(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/warning-cases/${id}/accept`);
  return data;
}

export async function completeWarningCase(id: string, payload: { completion_summary: string; completion_detail?: string }) {
  const { data } = await api.post<ApiResponse<any>>(`/warning-cases/${id}/complete`, payload);
  return data;
}

export async function listLeaveRequests(status = 'submitted') {
  const { data } = await api.get<ApiResponse<any[]>>('/leave_requests', {
    params: { status },
  });
  return data;
}

export async function approveLeaveRequest(id: string, approve: boolean, reject_reason?: string) {
  const { data } = await api.post<ApiResponse<any>>(
    `/leave_requests/${id}/approve`,
    { approve, reject_reason },
  );
  return data;
}

export async function listMakeupRequests(status = 'submitted') {
  const { data } = await api.get<ApiResponse<any[]>>('/makeup_requests', {
    params: { status },
  });
  return data;
}

export async function approveMakeupRequest(id: string, approve: boolean, reject_reason?: string) {
  const { data } = await api.post<ApiResponse<any>>(
    `/makeup_requests/${id}/approve`,
    { approve, reject_reason },
  );
  return data;
}

export async function listAppeals(status = 'submitted') {
  const { data } = await api.get<ApiResponse<any[]>>('/appeals', {
    params: { status },
  });
  return data;
}

export async function handleAppeal(id: string, status: string, result_note?: string) {
  const { data } = await api.post<ApiResponse<any>>(
    `/appeals/${id}/handle`,
    { status, result_note },
  );
  return data;
}

export async function listStudentAvailableClasses() {
  const { data } = await api.get<ApiResponse<any[]>>('/student/available-classes');
  return data;
}

export async function listStudentClassChangeRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/student/class-change-requests');
  return data;
}

export async function createStudentClassChangeRequest(payload: {
  target_class_id: string;
  reason: string;
  head_teacher_user_id?: string;
  evidence_file_id?: string;
  evidence_file_ids?: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/student/class-change-requests', payload);
  return data;
}

export async function listHeadTeacherClassChangeRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/class-change-requests');
  return data;
}

export async function reviewHeadTeacherClassChangeRequest(
  id: string,
  payload: { approve: boolean; note?: string },
) {
  const { data } = await api.post<ApiResponse<any>>(
    `/head-teacher/class-change-requests/${id}/review`,
    payload,
  );
  return data;
}



// 签到管理
export async function listSpecialApprovals() {
  const { data } = await api.get<ApiResponse<{ list: any[] }>>('/vice-dean/special-approvals');
  return data;
}

export async function approveSpecialApproval(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/vice-dean/approvals/${id}/approve`);
  return data;
}

export async function rejectSpecialApproval(id: string, payload: { reason?: string }) {
  const { data } = await api.post<ApiResponse<any>>(`/vice-dean/approvals/${id}/reject`, payload);
  return data;
}

export async function listSessions(params?: { date?: string }) {
  const { data } = await api.get<ApiResponse<any[]>>('/attendance/sessions', { params });
  return data;
}

export async function getAttendanceSessionOptions() {
  const { data } = await api.get<
    ApiResponse<{
      orgs: any[];
      classes: any[];
    }>
  >('/attendance/session-options');
  return data;
}

export async function getAttendanceSessionCourses(classId: string) {
  const { data } = await api.get<
    ApiResponse<{
      courses: any[];
    }>
  >('/attendance/session-options/courses', {
    params: { class_id: classId },
  });
  return data;
}

export async function createSession(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions', payload);
  return data;
}

export async function batchCreateSessions(payload: {
  count: number;
  expire_minutes?: number;
}) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions/batch-create', payload);
  return data;
}

export async function batchEndSessions(payload: {
  session_ids: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions/batch-end', payload);
  return data;
}

export async function startBatchEndSessionJob(payload: {
  session_ids: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions/batch-end-job', payload);
  return data;
}

export async function batchDeleteSessions(payload: {
  session_ids: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions/batch-delete', payload);
  return data;
}

export async function startBatchDeleteSessionJob(payload: {
  session_ids: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/attendance/sessions/batch-delete-job', payload);
  return data;
}

export async function getAttendanceBatchJob(jobId: string) {
  const { data } = await api.get<ApiResponse<any>>(`/attendance/batch-jobs/${jobId}`);
  return data;
}

export async function getAttendanceQrConfig() {
  const { data } = await api.get<ApiResponse<{ qr_refresh_minutes: number }>>('/attendance/qr-config');
  return data;
}

export async function deleteSession(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/attendance/sessions/${id}`);
  return data;
}

export async function endSession(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/attendance/sessions/${id}/end`);
  return data;
}

export async function getSessionAttendance(sessionId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/attendance/sessions/${sessionId}/attendance`);
  return data;
}

export async function getAttendanceSessionQrState(sessionId: string) {
  const { data } = await api.get<ApiResponse<any>>(`/attendance/sessions/${sessionId}/qr-state`);
  return data;
}

export async function getSessionRecords(sessionId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/attendance/sessions/${sessionId}/records`);
  return data;
}

// 预警规则
export async function listRules() {
  const { data } = await api.get<ApiResponse<any[]>>('/warning-rules');
  return data;
}

export async function createRule(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/warning-rules', payload);
  return data;
}

export async function updateRule(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/warning-rules/${id}`, payload);
  return data;
}

export async function deleteRule(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/warning-rules/${id}`);
  return data;
}

// 学院管理
export async function listOrgs() {
  const { data } = await api.get<ApiResponse<any[]>>('/orgs');
  return data;
}

export async function createOrg(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/orgs', payload);
  return data;
}

export async function updateOrg(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/orgs/${id}`, payload);
  return data;
}

export async function deleteOrg(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/orgs/${id}`);
  return data;
}

// 专业管理
export async function listMajors(orgId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/orgs/${orgId}/majors`);
  return data;
}

export async function createMajor(orgId: string, payload: any) {
  const { data } = await api.post<ApiResponse<any>>(`/orgs/${orgId}/majors`, payload);
  return data;
}

export async function updateMajor(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/orgs/majors/${id}`, payload);
  return data;
}

export async function deleteMajor(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/orgs/majors/${id}`);
  return data;
}

// 日预警任务
export async function runDailyWarning(date?: string) {
  const { data } = await api.post<ApiResponse<any>>('/jobs/run_daily_warning', { date });
  return data;
}

// 处理已结束签到并生成预警
export async function processAndGenerateWarnings() {
  const { data } = await api.post<ApiResponse<any>>('/jobs/process_and_generate_warnings');
  return data;
}

// 学生管理
export async function listStudents(params: { page?: number; pageSize?: number; keyword?: string; class_id?: string }) {
  const { data } = await api.get<ApiResponse<{ list: any[]; total: number; page: number; pageSize: number }>>('/admin/students', { params });
  return data;
}

export async function createStudent(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/admin/students', payload);
  return data;
}

export async function updateStudent(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/students/${id}`, payload);
  return data;
}

export async function deleteStudent(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/students/${id}`);
  return data;
}

export async function batchDeleteStudents(studentIds: string[]) {
  const { data } = await api.post<ApiResponse<any>>('/admin/students/batch-delete', { student_ids: studentIds });
  return data;
}

export async function unbindWechat(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/admin/students/${id}/unbind-wechat`);
  return data;
}

export async function listClasses(params?: { org_id?: string }) {
  const { data } = await api.get<ApiResponse<any[]>>('/admin/students/classes/list', { params });
  return data;
}

export async function importStudents(payload: any[]) {
  try {
    const response = await api.post<ApiResponse<{ success: number; failed: number; errors: string[] }>>('/admin/students/import', { students: payload });
    return response.data;
  } catch (error: any) {
    console.error('importStudents错误:', error);
    throw error;
  }
}

export async function batchCreateStudents(payload: {
  class_id: string;
  count: number;
  password_type: string;
  password_length: number;
  name_prefix?: string;
}) {
  const { data } = await api.post<ApiResponse<any>>('/admin/students/batch-create', payload);
  return data;
}

export async function exportStudentAccounts(classId?: string) {
  const params = classId ? { class_id: classId } : {};
  const { data } = await api.get<ApiResponse<any>>('/admin/students/export-accounts', { params });
  return data;
}

// 班级管理
export async function listClassesAdmin(params: { page?: number; pageSize?: number; keyword?: string }) {
  const { data } = await api.get<ApiResponse<{ list: any[]; total: number; page: number; pageSize: number }>>('/admin/classes', { params });
  return data;
}

export async function createClass(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/admin/classes', payload);
  return data;
}

export async function updateClass(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/classes/${id}`, payload);
  return data;
}

export async function deleteClass(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/classes/${id}`);
  return data;
}

export async function getStudentWarnings(params: { name: string; student_no: string }) {
  const { data } = await api.get<ApiResponse<{ student: any; warnings: any[] }>>('/admin/warnings/student', { params });
  return data;
}

// 教师管理
export async function listTeachers(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  org_id?: string;
}) {
  const { data } = await api.get<ApiResponse<{ list: any[]; total: number; page: number; pageSize: number }>>('/admin/teachers', { params });
  return data;
}

export async function createTeacher(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/admin/teachers', payload);
  return data;
}

export async function updateTeacher(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/teachers/${id}`, payload);
  return data;
}

export async function deleteTeacher(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/teachers/${id}`);
  return data;
}

// 开课班管理
export async function listCourseClasses(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  class_id?: string;
}) {
  const { data } = await api.get<ApiResponse<{ list: any[]; total: number; page: number; pageSize: number }>>('/admin/course-classes', { params });
  return data;
}

export async function createCourseClass(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/admin/course-classes', payload);
  return data;
}

export async function updateCourseClass(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/course-classes/${id}`, payload);
  return data;
}

export async function deleteCourseClass(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/course-classes/${id}`);
  return data;
}

export async function importCourseClasses(payload: any[]) {
  const { data } = await api.post<ApiResponse<{ success: number; failed: number }>>('/admin/course-classes/import', payload);
  return data;
}

// 获取课程的开课班列表
export async function listCourseClassesByCourseId(courseId: string) {
  const { data } = await api.get<ApiResponse<any[]>>('/courses/course-classes/list', {
    params: { course_id: courseId }
  });
  return data;
}

// 课表管理
export async function listSchedules(params: { page?: number; pageSize?: number; class_id?: string; term_code?: string }) {
  const { data } = await api.get<ApiResponse<{ list: any[]; total: number; page: number; pageSize: number }>>('/admin/schedules', { params });
  return data;
}

export async function getRoleSchedulesView(params?: { term_code?: string; scope?: string }) {
  const { data } = await api.get<
    ApiResponse<{
      list: any[];
      active_scope: string;
      available_scopes: string[];
      term_code: string;
      context_label: string;
    }>
  >('/schedules/view', { params });
  return data;
}

export async function getSchedulesSemesterConfig() {
  const { data } = await api.get<
    ApiResponse<{
      semester_start_date: string;
      default_semester_start_date: string;
      semester_total_weeks: number;
      default_semester_total_weeks: number;
    }>
  >('/schedules/semester-config');
  return data;
}

export async function importSchedules(payload: any[]) {
  const { data } = await api.post<ApiResponse<{ success: number; failed: number }>>('/admin/schedules/import', payload);
  return data;
}

export async function updateSchedule(id: string, payload: any) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/schedules/${id}`, payload);
  return data;
}

export async function deleteSchedule(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/schedules/${id}`);
  return data;
}

// 审计日志
export async function getOperationLogs(params: {
  page?: number;
  pageSize?: number;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/admin/audit/operations', { params });
  return data;
}

export async function getOperationLogDetail(id: string) {
  const { data } = await api.get<ApiResponse<any>>(`/admin/audit/operations/${id}`);
  return data;
}

export async function deleteOperationLog(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/audit/operations/${id}`);
  return data;
}

export async function batchDeleteOperationLogs(ids: string[]) {
  const { data } = await api.post<ApiResponse<any>>('/admin/audit/operations/batch-delete', { ids });
  return data;
}

export async function getNotificationLogs(params: {
  page?: number;
  pageSize?: number;
  receiver?: string;
  status?: string;
  channel?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/admin/audit/notifications', { params });
  return data;
}

export async function deleteNotificationLog(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/audit/notifications/${id}`);
  return data;
}

export async function batchDeleteNotificationLogs(ids: string[]) {
  const { data } = await api.post<ApiResponse<any>>('/admin/audit/notifications/batch-delete', { ids });
  return data;
}

export async function getSecurityEvents(params: {
  page?: number;
  pageSize?: number;
  user?: string;
  eventType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/admin/audit/security-events', { params });
  return data;
}

export async function getSecurityEventDetail(id: string) {
  const { data } = await api.get<ApiResponse<any>>(`/admin/audit/security-events/${id}`);
  return data;
}

export async function deleteSecurityEvent(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/admin/audit/security-events/${id}`);
  return data;
}

export async function batchDeleteSecurityEvents(ids: string[]) {
  const { data } = await api.post<ApiResponse<any>>('/admin/audit/security-events/batch-delete', { ids });
  return data;
}

export async function submitUserFeedback(payload: {
  content: string;
  source?: string;
  page_path?: string;
  page_title?: string;
  image_file_id?: string;
  image_file_ids?: string[];
}) {
  const submitPaths = [
    '/admin/feedback/submit',
    '/api/admin/feedback/submit',
    '/feedback',
  ];
  let lastError: any = null;

  for (const path of submitPaths) {
    try {
      const { data } = await api.post<ApiResponse<{ id: string }>>(path, payload);
      return data;
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError || new Error('提交建议失败');
}

export async function getAdminFeedbacks(params?: {
  page?: number;
  pageSize?: number;
  source?: string;
  status?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/admin/feedback', { params });
  return data;
}

export async function getAdminFeedbackDetail(id: string) {
  const { data } = await api.get<ApiResponse<any>>(`/admin/feedback/${id}`);
  return data;
}

export async function handleAdminFeedback(
  id: string,
  payload: {
    status: 'pending' | 'claimed' | 'resolved';
    handle_note?: string;
  },
) {
  const { data } = await api.post<ApiResponse<any>>(`/admin/feedback/${id}/handle`, payload);
  return data;
}

// 获取当前用户信息
export async function getCurrentUser() {
  const { data } = await api.get<ApiResponse<any>>('/auth/me');
  return data;
}

// 获取班主任可绑定的班级列表
export async function getHeadTeacherBindableClasses() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/bindable-classes');
  return data;
}

// 班主任获取绑定状态
export async function getHeadTeacherBindingStatus() {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/binding-status');
  return data;
}

// 班主任获取学院列表
export async function getHeadTeacherOrgs() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/orgs', { skipAuthRedirect: true });
  return data;
}

// 班主任获取班级列表
export async function getHeadTeacherClasses(orgId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/head-teacher/classes/${orgId}`, { skipAuthRedirect: true });
  return data;
}

// 班主任绑定班级
export async function headTeacherBindClass(classId: string) {
  const { data } = await api.post<ApiResponse<any>>('/head-teacher/bind-class', { class_id: classId }, { skipAuthRedirect: true });
  return data;
}

// 班主任 - 获取统计数据
export async function getHeadTeacherStats() {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/stats');
  return data;
}

// 班主任 - 获取预警列表
export async function getHeadTeacherWarnings(params?: { page?: number; pageSize?: number }) {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/warnings', { params });
  return data;
}

export async function getHeadTeacherLeaveRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/leave-requests');
  return data;
}

// 教务管理员 - 全校统计
export async function getTeachingAdminSchoolStats() {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/school-stats');
  return data;
}

export async function getTeachingAdminSemesterConfig() {
  const { data } = await api.get<ApiResponse<{
    semester_start_date: string;
    default_semester_start_date: string;
    semester_total_weeks: number;
    default_semester_total_weeks: number;
  }>>('/teaching-admin/semester-config');
  return data;
}

export async function getTeachingAdminOrgs() {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/orgs');
  return data;
}

export async function getTeachingAdminClasses(params?: {
  org_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/classes', { params });
  return data;
}

export async function updateTeachingAdminSemesterConfig(payload: {
  semester_start_date: string;
  semester_total_weeks: number;
}) {
  const { data } = await api.put<ApiResponse<any>>('/teaching-admin/semester-config', payload);
  return data;
}

export async function batchDeleteSchedulesByScope(payload: {
  org_name?: string;
  class_id: string;
  term_code: string;
}) {
  const { data } = await api.post<ApiResponse<any>>('/admin/schedules/batch-delete', payload);
  return data;
}

// 教务管理员 - 获取成绩列表
export async function getTeachingAdminGrades(params: {
  keyword?: string;
  class_id?: string;
  course_id?: string;
  term_code?: string;
  page?: number;
  pageSize?: number;
}) {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/grades', { params });
  return data;
}

// 教务管理员 - 创建成绩
export async function createTeachingAdminGrade(payload: {
  student_id: string;
  course_id: string;
  term_code: string;
  score: number;
  pass_status?: string;
}) {
  const { data } = await api.post<ApiResponse<any>>('/teaching-admin/grades', payload);
  return data;
}

// 教务管理员 - 更新成绩
export async function updateTeachingAdminGrade(id: string, score: number) {
  const { data } = await api.put<ApiResponse<any>>(`/teaching-admin/grades/${id}`, { score });
  return data;
}

// 教务管理员 - 删除成绩
export async function deleteTeachingAdminGrade(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/teaching-admin/grades/${id}`);
  return data;
}

// 教务管理员 - 获取学生列表
export async function getTeachingAdminStudents(params: {
  keyword?: string;
  class_id?: string;
  org_id?: string;
  page?: number;
  pageSize?: number;
}) {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/students', { params });
  return data;
}

// 教务管理员 - 更新学生档案（学籍变更）
export async function updateTeachingAdminStudentProfile(id: string, payload: {
  class_id?: string;
  major_id?: string;
  major?: string;
  enroll_year?: number;
  status?: string;
}) {
  const { data } = await api.put<ApiResponse<any>>(`/teaching-admin/students/${id}`, payload);
  return data;
}

// 教务管理员 - 获取课程列表
export async function getTeachingAdminCourses(params?: {
  keyword?: string;
  org_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/courses', { params });
  return data;
}

// 教务管理员 - 获取成绩统计
export async function getTeachingAdminGradesStats(params?: {
  class_id?: string;
  course_id?: string;
  term_code?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/grades/stats', { params });
  return data;
}

// 教务管理员 - 导出成绩
export async function exportTeachingAdminGrades(params?: {
  class_id?: string;
  course_id?: string;
  term_code?: string;
}) {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/grades/export', { params });
  return data;
}

export async function getTeachingAdminGradeImportTemplate() {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/grades/import-template');
  return data;
}

export async function getTeachingAdminCourseBindingRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/course-binding-requests');
  return data;
}

export async function approveTeachingAdminCourseBindingRequest(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/teaching-admin/course-binding-requests/${id}/approve`);
  return data;
}

export async function rejectTeachingAdminCourseBindingRequest(id: string, payload: { reason: string }) {
  const { data } = await api.post<ApiResponse<any>>(`/teaching-admin/course-binding-requests/${id}/reject`, payload);
  return data;
}

export type AdminImportTemplateType = 'grades' | 'course_classes' | 'schedules';

export async function getAdminImportTemplates() {
  const { data } = await api.get<ApiResponse<Record<AdminImportTemplateType, any>>>(
    '/admin/config/import-templates',
  );
  return data;
}

export async function getSchedulesImportTemplate() {
  const { data } = await api.get<ApiResponse<any>>('/admin/schedules/import-template');
  return data;
}

export async function setAdminImportTemplate(
  type: AdminImportTemplateType,
  payload: {
    fields: Array<{
      key: string;
      label?: string;
      columnName: string;
      enabled?: boolean;
      required?: boolean;
    }>;
  },
) {
  const { data } = await api.put<ApiResponse<any>>(`/admin/config/import-templates/${type}`, payload);
  return data;
}

export async function setTeachingAdminGradeImportTemplate(payload: {
  fields: Array<{
    key: string;
    label?: string;
    columnName: string;
    enabled?: boolean;
    required?: boolean;
  }>;
}) {
  const { data } = await api.post<ApiResponse<any>>('/teaching-admin/grades/import-template', payload);
  return data;
}

export async function importTeachingAdminGrades(payload: {
  rows: Array<Record<string, any>>;
}) {
  const { data } = await api.post<ApiResponse<any>>('/teaching-admin/grades/import', payload);
  return data;
}

// 教师端 - 获取绑定状态
export async function getTeacherBindingStatus() {
  const { data } = await api.get<ApiResponse<any>>('/teacher/binding-status');
  return data;
}

// 教师端 - 获取学院列表
export async function getTeacherOrgs() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/orgs');
  return data;
}

// 教师端 - 绑定学院
export async function teacherBindOrg(orgId: string) {
  const { data } = await api.post<ApiResponse<any>>('/teacher/bind-org', { org_id: orgId });
  return data;
}

// 教师端 - 获取课程列表
export async function getTeacherCourses() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/courses');
  return data;
}

// 教师端 - 获取班级列表
export async function getTeacherClasses() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/classes');
  return data;
}

// 教师端 - 绑定课程
export async function teacherBindCourses(bindings: Array<{ course_id: string; class_ids: string[] }>) {
  const { data } = await api.post<ApiResponse<any>>('/teacher/bind-courses', { bindings });
  return data;
}

// 教师端 - 获取我的绑定信息
export async function getTeacherMyBindings() {
  const { data } = await api.get<ApiResponse<any>>('/teacher/my-bindings');
  return data;
}

export async function getTeacherCourseBindingRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/course-binding-requests');
  return data;
}

// 教师端 - 获取签到列表
export async function getTeacherSessions() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/sessions');
  return data;
}

export async function getTeacherSessionQrState(sessionId: string) {
  const { data } = await api.get<ApiResponse<any>>(`/teacher/sessions/${sessionId}/qr-state`);
  return data;
}

// 教师端 - 创建签到
export async function createTeacherSession(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/teacher/sessions', payload);
  return data;
}

// 教师端 - 删除签到
export async function deleteTeacherSession(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/teacher/sessions/${id}`);
  return data;
}

export async function endTeacherSession(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/teacher/sessions/${id}/end`);
  return data;
}

// 教师端 - 获取签到学生
export async function getTeacherSessionAttendance(sessionId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/teacher/sessions/${sessionId}/attendance`);
  return data;
}

// 教师端 - 获取签到记录
export async function getTeacherSessionRecords(sessionId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/teacher/sessions/${sessionId}/records`);
  return data;
}

// 教师端 - 更新学生签到状态
export async function updateTeacherStudentStatus(
  sessionId: string,
  studentId: string,
  status: string,
  lateMinutes?: number
) {
  const { data } = await api.post<ApiResponse<any>>(
    `/teacher/sessions/${sessionId}/students/${studentId}/status`,
    { status, late_minutes: lateMinutes }
  );
  return data;
}

// 教师端 - 获取个人信息
export async function getTeacherProfile() {
  const { data } = await api.get<ApiResponse<any>>('/teacher/profile');
  return data;
}

// 教师端 - 更新个人信息
export async function updateTeacherProfile(payload: {
  name?: string;
  mobile?: string;
  email?: string;
}) {
  const { data } = await api.put<ApiResponse<any>>('/teacher/profile', payload);
  return data;
}

export async function listTeacherOrgChangeRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/teacher/org-change-requests');
  return data;
}

export async function createTeacherOrgChangeRequest(payload: {
  target_org_id: string;
  reason: string;
  evidence_file_id?: string;
  evidence_file_ids?: string[];
}) {
  const { data } = await api.post<ApiResponse<any>>('/teacher/org-change-requests', payload);
  return data;
}

// 学工管理员 - 获取规则覆盖
export async function getStudentAdminRulesOverride() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/rules-override');
  return data;
}

// 学工管理员 - 设置规则覆盖
export async function setStudentAdminRulesOverride(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/rules-override', payload);
  return data;
}

// 学工管理员 - 获取通知策略
export async function getStudentAdminNotificationStrategy() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/notification-strategy');
  return data;
}

// 学工管理员 - 设置通知策略
export async function setStudentAdminNotificationStrategy(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/notification-strategy', payload);
  return data;
}

// 学工管理员 - 绑定学院
export async function studentAdminBindOrg(orgId: string) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/bind-org', { org_id: orgId });
  return data;
}

// 学工管理员 - 获取学院看板数据
export async function getStudentAdminDashboard() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/dashboard');
  return data;
}

// 获取系统配置
export async function getSystemConfig() {
  const { data } = await api.get<ApiResponse<any>>('/admin/config');
  return data;
}

// 获取仪表盘摘要（教师端/学工端通用，基于权限过滤）
export async function getDashboardSummary() {
  const { data } = await api.get<ApiResponse<any>>('/admin/stats/summary');
  return data;
}

// ----------------- 报表模块 -----------------

// 生成日报表
export async function generateDailyReport(date?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/daily', {}, { params: { date, status, org_id } });
  return data;
}

// 生成周报表
export async function generateWeeklyReport(
  startDate?: string,
  status?: string,
  org_id?: string,
  weekNumber?: number,
) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/weekly', {}, {
    params: { startDate, status, org_id, weekNumber },
  });
  return data;
}

// 生成月报表
export async function generateMonthlyReport(month?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/monthly', {}, { params: { month, status, org_id } });
  return data;
}

// 生成学期报表
export async function generateSemesterReport(semester?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/semester', {}, { params: { semester, status, org_id } });
  return data;
}

// 获取导出历史
export async function getExportHistory() {
  const { data } = await api.get<ApiResponse<any>>('/admin/reports/history');
  return data;
}

// 删除导出报表
export async function deleteExportReport(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/admin/reports/delete/${id}`);
  return data;
}

// 下载导出文件 (如果后端实现返回文件流)
export async function downloadExportReport(id: string) {
  const response = await api.get(`/admin/reports/download/${id}`, { responseType: 'blob' });
  return response.data;
}
