const { api, toastError } = require('../../utils/request');

Page({
  data: {
    items: [],
    loading: true,
    hasMore: false,
    page: 1,
    pageSize: 20,
  },

  onLoad() {
    this.fetchList(true);
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  async fetchList(reset) {
    if (reset) this.setData({ page: 1 });
    this.setData({ loading: true });
    try {
      const data = await api.leaveRequests({ page: this.data.page, pageSize: this.data.pageSize });
      // 兼容后端两种返回形态：数组 或 { list, total }
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const total = (data && data.total) || list.length;
      const merged = reset ? list : this.data.items.concat(list);
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
    wx.navigateTo({ url: '/pages/leave-detail/leave-detail?id=' + e.currentTarget.dataset.id });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/leave-form/leave-form' });
  },
});
