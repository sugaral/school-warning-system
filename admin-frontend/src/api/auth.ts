import { api, ApiResponse } from './http';

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

      const { data } = await api.post<ApiResponse<import('./http').UploadedFileRecord>>(path, formData, {
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
      const { data } = await api.get<ApiResponse<import('./http').UploadedFileRecord>>(path);
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

export async function getCurrentUser() {
  const { data } = await api.get<ApiResponse<any>>('/auth/me');
  return data;
}


