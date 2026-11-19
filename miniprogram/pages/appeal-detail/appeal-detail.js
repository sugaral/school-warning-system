const { api } = require('../../utils/request');

Page({
  data: { id: '', detail: null, loading: true },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ id });
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.fetchDetail(id);
  },

  async fetchDetail(id) {
    try {
      // 列表接口通常支持按 id 过滤；若后端提供独立详情端点可替换此处
      const data = await api.appeals({ id });
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const hit = list.find((x) => String(x.id) === String(id)) || list[0] || null;
      this.setData({ detail: hit, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },
});
