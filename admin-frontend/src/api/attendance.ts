import { api, ApiResponse } from './http';

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

/** 立即换码：服务端重置 qr_token_hash 种子，旧二维码立即失效 */
export async function rotateSessionQr(sessionId: string) {
  const { data } = await api.post<ApiResponse<any>>(
    `/attendance/sessions/${sessionId}/rotate-qr`,
    {},
  );
  return data;
}