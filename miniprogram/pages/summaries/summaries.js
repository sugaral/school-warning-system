const { api } = require('../../utils/request');

Page({
  data: {
    weekly: [],
    monthly: [],
    term: [],
    loading: true,
  },

  onLoad() {
    this.fetchSummaries();
  },

  onPullDownRefresh() {
    this.fetchSummaries().then(() => wx.stopPullDownRefresh());
  },

  async fetchSummaries() {
    this.setData({ loading: true });
    try {
      const data = await api.summaries({ weeks: 8, months: 6 });
      const weekly = ((data && data.weekly) || []).map((w) => ({
        ...w,
        label: String(w.week_start).slice(0, 10) + ' ~ ' + String(w.week_end).slice(0, 10),
      }));
      const monthly = ((data && data.monthly) || []).map((m) => ({
        ...m,
        label: m.year + ' 年 ' + m.month + ' 月',
      }));
      this.setData({
        weekly,
        monthly,
        term: (data && data.term) || [],
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
