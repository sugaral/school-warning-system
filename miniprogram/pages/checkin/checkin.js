const { api, toastError } = require('../../utils/request');
const { ATTENDANCE_TEXT, formatDateTime } = require('../../utils/format');

Page({
  data: {
    sessionId: '',
    scanToken: '',
    manualToken: '',
    submitting: false,
    result: null,
  },

  onLoad(options) {
    if (options && options.session_id) this.setData({ sessionId: String(options.session_id) });
    if (options && options.scan_token) this.setData({ scanToken: String(options.scan_token) });
  },

  onSessionInput(e) {
    this.setData({ sessionId: e.detail.value });
  },

  onTokenInput(e) {
    this.setData({ manualToken: e.detail.value });
  },

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
        this.setData({
          sessionId: parsed.sessionId,
          scanToken: parsed.scanToken,
          result: null,
        });
      },
      fail: () => toastError('扫码已取消'),
    });
  },

  parseQrPayload(text) {
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
  },

  onManualSubmit() {
    const { sessionId, manualToken } = this.data;
    if (!String(sessionId || '').trim()) return toastError('请输入课次 ID');
    if (!String(manualToken || '').trim()) return toastError('请输入签到口令');
    this.setData({ scanToken: String(manualToken).trim() }, () => this.doCheckin());
  },

  onConfirm() {
    this.doCheckin();
  },

  onReset() {
    this.setData({ scanToken: '', manualToken: '', result: null });
  },

  async doCheckin() {
    if (this.data.submitting) return;
    const sessionId = String(this.data.sessionId || '').trim();
    const scanToken = String(this.data.scanToken || '').trim();
    if (!sessionId || !scanToken) return toastError('缺少课次 ID 或签到口令');
    if (!/^\d+$/.test(sessionId)) return toastError('课次 ID 必须为数字');

    this.setData({ submitting: true, result: null });
    try {
      const data = await api.checkin({
        session_id: Number(sessionId),
        scan_token: scanToken,
      });
      const row = Array.isArray(data) ? data[0] : data || {};
      const statusCode = row.attendance_status || 'on_time';
      this.setData({
        result: {
          ok: true,
          message: row.is_late ? '签到成功（已记为迟到）' : '签到成功',
          status: ATTENDANCE_TEXT[statusCode] || statusCode,
          time: formatDateTime(row.checkin_time || new Date().toISOString()),
        },
      });
      wx.showToast({ title: '签到成功', icon: 'success' });
    } catch (err) {
      this.setData({
        result: { ok: false, message: (err && err.message) || '签到失败' },
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
