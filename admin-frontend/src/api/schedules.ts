import { api, ApiResponse } from './http';

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

export async function batchDeleteSchedulesByScope(payload: {
  org_name?: string;
  class_id: string;
  term_code: string;
}) {
  const { data } = await api.post<ApiResponse<any>>('/admin/schedules/batch-delete', payload);
  return data;
}

export async function getSchedulesImportTemplate() {
  const { data } = await api.get<ApiResponse<any>>('/admin/schedules/import-template');
  return data;
}

// 教务管理员 - 学期配置
export async function getTeachingAdminSemesterConfig() {
  const { data } = await api.get<ApiResponse<{
    semester_start_date: string;
    default_semester_start_date: string;
    semester_total_weeks: number;
    default_semester_total_weeks: number;
  }>>('/teaching-admin/semester-config');
  return data;
}

export async function updateTeachingAdminSemesterConfig(payload: {
  semester_start_date: string;
  semester_total_weeks: number;
}) {
  const { data } = await api.put<ApiResponse<any>>('/teaching-admin/semester-config', payload);
  return data;
}
