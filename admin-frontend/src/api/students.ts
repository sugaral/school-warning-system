import { api, ApiResponse } from './http';

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
