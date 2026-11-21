const { api, toastError } = require('../../utils/request');
const { chooseAndUploadImages } = require('../../utils/media');

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

Page({
  data: {
    leaveTypes: ['事假', '病假', '公假', '其他'],
    leaveType: '事假',
    teachers: [],
    teacherIndex: -1,
    startDate: todayStr(),
    startTime: '08:00',
    endDate: todayStr(),
    endTime: '18:00',
    reason: '',
    images: [], // [{ id, tempPath }]
    submitting: false,
  },

  onLoad() {
    this.loadTeachers();
  },

  async loadTeachers() {
    try {
      const list = await api.getTeachers();
      const rows = Array.isArray(list) ? list : [];
      const mapped = rows.map((t) => ({
        ...t,
        displayLabel: t.name + (t.type ? '（' + t.type + '）' : ''),
      }));
      const headIdx = mapped.findIndex((t) => t.type === '班主任');
      this.setData({
        teachers: mapped,
        teacherIndex: headIdx >= 0 ? headIdx : mapped.length > 0 ? 0 : -1,
      });
    } catch (e) {
      /* 未绑定班级时由后端提示 */
    }
  },

  selectLeaveType(e) {
    this.setData({ leaveType: e.currentTarget.dataset.type });
  },

  onTeacherChange(e) {
    this.setData({ teacherIndex: Number(e.detail.value) });
  },

  onDateTimeChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value });
  },

  async onChooseImages() {
    const uploaded = await chooseAndUploadImages({
      source: 'leave-request',
      maxCount: 6,
      currentCount: this.data.images.length,
    });
    if (uploaded.length > 0) {
      this.setData({
        images: this.data.images.concat(uploaded),
      });
    }
  },

  onPreviewUpload(e) {
    const idx = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.images.map((item) => item.tempPath);
    if (!urls.length) return;
    wx.previewImage({
      current: urls[idx] || urls[0],
      urls,
    });
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const next = this.data.images.slice();
    next.splice(idx, 1);
    this.setData({ images: next });
  },

  async onSubmit() {
    const {
      leaveType,
      teachers,
      teacherIndex,
      startDate,
      startTime,
      endDate,
      endTime,
      reason,
      images,
    } = this.data;

    if (!leaveType) return toastError('请选择请假类型');
    const teacher = teachers[teacherIndex];
    if (!teacher || !teacher.id) {
      return toastError('请选择审批老师（请先绑定班级）');
    }
    if (!startDate || !endDate) return toastError('请选择请假起止日期');

    const startFull = startDate + ' ' + (startTime || '00:00') + ':00';
    const endFull = endDate + ' ' + (endTime || '23:59') + ':00';
    const startTs = new Date(startFull.replace(/-/g, '/')).getTime();
    const endTs = new Date(endFull.replace(/-/g, '/')).getTime();
    if (endTs < startTs) {
      return toastError('结束时间不能早于开始时间');
    }
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) return toastError('请填写请假原因');

    const fileIds = images.map((item) => item.id);
    this.setData({ submitting: true });
    try {
      await api.createLeave({
        leave_type: leaveType,
        approver_user_id: teacher.id,
        start_date: startFull,
        end_date: endFull,
        reason: cleanReason,
        ...(fileIds.length
          ? { proof_file_id: fileIds[0], proof_file_ids: fileIds }
          : {}),
      });
      wx.showToast({ title: '请假申请已提交', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ submitting: false });
    }
  },
});
