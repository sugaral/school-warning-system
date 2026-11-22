const { api } = require('../../utils/request');
const {
  getCurrentTermCode,
  shiftTermCode,
  getAcademicWeekNumber,
  formatTimeOnly,
} = require('../../utils/format');

const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

Page({
  data: {
    termOptions: [],
    termIndex: 4,
    selectedTerm: '',
    semesterStartDate: '',
    totalWeeks: 20,
    weekOptions: [{ value: '', label: '全部周次' }],
    weekIndex: 0,
    activeWeekday: 0, // 0=全部, 1..7
    weekdays: [
      { key: 0, label: '全部' },
      { key: 1, label: '周一' },
      { key: 2, label: '周二' },
      { key: 3, label: '周三' },
      { key: 4, label: '周四' },
      { key: 5, label: '周五' },
      { key: 6, label: '周六' },
      { key: 7, label: '周日' },
    ],
    contextLabel: '',
    allItems: [],
    groupedDays: [],
    unboundError: false,
    loading: true,
  },

  onLoad() {
    const baseTerm = getCurrentTermCode();
    const terms = [];
    for (let offset = -4; offset <= 4; offset += 1) {
      terms.push(shiftTermCode(baseTerm, offset));
    }
    this.setData({
      termOptions: terms,
      termIndex: 4,
      selectedTerm: baseTerm,
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.initAndLoad();
  },

  onPullDownRefresh() {
    this.initAndLoad().then(() => wx.stopPullDownRefresh());
  },

  async initAndLoad() {
    await this.loadSemesterConfig();
    await this.loadSchedules();
  },

  async loadSemesterConfig() {
    try {
      const cfg = await api.semesterConfig();
      const startDate = (cfg && cfg.semester_start_date) || '';
      const totalWeeks = Number(
        (cfg && (cfg.semester_total_weeks || cfg.default_semester_total_weeks)) || 20,
      );
      const weeks = [{ value: '', label: '全部周次' }];
      if (startDate && totalWeeks > 0) {
        for (let i = 1; i <= totalWeeks; i += 1) {
          weeks.push({ value: String(i), label: '第' + i + '周' });
        }
      }
      this.setData({
        semesterStartDate: startDate,
        totalWeeks,
        weekOptions: weeks,
      });
    } catch (e) {
      /* 使用默认配置 */
    }
  },

  async loadSchedules() {
    this.setData({ loading: true, unboundError: false });
    try {
      const data = await api.schedulesView({
        term_code: this.data.selectedTerm,
        scope: 'class',
      });
      const list = Array.isArray(data && data.list) ? data.list : [];
      const mapped = list.map((item) => {
        const start = new Date(item.session_start);
        const day = Number.isNaN(start.getTime()) ? 1 : start.getDay();
        const weekdayKey = day === 0 ? 7 : day;
        const weekNumber = getAcademicWeekNumber(item.session_start, this.data.semesterStartDate);
        const dateLabel = Number.isNaN(start.getTime())
          ? ''
          : (start.getMonth() + 1) + '/' + start.getDate();

        return {
          ...item,
          weekdayKey,
          weekdayLabel: WEEKDAY_NAMES[weekdayKey] || '',
          weekNumber: weekNumber || '',
          weekLabel: weekNumber ? '第' + weekNumber + '周' : '未设周次',
          dateLabel,
          timeRange: formatTimeOnly(item.session_start) + ' - ' + formatTimeOnly(item.session_end),
        };
      });

      this.setData({
        allItems: mapped,
        contextLabel: (data && data.context_label) || '当前班级',
        loading: false,
      });
      this.applyFilters();
    } catch (err) {
      const msg = (err && err.message) || '';
      this.setData({
        allItems: [],
        groupedDays: [],
        unboundError: msg.indexOf('未绑定') !== -1,
        loading: false,
      });
    }
  },

  onTermChange(e) {
    const idx = Number(e.detail.value) || 0;
    const term = this.data.termOptions[idx] || this.data.selectedTerm;
    this.setData(
      {
        termIndex: idx,
        selectedTerm: term,
        weekIndex: 0,
      },
      () => this.loadSchedules(),
    );
  },

  onWeekChange(e) {
    this.setData({ weekIndex: Number(e.detail.value) || 0 }, () => this.applyFilters());
  },

  onWeekdaySelect(e) {
    this.setData(
      { activeWeekday: Number(e.currentTarget.dataset.key) || 0 },
      () => this.applyFilters(),
    );
  },

  applyFilters() {
    const { allItems, weekOptions, weekIndex, activeWeekday } = this.data;
    const weekTarget = (weekOptions[weekIndex] && weekOptions[weekIndex].value) || '';

    const filtered = allItems.filter((item) => {
      if (weekTarget && String(item.weekNumber) !== String(weekTarget)) return false;
      if (activeWeekday > 0 && item.weekdayKey !== activeWeekday) return false;
      return true;
    });

    const groupsMap = {};
    filtered.forEach((item) => {
      const key = item.weekdayKey;
      if (!groupsMap[key]) {
        groupsMap[key] = {
          weekdayKey: key,
          weekdayLabel: WEEKDAY_NAMES[key] || '',
          items: [],
        };
      }
      groupsMap[key].items.push(item);
    });

    const groupedDays = Object.keys(groupsMap)
      .map((k) => groupsMap[k])
      .sort((a, b) => a.weekdayKey - b.weekdayKey);

    this.setData({ groupedDays });
  },

  goBindClass() {
    wx.navigateTo({ url: '/pages/bind-class/bind-class' });
  },
});
