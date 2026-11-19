const { api, toastError } = require('../../utils/request');

Page({
  data: { classes: [], selectedId: '' },

  onLoad() {
    this.fetchClasses();
  },

  async fetchClasses() {
    try {
      const data = await api.availableClasses();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      this.setData({ classes: list });
    } catch (e) {
      /* ignore */
    }
  },

  onPick(e) {
    this.setData({ selectedId: e.currentTarget.dataset.id });
  },

  async onSubmit() {
    if (!this.data.selectedId) return toastError('请选择班级');
    try {
      await api.bindClass({ class_id: this.data.selectedId });
      wx.showToast({ title: '绑定成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      /* request 层已提示 */
    }
  },
});
