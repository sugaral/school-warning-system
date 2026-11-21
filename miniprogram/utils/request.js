/**
 * 统一请求与文件传输封装（仅供学生端使用）
 *
 * 约定（与后端 main.ts / ResponseInterceptor 一致）：
 *   成功: { code: 0, message: 'ok', data: {...}, trace_id: '...' }
 *   失败: { code: <非0>, message: '...', data: ..., trace_id: '...' }
 */
const config = require('../config');

// 内存缓存：fileId -> 本地 tempFilePath，避免重复下载受保护图片
const authImageCache = {};

/** 读取 token */
function getToken() {
  try {
    return wx.getStorageSync(config.STORAGE_TOKEN) || '';
  } catch (e) {
    return '';
  }
}

function clearAuthImageCache() {
  Object.keys(authImageCache).forEach((key) => {
    delete authImageCache[key];
  });
}

/** 清除登录态并跳登录页 */
function clearAuthAndRedirect() {
  clearAuthImageCache();
  try {
    wx.removeStorageSync(config.STORAGE_TOKEN);
    wx.removeStorageSync(config.STORAGE_STUDENT);
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.student = null;
    }
  } catch (e) {
    /* ignore */
  }
  const pages = getCurrentPages();
  const current = pages.length > 0 ? pages[pages.length - 1].route : '';
  if (current && current.indexOf('pages/login/login') === -1) {
    wx.reLaunch({ url: '/pages/login/login' });
  }
}

/** 展示错误提示 */
function toastError(message) {
  wx.showToast({
    title: String(message || '请求失败').slice(0, 40),
    icon: 'none',
    duration: 2500,
  });
}

function buildIdempotencyKey() {
  return 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** 清理 GET 请求空参数，避免产生 ?foo=undefined */
function cleanQueryParams(data) {
  if (!data || typeof data !== 'object') return {};
  const cleaned = {};
  Object.keys(data).forEach((key) => {
    const val = data[key];
    if (val !== undefined && val !== null && val !== '') {
      cleaned[key] = val;
    }
  });
  return cleaned;
}

/**
 * 基础请求
 * @param {object} options { url, method, data, header, silent, loading }
 * @returns {Promise<any>} resolve 业务 data；reject { code, message }
 */
function request(options) {
  const opts = options || {};
  const method = (opts.method || 'GET').toUpperCase();
  const header = Object.assign(
    { 'Content-Type': 'application/json' },
    opts.header || {},
  );
  const token = getToken();
  if (token) {
    header[config.TOKEN_HEADER] = config.TOKEN_PREFIX + token;
  }
  if (
    (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
    !header['Idempotency-Key'] &&
    !header['idempotency-key']
  ) {
    header['Idempotency-Key'] = buildIdempotencyKey();
  }

  const requestData = method === 'GET' ? cleanQueryParams(opts.data) : (opts.data || {});

  if (opts.loading) {
    wx.showLoading({ title: '加载中', mask: true });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl + opts.url,
      method,
      data: requestData,
      header,
      timeout: config.REQUEST_TIMEOUT,
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 401 || res.statusCode === 403) {
          clearAuthAndRedirect();
          reject({ code: res.statusCode, message: body.message || '登录已失效，请重新登录' });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = body.message || 'HTTP ' + res.statusCode;
          if (!opts.silent) toastError(msg);
          reject({ code: res.statusCode, message: msg, data: body.data });
          return;
        }
        if (body.code === 0) {
          resolve(body.data);
        } else {
          const msg = body.message || '请求失败';
          if (body.code === 401 || body.code === 4010) {
            clearAuthAndRedirect();
          } else if (!opts.silent) {
            toastError(msg);
          }
          reject({ code: body.code, message: msg, data: body.data });
        }
      },
      fail(err) {
        const msg = '网络异常，请检查网络或后端地址';
        if (!opts.silent) toastError(msg);
        reject({ code: -1, message: msg, raw: err });
      },
      complete() {
        if (opts.loading) wx.hideLoading();
      },
    });
  });
}

/** 上传图片文件，对接后端 /files/images */
function uploadFile(filePath, options) {
  const opts = options || {};
  const header = {};
  const token = getToken();
  if (token) header[config.TOKEN_HEADER] = config.TOKEN_PREFIX + token;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: config.baseUrl + (opts.url || '/files/images'),
      filePath,
      name: opts.name || 'file',
      header,
      formData: opts.formData || {},
      timeout: 60000,
      success(res) {
        if (res.statusCode === 401) {
          clearAuthAndRedirect();
          reject({ code: 401, message: '登录已失效，请重新登录' });
          return;
        }
        let body = {};
        try {
          body = JSON.parse(res.data || '{}');
        } catch (e) {
          reject({ code: res.statusCode || -1, message: '上传响应解析失败' });
          return;
        }
        if (res.statusCode >= 400) {
          reject({ code: res.statusCode, message: body.message || '图片上传失败' });
          return;
        }
        if (body.code === 0) resolve(body.data);
        else reject({ code: body.code, message: body.message || '上传失败' });
      },
      fail(err) {
        reject({ code: -1, message: '图片上传失败', raw: err });
      },
    });
  });
}

/**
 * 带鉴权下载受保护图片文件（后端 /files/:id/download 要求 Bearer token）
 * 返回本地临时路径以供 <image src="..." /> 及 wx.previewImage 使用。
 */
function downloadAuthImage(fileId) {
  const id = String(fileId || '').trim();
  if (!/^\d+$/.test(id)) {
    return Promise.resolve('');
  }
  if (authImageCache[id]) {
    return Promise.resolve(authImageCache[id]);
  }
  const token = getToken();
  if (!token) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    wx.downloadFile({
      url: config.baseUrl + '/files/' + id + '/download',
      header: {
        [config.TOKEN_HEADER]: config.TOKEN_PREFIX + token,
      },
      timeout: 60000,
      success(res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          authImageCache[id] = res.tempFilePath;
          resolve(res.tempFilePath);
          return;
        }
        resolve('');
      },
      fail() {
        resolve('');
      },
    });
  });
}

/** 批量下载受保护图片并过滤失败项 */
async function loadAuthImageUrls(fileIds) {
  const ids = Array.isArray(fileIds)
    ? fileIds.map((item) => String(item || '').trim()).filter((id) => /^\d+$/.test(id))
    : [];
  if (!ids.length) return [];
  const paths = await Promise.all(ids.map((id) => downloadAuthImage(id)));
  return paths.filter(Boolean);
}

// ============================================================
// 学生端业务接口封装（Strictly Student-Only）
// ============================================================
const api = {
  // --- 登录、找回密码与身份安全 ---
  loginByAccount: (data, opts) =>
    request(Object.assign({ url: '/student/login', method: 'POST', data }, opts)),
  loginByWechat: (data, opts) =>
    request(Object.assign({ url: '/student/login', method: 'POST', data }, opts)),
  bindWechat: (data) => request({ url: '/student/bind-wechat', method: 'POST', data }),
  bindEmail: (data) => request({ url: '/student/bind-email', method: 'POST', data }),
  bindPhone: (data) => request({ url: '/student/bind-phone', method: 'POST', data }),
  bindClass: (data) => request({ url: '/student/bind-class', method: 'POST', data }),
  availableClasses: () => request({ url: '/student/available-classes' }),
  getProfile: () => request({ url: '/student/profile' }),
  updateProfile: (data) => request({ url: '/student/profile', method: 'PUT', data }),
  changePassword: (data) => request({ url: '/student/change-password', method: 'POST', data }),
  getTeachers: () => request({ url: '/student/teachers' }),

  // --- 验证码与账号找回 ---
  sendCode: (data) => request({ url: '/auth/send_code', method: 'POST', data }),
  verifyCode: (data) => request({ url: '/auth/verify_code', method: 'POST', data }),
  recoveryOptions: (data) => request({ url: '/auth/recovery/options', method: 'POST', data }),
  sendRecoveryEmailCode: (data) =>
    request({ url: '/auth/recovery/send-email-code', method: 'POST', data }),
  sendRecoverySmsCode: (data) =>
    request({ url: '/auth/recovery/send-sms-code', method: 'POST', data }),
  resetPassword: (data) => request({ url: '/auth/recovery/reset-password', method: 'POST', data }),

  // --- 首页与学业数据 ---
  today: () => request({ url: '/student/today' }),
  weekly: () => request({ url: '/student/weekly' }),
  summaries: (params) => request({ url: '/student/summaries', data: params || {} }),
  courses: () => request({ url: '/student/courses' }),
  grades: (params) => request({ url: '/student/grades', data: params || {} }),

  // --- 课表与校历 ---
  schedulesView: (params) => request({ url: '/schedules/view', data: params || {} }),
  semesterConfig: () => request({ url: '/schedules/semester-config' }),

  // --- 预警 ---
  warnings: (params) => request({ url: '/student/warnings', data: params || {} }),
  confirmWarning: (id) => request({ url: '/student/warnings/' + id + '/confirm', method: 'POST' }),

  // --- 请假 / 申诉 / 换班 ---
  leaveRequests: (params) => request({ url: '/student/leave_requests', data: params || {} }),
  createLeave: (data) => request({ url: '/student/leave_requests', method: 'POST', data }),
  appeals: (params) => request({ url: '/student/appeals', data: params || {} }),
  createAppeal: (data) => request({ url: '/student/appeals', method: 'POST', data }),
  classChangeRequests: () => request({ url: '/student/class-change-requests' }),
  createClassChange: (data) =>
    request({ url: '/student/class-change-requests', method: 'POST', data }),

  // --- 站内个人消息 & 班级公告 ---
  inbox: (params) => request({ url: '/student/inbox', data: params || {} }),
  inboxUnreadCount: () => request({ url: '/student/inbox/unread-count', silent: true }),
  readInbox: (id) => request({ url: '/student/inbox/' + id + '/read', method: 'POST', silent: true }),
  readAllInbox: () => request({ url: '/student/inbox/read-all', method: 'POST' }),
  notifications: (params) => request({ url: '/student/notifications', data: params || {} }),
  readNotification: (id) =>
    request({ url: '/student/notifications/' + id + '/read', method: 'POST', silent: true }),

  // --- 偏好（渠道 + 静默免打扰时段） ---
  preferences: () => request({ url: '/student/preferences' }),
  updatePreferences: (data) => request({ url: '/student/preferences', method: 'PUT', data }),

  // --- 课堂扫码签到 ---
  checkin: (data) => request({ url: '/attendance/checkin', method: 'POST', data }),
};

module.exports = {
  request,
  uploadFile,
  downloadAuthImage,
  loadAuthImageUrls,
  clearAuthImageCache,
  api,
  getToken,
  clearAuthAndRedirect,
  toastError,
  config,
};
