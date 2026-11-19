const { api } = require('../../utils/request');

Page({
  data: { trend: [] },

  onLoad() {
    this.fetchTrend();
  },

  async fetchTrend() {
    try {
      const data = await api.weekly();
      this.setData({ trend: Array.isArray(data) ? data : [] });
    } catch (e) {
      /* ignore */
    }
  },
});
