const { api } = require('../../utils/request');
const {
  ATTENDANCE_TEXT,
  ATTENDANCE_TAG_CLASS,
  HOMEWORK_TEXT,
  BEHAVIOR_TEXT,
} = require('../../utils/format');

Page({
  data: {
    trend: [],
    loading: true,
  },

  onShow() {
    this.fetchTrend();
  },

  onPullDownRefresh() {
    this.fetchTrend().then(() => wx.stopPullDownRefresh());
  },

  async fetchTrend() {
    this.setData({ loading: true });
    try {
      const data = await api.weekly();
      const rows = Array.isArray(data) ? data : [];
      const trend = rows
        .slice()
        .reverse()
        .map((item) => ({
          ...item,
          attendanceText: ATTENDANCE_TEXT[item.attendance] || '未记录',
          attendanceClass: ATTENDANCE_TAG_CLASS[item.attendance] || 'tag-plain',
          homeworkText: HOMEWORK_TEXT[item.homework_status] || '未录入',
          behaviorText: BEHAVIOR_TEXT[item.class_behavior] || '正常',
        }));
      this.setData({ trend, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin?autoScan=1' });
  },

  goLeaveForm() {
    wx.navigateTo({ url: '/pages/leave-form/leave-form' });
  },
});
