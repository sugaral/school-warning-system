const { api } = require('../../utils/request');

const LEVEL_TEXT = { yellow: '黄色', orange: '橙色', red: '红色', severe: '严重' };
const METRIC_TEXT = {
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  warning_total: '累计预警',
  homework_not_submit: '作业未交',
  homework_late_submit: '作业迟交',
  class_behavior: '课堂违纪',
  leave: '请假',
};
const WINDOW_TEXT = { day: '日', week: '周', month: '月', term: '学期' };
const STATUS_TEXT = { open: '待确认', acknowledged: '已确认', closed: '已关闭', suppressed: '已豁免', escalated: '已升级' };
const STATUS_CLASS = {
  open: 'tag-warn',
  acknowledged: '',
  closed: 'tag-success',
  suppressed: 'tag-plain',
  escalated: 'tag-danger',
};

Page({
  data: {
    items: [],
    level: '',
    status: '',
    page: 1,
    pageSize: 20,
    hasMore: false,
    loading: true,
  },

  onShow() {
    this.fetchList(true);
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  onFilter(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ [key]: value }, () => this.fetchList(true));
  },

  async fetchList(reset) {
    if (reset) this.setData({ page: 1 });
    this.setData({ loading: true });

    const params = { page: this.data.page, pageSize: this.data.pageSize };
    if (this.data.level) params.level = this.data.level;
    if (this.data.status) params.status = this.data.status;

    try {
      const data = await api.warnings(params);
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const total = (data && data.total) || list.length;

      // 统一在客户端做展示字段映射，避免模板里堆叠三元表达式
      const mapped = list.map((w) => ({
        ...w,
        levelText: LEVEL_TEXT[w.level] || w.level,
        metricText: METRIC_TEXT[w.metric] || w.metric,
        windowText: WINDOW_TEXT[w.window] || w.window,
        statusText: STATUS_TEXT[w.status] || w.status,
        statusClass: STATUS_CLASS[w.status] || 'tag-plain',
        periodText: [w.period_start, w.period_end]
          .filter(Boolean)
          .map((d) => String(d).slice(0, 10))
          .join(' ~ '),
        createdText: w.created_at ? String(w.created_at).slice(0, 16).replace('T', ' ') : '',
      }));

      const merged = reset ? mapped : this.data.items.concat(mapped);
      this.setData({
        items: merged,
        hasMore: merged.length < total,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    this.setData({ page: this.data.page + 1 }, () => this.fetchList(false));
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/warning-detail/warning-detail?id=' + e.currentTarget.dataset.id,
    });
  },
});
