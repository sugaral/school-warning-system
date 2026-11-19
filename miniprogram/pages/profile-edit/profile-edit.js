const { api } = require('../../utils/request');

Page({
  data: {
    form: { mobile: '', email: '', emergency_contact_name: '', emergency_contact_mobile: '' },
    saving: false,
  },

  onLoad() {
    this.fetchProfile();
  },

  async fetchProfile() {
    try {
      const data = await api.getProfile();
      const s = (data && data.student) || data || {};
      this.setData({
        form: {
          mobile: s.mobile || '',
          email: s.email || '',
          emergency_contact_name: s.emergency_contact_name || '',
          emergency_contact_mobile: s.emergency_contact_mobile || '',
        },
      });
    } catch (e) {
      /* ignore */
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await api.updateProfile(this.data.form);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ saving: false });
    }
  },
});
