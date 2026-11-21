const { api } = require('../../utils/request');
const {
  LEVEL_TEXT,
  METRIC_TEXT,
  WINDOW_TEXT,
  WARNING_STATUS_TEXT,
  WARNING_STATUS_CLASS,
  formatDateTime,
  formatDateOnly,
} = require('../../utils/format');

const DETAIL_LABEL = {
  count: '触发次数',
  late_count: '迟到次数',
  absent_count: '缺勤次数',
  early_leave_count: '早退次数',
  leave_count: '请假次数',
  homework_not_submit_count: '作业未交次数',
  homework_late_submit_count: '作业迟交次数',
  class_behavior_count: '课堂违纪次数',
  violation_count: '累计触发值',
  violation_type: '异常类型',
  violation_time: '异常发生时间',
  course_name: '关联课程',
  course_code: '课程代码',
  dates: '涉及日期',
  threshold: '触发阈值',
  window: '统计窗口',
  metric: '预警指标',
};

const HIDDEN_DETAIL_KEYS = { course_id: true };

Page({
  data: {
    id: '',
    detail: null,
    detailRows: [],
    ruleExplain: '',
    loading: true,
    confirming: false,
  },

  onLoad(options) {
    const id = (options && options.id) || '';
    this.setData({ id });
    if (id) this.fetchDetail(id);
    else this.setData({ loading: false });
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const data = await api.warnings({ id });
      const list = Array.isArray(data) ? data : (data && (data.items || data.list)) || [];
      const raw = list.find((w) => String(w.id) === String(id)) || list[0] || null;
      if (!raw) {
        this.setData({ detail: null, loading: false });
        return;
      }

      const level = raw.level || raw.warning_level || '';
      const detail = {
        ...raw,
        level,
        levelText: LEVEL_TEXT[level] || raw.level_text || level,
        metricText: METRIC_TEXT[raw.metric] || raw.violation_type || '学业预警',
        windowText: WINDOW_TEXT[raw.window] || raw.window_text || raw.window || '',
        statusText: WARNING_STATUS_TEXT[raw.status] || raw.status_text || raw.status,
        statusClass: WARNING_STATUS_CLASS[raw.status] || 'tag-plain',
        canConfirm: raw.status === 'open' || raw.status === 'pending',
        canAppeal: raw.status !== 'closed',
        periodText:
          [formatDateOnly(raw.period_start_raw || raw.period_start), formatDateOnly(raw.period_end_raw || raw.period_end)]
            .filter(Boolean)
            .join(' ~ ') || raw.period_start || '',
        createdText: formatDateTime(raw.created_at_raw || raw.created_at),
        acknowledgedText: formatDateTime(raw.acknowledged_at_raw || raw.acknowledged_at),
      };

      this.setData({
        detail,
        detailRows: this.buildDetailRows(raw.trigger_detail_json),
        ruleExplain: this.buildRuleExplain(raw),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  buildDetailRows(detailJson) {
    let obj = detailJson;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch (e) {
        return [];
      }
    }
    if (!obj || typeof obj !== 'object') return [];
    const rows = [];
    Object.keys(obj).forEach((key) => {
      if (HIDDEN_DETAIL_KEYS[key]) return;
      const val = obj[key];
      if (val === null || val === undefined || val === '') return;
      let text;
      if (Array.isArray(val)) text = val.join('、');
      else if (typeof val === 'object') text = JSON.stringify(val);
      else if (key === 'metric') text = METRIC_TEXT[val] || String(val);
      else if (key === 'window') text = WINDOW_TEXT[val] || String(val);
      else text = String(val);
      rows.push({ label: DETAIL_LABEL[key] || key, value: text });
    });
    return rows;
  },

  buildRuleExplain(raw) {
    let snap = raw.rule_snapshot_json;
    if (typeof snap === 'string') {
      try {
        snap = JSON.parse(snap);
      } catch (e) {
        return '';
      }
    }
    if (!snap || typeof snap !== 'object') return '';

    const scopeText = snap.scope === 'college' ? '学院覆盖' : '学校默认';
    const metric = METRIC_TEXT[snap.metric] || snap.metric || '';
    const win = WINDOW_TEXT[snap.window] || snap.window || '';
    const threshold = snap.threshold !== undefined ? snap.threshold : '?';
    const version = snap.rule_version !== undefined ? snap.rule_version : '?';
    const level = LEVEL_TEXT[snap.level] || snap.level || '';

    return `由【${scopeText}】规则触发：统计窗口=${win}，考核指标=${metric}，阈值=${threshold}，预警等级=${level}，规则版本 v${version}。`;
  },

  async onConfirm() {
    this.setData({ confirming: true });
    try {
      await api.confirmWarning(this.data.id);
      wx.showToast({ title: '已确认收到', icon: 'success' });
      await this.fetchDetail(this.data.id);
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ confirming: false });
    }
  },

  goAppeal() {
    const d = this.data.detail || {};
    const qs =
      'warning_id=' +
      encodeURIComponent(String(d.id || this.data.id || '')) +
      '&course_name=' +
      encodeURIComponent(String(d.course_name || '')) +
      '&warning_reason=' +
      encodeURIComponent(String(d.trigger_summary || d.warning_reason || ''));
    wx.navigateTo({ url: '/pages/appeal-form/appeal-form?' + qs });
  },
});
