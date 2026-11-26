const { api, uploadFile, toastError } = require('../../utils/request');
const { ATTENDANCE_TEXT, formatDateTime, parseCheckinQrPayload } = require('../../utils/format');

const MODE_NAMES = {
  qr: '扫码签到',
  photo: '拍照签到',
  gesture: '手势签到',
  location: '定位签到',
};

const GESTURE_DOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((pt) => {
  const col = (pt - 1) % 3;
  const row = Math.floor((pt - 1) / 3);
  return {
    pt,
    cx: Number((((col + 0.5) / 3) * 100).toFixed(4)),
    cy: Number((((row + 0.5) / 3) * 100).toFixed(4)),
  };
});

const GESTURE_DOT_MAP = GESTURE_DOTS.reduce((acc, item) => {
  acc[item.pt] = item;
  return acc;
}, {});

const GESTURE_MID_MAP = {
  '1-3': 2,
  '3-1': 2,
  '1-7': 4,
  '7-1': 4,
  '1-9': 5,
  '9-1': 5,
  '2-8': 5,
  '8-2': 5,
  '3-7': 5,
  '7-3': 5,
  '3-9': 6,
  '9-3': 6,
  '4-6': 5,
  '6-4': 5,
  '7-9': 8,
  '9-7': 8,
};

function buildGestureLine(ax, ay, bx, by, key) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    key,
    x: Number(ax.toFixed(4)),
    y: Number(ay.toFixed(4)),
    len: Number(len.toFixed(4)),
    angle: Number(angle.toFixed(2)),
  };
}

const MAX_GESTURE_POINTS = 25;

function buildGestureLines(points) {
  const lines = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = GESTURE_DOT_MAP[points[i]];
    const b = GESTURE_DOT_MAP[points[i + 1]];
    if (a && b) {
      lines.push(buildGestureLine(a.cx, a.cy, b.cx, b.cy, i + '-' + a.pt + '-' + b.pt));
    }
  }
  return lines;
}

function appendGestureWithBridge(curPts, nextPt) {
  if (!nextPt || curPts.length >= MAX_GESTURE_POINTS || curPts[curPts.length - 1] === nextPt) {
    return curPts;
  }
  const next = curPts.slice();
  if (next.length > 0) {
    const last = next[next.length - 1];
    const mid = GESTURE_MID_MAP[last + '-' + nextPt];
    if (mid && mid !== last && next.length < MAX_GESTURE_POINTS) {
      next.push(mid);
    }
  }
  if (next[next.length - 1] !== nextPt && next.length < MAX_GESTURE_POINTS) {
    next.push(nextPt);
  }
  return next;
}

Page({
  data: {
    modeNames: MODE_NAMES,
    sessions: [],
    selectedSession: null,
    availableModes: ['qr'],
    activeMode: 'qr',
    loadingSessions: false,

    // qr
    sessionId: '',
    scanToken: '',

    // photo
    photoTempPath: '',
    photoFileId: '',

    // gesture
    gestureDots: GESTURE_DOTS,
    gesturePoints: [],
    gestureMap: {},
    gestureMultiMap: {},
    gestureLines: [],
    gestureLiveLine: null,
    gesturePattern: '',

    // location
    latitude: null,
    longitude: null,
    locating: false,

    submitting: false,
    result: null,
  },

  onLoad(options) {
    if (options && options.session_id && options.scan_token) {
      this.setData(
        {
          sessionId: String(options.session_id),
          scanToken: String(options.scan_token),
          activeMode: 'qr',
          result: null,
        },
        () => {
          if (options.auto === '1') {
            this.doCheckin({
              session_id: this.data.sessionId,
              scan_token: this.data.scanToken,
              checkin_mode: 'qr',
            });
          }
        },
      );
    } else if (options && options.autoScan === '1') {
      this.onScan();
    }
    this._loadedOnce = true;
    this.loadActiveSessions();
  },

  onReady() {
    this.measureGesturePad();
  },

  onShow() {
    if (this._loadedOnce && this._showSkipFirst) {
      this.loadActiveSessions();
    }
    this._showSkipFirst = true;
  },

  async loadActiveSessions() {
    this.setData({ loadingSessions: true });
    try {
      const list = await api.activeCheckinSessions();
      const sessions = Array.isArray(list) ? list : [];
      let picked = this.data.selectedSession
        ? sessions.find((s) => s.session_id === this.data.selectedSession.session_id)
        : null;
      if (!picked && this.data.sessionId) {
        picked = sessions.find((s) => String(s.session_id) === String(this.data.sessionId)) || null;
      }
      if (!picked && sessions.length > 0) {
        picked = sessions[0];
      }
      const modes = picked && Array.isArray(picked.checkin_modes) && picked.checkin_modes.length
        ? picked.checkin_modes
        : ['qr'];
      const nextMode = modes.indexOf(this.data.activeMode) !== -1 ? this.data.activeMode : modes[0];
      this.setData(
        {
          sessions,
          selectedSession: picked,
          sessionId: picked ? picked.session_id : this.data.sessionId,
          availableModes: modes,
          activeMode: nextMode,
          loadingSessions: false,
        },
        () => {
          if (nextMode === 'gesture') {
            setTimeout(() => this.measureGesturePad(), 50);
          }
        },
      );
    } catch (e) {
      this.setData({ loadingSessions: false });
    }
  },

  selectSession(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const picked = this.data.sessions[idx];
    if (!picked) return;
    const modes = Array.isArray(picked.checkin_modes) && picked.checkin_modes.length ? picked.checkin_modes : ['qr'];
    const nextMode = modes[0];
    this.setData(
      {
        selectedSession: picked,
        sessionId: picked.session_id,
        availableModes: modes,
        activeMode: nextMode,
        result: null,
      },
      () => {
        if (nextMode === 'gesture') {
          setTimeout(() => this.measureGesturePad(), 50);
        }
      },
    );
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ activeMode: mode, result: null });
    if (mode === 'location' && this.data.latitude === null) {
      this.fetchLocation();
    } else if (mode === 'gesture') {
      setTimeout(() => this.measureGesturePad(), 50);
    }
  },

  // --- 1. 扫码签到 ---
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
          () =>
            this.doCheckin({
              session_id: parsed.sessionId,
              scan_token: parsed.scanToken,
              checkin_mode: 'qr',
            }),
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

  // --- 2. 拍照签到 ---
  onChoosePhoto() {
    const handlePickedPath = async (tempPath) => {
      if (!tempPath) return;
      wx.showLoading({ title: '正在上传照片', mask: true });
      try {
        const data = await uploadFile(tempPath, { formData: { source: 'checkin-photo' } });
        this.setData({
          photoTempPath: tempPath,
          photoFileId: String((data && (data.file_id || data.id)) || ''),
        });
        wx.showToast({ title: '照片上传成功', icon: 'success' });
      } catch (e) {
        toastError((e && e.message) || '照片上传失败');
      } finally {
        wx.hideLoading();
      }
    };

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
        success: (res) => {
          const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          handlePickedPath(path);
        },
      });
    } else {
      wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
        success: (res) => {
          const path = res.tempFilePaths && res.tempFilePaths[0];
          handlePickedPath(path);
        },
      });
    }
  },

  submitPhotoCheckin() {
    if (!this.data.sessionId) return toastError('请先选择进行中的签到课次');
    if (!this.data.photoFileId) return toastError('请先拍摄现场照片');
    this.doCheckin({
      session_id: this.data.sessionId,
      checkin_mode: 'photo',
      photo_file_id: this.data.photoFileId,
    });
  },

  // --- 3. 手势签到 ---
  measureGesturePad(cb) {
    wx.createSelectorQuery()
      .select('#gesturePad')
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rect = res && res[0];
        const vp = res && res[1];
        if (rect && rect.width > 0 && rect.height > 0) {
          this._gestureBox = {
            left: rect.left + (vp && vp.scrollLeft ? vp.scrollLeft : 0),
            top: rect.top + (vp && vp.scrollTop ? vp.scrollTop : 0),
            width: rect.width,
            height: rect.height,
          };
        }
        if (typeof cb === 'function') cb(this._gestureBox || null);
      });
  },

  touchToPadPct(touch, box) {
    if (!touch || !box || !box.width || !box.height) return null;
    const tx = touch.pageX !== undefined ? touch.pageX : touch.clientX;
    const ty = touch.pageY !== undefined ? touch.pageY : touch.clientY;
    if (tx === undefined || ty === undefined) return null;
    const xPct = Math.max(0, Math.min(100, ((tx - box.left) / box.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((ty - box.top) / box.height) * 100));
    return { xPct, yPct, tx, ty };
  },

  hitGestureDot(xPct, yPct, thresholdPct) {
    const r = thresholdPct || 12;
    for (let i = 0; i < GESTURE_DOTS.length; i++) {
      const d = GESTURE_DOTS[i];
      if (Math.hypot(xPct - d.cx, yPct - d.cy) <= r) {
        return d.pt;
      }
    }
    return null;
  },

  applyGesturePoints(pts, liveLine) {
    const stepMap = {};
    const multiMap = {};
    pts.forEach((p, idx) => {
      if (!stepMap[p]) {
        stepMap[p] = [idx + 1];
      } else {
        stepMap[p].push(idx + 1);
      }
    });
    const map = {};
    Object.keys(stepMap).forEach((k) => {
      map[k] = stepMap[k].join(',');
      if (stepMap[k].length > 1) multiMap[k] = true;
    });
    this.setData({
      gesturePoints: pts,
      gestureMap: map,
      gestureMultiMap: multiMap,
      gestureLines: buildGestureLines(pts),
      gestureLiveLine: liveLine || null,
      gesturePattern: pts.join('-'),
    });
  },

  onGestureTouchStart(e) {
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!touch) return;
    const tx = touch.pageX !== undefined ? touch.pageX : touch.clientX;
    const ty = touch.pageY !== undefined ? touch.pageY : touch.clientY;
    const dsPt = Number((e.target && e.target.dataset && e.target.dataset.point) || 0);
    let startPt = dsPt >= 1 && dsPt <= 9 ? dsPt : null;
    if (!startPt && this._gestureBox) {
      const pos = this.touchToPadPct(touch, this._gestureBox);
      if (pos) startPt = this.hitGestureDot(pos.xPct, pos.yPct, 13.5);
    }
    this._gestureTouch = {
      startX: tx,
      startY: ty,
      startPt,
      dragging: false,
    };
    this.measureGesturePad((box) => {
      if (this._gestureTouch && !this._gestureTouch.startPt && box) {
        const pos = this.touchToPadPct(touch, box);
        if (pos) this._gestureTouch.startPt = this.hitGestureDot(pos.xPct, pos.yPct, 13.5);
      }
    });
  },

  onGestureTouchMove(e) {
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    const st = this._gestureTouch;
    const box = this._gestureBox;
    if (!touch || !st || !box) return;
    const pos = this.touchToPadPct(touch, box);
    if (!pos) return;

    let pts = this.data.gesturePoints.slice();
    if (!st.dragging) {
      if (Math.hypot(pos.tx - st.startX, pos.ty - st.startY) <= 10) {
        return;
      }
      st.dragging = true;
      pts = st.startPt ? [st.startPt] : [];
    }

    const hitPt = this.hitGestureDot(pos.xPct, pos.yPct, 11.5);
    if (hitPt && hitPt !== pts[pts.length - 1]) {
      pts = appendGestureWithBridge(pts, hitPt);
    }
    const lastDot = pts.length ? GESTURE_DOT_MAP[pts[pts.length - 1]] : null;
    const liveLine = lastDot ? buildGestureLine(lastDot.cx, lastDot.cy, pos.xPct, pos.yPct, 'live') : null;
    this.applyGesturePoints(pts, liveLine);
  },

  onGestureTouchEnd(e) {
    const st = this._gestureTouch;
    this._gestureTouch = null;
    if (!st) {
      if (this.data.gestureLiveLine) this.setData({ gestureLiveLine: null });
      return;
    }
    if (!st.dragging) {
      let tapPt = st.startPt;
      if (!tapPt && this._gestureBox) {
        const touch = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0]);
        const pos = this.touchToPadPct(touch, this._gestureBox);
        if (pos) tapPt = this.hitGestureDot(pos.xPct, pos.yPct, 13.5);
      }
      if (tapPt) {
        const pts = this.data.gesturePoints.slice();
        if (tapPt === pts[pts.length - 1]) {
          this.applyGesturePoints(pts.slice(0, -1), null);
        } else if (pts.length < MAX_GESTURE_POINTS) {
          pts.push(tapPt);
          this.applyGesturePoints(pts, null);
        } else {
          this.setData({ gestureLiveLine: null });
        }
        return;
      }
    }
    if (this.data.gestureLiveLine) {
      this.setData({ gestureLiveLine: null });
    }
  },

  undoGesture() {
    const pts = this.data.gesturePoints;
    if (!pts.length) return;
    this.applyGesturePoints(pts.slice(0, -1), null);
  },

  clearGesture() {
    this.applyGesturePoints([], null);
  },

  submitGestureCheckin() {
    if (!this.data.sessionId) return toastError('请先选择进行中的签到课次');
    const pts = this.data.gesturePoints;
    if (pts.length < 4 || pts.length > MAX_GESTURE_POINTS) {
      return toastError('请按顺序连接 4~25 个九宫格点位');
    }
    const uniq = {};
    pts.forEach((p) => { uniq[p] = true; });
    if (Object.keys(uniq).length < 3) {
      return toastError('手势连线请至少经过 3 个不同点位');
    }
    this.doCheckin({
      session_id: this.data.sessionId,
      checkin_mode: 'gesture',
      gesture_pattern: this.data.gesturePattern,
    });
  },

  // --- 4. 定位签到 ---
  fetchLocation() {
    this.setData({ locating: true });
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          latitude: Number(res.latitude.toFixed(6)),
          longitude: Number(res.longitude.toFixed(6)),
          locating: false,
        });
      },
      fail: () => {
        this.setData({ locating: false });
        wx.showModal({
          title: '需要位置权限',
          content: '定位签到需要获取您当前地理位置，请在设置中开启位置权限后重试。',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting();
          },
        });
      },
    });
  },

  submitLocationCheckin() {
    if (!this.data.sessionId) return toastError('请先选择进行中的签到课次');
    if (this.data.latitude === null || this.data.longitude === null) {
      return toastError('请先获取当前定位');
    }
    this.doCheckin({
      session_id: this.data.sessionId,
      checkin_mode: 'location',
      latitude: this.data.latitude,
      longitude: this.data.longitude,
    });
  },

  async doCheckin(payload) {
    if (this.data.submitting) return;
    if (!payload.session_id || !/^\d+$/.test(String(payload.session_id))) {
      return toastError('课次 ID 无效');
    }

    this.setData({ submitting: true, result: null });
    try {
      const data = await api.checkin(payload);
      const row = Array.isArray(data) ? data[0] : data || {};
      const statusCode = row.attendance_status || row.attendanceStatus || 'on_time';
      const modeCode = row.checkin_mode || payload.checkin_mode || 'qr';
      this.setData({
        result: {
          ok: true,
          mode: MODE_NAMES[modeCode] || modeCode,
          message: row.is_late ? '签到成功（已记为迟到）' : '签到成功',
          status: ATTENDANCE_TEXT[statusCode] || statusCode,
          distance: row.distance_meters !== undefined ? row.distance_meters : null,
          time: formatDateTime(row.checkin_time || new Date().toISOString()),
        },
      });
      wx.showToast({ title: '签到成功', icon: 'success' });
      this.loadActiveSessions();
    } catch (err) {
      this.setData({
        result: { ok: false, message: (err && err.message) || '签到失败' },
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
