const { api, config, toastError } = require('../../utils/request');

Page({
  data: {
    mode: 'login', // 'login' | 'recovery'
    studentNo: '',
    name: '',
    password: '',
    submitting: false,
    errorMsg: '',

    // 忘记密码找回状态
    recoveryAccount: '',
    recoveryOptions: null,
    recoveryChannel: 'email',
    recoveryTarget: '',
    recoveryChallengeId: '',
    recoveryCode: '',
    recoveryNewPassword: '',
    recoveryConfirmPassword: '',
    recoveryLoading: false,
    cooldownSeconds: 0,
    recoveryError: '',
  },

  _timer: null,

  onLoad() {
    const token = wx.getStorageSync(config.STORAGE_TOKEN);
    if (token) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onUnload() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      mode,
      errorMsg: '',
      recoveryError: '',
      recoveryAccount: mode === 'recovery' && this.data.studentNo ? this.data.studentNo : this.data.recoveryAccount,
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [field]: e.detail.value,
      errorMsg: '',
      recoveryError: '',
    });
  },

  onSubmit() {
    const studentNo = this.data.studentNo.trim();
    const name = this.data.name.trim();
    const password = this.data.password;

    if (!studentNo) return toastError('请输入学号或账号');
    if (!name) return toastError('请输入姓名');
    if (!password) return toastError('请输入密码');

    this.setData({ submitting: true, errorMsg: '' });
    wx.login({
      success: (res) => {
        const payload = {
          student_no: studentNo,
          name,
          password,
        };
        if (res.code) payload.wx_code = res.code;
        this.doLogin(payload);
      },
      fail: () => {
        this.doLogin({
          student_no: studentNo,
          name,
          password,
        });
      },
    });
  },

  async doLogin(payload) {
    try {
      const data = await api.loginByAccount(payload);
      this.onLoginSuccess(data);
    } catch (err) {
      this.setData({
        errorMsg: (err && err.message) || '登录失败',
        submitting: false,
      });
    }
  },

  onWechatLogin() {
    this.setData({ submitting: true, errorMsg: '' });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ submitting: false, errorMsg: '获取微信登录凭证失败' });
          return;
        }
        try {
          const data = await api.loginByWechat({ wx_code: res.code });
          this.onLoginSuccess(data);
        } catch (err) {
          this.setData({
            errorMsg: (err && err.message) || '当前微信尚未绑定学生账号，请先使用学号姓名密码登录',
            submitting: false,
          });
        }
      },
      fail: () => this.setData({ submitting: false, errorMsg: '微信登录取消或失败' }),
    });
  },

  onLoginSuccess(data) {
    if (!data || !data.token) {
      this.setData({ submitting: false, errorMsg: '登录响应缺少 token' });
      return;
    }
    const student = data.student || {};
    wx.setStorageSync(config.STORAGE_TOKEN, data.token);
    getApp().setStudent(student);
    this.setData({ submitting: false });

    const unbound = !student.class_name || student.class_name === '未绑定班级' || student.class_name === '未绑定';
    wx.showToast({
      title: unbound ? '登录成功，请绑定班级' : '登录成功',
      icon: unbound ? 'none' : 'success',
      duration: 1500,
    });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/index/index' });
    }, 500);
  },

  // --- 密码找回 ---
  async onQueryRecoveryOptions() {
    const account = this.data.recoveryAccount.trim();
    if (!account) return toastError('请输入学号');

    this.setData({ recoveryLoading: true, recoveryError: '', recoveryChallengeId: '' });
    try {
      const options = await api.recoveryOptions({ account });
      const preferSms = !(options && options.email && options.email.enabled) && (options && options.sms && options.sms.enabled);
      this.setData({
        recoveryOptions: options,
        recoveryChannel: preferSms ? 'sms' : 'email',
        recoveryTarget: '',
        recoveryLoading: false,
      });
    } catch (err) {
      this.setData({
        recoveryOptions: null,
        recoveryError: (err && err.message) || '查询找回方式失败',
        recoveryLoading: false,
      });
    }
  },

  selectRecoveryChannel(e) {
    const channel = e.currentTarget.dataset.channel;
    this.setData({
      recoveryChannel: channel,
      recoveryTarget: '',
      recoveryChallengeId: '',
      recoveryError: '',
    });
  },

  startCooldown(seconds) {
    if (this._timer) clearInterval(this._timer);
    let left = Number(seconds) || 60;
    this.setData({ cooldownSeconds: left });
    this._timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._timer);
        this._timer = null;
        this.setData({ cooldownSeconds: 0 });
      } else {
        this.setData({ cooldownSeconds: left });
      }
    }, 1000);
  },

  async onSendRecoveryCode() {
    const account = this.data.recoveryAccount.trim();
    const target = this.data.recoveryTarget.trim();
    const channel = this.data.recoveryChannel;
    if (!account) return toastError('请先输入学号');
    if (!target) return toastError(channel === 'sms' ? '请输入绑定手机号' : '请输入绑定邮箱');

    this.setData({ recoveryLoading: true, recoveryError: '' });
    try {
      const res =
        channel === 'sms'
          ? await api.sendRecoverySmsCode({ account, mobile: target })
          : await api.sendRecoveryEmailCode({ account, email: target });
      this.setData({
        recoveryChallengeId: res && res.challenge_id ? String(res.challenge_id) : '',
        recoveryLoading: false,
      });
      this.startCooldown((res && res.cooldown_seconds) || 60);
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (err) {
      this.setData({
        recoveryError: (err && err.message) || '验证码发送失败',
        recoveryLoading: false,
      });
    }
  },

  async onResetPassword() {
    const {
      recoveryAccount,
      recoveryChannel,
      recoveryTarget,
      recoveryChallengeId,
      recoveryCode,
      recoveryNewPassword,
      recoveryConfirmPassword,
    } = this.data;

    if (!recoveryAccount.trim()) return toastError('请输入学号');
    if (!recoveryChallengeId) return toastError('请先获取验证码');
    if (!recoveryCode.trim()) return toastError('请输入验证码');
    if (!recoveryNewPassword || recoveryNewPassword.length < 8) {
      return toastError('新密码至少 8 位且需含两类字符');
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      return toastError('两次输入的密码不一致');
    }

    this.setData({ recoveryLoading: true, recoveryError: '' });
    try {
      const verifyRes = await api.verifyCode({
        challenge_id: recoveryChallengeId,
        code: recoveryCode.trim(),
      });
      const ticket = verifyRes && verifyRes.ticket;
      if (!ticket) {
        throw { message: '验证码校验失败' };
      }

      await api.resetPassword({
        account: recoveryAccount.trim(),
        channel: recoveryChannel,
        ...(recoveryChannel === 'sms'
          ? { mobile: recoveryTarget.trim() }
          : { email: recoveryTarget.trim().toLowerCase() }),
        ticket,
        new_password: recoveryNewPassword,
      });

      wx.showToast({ title: '密码重置成功，请登录', icon: 'success' });
      this.setData({
        mode: 'login',
        studentNo: recoveryAccount.trim(),
        password: '',
        recoveryLoading: false,
        recoveryOptions: null,
        recoveryCode: '',
        recoveryNewPassword: '',
        recoveryConfirmPassword: '',
      });
    } catch (err) {
      this.setData({
        recoveryError: (err && err.message) || '重置密码失败',
        recoveryLoading: false,
      });
    }
  },
});
