const { api, toastError } = require('../../utils/request');
const { ATTENDANCE_TEXT, formatDateTime, parseCheckinQrPayload } = require('../../utils/format');

Page({
  data: {
    sessionId: '',
    scanToken: '',
    submitting: false,
    result: null,
  },

  onLoad(options) {
    if (options && options.session_id && options.scan_token) {
      this.setData(
        {
          sessionId: String(options.session_id),
          scanToken: String(options.scan_token),
          result: null,
        },
        () => {
          if (options.auto === '1') {
            this.doCheckin();
          }
        },
      );
      return;
    }

    if (options && options.session_id) {
      this.setData({ sessionId: String(options.session_id) });
    }
    if (options && options.scan_token) {
      this.setData({ scanToken: String(options.scan_token) });
    }

    if (options && options.autoScan === '1') {
      this.onScan();
    }
  },

  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const parsed = parseCheckinQrPayload(res.result || res.path || '');
        if (!parsed) {
          toastError('二维码内容无法识别，请确认是课堂签到码');
          return;
        }
        this.setData(
          {
            sessionId: parsed.sessionId,
            scanToken: parsed.scanToken,
            result: null,
          },
          () => this.doCheckin(),
        );
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '').toLowerCase();
        if (msg.indexOf('cancel') === -1) {
          toastError('扫码失败，请重试');
        }
      },
    });
  },

  onReset() {
    this.setData({ scanToken: '', result: null }, () => this.onScan());
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
