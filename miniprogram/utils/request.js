/**
 * 统一请求封装
 *
 * 约定（与后端 main.ts / ResponseInterceptor 一致）：
 *   成功: { code: 0, message: 'ok', data: {...}, trace_id: '...' }
 *   失败: { code: <非0>, message: '...', data: ..., trace_id: '...' }
 * ⚠️ 成功码是 0，不是 200。
 *
 * 另外注意后端序列化规则：bigint → 字符串、Date → ISO 字符串、
 * Decimal → 字符串。因此页面里**不要把 id 当 number 运算或比较**。
 */
const config = require('./config');

/** 读取 token */
function getToken() {
  try {
    return wx.getStorageSync(config.STORAGE_TOKEN) || '';
  } catch (e) {
    return '';
  }
}

/** 清除登录态并跳登录页 */
function clearAuthAndRedirect() {
  wx.removeStorageSync(config.STORAGE_TOKEN);
  wx.removeStorageSync(config.STORAGE_STUDENT);
  const pages = getCurrentPages();
  const current = pages.length > 0 ? pages[pages.length - 1].route : '';
  if (current && current.indexOf('pages/login/login') === -1) {
    wx.reLaunch({ url: '/pages/login/login' });
  }
}

/** 展示错误（统一 toast，避免每个页面重复写） */
function toastError(message) {
  wx.showToast({
    title: String(message || '请求失败').slice(0, 40),
    icon: 'none',
    duration: 2500,
  });
}

/**
 * 基础请求
 * @param {object} options { url, method, data, header, silent, loading }
 * @returns {Promise<any>} resolve 业务 data；reject { code, message }
 */
function request(options) {
  const opts = options || {};
  const header = Object.assign(
    { 'Content-Type': 'application/json' },
    opts.header || {},
  );
  const token = getToken();
  if (token) {
    header[config.TOKEN_HEADER] = config.TOKEN_PREFIX + token;
  }

  if (opts.loading) {
    wx.showLoading({ title: '加载中', mask: true });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl + opts.url,
      method: (opts.method || 'GET').toUpperCase(),
      data: opts.data || {},
      header,
      timeout: config.REQUEST_TIMEOUT,
      success(res) {
        const body = res.data || {};
        // HTTP 层：401 直接跳登录
        if (res.statusCode === 401 || res.statusCode === 403) {
          clearAuthAndRedirect();
          reject({ code: res.statusCode, message: '登录已失效，请重新登录' });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = body.message || 'HTTP ' + res.statusCode;
          if (!opts.silent) toastError(msg);
          reject({ code: res.statusCode, message: msg });
          return;
        }
        // 业务层：code 必须为 0
        if (body.code === 0) {
          resolve(body.data);
        } else {
          const msg = body.message || '请求失败';
          // 学生未登录/绑定异常时引导回登录页
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

/** 上传文件（多图证明/证据用），对接后端 /files/images */
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
        let body = {};
        try {
          body = JSON.parse(res.data || '{}');
        } catch (e) {
          reject({ code: -1, message: '上传响应解析失败' });
          return;
        }
        if (body.code === 0) resolve(body.data);
        else reject({ code: body.code, message: body.message || '上传失败' });
      },
      fail(err) {
        reject({ code: -1, message: '上传失败', raw: err });
      },
    });
  });
}

// ============================================================
// 业务接口封装（与后端 35 个 controller 中的 /student/* 对齐）
// ============================================================
const api = {
  // --- 登录与身份 ---
  loginByAccount: (data) => request({ url: '/student/login', method: 'POST', data }),
  loginByWechat: (data) => request({ url: '/student/login', method: 'POST', data }),
  bindWechat: (data) => request({ url: '/student/bind-wechat', method: 'POST', data }),
  bindEmail: (data) => request({ url: '/student/bind-email', method: 'POST', data }),
  bindPhone: (data) => request({ url: '/student/bind-phone', method: 'POST', data }),
  bindClass: (data) => request({ url: '/student/bind-class', method: 'POST', data }),
  availableClasses: () => request({ url: '/student/available-classes' }),
  getProfile: () => request({ url: '/student/profile' }),
  updateProfile: (data) => request({ url: '/student/profile', method: 'PUT', data }),
  changePassword: (data) => request({ url: '/student/change-password', method: 'POST', data }),
  getTeachers: () => request({ url: '/student/teachers' }),

  // --- 首页与统计 ---
  today: () => request({ url: '/student/today' }),
  weekly: () => request({ url: '/student/weekly' }),
  summaries: (params) => request({ url: '/student/summaries', data: params || {} }),
  courses: () => request({ url: '/student/courses' }),

  // --- 预警 ---
  warnings: (params) => request({ url: '/student/warnings', data: params || {} }),
  confirmWarning: (id) => request({ url: '/student/warnings/' + id + '/confirm', method: 'POST' }),

  // --- 请假 / 申诉 ---
  leaveRequests: (params) => request({ url: '/student/leave_requests', data: params || {} }),
  createLeave: (data) => request({ url: '/student/leave_requests', method: 'POST', data }),
  appeals: (params) => request({ url: '/student/appeals', data: params || {} }),
  createAppeal: (data) => request({ url: '/student/appeals', method: 'POST', data }),

  // --- 通知（班级公告 + 已读回执） ---
  notifications: (params) => request({ url: '/student/notifications', data: params || {} }),
  readNotification: (id) =>
    request({ url: '/student/notifications/' + id + '/read', method: 'POST' }),

  // --- 偏好（含静默时段） ---
  preferences: () => request({ url: '/student/preferences' }),
  updatePreferences: (data) => request({ url: '/student/preferences', method: 'PUT', data }),

  // --- 换班申请 ---
  classChangeRequests: () => request({ url: '/student/class-change-requests' }),
  createClassChange: (data) =>
    request({ url: '/student/class-change-requests', method: 'POST', data }),

  // --- 签到 ---
  checkin: (data) => request({ url: '/attendance/checkin', method: 'POST', data }),
};

module.exports = {
  request,
  uploadFile,
  api,
  getToken,
  clearAuthAndRedirect,
  toastError,
  config,
};
