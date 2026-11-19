const { api, config } = require('../../utils/request');

/** 考勤状态中文与展示映射 */
const ATTENDANCE_TEXT = {
  on_time: '正常',
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  leave: '请假',
};
const HOMEWORK_TEXT = {
  submitted: '已交',
  not_submit: '未交',
  late_submit: '迟交',
  unknown: '未知',
};
const LEVEL_TEXT = {
  yellow: '黄色',
  orange: '橙色',
  red: '红色',
  severe: '严重',
};

Page({
  data: {
    student: {},
    today: {},
    warnStats: {},
    trend: [],
    notifyStat: null,
  },

  onShow() {
    this.loadStudent();
    this.loadToday();
    this.loadTrend();
    this.loadWarnings();
    this.loadNotifyStat();
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadToday(),
      this.loadTrend(),
      this.loadWarnings(),
      this.loadNotifyStat(),
    ]).then(() => wx.stopPullDownRefresh());
  },

  loadStudent() {
    const student = wx.getStorageSync(config.STORAGE_STUDENT) || {};
    this.setData({ student });
  },

  /** 今日考勤与作业 */
  async loadToday() {
    try {
      const data = await api.today();
      // 后端 /student/today 的返回可能是单条或数组（一天多门课，每门一行）
      const rows = Array.isArray(data) ? data : data && data.records ? data.records : [data || {}];
      const first = rows[0] || {};
      const hasAbsent = rows.some((r) => r && r.attendance_status === 'absent');
      const hasLate = rows.some((r) => r && r.attendance_status === 'late');
      const hasNotSubmit = rows.some((r) => r && r.homework_status === 'not_submit');
      this.setData({
        today: {
          date: first.record_date ? String(first.record_date).slice(0, 10) : '',
          courseCount: rows.filter((r) => r && r.course_id).length,
          attendanceText: hasAbsent
            ? '缺勤'
            : hasLate
              ? '迟到'
              : ATTENDANCE_TEXT[first.attendance_status] || '—',
          homeworkText: hasNotSubmit
            ? '未交'
            : HOMEWORK_TEXT[first.homework_status] || '—',
        },
      });
    } catch (e) {
      /* 保持占位 */
    }
  },

  /** 近 7 天考勤趋势（把状态映射为柱高，避免引入图表库） */
  async loadTrend() {
    try {
      const data = await api.weekly();
      const list = Array.isArray(data) ? data : [];
      const heightMap = { on_time: 120, late: 90, early_leave: 70, leave: 50, absent: 30, unknown: 20 };
      this.setData({
        trend: list.map((item) => ({
          date: item.date || '',
          attendance: item.attendance || 'unknown',
          height: heightMap[item.attendance] || 20,
        })),
      });
    } catch (e) {
      /* ignore */
    }
  },

  /** 预警统计：读汇总快照 + 列表总数，避免逐条统计 */
  async loadWarnings() {
    try {
      const data = await api.summaries({ weeks: 1, months: 1 });
      const weekly = (data && data.weekly && data.weekly[0]) || {};
      const monthly = (data && data.monthly && data.monthly[0]) || {};

      const listData = await api.warnings({ page: 1, pageSize: 100 });
      const list = Array.isArray(listData) ? listData : (listData && listData.list) || [];
      const total = (listData && listData.total) || list.length;
      const unconfirmed = list.filter((w) => w.status === 'open').length;
      const levels = list.map((w) => w.level).filter(Boolean);
      const order = ['severe', 'red', 'orange', 'yellow'];
      const highest = order.find((lv) => levels.indexOf(lv) !== -1) || '';

      this.setData({
        warnStats: {
          today: 0,
          week: (weekly.late_count || 0) + (weekly.absent_count || 0),
          month: (monthly.late_count || 0) + (monthly.absent_count || 0),
          unconfirmed,
          total,
          highestLevel: highest,
          highestLevelText: LEVEL_TEXT[highest] || '',
        },
      });
    } catch (e) {
      /* ignore */
    }
  },

  /** 通知到达/确认状态（用通知日志统计） */
  async loadNotifyStat() {
    try {
      const data = await api.notifications({ page: 1, pageSize: 50 });
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      if (list.length === 0) {
        this.setData({ notifyStat: null });
        return;
      }
      const acknowledged = list.filter((n) => n.read_at).length;
      this.setData({
        notifyStat: {
          success: list.length,
          acknowledged,
          pending: list.length - acknowledged,
        },
      });
    } catch (e) {
      this.setData({ notifyStat: null });
    }
  },

  // ---- 跳转 ----
  goWarnings() {
    wx.switchTab({ url: '/pages/warnings/warnings' });
  },
  goCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },
  goLeave() {
    wx.navigateTo({ url: '/pages/leave-form/leave-form' });
  },
  goSummaries() {
    wx.navigateTo({ url: '/pages/summaries/summaries' });
  },
  goNotifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' });
  },
});
