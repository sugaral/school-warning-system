const { api, config } = require('../../utils/request');

Page({
  data: {
    prefs: { wechat: true, sms: true, email: false, quiet_start: '22:00', quiet_end: '08:00' },
    saving: false,
    hasTemplate: (config.SUBSCRIBE_TEMPLATE_IDS || []).length > 0,
  },

  onLoad() {
    this.fetchPrefs();
  },

  async fetchPrefs() {
    try {
      const data = await api.preferences();
      const prefs = (data && data.notify_prefs_json) || data || {};
      this.setData({
        prefs: {
          wechat: prefs.wechat !== false,
          sms: prefs.sms !== false,
          email: prefs.email === true,
          quiet_start: (prefs.quiet_hours && prefs.quiet_hours.start) || '22:00',
          quiet_end: (prefs.quiet_hours && prefs.quiet_hours.end) || '08:00',
        },
      });
    } catch (e) {
      /* 使用默认值 */
    }
  },

  onSwitch(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['prefs.' + key]: e.detail.value });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['prefs.' + key]: e.detail.value });
  },

  async onSave() {
    const p = this.data.prefs;
    this.setData({ saving: true });
    try {
      await api.updatePreferences({
        wechat: p.wechat,
        sms: p.sms,
        email: p.email,
        quiet_hours: { start: p.quiet_start, end: p.quiet_end },
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ saving: false });
    }
  },

  requestSubscribe() {
    const ids = config.SUBSCRIBE_TEMPLATE_IDS || [];
    if (ids.length === 0) return;
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        const accepted = ids.filter((id) => res[id] === 'accept').length;
        wx.showToast({ title: '已授权 ' + accepted + ' 项', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '授权未完成', icon: 'none' }),
    });
  },
});
