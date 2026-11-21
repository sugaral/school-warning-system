const { api, toastError } = require('../../utils/request');

Page({
  data: {
    profile: {},
    email: '',
    challengeId: '',
    code: '',
    newPassword: '',
    confirmPassword: '',
    cooldown: 0,
    sending: false,
    submitting: false,
  },

  _timer: null,

  onShow() {
    this.loadProfile();
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  async loadProfile() {
    try {
      const p = await api.getProfile();
      this.setData({
        profile: p || {},
        email: (p && p.email) || '',
      });
    } catch (e) {
      /* ignore */
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  startCooldown(seconds) {
    if (this._timer) clearInterval(this._timer);
    let left = Number(seconds) || 60;
    this.setData({ cooldown: left });
    this._timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._timer);
        this._timer = null;
        this.setData({ cooldown: 0 });
      } else {
        this.setData({ cooldown: left });
      }
    }, 1000);
  },

  async onSendCode() {
    const email = String(this.data.email || '').trim().toLowerCase();
    if (!email) return toastError('请先前往个人资料绑定邮箱');

    this.setData({ sending: true });
    try {
      const res = await api.sendCode({
        purpose: 'student_change_password',
        channel: 'email',
        target: email,
      });
      this.setData({ challengeId: String((res && res.challenge_id) || '') });
      this.startCooldown((res && res.cooldown_seconds) || 60);
      wx.showToast({ title: '验证码已发送至邮箱', icon: 'success' });
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ sending: false });
    }
  },

  async onSubmit() {
    const { email, challengeId, code, newPassword, confirmPassword } = this.data;
    if (!email) return toastError('请先绑定邮箱');
    if (!challengeId) return toastError('请先发送邮箱验证码');
    if (!String(code || '').trim()) return toastError('请输入验证码');
    if (!newPassword || newPassword.length < 8) {
      return toastError('新密码至少 8 位且包含两类字符');
    }
    if (newPassword !== confirmPassword) return toastError('两次输入的新密码不一致');

    this.setData({ submitting: true });
    try {
      const verifyRes = await api.verifyCode({
        challenge_id: challengeId,
        code: String(code).trim(),
      });
      const ticket = verifyRes && verifyRes.ticket;
      if (!ticket) throw { message: '验证码核验失败' };

      await api.changePassword({
        ticket,
        new_password: newPassword,
      });
      wx.showToast({ title: '密码修改成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 900);
    } catch (err) {
      if (err && err.message && !err.code) toastError(err.message);
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBindEmail() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit?tab=security' });
  },
});
