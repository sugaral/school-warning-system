const { api } = require('../../utils/request');
const { INBOX_TYPE_CLASS, formatDateTime } = require('../../utils/format');

Page({
  data: {
    source: 'class', // 'inbox' | 'class'
    detail: null,
    loading: true,
  },

  onLoad(options) {
    const source = (options && options.source) || 'class';
    const id = (options && options.id) || '';
    this.setData({ source });

    if (options && options.payload) {
      try {
        const parsed = JSON.parse(decodeURIComponent(options.payload));
        this.applyDetail(source, parsed);
        return;
      } catch (e) {
        /* fallback to fetch */
      }
    }

    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.fetchDetail(source, id);
  },

  applyDetail(source, item) {
    if (!item) {
      this.setData({ detail: null, loading: false });
      return;
    }
    this.setData({
      detail: {
        ...item,
        typeClass: INBOX_TYPE_CLASS[item.type] || 'tag-info',
        createdText: formatDateTime(item.created_at),
      },
      loading: false,
    });
  },

  async fetchDetail(source, id) {
    try {
      const data =
        source === 'inbox'
          ? await api.inbox({ page: 1, pageSize: 50 })
          : await api.notifications({ page: 1, pageSize: 50 });
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const hit = list.find((x) => String(x.id) === String(id)) || null;
      this.applyDetail(source, hit);
    } catch (e) {
      this.setData({ loading: false });
    }
  },
});
