const { api, loadAuthImageUrls } = require('../../utils/request');
const {
  APPEAL_STATUS_TEXT,
  APPEAL_STATUS_CLASS,
  formatDateTime,
  normalizeFileIds,
} = require('../../utils/format');

Page({
  data: {
    id: '',
    detail: null,
    evidenceImages: [],
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
      const data = await api.appeals();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const hit = list.find((x) => String(x.id) === String(id)) || null;
      if (!hit) {
        this.setData({ detail: null, loading: false });
        return;
      }

      const status = hit.status || hit.appeal_result || 'submitted';
      const evidenceIds = normalizeFileIds(hit.evidence_file_ids, hit.evidence_file_id);
      const detail = {
        ...hit,
        statusText: APPEAL_STATUS_TEXT[status] || status || '-',
        statusClass: APPEAL_STATUS_CLASS[status] || 'tag-plain',
        warning_course: hit.warning_course || hit.related_type || '',
        content: hit.content || hit.appeal_reason || '',
        createdText: formatDateTime(hit.created_at),
      };
      this.setData({ detail, loading: false });

      if (evidenceIds.length > 0) {
        const urls = await loadAuthImageUrls(evidenceIds);
        this.setData({ evidenceImages: urls });
      }
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.evidenceImages || [];
    if (!urls.length) return;
    wx.previewImage({
      current: urls[idx] || urls[0],
      urls,
    });
  },
});
