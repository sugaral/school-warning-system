/**
 * 统一请求与文件传输封装（仅供学生端使用）
 *
 * 约定（与后端 main.ts / ResponseInterceptor 一致）：
 *   成功: { code: 0, message: 'ok', data: {...}, trace_id: '...' }
 *   失败: { code: <非0>, message: '...', data: ..., trace_id: '...' }
 */
const config = require('../config');
const smCrypto = require('./smCrypto');

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
    const baseUrl = config.getBaseUrl ? config.getBaseUrl() : config.baseUrl;
    wx.request({
      url: baseUrl + opts.url,
      method,
      data: requestData,
      header,
      timeout: config.REQUEST_TIMEOUT,
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 401 || res.statusCode === 403) {
          clearAuthAndRedirect();
          reject({ code: res.statusCode, message: body.msg || body.message || '登录已失效，请重新登录' });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = body.msg || body.message || 'HTTP ' + res.statusCode;
          if (!opts.silent) toastError(msg);
          reject({ code: res.statusCode, message: msg, data: body.data });
          return;
        }
        if (body.code === 200 || body.code === 0) {
          resolve(body.data);
        } else {
          const msg = body.msg || body.message || '请求失败';
          if (body.code === 401 || body.code === 4010) {
            clearAuthAndRedirect();
          } else if (!opts.silent) {
            toastError(msg);
          }
          reject({ code: body.code, message: msg, data: body.data });
        }
      },
      fail(err) {
        const errDetail = (err && err.errMsg) || '';
        const msg = errDetail.indexOf('url not in domain list') !== -1
          ? '请在微信开发者工具关闭「校验合法域名」或使用HTTPS生产域名'
          : '网络异常，无法连接 ' + baseUrl;
        if (!opts.silent) toastError(msg);
        reject({ code: -1, message: msg, raw: err });
      },
      complete() {
        if (opts.loading) wx.hideLoading();
      },
    });
  });
}

/** 上传图片文件，对接 Snowy C 端 /client/c/warnsys/file/upload */
function uploadFile(filePath, options) {
  const opts = options || {};
  const header = {};
  const token = getToken();
  if (token) header[config.TOKEN_HEADER] = config.TOKEN_PREFIX + token;
  const baseUrl = config.getBaseUrl ? config.getBaseUrl() : config.baseUrl;

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: baseUrl + (opts.url || '/client/c/warnsys/file/upload'),
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
          reject({ code: res.statusCode, message: body.msg || body.message || '图片上传失败' });
          return;
        }
        if (body.code === 200 || body.code === 0) resolve(body.data);
        else reject({ code: body.code, message: body.msg || body.message || '上传失败' });
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
    const baseUrl = config.getBaseUrl ? config.getBaseUrl() : config.baseUrl;
    wx.downloadFile({
      url: baseUrl + '/client/c/warnsys/file/download?id=' + encodeURIComponent(id),
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

function encryptLoginPayload(data) {
  const payload = Object.assign({}, data || {});
  if (payload.password) {
    payload.password = smCrypto.doSm2Encrypt(payload.password);
  }
  return payload;
}

function encryptPasswordPayload(data) {
  const payload = Object.assign({}, data || {});
  if (payload.old_password) payload.old_password = smCrypto.doSm2Encrypt(payload.old_password);
  if (payload.oldPassword) payload.oldPassword = smCrypto.doSm2Encrypt(payload.oldPassword);
  if (payload.new_password) payload.new_password = smCrypto.doSm2Encrypt(payload.new_password);
  if (payload.newPassword) payload.newPassword = smCrypto.doSm2Encrypt(payload.newPassword);
  if (payload.password) payload.password = smCrypto.doSm2Encrypt(payload.password);
  return payload;
}

// ============================================================
// 学生端业务接口封装（对接 Snowy C 端 /client/c/warnsys/**，SM2 加密敏感口令）
// ============================================================
const api = {
  // --- 登录、找回密码与身份安全 ---
  loginByAccount: (data, opts) =>
    request(Object.assign({ url: '/client/c/warnsys/auth/login', method: 'POST', data: encryptLoginPayload(data) }, opts)),
  loginByWechat: (data, opts) =>
    request(Object.assign({ url: '/client/c/warnsys/auth/wxLogin', method: 'POST', data }, opts)),
  bindWechat: (data) => request({ url: '/client/c/warnsys/student/bindWechat', method: 'POST', data }),
  bindEmail: (data) => request({ url: '/client/c/warnsys/student/bindEmail', method: 'POST', data }),
  bindPhone: (data) => request({ url: '/client/c/warnsys/student/bindPhone', method: 'POST', data }),
  bindClass: (data) => request({ url: '/client/c/warnsys/student/bindClass', method: 'POST', data }),
  availableClasses: () => request({ url: '/client/c/warnsys/student/availableClasses' }),
  getProfile: () => request({ url: '/client/c/warnsys/student/profile' }),
  updateProfile: (data) => request({ url: '/client/c/warnsys/student/profile', method: 'PUT', data }),
  changePassword: (data) =>
    request({ url: '/client/c/warnsys/student/changePassword', method: 'POST', data: encryptPasswordPayload(data) }),
  getTeachers: () => request({ url: '/client/c/warnsys/student/teachers' }),

  // --- 验证码与账号找回 ---
  sendCode: (data) => request({ url: '/client/c/warnsys/auth/sendCode', method: 'POST', data }),
  verifyCode: (data) => request({ url: '/client/c/warnsys/auth/verifyCode', method: 'POST', data }),
  recoveryOptions: (data) => request({ url: '/client/c/warnsys/auth/recovery/options', method: 'POST', data }),
  sendRecoveryEmailCode: (data) =>
    request({ url: '/client/c/warnsys/auth/recovery/sendEmailCode', method: 'POST', data }),
  sendRecoverySmsCode: (data) =>
    request({ url: '/client/c/warnsys/auth/recovery/sendSmsCode', method: 'POST', data }),
  resetPassword: (data) =>
    request({ url: '/client/c/warnsys/auth/recovery/resetPassword', method: 'POST', data: encryptPasswordPayload(data) }),

  // --- 首页与学业数据 ---
  today: () => request({ url: '/client/c/warnsys/student/today' }),
  weekly: () => request({ url: '/client/c/warnsys/student/weekly' }),
  summaries: (params) => request({ url: '/client/c/warnsys/student/summaries', data: params || {} }),
  courses: () => request({ url: '/client/c/warnsys/student/courses' }),

  // --- 预警 ---
  warnings: (params) => request({ url: '/client/c/warnsys/student/warnings', data: params || {} }),
  confirmWarning: (id) =>
    request({ url: '/client/c/warnsys/student/warnings/' + encodeURIComponent(id) + '/confirm', method: 'POST' }),

  // --- 请假 / 申诉 / 换班 ---
  leaveRequests: (params) => request({ url: '/client/c/warnsys/student/leaveRequests', data: params || {} }),
  createLeave: (data) => request({ url: '/client/c/warnsys/student/leaveRequests', method: 'POST', data }),
  appeals: (params) => request({ url: '/client/c/warnsys/student/appeals', data: params || {} }),
  createAppeal: (data) => request({ url: '/client/c/warnsys/student/appeals', method: 'POST', data }),
  classChangeRequests: () => request({ url: '/client/c/warnsys/student/classChangeRequests' }),
  createClassChange: (data) =>
    request({ url: '/client/c/warnsys/student/classChangeRequests', method: 'POST', data }),

  // --- 站内个人消息 ---
  inbox: (params) => request({ url: '/client/c/warnsys/student/inbox', data: params || {} }),
  inboxUnreadCount: () => request({ url: '/client/c/warnsys/student/inbox/unreadCount', silent: true }),
  readInbox: (id) =>
    request({ url: '/client/c/warnsys/student/inbox/' + encodeURIComponent(id) + '/read', method: 'POST', silent: true }),
  readAllInbox: () => request({ url: '/client/c/warnsys/student/inbox/readAll', method: 'POST' }),

  // --- 偏好（渠道 + 静默免打扰时段） ---
  preferences: () => request({ url: '/client/c/warnsys/student/preferences' }),
  updatePreferences: (data) => request({ url: '/client/c/warnsys/student/preferences', method: 'PUT', data }),

  // --- 课堂多模式签到 ---
  activeCheckinSessions: () => request({ url: '/client/c/warnsys/attendance/activeSessions' }),
  checkin: (data) => request({ url: '/client/c/warnsys/attendance/checkin', method: 'POST', data }),
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
