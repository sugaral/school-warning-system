const { api, toastError } = require('../../utils/request');

Page({
  data: {
    form: {"old_password":"","new_password":"","confirm_password":""},
    submitting: false,
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onSubmit() {
    const payload = this.buildPayload();
    if (!payload) return;
    this.setData({ submitting: true });
    try {
      await api.changePassword(payload);
      wx.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ submitting: false });
    }
  },

  buildPayload() {
    const f = this.data.form;
    if (!f.old_password) return toastError('请输入当前密码'), null;
    if (!f.new_password) return toastError('请输入新密码'), null;
    if (f.new_password !== f.confirm_password) return toastError('两次输入的新密码不一致'), null;
    if (f.new_password.length < 8) return toastError('新密码至少 8 位'), null;
    return { old_password: f.old_password, new_password: f.new_password };
  },
});
