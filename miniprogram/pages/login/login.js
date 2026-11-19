const { api, config, toastError } = require('../../utils/request');

Page({
  data: {
    studentNo: '',
    name: '',
    password: '',
    submitting: false,
    errorMsg: '',
    bound: false,
    student: null,
  },

  onLoad() {
    // 若本地已有登录态，直接进首页
    const token = wx.getStorageSync(config.STORAGE_TOKEN);
    if (token) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onStudentNoInput(e) {
    this.setData({ studentNo: e.detail.value, errorMsg: '' });
  },
  onNameInput(e) {
    this.setData({ name: e.detail.value, errorMsg: '' });
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value, errorMsg: '' });
  },

  /**
   * 账号登录/绑定
   * 先取 wx.login 的 code，一并提交，后端可在校验通过后把 openid 绑到该学生，
   * 之后即可微信一键登录（避免每次输密码）。
   */
  onSubmit() {
    const { studentNo, name, password } = this.data;
    if (!studentNo.trim()) return toastError('请输入学号');
    if (!name.trim()) return toastError('请输入姓名');

    this.setData({ submitting: true, errorMsg: '' });
    wx.login({
      success: (res) => {
        const payload = {
          student_no: studentNo.trim(),
          name: name.trim(),
        };
        if (password) payload.password = password;
        if (res.code) payload.wx_code = res.code;
        this.doLogin(payload);
      },
      fail: () => {
        // 拿不到 code 也要允许纯账号登录
        this.doLogin({
          student_no: studentNo.trim(),
          name: name.trim(),
          ...(password ? { password } : {}),
        });
      },
    });
  },

  async doLogin(payload) {
    try {
      const data = await api.loginByAccount(payload);
      this.onLoginSuccess(data);
    } catch (err) {
      // 后端在密码错误时会返回剩余尝试次数，这里原样展示，便于学生自助排查
      this.setData({ errorMsg: err.message || '登录失败', submitting: false });
    }
  },

  /** 已绑定账号：微信一键登录 */
  onWechatLogin() {
    this.setData({ submitting: true, errorMsg: '' });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ submitting: false, errorMsg: '获取微信 code 失败' });
          return;
        }
        try {
          const data = await api.loginByWechat({ wx_code: res.code });
          this.onLoginSuccess(data);
        } catch (err) {
          this.setData({ errorMsg: err.message || '微信登录失败', submitting: false });
        }
      },
      fail: () => this.setData({ submitting: false, errorMsg: '微信登录失败' }),
    });
  },

  onLoginSuccess(data) {
    if (!data || !data.token) {
      this.setData({ submitting: false, errorMsg: '登录响应缺少 token' });
      return;
    }
    wx.setStorageSync(config.STORAGE_TOKEN, data.token);
    wx.setStorageSync(config.STORAGE_STUDENT, data.student || null);
    getApp().globalData.student = data.student || null;
    this.setData({ submitting: false });
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 500);
  },
});
