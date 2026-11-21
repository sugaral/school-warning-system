const { api, loadAuthImageUrls } = require('../../utils/request');
const {
  LEAVE_STATUS_TEXT,
  LEAVE_STATUS_CLASS,
  formatDateTime,
  normalizeFileIds,
} = require('../../utils/format');

Page({
  data: {
    id: '',
    detail: null,
    proofImages: [],
    loading: true,
  },

  onLoad(options) {
    const id = (options && options.id) || '';
    this.setData({ id });
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.fetchDetail(id);
  },

  async fetchDetail(id) {
    try {
      const data = await api.leaveRequests();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const hit = list.find((x) => String(x.id) === String(id)) || null;
      if (!hit) {
        this.setData({ detail: null, loading: false });
        return;
      }

      const proofIds = normalizeFileIds(hit.proof_file_ids, hit.proof_file_id);
      const detail = {
        ...hit,
        leave_type: hit.leave_type || '请假',
        statusText: LEAVE_STATUS_TEXT[hit.status] || hit.status || '-',
        statusClass: LEAVE_STATUS_CLASS[hit.status] || 'tag-plain',
        startText: formatDateTime(hit.start_date || hit.from_date),
        endText: formatDateTime(hit.end_date || hit.to_date),
        createdText: formatDateTime(hit.created_at),
      };
      this.setData({ detail, loading: false });

      if (proofIds.length > 0) {
        const urls = await loadAuthImageUrls(proofIds);
        this.setData({ proofImages: urls });
      }
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.proofImages || [];
    if (!urls.length) return;
    wx.previewImage({
      current: urls[idx] || urls[0],
      urls,
    });
  },
});
