const { api, config, clearAuthAndRedirect } = require('../../utils/request');

Page({
  data: { student: {} },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    // 先用本地缓存渲染，避免白屏
    const cached = wx.getStorageSync(config.STORAGE_STUDENT) || {};
    this.setData({ student: cached });

    try {
      const data = await api.getProfile();
      const s = (data && data.student) || data || {};
      const merged = Object.assign({}, cached, s);
      wx.setStorageSync(config.STORAGE_STUDENT, merged);
      this.setData({ student: merged });
    } catch (e) {
      /* 保留缓存展示 */
    }
  },

  goEdit() { wx.navigateTo({ url: '/pages/profile-edit/profile-edit' }); },
  goPreferences() { wx.navigateTo({ url: '/pages/preferences/preferences' }); },
  goBindClass() { wx.navigateTo({ url: '/pages/bind-class/bind-class' }); },
  goPassword() { wx.navigateTo({ url: '/pages/change-password/change-password' }); },
  goSummaries() { wx.navigateTo({ url: '/pages/summaries/summaries' }); },
  goAttendance() { wx.navigateTo({ url: '/pages/attendance/attendance' }); },
  goGrades() { wx.navigateTo({ url: '/pages/grades/grades' }); },
  goTeachers() { wx.navigateTo({ url: '/pages/teachers/teachers' }); },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需要重新登录',
      success: (res) => {
        if (res.confirm) clearAuthAndRedirect();
      },
    });
  },
});
