const { api } = require('../../utils/request');

const LEVEL_TEXT = { yellow: '黄色', orange: '橙色', red: '红色', severe: '严重' };
const METRIC_TEXT = {
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  warning_total: '累计预警',
  homework_not_submit: '作业未交',
  homework_late_submit: '作业迟交',
  class_behavior: '课堂违纪',
  leave: '请假',
};
const WINDOW_TEXT = { day: '日', week: '周', month: '月', term: '学期' };
const STATUS_TEXT = { open: '待确认', acknowledged: '已确认', closed: '已关闭', suppressed: '已豁免', escalated: '已升级' };
const STATUS_CLASS = {
  open: 'tag-warn',
  acknowledged: '',
  closed: 'tag-success',
  suppressed: 'tag-plain',
  escalated: 'tag-danger',
};
/** trigger_detail_json 中常见键的中文名 */
const DETAIL_LABEL = {
  count: '触发次数',
  late_count: '迟到次数',
  absent_count: '缺勤次数',
  early_leave_count: '早退次数',
  homework_not_submit_count: '作业未交次数',
  class_behavior_count: '课堂违纪次数',
  course_name: '课程',
  course_code: '课程代码',
  dates: '涉及日期',
  threshold: '阈值',
  window: '统计窗口',
  metric: '指标',
};

Page({
  data: {
    id: '',
    detail: null,
    detailDetails: [],
    ruleExplain: '',
    loading: true,
    confirming: false,
  },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ id });
    if (id) this.fetchDetail(id);
    else this.setData({ loading: false });
  },

  async fetchDetail(id) {
    try {
      // 学生端预警列表按 id 过滤；后端 /student/warnings 支持 id 参数时可直接命中
      const data = await api.warnings({ page: 1, pageSize: 200 });
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const raw = list.find((w) => String(w.id) === String(id)) || null;
      if (!raw) {
        this.setData({ loading: false });
        return;
      }

      const detail = {
        ...raw,
        levelText: LEVEL_TEXT[raw.level] || raw.level,
        metricText: METRIC_TEXT[raw.metric] || raw.metric,
        windowText: WINDOW_TEXT[raw.window] || raw.window,
        statusText: STATUS_TEXT[raw.status] || raw.status,
        statusClass: STATUS_CLASS[raw.status] || 'tag-plain',
        periodText: [raw.period_start, raw.period_end]
          .filter(Boolean)
          .map((d) => String(d).slice(0, 10))
          .join(' ~ '),
        createdText: raw.created_at ? String(raw.created_at).slice(0, 16).replace('T', ' ') : '',
        acknowledgedText: raw.acknowledged_at
          ? String(raw.acknowledged_at).slice(0, 16).replace('T', ' ')
          : '',
      };

      this.setData({
        detail,
        detailDetails: this.buildDetailRows(raw.trigger_detail_json),
        ruleExplain: this.buildRuleExplain(raw),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  /** 把 trigger_detail_json 展平为「标签 - 值」行，值里的数组转成逗号串 */
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
      const val = obj[key];
      if (val === null || val === undefined || val === '') return;
      let text;
      if (Array.isArray(val)) text = val.join('、');
      else if (typeof val === 'object') text = JSON.stringify(val);
      else text = String(val);
      rows.push({ label: DETAIL_LABEL[key] || key, value: text });
    });
    return rows;
  },

  /**
   * 用规则快照生成"人话"说明。
   * 后端在生成预警时把生效规则整体冻结进 warnings.rule_snapshot_json，
   * 因此即使之后改了规则，这条预警的解释也不会变。
   */
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

    return `该预警由【${scopeText}】规则触发：窗口=${win}，指标=${metric}，阈值 ≥ ${threshold}，等级=${level}，版本 v${version}。`;
  },

  async onConfirm() {
    this.setData({ confirming: true });
    try {
      await api.confirmWarning(this.data.id);
      wx.showToast({ title: '已确认收到', icon: 'success' });
      // 同步更新本地展示，避免必须返回列表才能看到状态变化
      this.setData({
        'detail.status': 'acknowledged',
        'detail.statusText': STATUS_TEXT.acknowledged,
        'detail.statusClass': STATUS_CLASS.acknowledged,
      });
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ confirming: false });
    }
  },
});
