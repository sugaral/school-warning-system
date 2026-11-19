import { api, ApiResponse } from './http';

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

export type AdminImportTemplateType = 'grades' | 'course_classes' | 'schedules';

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

// 反馈
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

// 导入模板配置
export async function getAdminImportTemplates() {
  const { data } = await api.get<ApiResponse<Record<AdminImportTemplateType, any>>>(
    '/admin/config/import-templates',
  );
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

// 教务管理员 - 统计和学院
export async function getTeachingAdminSchoolStats() {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/school-stats');
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

// 教务管理员 - 成绩
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

export async function updateTeachingAdminGrade(id: string, score: number) {
  const { data } = await api.put<ApiResponse<any>>(`/teaching-admin/grades/${id}`, { score });
  return data;
}

export async function deleteTeachingAdminGrade(id: string) {
  const { data } = await api.delete<ApiResponse<any>>(`/teaching-admin/grades/${id}`);
  return data;
}

export async function getTeachingAdminCourses(params?: {
  keyword?: string;
  org_id?: string;
}) {
  const { data } = await api.get<ApiResponse<any[]>>('/teaching-admin/courses', { params });
  return data;
}

export async function getTeachingAdminGradesStats(params?: {
  class_id?: string;
  course_id?: string;
  term_code?: string;
}) {
  const { data } = await api.get<ApiResponse<any>>('/teaching-admin/grades/stats', { params });
  return data;
}

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

export async function importTeachingAdminGrades(payload: {
  rows: Array<Record<string, any>>;
}) {
  const { data } = await api.post<ApiResponse<any>>('/teaching-admin/grades/import', payload);
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

// 报表
export async function generateDailyReport(date?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/daily', {}, { params: { date, status, org_id } });
  return data;
}

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

export async function generateMonthlyReport(month?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/monthly', {}, { params: { month, status, org_id } });
  return data;
}

export async function generateSemesterReport(semester?: string, status?: string, org_id?: string) {
  const { data } = await api.post<ApiResponse<any>>('/admin/reports/generate/semester', {}, { params: { semester, status, org_id } });
  return data;
}

export async function getExportHistory() {
  const { data } = await api.get<ApiResponse<any>>('/admin/reports/history');
  return data;
}

export async function deleteExportReport(id: string) {
  const { data } = await api.post<ApiResponse<any>>(`/admin/reports/delete/${id}`);
  return data;
}

export async function downloadExportReport(id: string) {
  const response = await api.get(`/admin/reports/download/${id}`, { responseType: 'blob' });
  return response.data;
}
