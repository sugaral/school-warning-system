/**
 * 学生端共享格式化与状态映射工具
 * 保持与 admin-frontend 端完全一致的文案与语义等级着色。
 */

const ATTENDANCE_TEXT = {
  on_time: '正常',
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  leave: '请假',
  unknown: '未记录',
};

const ATTENDANCE_TAG_CLASS = {
  on_time: 'tag-success',
  late: 'tag-warn',
  early_leave: 'tag-warn',
  leave: 'tag-info',
  absent: 'tag-danger',
  unknown: 'tag-plain',
};

const HOMEWORK_TEXT = {
  submitted: '已交',
  not_submit: '未交',
  late_submit: '迟交',
  unknown: '未录入',
};

const BEHAVIOR_TEXT = {
  normal: '正常',
  disruptive: '课堂违纪',
};

const LEVEL_TEXT = {
  yellow: '黄色预警',
  orange: '橙色预警',
  red: '红色预警',
  severe: '严重预警',
};

const LEVEL_SHORT_TEXT = {
  yellow: '黄色',
  orange: '橙色',
  red: '红色',
  severe: '严重',
};

const METRIC_TEXT = {
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  warning_total: '累计预警',
  homework_not_submit: '作业未交',
  homework_late_submit: '作业迟交',
  class_behavior: '课堂违纪',
  leave: '请假',
  failed_courses: '挂科门数',
  credits: '已修学分',
  gpa: '平均绩点',
  unacknowledged: '未确认预警',
};

const WINDOW_TEXT = {
  day: '日',
  week: '周',
  month: '月',
  term: '学期',
};

const WARNING_STATUS_TEXT = {
  open: '待确认',
  pending: '待确认',
  student_acknowledged: '已确认',
  acknowledged: '已确认',
  processing: '已确认',
  closed: '已关闭',
  suppressed: '已豁免',
  escalated: '已升级',
};

const WARNING_STATUS_CLASS = {
  open: 'tag-warn',
  pending: 'tag-warn',
  student_acknowledged: 'tag-success',
  acknowledged: 'tag-success',
  processing: 'tag-success',
  closed: 'tag-plain',
  suppressed: 'tag-plain',
  escalated: 'tag-danger',
};

const LEAVE_STATUS_TEXT = {
  submitted: '待审批',
  approved: '已通过',
  rejected: '已驳回',
};

const LEAVE_STATUS_CLASS = {
  submitted: 'tag-warn',
  approved: 'tag-success',
  rejected: 'tag-danger',
};

const APPEAL_STATUS_TEXT = {
  submitted: '待处理',
  resolved: '已受理',
  approved: '已通过',
  rejected: '已驳回',
};

const APPEAL_STATUS_CLASS = {
  submitted: 'tag-warn',
  resolved: 'tag-success',
  approved: 'tag-success',
  rejected: 'tag-danger',
};

const CLASS_CHANGE_STATUS_TEXT = {
  pending_head: '待班主任审核',
  pending_head_teacher: '待班主任审核',
  pending_dean: '待副院长审批',
  pending_vice_dean: '待副院长审批',
  approved: '已通过',
  rejected: '已驳回',
};

const CLASS_CHANGE_STATUS_CLASS = {
  pending_head: 'tag-warn',
  pending_head_teacher: 'tag-warn',
  pending_dean: 'tag-info',
  pending_vice_dean: 'tag-info',
  approved: 'tag-success',
  rejected: 'tag-danger',
};

const PASS_STATUS_TEXT = {
  pass: '通过',
  fail: '未通过',
  unknown: '待定',
};

const PASS_STATUS_CLASS = {
  pass: 'tag-success',
  fail: 'tag-danger',
  unknown: 'tag-plain',
};

const INBOX_TYPE_CLASS = {
  warning_red: 'tag-danger',
  warning_severe: 'tag-danger',
  warning_orange: 'tag-warn',
  warning_yellow: 'tag-amber',
  class_notice: 'tag-info',
  system: 'tag-plain',
};

function padZero(num) {
  return num < 10 ? '0' + num : String(num);
}

/** 解析常见日期（ISO、MySQL DATETIME 或已被 formatDateTime 格式化过的中文字串） */
function formatDateTime(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(str)) {
    return str;
  }
  // 兼容 iOS JavaScriptCore：把 "YYYY-MM-DD HH:mm:ss" 转为 "YYYY/MM/DD HH:mm:ss"
  const safe = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)
    ? str.replace(/-/g, '/')
    : /^\d{4}-\d{2}-\d{2}$/.test(str)
      ? str.replace(/-/g, '/')
      : str;
  const date = new Date(safe);
  if (Number.isNaN(date.getTime())) {
    return str.slice(0, 16).replace('T', ' ');
  }
  return (
    date.getFullYear() +
    '-' +
    padZero(date.getMonth() + 1) +
    '-' +
    padZero(date.getDate()) +
    ' ' +
    padZero(date.getHours()) +
    ':' +
    padZero(date.getMinutes())
  );
}

function formatDateOnly(value) {
  if (!value) return '';
  const formatted = formatDateTime(value);
  return formatted ? formatted.slice(0, 10) : String(value).slice(0, 10);
}

function formatTimeOnly(value) {
  if (!value) return '';
  const str = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str) ? str.replace(/-/g, '/') : str);
  if (Number.isNaN(date.getTime())) {
    return str.slice(11, 16);
  }
  return padZero(date.getHours()) + ':' + padZero(date.getMinutes());
}

function normalizeFileIds(list, single) {
  const seen = {};
  const result = [];
  const pushVal = (v) => {
    if (Array.isArray(v)) {
      v.forEach(pushVal);
      return;
    }
    const id = String(v || '').trim();
    if (/^\d+$/.test(id) && !seen[id]) {
      seen[id] = true;
      result.push(id);
    }
  };
  pushVal(single);
  pushVal(list);
  return result;
}

function getCurrentTermCode() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 2 && month <= 7) return year + '-SPRING';
  if (month >= 8) return year + '-FALL';
  return (year - 1) + '-FALL';
}

function shiftTermCode(termCode, offset) {
  const match = /^(\d{4})-(SPRING|FALL)$/.exec(String(termCode || '').trim().toUpperCase());
  if (!match) return String(termCode || '');
  let year = Number(match[1]);
  let season = match[2];
  let rem = offset;
  while (rem > 0) {
    if (season === 'SPRING') {
      season = 'FALL';
    } else {
      season = 'SPRING';
      year += 1;
    }
    rem -= 1;
  }
  while (rem < 0) {
    if (season === 'FALL') {
      season = 'SPRING';
    } else {
      season = 'FALL';
      year -= 1;
    }
    rem += 1;
  }
  return year + '-' + season;
}

function startOfWeekMonday(dateInput) {
  const str = String(dateInput || '').trim();
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(str) ? str.replace(/-/g, '/') : dateInput;
  const date = new Date(safe);
  date.setHours(0, 0, 0, 0);
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

function getAcademicWeekNumber(dateInput, semesterStartDate) {
  if (!semesterStartDate) return null;
  const base = startOfWeekMonday(semesterStartDate);
  const current = startOfWeekMonday(dateInput);
  if (Number.isNaN(base.getTime()) || Number.isNaN(current.getTime())) return null;
  const diffDays = Math.max(0, Math.floor((current.getTime() - base.getTime()) / (24 * 60 * 60 * 1000)));
  return Math.floor(diffDays / 7) + 1;
}

function parseCheckinQrPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      const sid = obj.session_id || obj.sessionId || obj.id;
      const tok = obj.scan_token || obj.scanToken || obj.token;
      if (sid && tok) return { sessionId: String(sid), scanToken: String(tok) };
    } catch (e) {
      /* continue */
    }
  }

  const qsIndex = raw.indexOf('?');
  const queryPart = qsIndex >= 0 ? raw.slice(qsIndex + 1) : raw;
  const params = {};
  queryPart.split('&').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      params[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    }
  });
  const sid = params.session_id || params.sessionId;
  const tok = params.scan_token || params.scanToken || params.token;
  if (sid && tok) return { sessionId: String(sid), scanToken: String(tok) };

  if (raw.indexOf('|') > 0) {
    const parts = raw.split('|');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { sessionId: String(parts[0]), scanToken: String(parts[1]) };
    }
  }

  return null;
}

module.exports = {
  ATTENDANCE_TEXT,
  ATTENDANCE_TAG_CLASS,
  HOMEWORK_TEXT,
  BEHAVIOR_TEXT,
  LEVEL_TEXT,
  LEVEL_SHORT_TEXT,
  METRIC_TEXT,
  WINDOW_TEXT,
  WARNING_STATUS_TEXT,
  WARNING_STATUS_CLASS,
  LEAVE_STATUS_TEXT,
  LEAVE_STATUS_CLASS,
  APPEAL_STATUS_TEXT,
  APPEAL_STATUS_CLASS,
  CLASS_CHANGE_STATUS_TEXT,
  CLASS_CHANGE_STATUS_CLASS,
  PASS_STATUS_TEXT,
  PASS_STATUS_CLASS,
  INBOX_TYPE_CLASS,
  formatDateTime,
  formatDateOnly,
  formatTimeOnly,
  normalizeFileIds,
  getCurrentTermCode,
  shiftTermCode,
  getAcademicWeekNumber,
  parseCheckinQrPayload,
};
