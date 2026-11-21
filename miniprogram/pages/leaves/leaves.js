const { api } = require('../../utils/request');
const {
  LEAVE_STATUS_TEXT,
  LEAVE_STATUS_CLASS,
  formatDateTime,
  normalizeFileIds,
} = require('../../utils/format');

Page({
  data: {
    items: [],
    loading: true,
  },

  onShow() {
    this.fetchList();
  },

  onPullDownRefresh() {
    this.fetchList().then(() => wx.stopPullDownRefresh());
  },

  async fetchList() {
    this.setData({ loading: true });
    try {
      const data = await api.leaveRequests();
      const rawList = Array.isArray(data) ? data : (data && data.list) || [];
      const items = rawList.map((item) => {
        const proofIds = normalizeFileIds(item.proof_file_ids, item.proof_file_id);
        return {
          ...item,
          leave_type: item.leave_type || '请假',
          startText: formatDateTime(item.start_date || item.from_date),
          endText: formatDateTime(item.end_date || item.to_date),
          createdText: formatDateTime(item.created_at),
          statusText: LEAVE_STATUS_TEXT[item.status] || item.status || '-',
          statusClass: LEAVE_STATUS_CLASS[item.status] || 'tag-plain',
          proofCount: proofIds.length,
        };
      });
      this.setData({ items, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/leave-detail/leave-detail?id=' + e.currentTarget.dataset.id,
    });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/leave-form/leave-form' });
  },
});
