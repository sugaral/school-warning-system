const { api } = require('../../utils/request');

Page({
  data: {
    items: [],
    loading: true,
    unbound: false,
  },

  onShow() {
    this.fetchTeachers();
  },

  onPullDownRefresh() {
    this.fetchTeachers().then(() => wx.stopPullDownRefresh());
  },

  async fetchTeachers() {
    this.setData({ loading: true, unbound: false });
    try {
      const data = await api.getTeachers();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      this.setData({ items: list, loading: false });
    } catch (err) {
      const msg = (err && err.message) || '';
      this.setData({
        items: [],
        unbound: msg.indexOf('未绑定') !== -1,
        loading: false,
      });
    }
  },

  goBindClass() {
    wx.navigateTo({ url: '/pages/bind-class/bind-class' });
  },
});
