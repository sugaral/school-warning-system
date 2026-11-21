const { api } = require('../../utils/request');
const {
  APPEAL_STATUS_TEXT,
  APPEAL_STATUS_CLASS,
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
      const data = await api.appeals();
      const rawList = Array.isArray(data) ? data : (data && data.list) || [];
      const items = rawList.map((item) => {
        const evidenceIds = normalizeFileIds(item.evidence_file_ids, item.evidence_file_id);
        const status = item.status || item.appeal_result || 'submitted';
        return {
          ...item,
          appeal_type: item.appeal_type || '申诉',
          warning_course: item.warning_course || item.related_type || '',
          content: item.content || item.appeal_reason || '',
          status,
          statusText: APPEAL_STATUS_TEXT[status] || status || '-',
          statusClass: APPEAL_STATUS_CLASS[status] || 'tag-plain',
          createdText: formatDateTime(item.created_at),
          evidenceCount: evidenceIds.length,
        };
      });
      this.setData({ items, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/appeal-detail/appeal-detail?id=' + e.currentTarget.dataset.id,
    });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/appeal-form/appeal-form' });
  },
});
