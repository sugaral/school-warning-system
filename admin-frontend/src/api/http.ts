import axios from 'axios';
import { clearBindingStateCache } from '../lib/binding';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthRedirect?: boolean;
  }
}

const resolvedApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim();

const api = axios.create({
  baseURL: resolvedApiBaseUrl,
  timeout: 60000,
  withCredentials: true,
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
