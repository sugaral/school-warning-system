const { api, config } = require('../../utils/request');
const {
  ATTENDANCE_TEXT,
  ATTENDANCE_TAG_CLASS,
  HOMEWORK_TEXT,
  LEVEL_TEXT,
} = require('../../utils/format');

Page({
  data: {
    student: {},
    isBound: true,
    today: {
      date: '',
      attendanceText: '-',
      attendanceTag: 'tag-plain',
      homeworkText: '-',
      courseCount: 0,
      records: [],
    },
    warnStats: {
      total: 0,
      pending: 0,
      processing: 0,
      closed: 0,
      week: 0,
      month: 0,
      highestLevel: '',
      highestLevelText: '',
    },
    trend: [],
    messageSummary: {
      inboxUnread: 0,
      classUnread: 0,
      totalUnread: 0,
    },
  },

  onShow() {
    const token = wx.getStorageSync(config.STORAGE_TOKEN);
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.refreshAll();
  },

  onPullDownRefresh() {
    this.refreshAll().then(() => wx.stopPullDownRefresh());
  },

  async refreshAll() {
    this.loadCachedStudent();
    await Promise.all([
      this.loadProfile(),
      this.loadToday(),
      this.loadTrend(),
      this.loadWarnings(),
      this.loadMessages(),
    ]);
  },

  loadCachedStudent() {
    const student = wx.getStorageSync(config.STORAGE_STUDENT) || {};
    this.setData({ student });
  },

  async loadProfile() {
    try {
      const profile = await api.getProfile();
      if (profile && profile.id) {
        getApp().setStudent(profile);
        this.setData({
          student: profile,
          isBound: profile.is_bound !== false && Boolean(profile.class_id),
        });
      }
    } catch (e) {
      /* 保留缓存展示 */
    }
  },

  async loadToday() {
    try {
      const data = await api.today();
      const rows = Array.isArray(data && data.records) ? data.records : [];
      const attendanceCode = (data && (data.attendance_status || data.attendance)) || 'unknown';
      const homeworkCode = (data && data.homework_status) || 'unknown';

      this.setData({
        today: {
          date: (data && data.record_date) || '',
          courseCount: Number((data && data.course_count) || rows.length || 0),
          attendanceText: ATTENDANCE_TEXT[attendanceCode] || '未记录',
          attendanceTag: ATTENDANCE_TAG_CLASS[attendanceCode] || 'tag-plain',
          homeworkText: HOMEWORK_TEXT[homeworkCode] || '未录入',
          records: rows.slice(0, 3).map((item) => ({
            courseName: item.course_name || '课堂记录',
            attendanceText: ATTENDANCE_TEXT[item.attendance_status] || '未记录',
            attendanceTag: ATTENDANCE_TAG_CLASS[item.attendance_status] || 'tag-plain',
          })),
        },
      });
    } catch (e) {
      /* 保持占位 */
    }
  },

  async loadTrend() {
    try {
      const data = await api.weekly();
      const list = Array.isArray(data) ? data : [];
      const heightMap = {
        on_time: 120,
        late: 88,
        early_leave: 74,
        leave: 58,
        absent: 34,
        unknown: 22,
      };
      this.setData({
        trend: list.map((item) => {
          const status = item.attendance || 'unknown';
          return {
            date: item.date || '',
            attendance: status,
            attendanceText: ATTENDANCE_TEXT[status] || '未记录',
            height: heightMap[status] || 22,
          };
        }),
      });
    } catch (e) {
      /* ignore */
    }
  },

  async loadWarnings() {
    try {
      const [summaryRes, warnRes] = await Promise.all([
        api.summaries({ weeks: 1, months: 1 }).catch(() => null),
        api.warnings({ page: 1, pageSize: 100 }).catch(() => null),
      ]);

      const weekly = (summaryRes && summaryRes.weekly && summaryRes.weekly[0]) || {};
      const monthly = (summaryRes && summaryRes.monthly && summaryRes.monthly[0]) || {};

      const items = (warnRes && (warnRes.items || warnRes.list)) || [];
      const stats = (warnRes && warnRes.stats) || {};
      const activeLevels = items
        .filter((w) => w.status !== 'closed')
        .map((w) => w.level || w.warning_level)
        .filter(Boolean);
      const order = ['severe', 'red', 'orange', 'yellow'];
      const highest = order.find((lv) => activeLevels.indexOf(lv) !== -1) || '';

      this.setData({
        warnStats: {
          total: Number(stats.total !== undefined ? stats.total : items.length || 0),
          pending: Number(
            stats.pending !== undefined
              ? stats.pending
              : items.filter((w) => w.status === 'open' || w.status === 'pending').length,
          ),
          processing: Number(
            stats.processing !== undefined
              ? stats.processing
              : items.filter(
                  (w) =>
                    w.status === 'acknowledged' ||
                    w.status === 'student_acknowledged' ||
                    w.status === 'processing',
                ).length,
          ),
          closed: Number(
            stats.closed !== undefined
              ? stats.closed
              : items.filter((w) => w.status === 'closed').length,
          ),
          week: (weekly.late_count || 0) + (weekly.absent_count || 0),
          month: (monthly.late_count || 0) + (monthly.absent_count || 0),
          highestLevel: highest,
          highestLevelText: LEVEL_TEXT[highest] || '',
        },
      });
    } catch (e) {
      /* ignore */
    }
  },

  async loadMessages() {
    try {
      const [inboxRes, classRes] = await Promise.all([
        api.inboxUnreadCount().catch(() => ({ unread: 0 })),
        api.notifications({ page: 1, pageSize: 50 }).catch(() => ({ list: [] })),
      ]);

      const inboxUnread = Number((inboxRes && inboxRes.unread) || 0);
      const classList = Array.isArray(classRes) ? classRes : (classRes && classRes.list) || [];
      const classUnread = classList.filter((item) => item && item.is_read === false).length;

      this.setData({
        messageSummary: {
          inboxUnread,
          classUnread,
          totalUnread: inboxUnread + classUnread,
        },
      });
    } catch (e) {
      /* ignore */
    }
  },

  // ---- 页面跳转（严格学生端路径） ----
  goBindClass() {
    wx.navigateTo({ url: '/pages/bind-class/bind-class' });
  },
  goWarnings() {
    wx.switchTab({ url: '/pages/warnings/warnings' });
  },
  goSchedules() {
    wx.switchTab({ url: '/pages/schedules/schedules' });
  },
  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },
  goLeaves() {
    wx.navigateTo({ url: '/pages/leaves/leaves' });
  },
  goAppeals() {
    wx.navigateTo({ url: '/pages/appeals/appeals' });
  },
  goNotifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' });
  },
  goGrades() {
    wx.navigateTo({ url: '/pages/grades/grades' });
  },
  goSummaries() {
    wx.navigateTo({ url: '/pages/summaries/summaries' });
  },
  goAttendance() {
    wx.navigateTo({ url: '/pages/attendance/attendance' });
  },
});
