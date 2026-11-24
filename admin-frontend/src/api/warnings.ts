import { api, ApiResponse } from './http';

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

export async function getStudentWarnings(params: { name: string; student_no: string }) {
  const { data } = await api.get<ApiResponse<{ student: any; warnings: any[] }>>('/admin/warnings/student', { params });
  return data;
}

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

export async function runDailyWarning(date?: string) {
  const { data } = await api.post<ApiResponse<any>>('/jobs/run_daily_warning', { date });
  return data;
}

export async function processAndGenerateWarnings() {
  const { data } = await api.post<ApiResponse<any>>('/jobs/process_and_generate_warnings');
  return data;
}
