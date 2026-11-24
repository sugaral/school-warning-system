const { api } = require('../../utils/request');
const { INBOX_TYPE_CLASS, formatDateTime } = require('../../utils/format');

Page({
  data: {
    inboxFilter: 'all', // 'all' | 'unread' | 'read'
    inboxList: [],
    unreadCount: 0,
    inboxLoading: true,
  },

  onShow() {
    this.loadInbox();
  },

  onPullDownRefresh() {
    this.loadInbox().then(() => wx.stopPullDownRefresh());
  },

  setInboxFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ inboxFilter: filter }, () => this.loadInbox());
  },

  async loadInbox() {
    this.setData({ inboxLoading: true });
    try {
      const params = { page: 1, pageSize: 50 };
      if (this.data.inboxFilter !== 'all') {
        params.status = this.data.inboxFilter;
      }
      const data = await api.inbox(params);
      const rawList = (data && data.list) || [];
      const list = rawList.map((item) => ({
        ...item,
        typeClass: INBOX_TYPE_CLASS[item.type] || 'tag-plain',
        createdText: formatDateTime(item.created_at),
      }));
      this.setData({
        inboxList: list,
        unreadCount: Number((data && data.unread) || 0),
        inboxLoading: false,
      });
    } catch (e) {
      this.setData({ inboxLoading: false });
    }
  },

  async onMarkAllRead() {
    if (this.data.unreadCount <= 0) return;
    try {
      await api.readAllInbox();
      wx.showToast({ title: '已全部标为已读', icon: 'success' });
      this.loadInbox();
    } catch (e) {
      /* request 层已提示 */
    }
  },

  goInboxDetail(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.inboxList[idx];
    if (!item) return;

    if (!item.is_read) {
      api.readInbox(item.id).catch(() => {});
    }
    const payload = encodeURIComponent(JSON.stringify(item));
    wx.navigateTo({
      url: '/pages/notification-detail/notification-detail?source=inbox&id=' + item.id + '&payload=' + payload,
    });
  },
});
