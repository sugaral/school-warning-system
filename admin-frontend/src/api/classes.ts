import { api, ApiResponse } from './http';

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

export async function listCourseClassesByCourseId(courseId: string) {
  const { data } = await api.get<ApiResponse<any[]>>('/courses/course-classes/list', {
    params: { course_id: courseId }
  });
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

// 班主任相关
export async function getHeadTeacherBindableClasses() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/bindable-classes');
  return data;
}

export async function getHeadTeacherBindingStatus() {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/binding-status');
  return data;
}

export async function getHeadTeacherOrgs() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/orgs', { skipAuthRedirect: true });
  return data;
}

export async function getHeadTeacherClasses(orgId: string) {
  const { data } = await api.get<ApiResponse<any[]>>(`/head-teacher/classes/${orgId}`, { skipAuthRedirect: true });
  return data;
}

export async function headTeacherBindClass(classId: string) {
  const { data } = await api.post<ApiResponse<any>>('/head-teacher/bind-class', { class_id: classId }, { skipAuthRedirect: true });
  return data;
}

export async function getHeadTeacherStats() {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/stats');
  return data;
}

export async function getHeadTeacherWarnings(params?: { page?: number; pageSize?: number }) {
  const { data } = await api.get<ApiResponse<any>>('/head-teacher/warnings', { params });
  return data;
}

export async function getHeadTeacherLeaveRequests() {
  const { data } = await api.get<ApiResponse<any[]>>('/head-teacher/leave-requests');
  return data;
}

// 学工管理员
export async function getStudentAdminRulesOverride() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/rules-override');
  return data;
}

export async function setStudentAdminRulesOverride(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/rules-override', payload);
  return data;
}

export async function getStudentAdminNotificationStrategy() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/notification-strategy');
  return data;
}

export async function setStudentAdminNotificationStrategy(payload: any) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/notification-strategy', payload);
  return data;
}

export async function studentAdminBindOrg(orgId: string) {
  const { data } = await api.post<ApiResponse<any>>('/student-admin/bind-org', { org_id: orgId });
  return data;
}

export async function getStudentAdminDashboard() {
  const { data } = await api.get<ApiResponse<any>>('/student-admin/dashboard');
  return data;
}

// 签到审批
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

// 请假/补签/申诉
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

// 学生换班
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
