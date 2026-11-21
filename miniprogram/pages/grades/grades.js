const { api } = require('../../utils/request');
const { PASS_STATUS_TEXT, PASS_STATUS_CLASS } = require('../../utils/format');

Page({
  data: {
    allItems: [],
    items: [],
    stats: { total: 0, passed: 0, failed: 0, earned_credits: 0 },
    terms: ['全部学期'],
    termIndex: 0,
    loading: true,
  },

  onLoad() {
    this.fetchGrades();
  },

  onPullDownRefresh() {
    this.fetchGrades().then(() => wx.stopPullDownRefresh());
  },

  async fetchGrades() {
    this.setData({ loading: true });
    try {
      const data = await api.grades();
      const rawList = (data && data.list) || [];
      const mapped = rawList.map((item) => ({
        ...item,
        passText: PASS_STATUS_TEXT[item.pass_status] || item.pass_status || '待定',
        passClass: PASS_STATUS_CLASS[item.pass_status] || 'tag-plain',
      }));

      const termSet = {};
      const terms = ['全部学期'];
      mapped.forEach((item) => {
        if (item.term_code && !termSet[item.term_code]) {
          termSet[item.term_code] = true;
          terms.push(item.term_code);
        }
      });

      this.setData({
        allItems: mapped,
        terms,
        loading: false,
      });
      this.applyTermFilter();
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  onTermChange(e) {
    this.setData({ termIndex: Number(e.detail.value) || 0 }, () => this.applyTermFilter());
  },

  applyTermFilter() {
    const { allItems, terms, termIndex } = this.data;
    const pickedTerm = terms[termIndex] || '全部学期';
    const items =
      termIndex === 0 || pickedTerm === '全部学期'
        ? allItems
        : allItems.filter((item) => item.term_code === pickedTerm);

    const passed = items.filter((item) => item.pass_status === 'pass').length;
    const failed = items.filter((item) => item.pass_status === 'fail').length;
    const earnedCredits = items
      .filter((item) => item.pass_status === 'pass')
      .reduce((sum, item) => sum + (Number(item.credit) || 0), 0);

    this.setData({
      items,
      stats: {
        total: items.length,
        passed,
        failed,
        earned_credits: Number(earnedCredits.toFixed(1)),
      },
    });
  },
});
