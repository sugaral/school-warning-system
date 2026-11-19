const { api, toastError } = require('../../utils/request');

Page({
  data: {
    form: {"from_date":"","to_date":"","reason":""},
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
      await api.createLeave(payload);
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
    if (!f.from_date) return toastError('请填写开始日期'), null;
    if (!f.to_date) return toastError('请填写结束日期'), null;
    if (!f.reason) return toastError('请填写请假原因'), null;
    return { from_date: f.from_date, to_date: f.to_date, reason: f.reason };
  },
});
