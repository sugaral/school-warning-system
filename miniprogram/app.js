/**
 * 小程序入口（仅供学生端使用）
 *
 * 登录时序（与后端约定）：
 *  1. wx.login() 取 code
 *  2. POST /student/login { wx_code }            -> 若该 openid 已绑定学生，直接拿 token
 *  3. 未绑定时 POST /student/login { student_no, name, password, wx_code }
 *  4. 拿到 token 后写入 Storage，后续请求带 Authorization: Bearer <token>
 */
const { api, config, clearAuthImageCache } = require('./utils/request');

App({
  globalData: {
    student: null,
    subscribeQuota: 0,
  },

  onLaunch() {
    try {
      const student = wx.getStorageSync(config.STORAGE_STUDENT);
      if (student) this.globalData.student = student;
    } catch (e) {
      /* ignore */
    }
  },

  setStudent(student) {
    this.globalData.student = student || null;
    try {
      if (student) {
        wx.setStorageSync(config.STORAGE_STUDENT, student);
      } else {
        wx.removeStorageSync(config.STORAGE_STUDENT);
      }
    } catch (e) {
      /* ignore */
    }
  },

  clearSession() {
    this.globalData.student = null;
    clearAuthImageCache();
    try {
      wx.removeStorageSync(config.STORAGE_TOKEN);
      wx.removeStorageSync(config.STORAGE_STUDENT);
    } catch (e) {
      /* ignore */
    }
  },

  /**
   * 静默登录：尝试用 wx_code 换取 token（已绑定 openid 的学生无需输密码）
   * @returns {Promise<boolean>} 是否已登录
   */
  silentLogin() {
    const token = wx.getStorageSync(config.STORAGE_TOKEN);
    if (token) return Promise.resolve(true);

    return new Promise((resolve) => {
      wx.login({
        success: async (res) => {
          if (!res.code) return resolve(false);
          try {
            const data = await api.loginByWechat({ wx_code: res.code }, { silent: true });
            if (data && data.token) {
              wx.setStorageSync(config.STORAGE_TOKEN, data.token);
              this.setStudent(data.student || null);
              resolve(true);
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
          }
        },
        fail: () => resolve(false),
      });
    });
  },
});
