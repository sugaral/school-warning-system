const { api, toastError } = require('../../utils/request');

Page({
  data: {
    form: {"appeal_type":"","related_id":"","content":""},
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
      await api.createAppeal(payload);
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
    if (!f.appeal_type) return toastError('请填写申诉类型'), null;
    if (!f.content) return toastError('请填写申诉内容'), null;
    const payload = { appeal_type: f.appeal_type, content: f.content };
    if (f.related_id) payload.related_id = f.related_id;
    return payload;
  },
});
