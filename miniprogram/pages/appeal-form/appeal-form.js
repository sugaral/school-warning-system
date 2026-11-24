const { api, toastError } = require('../../utils/request');
const { chooseAndUploadImages } = require('../../utils/media');

Page({
  data: {
    appealTypes: ['预警申诉', '考勤申诉', '其他申诉'],
    form: {
      appeal_type: '预警申诉',
      related_type: '',
      warning_id: '',
      content: '',
    },
    images: [], // [{ id, tempPath }]
    submitting: false,
  },

  onLoad(options) {
    if (!options) return;
    const warningId = options.warning_id ? decodeURIComponent(options.warning_id) : '';
    const courseName = options.course_name ? decodeURIComponent(options.course_name) : '';
    const warningReason = options.warning_reason ? decodeURIComponent(options.warning_reason) : '';

    if (warningId || courseName || warningReason) {
      this.setData({
        'form.appeal_type': '预警申诉',
        'form.warning_id': warningId,
        'form.related_type': courseName,
        'form.content': warningReason ? '针对当前预警提出申诉：' + warningReason : '',
      });
    }
  },

  selectAppealType(e) {
    this.setData({ 'form.appeal_type': e.currentTarget.dataset.type });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onChooseImages() {
    const uploaded = await chooseAndUploadImages({
      source: 'appeal',
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
    const f = this.data.form;
    if (!f.appeal_type) return toastError('请选择申诉类型');
    const cleanContent = String(f.content || '').trim();
    if (!cleanContent) return toastError('请填写申诉说明');

    const warningId = String(f.warning_id || '').trim();
    if (warningId && !/^\d+$/.test(warningId)) {
      return toastError('关联预警 ID 必须为数字');
    }

    const fileIds = this.data.images.map((item) => item.id);
    const payload = {
      appeal_type: f.appeal_type,
      content: cleanContent,
      ...(String(f.related_type || '').trim() ? { related_type: String(f.related_type).trim() } : {}),
      ...(warningId ? { warning_id: warningId } : {}),
      ...(fileIds.length
        ? { evidence_file_id: fileIds[0], evidence_file_ids: fileIds }
        : {}),
    };

    this.setData({ submitting: true });
    try {
      await api.createAppeal(payload);
      wx.showToast({ title: '申诉提交成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ submitting: false });
    }
  },
});
