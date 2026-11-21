const { api } = require('../../utils/request');
const {
  LEVEL_SHORT_TEXT,
  METRIC_TEXT,
  WINDOW_TEXT,
  WARNING_STATUS_TEXT,
  WARNING_STATUS_CLASS,
  formatDateTime,
  formatDateOnly,
} = require('../../utils/format');

Page({
  data: {
    items: [],
    stats: { total: 0, pending: 0, processing: 0, closed: 0 },
    courses: [{ id: 'all', course_name: '全部课程' }],
    courseIndex: 0,
    courseId: 'all',
    level: '',
    status: '',
    loading: true,
  },

  onShow() {
    this.loadCourses();
    this.fetchList();
  },

  onPullDownRefresh() {
    Promise.all([this.loadCourses(), this.fetchList()]).then(() => wx.stopPullDownRefresh());
  },

  async loadCourses() {
    try {
      const data = await api.courses();
      const rows = Array.isArray(data) ? data : [];
      this.setData({
        courses: [{ id: 'all', course_name: '全部课程' }].concat(rows),
      });
    } catch (e) {
      /* ignore */
    }
  },

  onCourseChange(e) {
    const idx = Number(e.detail.value) || 0;
    const picked = this.data.courses[idx] || { id: 'all' };
    this.setData(
      {
        courseIndex: idx,
        courseId: picked.id || 'all',
      },
      () => this.fetchList(),
    );
  },

  onFilter(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ [key]: value }, () => this.fetchList());
  },

  async fetchList() {
    this.setData({ loading: true });
    const params = {};
    if (this.data.level) params.level = this.data.level;
    if (this.data.status) params.status = this.data.status;
    if (this.data.courseId && this.data.courseId !== 'all') params.course_id = this.data.courseId;

    try {
      const data = await api.warnings(params);
      const list = Array.isArray(data) ? data : (data && (data.items || data.list)) || [];
      const stats = (data && data.stats) || {
        total: list.length,
        pending: list.filter((w) => w.status === 'open').length,
        processing: list.filter(
          (w) => w.status === 'acknowledged' || w.status === 'student_acknowledged',
        ).length,
        closed: list.filter((w) => w.status === 'closed').length,
      };

      const mapped = list.map((w) => {
        const level = w.level || w.warning_level || '';
        const periodStart = formatDateOnly(w.period_start_raw || w.period_start);
        const periodEnd = formatDateOnly(w.period_end_raw || w.period_end);
        return {
          ...w,
          level,
          levelText: LEVEL_SHORT_TEXT[level] || w.level_text || level,
          metricText: METRIC_TEXT[w.metric] || w.violation_type || '学业预警',
          windowText: WINDOW_TEXT[w.window] || w.window_text || w.window || '',
          statusText: WARNING_STATUS_TEXT[w.status] || w.status_text || w.status,
          statusClass: WARNING_STATUS_CLASS[w.status] || 'tag-plain',
          canConfirm: w.status === 'open' || w.status === 'pending',
          canAppeal: w.status !== 'closed',
          periodText: [periodStart, periodEnd].filter(Boolean).join(' ~ ') || w.period_start || '',
          createdText: formatDateTime(w.created_at_raw || w.created_at),
        };
      });

      this.setData({
        items: mapped,
        stats,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  async onQuickConfirm(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    try {
      await api.confirmWarning(id);
      wx.showToast({ title: '确认成功', icon: 'success' });
      this.fetchList();
    } catch (err) {
      /* request 层已提示 */
    }
  },

  onQuickAppeal(e) {
    const { id, course, reason } = e.currentTarget.dataset;
    const qs =
      'warning_id=' +
      encodeURIComponent(String(id || '')) +
      '&course_name=' +
      encodeURIComponent(String(course || '')) +
      '&warning_reason=' +
      encodeURIComponent(String(reason || ''));
    wx.navigateTo({ url: '/pages/appeal-form/appeal-form?' + qs });
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/warning-detail/warning-detail?id=' + e.currentTarget.dataset.id,
    });
  },
});
