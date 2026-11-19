const { api, toastError } = require('../../utils/request');

/** 考勤状态中文映射，与后端 attendance_status 取值对应 */
const STATUS_TEXT = {
  on_time: '正常',
  late: '迟到',
  early_leave: '早退',
  absent: '缺勤',
  leave: '请假',
};

Page({
  data: {
    sessionId: '',
    scanToken: '',
    manualToken: '',
    submitting: false,
    result: null,
  },

  onLoad(options) {
    // 支持从其它页面带参进入：?session_id=123&scan_token=xxx
    if (options.session_id) this.setData({ sessionId: String(options.session_id) });
    if (options.scan_token) this.setData({ scanToken: String(options.scan_token) });
  },

  onSessionInput(e) {
    this.setData({ sessionId: e.detail.value });
  },
  onTokenInput(e) {
    this.setData({ manualToken: e.detail.value });
  },

  /** 调用微信扫码；二维码内容约定为 URL 或 JSON */
  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const parsed = this.parseQrPayload(res.result || res.path || '');
        if (!parsed) {
          toastError('二维码内容无法识别，请确认是课堂签到码');
          return;
        }
        this.setData({ sessionId: parsed.sessionId, scanToken: parsed.scanToken });
      },
      fail: () => toastError('扫码已取消'),
    });
  },

  /**
   * 解析二维码载荷。兼容三种形态：
   *  1. JSON:  {"session_id":1,"scan_token":"abc"}
   *  2. URL:   https://x/checkin?session_id=1&scan_token=abc
   *  3. 自定义: "1|abc"
   */
  parseQrPayload(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    // 1) JSON
    if (raw.startsWith('{')) {
      try {
        const obj = JSON.parse(raw);
        const sid = obj.session_id || obj.sessionId || obj.id;
        const tok = obj.scan_token || obj.scanToken || obj.token;
        if (sid && tok) return { sessionId: String(sid), scanToken: String(tok) };
      } catch (e) {
        /* 继续尝试其它格式 */
      }
    }

    // 2) URL 查询串
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

    // 3) "1|abc"
    if (raw.indexOf('|') > 0) {
      const parts = raw.split('|');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return { sessionId: String(parts[0]), scanToken: String(parts[1]) };
      }
    }

    return null;
  },

  onManualSubmit() {
    const { sessionId, manualToken } = this.data;
    if (!sessionId) return toastError('请输入课次 ID');
    if (!manualToken) return toastError('请输入签到口令');
    this.setData({ scanToken: manualToken }, () => this.doCheckin());
  },

  onConfirm() {
    this.doCheckin();
  },

  onReset() {
    this.setData({ scanToken: '', manualToken: '', result: null });
  },

  /**
   * 提交签到。
   * ⚠️ 该接口挂了幂等（Idempotency-Key）：重复点击不会产生重复记录，
   *    这里仍用 submitting 做前置保护，减少无谓请求。
   */
  async doCheckin() {
    if (this.data.submitting) return;
    const { sessionId, scanToken } = this.data;
    if (!sessionId || !scanToken) return toastError('缺少课次或口令');

    this.setData({ submitting: true, result: null });
    try {
      const data = await api.checkin({
        // 后端 DTO 声明 session_id 为 bigint|number，仍以数字提交
        session_id: Number(sessionId),
        scan_token: scanToken,
      });
      const row = Array.isArray(data) ? data[0] : data || {};
      this.setData({
        result: {
          ok: true,
          message: '签到成功',
          status: STATUS_TEXT[row.attendance_status] || row.attendance_status || '',
          time: row.checkin_time ? String(row.checkin_time).slice(0, 19).replace('T', ' ') : '',
        },
      });
      wx.showToast({ title: '签到成功', icon: 'success' });
    } catch (err) {
      // 业务错误码（如 4007 已过签到时间 / 4008 口令无效）在 message 里
      this.setData({
        result: { ok: false, message: err.message || '签到失败' },
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
