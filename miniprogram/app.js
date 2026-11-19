/**
 * 小程序入口
 *
 * 登录时序（与后端约定）：
 *  1. wx.login() 取 code
 *  2. POST /student/login { wx_code }            → 若该 openid 已绑定学生，直接拿 token
 *  3. 未绑定时 POST /student/login { student_no, name, password }（或 { wx_code, student_no, name }）
 *  4. 拿到 token 后写入 Storage，后续请求带 Authorization: Bearer <token>
 *
 * ⚠️ token 请求头名是 `Authorization`（后端 AuthGuard 读取），
 *    不是某些模板里的 `token`，切勿臆造。
 */
const { api, config } = require('./utils/request');

App({
  globalData: {
    student: null,
    /** 订阅消息剩余可推送次数（微信一次性订阅限制，见 preferences 页说明） */
    subscribeQuota: 0,
  },

  onLaunch() {
    // 恢复本地登录态
    try {
      const student = wx.getStorageSync(config.STORAGE_STUDENT);
      if (student) this.globalData.student = student;
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
            const data = await api.loginByWechat({ wx_code: res.code });
            if (data && data.token) {
              wx.setStorageSync(config.STORAGE_TOKEN, data.token);
              wx.setStorageSync(config.STORAGE_STUDENT, data.student || null);
              this.globalData.student = data.student || null;
              resolve(true);
            } else {
              resolve(false);
            }
          } catch (e) {
            // 未绑定属于正常流程，静默失败
            resolve(false);
          }
        },
        fail: () => resolve(false),
      });
    });
  },
});
