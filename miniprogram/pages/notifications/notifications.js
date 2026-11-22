const { api } = require('../../utils/request');
const { INBOX_TYPE_CLASS, formatDateTime } = require('../../utils/format');

Page({
  data: {
    activeTab: 'inbox', // 'inbox' | 'class'
    inboxFilter: 'all', // 'all' | 'unread' | 'read'
    inboxList: [],
    unreadCount: 0,
    inboxLoading: true,

    classList: [],
    classUnreadCount: 0,
    classPage: 1,
    classHasMore: false,
    classLoading: false,
  },

  onShow() {
    this.loadInbox();
    this.loadClassNotices(true);
  },

  onPullDownRefresh() {
    const task =
      this.data.activeTab === 'inbox' ? this.loadInbox() : this.loadClassNotices(true);
    task.then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.activeTab === 'class' && this.data.classHasMore && !this.data.classLoading) {
      this.setData({ classPage: this.data.classPage + 1 }, () => this.loadClassNotices(false));
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
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

  async loadClassNotices(reset) {
    if (reset) this.setData({ classPage: 1 });
    this.setData({ classLoading: true });
    try {
      const data = await api.notifications({ page: this.data.classPage, pageSize: 30 });
      const rawList = Array.isArray(data) ? data : (data && data.list) || [];
      const total = (data && data.total) || rawList.length;
      const mapped = rawList.map((item) => ({
        ...item,
        is_read: Boolean(item.is_read),
        createdText: formatDateTime(item.created_at),
      }));
      const merged = reset ? mapped : this.data.classList.concat(mapped);
      const classUnreadCount =
        data && typeof data.unread === 'number'
          ? Number(data.unread)
          : merged.filter((x) => !x.is_read).length;
      this.setData({
        classList: merged,
        classUnreadCount,
        classHasMore: merged.length < total,
        classLoading: false,
      });
    } catch (e) {
      this.setData({ classLoading: false });
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

  goClassDetail(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.classList[idx];
    if (!item) return;

    if (!item.is_read) {
      api.readNotification(item.id).catch(() => {});
    }
    const payload = encodeURIComponent(JSON.stringify(item));
    wx.navigateTo({
      url: '/pages/notification-detail/notification-detail?source=class&id=' + item.id + '&payload=' + payload,
    });
  },
});
