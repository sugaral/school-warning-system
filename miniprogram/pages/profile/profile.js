const { api, config, downloadAuthImage, toastError } = require('../../utils/request');

Page({
  data: {
    student: {},
    avatarUrl: '',
    bindingWechat: false,
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    const cached = wx.getStorageSync(config.STORAGE_STUDENT) || {};
    this.setData({ student: cached });

    try {
      const data = await api.getProfile();
      const s = (data && data.student) || data || {};
      const merged = Object.assign({}, cached, s);
      getApp().setStudent(merged);
      this.setData({ student: merged });

      if (merged.photo_file_id) {
        const localPath = await downloadAuthImage(merged.photo_file_id);
        if (localPath) this.setData({ avatarUrl: localPath });
      } else {
        this.setData({ avatarUrl: '' });
      }
    } catch (e) {
      /* 保留缓存展示 */
    }
  },

  onBindWechat() {
    if (this.data.bindingWechat) return;
    this.setData({ bindingWechat: true });
    wx.login({
      success: async (res) => {
        if (!res.code) {
          this.setData({ bindingWechat: false });
          return toastError('获取微信凭证失败');
        }
        try {
          const data = await api.bindWechat({ wx_code: res.code });
          if (data && data.token) {
            wx.setStorageSync(config.STORAGE_TOKEN, data.token);
          }
          wx.showToast({ title: '微信绑定成功', icon: 'success' });
          this.loadProfile();
        } catch (err) {
          /* request 层已提示 */
        } finally {
          this.setData({ bindingWechat: false });
        }
      },
      fail: () => {
        this.setData({ bindingWechat: false });
        toastError('微信授权取消');
      },
    });
  },

  goEdit() { wx.navigateTo({ url: '/pages/profile-edit/profile-edit' }); },
  goClassChange() { wx.navigateTo({ url: '/pages/profile-edit/profile-edit?tab=class' }); },
  goLeaves() { wx.navigateTo({ url: '/pages/leaves/leaves' }); },
  goAppeals() { wx.navigateTo({ url: '/pages/appeals/appeals' }); },
  goNotifications() { wx.navigateTo({ url: '/pages/notifications/notifications' }); },
  goPreferences() { wx.navigateTo({ url: '/pages/preferences/preferences' }); },
  goBindClass() { wx.navigateTo({ url: '/pages/bind-class/bind-class' }); },
  goPassword() { wx.navigateTo({ url: '/pages/change-password/change-password' }); },
  goSummaries() { wx.navigateTo({ url: '/pages/summaries/summaries' }); },
  goAttendance() { wx.navigateTo({ url: '/pages/attendance/attendance' }); },
  goGrades() { wx.navigateTo({ url: '/pages/grades/grades' }); },
  goTeachers() { wx.navigateTo({ url: '/pages/teachers/teachers' }); },
  goAbout() { wx.navigateTo({ url: '/pages/about/about' }); },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后将清除本地学生登录态，确定继续吗？',
      success: (res) => {
        if (res.confirm) {
          getApp().clearSession();
          wx.reLaunch({ url: '/pages/login/login' });
        }
      },
    });
  },
});
