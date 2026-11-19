const { api } = require('../../utils/request');

Page({
  data: { weekly: [], monthly: [], term: [] },

  onLoad() {
    this.fetchSummaries();
  },

  async fetchSummaries() {
    try {
      // 读的是后端 P1-5 落地的三张汇总表（weekly/monthly/term_summaries），
      // 不是每次实时聚合 daily_records，因此打开很快。
      const data = await api.summaries({ weeks: 8, months: 6 });
      const weekly = ((data && data.weekly) || []).map((w) => ({
        ...w,
        label: `${String(w.week_start).slice(0, 10)} ~ ${String(w.week_end).slice(0, 10)}`,
      }));
      const monthly = ((data && data.monthly) || []).map((m) => ({
        ...m,
        label: `${m.year} 年 ${m.month} 月`,
      }));
      this.setData({
        weekly,
        monthly,
        term: (data && data.term) || [],
      });
    } catch (e) {
      /* ignore */
    }
  },
});
