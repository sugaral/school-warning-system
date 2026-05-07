import { api, ApiResponse } from './http';

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
