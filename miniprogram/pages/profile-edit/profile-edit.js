const { api, downloadAuthImage, toastError } = require('../../utils/request');
const { chooseAndUploadImages, previewByFileIds } = require('../../utils/media');
const {
  CLASS_CHANGE_STATUS_TEXT,
  CLASS_CHANGE_STATUS_CLASS,
  formatDateTime,
} = require('../../utils/format');

Page({
  data: {
    activeTab: 'basic', // 'basic' | 'security' | 'class'
    profile: {},
    photoUrl: '',
    form: {
      gender: '',
      student_position: '',
      emergency_contact_name: '',
      emergency_contact_mobile: '',
      photo_file_id: '',
    },
    savingBasic: false,

    // 邮箱绑定
    emailForm: { email: '', challengeId: '', code: '', cooldown: 0 },
    bindingEmail: false,

    // 手机绑定
    phoneForm: { mobile: '', challengeId: '', code: '', cooldown: 0 },
    bindingPhone: false,

    // 换班申请
    classOptions: [],
    classIndex: -1,
    classChangeForm: { target_class_id: '', reason: '' },
    evidenceImages: [],
    classChangeList: [],
    submittingClassChange: false,
  },

  _timers: { email: null, phone: null },

  onLoad(options) {
    if (options && options.tab && ['basic', 'security', 'class'].indexOf(options.tab) !== -1) {
      this.setData({ activeTab: options.tab });
    }
    this.loadAll();
  },

  onUnload() {
    if (this._timers.email) clearInterval(this._timers.email);
    if (this._timers.phone) clearInterval(this._timers.phone);
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  async loadAll() {
    await Promise.all([
      this.fetchProfile(),
      this.fetchAvailableClasses(),
      this.fetchClassChangeRequests(),
    ]);
  },

  async fetchProfile() {
    try {
      const s = await api.getProfile();
      if (!s) return;
      getApp().setStudent(s);
      this.setData({
        profile: s,
        form: {
          gender: s.gender || '',
          student_position: s.student_position || '',
          emergency_contact_name: s.emergency_contact_name || '',
          emergency_contact_mobile: s.emergency_contact_mobile || '',
          photo_file_id: s.photo_file_id || '',
        },
        'emailForm.email': s.email || '',
        'phoneForm.mobile': s.mobile || '',
      });

      if (s.photo_file_id) {
        const localUrl = await downloadAuthImage(s.photo_file_id);
        if (localUrl) this.setData({ photoUrl: localUrl });
      }
    } catch (e) {
      /* ignore */
    }
  },

  async fetchAvailableClasses() {
    try {
      const rows = await api.availableClasses();
      const list = Array.isArray(rows) ? rows : [];
      const currentClassId = String(this.data.profile.class_id || '');
      const options = list
        .filter((item) => String(item.id) !== currentClassId)
        .map((item) => ({
          ...item,
          displayLabel: (item.org_name ? item.org_name + ' / ' : '') + item.class_name,
        }));
      this.setData({ classOptions: options });
    } catch (e) {
      /* ignore */
    }
  },

  async fetchClassChangeRequests() {
    try {
      const rows = await api.classChangeRequests();
      const list = (Array.isArray(rows) ? rows : []).map((item) => ({
        ...item,
        statusText: CLASS_CHANGE_STATUS_TEXT[item.status] || item.status || '-',
        statusClass: CLASS_CHANGE_STATUS_CLASS[item.status] || 'tag-plain',
        createdText: formatDateTime(item.created_at),
      }));
      this.setData({ classChangeList: list });
    } catch (e) {
      /* ignore */
    }
  },

  // ---- 基础资料编辑 ----
  selectGender(e) {
    this.setData({ 'form.gender': e.currentTarget.dataset.gender });
  },

  onBasicInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onUploadPhoto() {
    const uploaded = await chooseAndUploadImages({
      source: 'profile-photo',
      maxCount: 1,
      currentCount: 0,
    });
    if (uploaded.length > 0) {
      this.setData({
        'form.photo_file_id': uploaded[0].id,
        photoUrl: uploaded[0].tempPath,
      });
    }
  },

  onPreviewPhoto() {
    if (this.data.photoUrl) {
      wx.previewImage({ current: this.data.photoUrl, urls: [this.data.photoUrl] });
    }
  },

  async onSaveBasic() {
    const f = this.data.form;
    this.setData({ savingBasic: true });
    try {
      await api.updateProfile({
        gender: f.gender,
        student_position: String(f.student_position || '').trim(),
        emergency_contact_name: String(f.emergency_contact_name || '').trim(),
        emergency_contact_mobile: String(f.emergency_contact_mobile || '').trim(),
        ...(f.photo_file_id ? { photo_file_id: f.photo_file_id } : {}),
      });
      wx.showToast({ title: '资料已保存', icon: 'success' });
      await this.fetchProfile();
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ savingBasic: false });
    }
  },

  // ---- 验证码倒计时共用逻辑 ----
  startCooldown(timerKey, dataPath, seconds) {
    if (this._timers[timerKey]) clearInterval(this._timers[timerKey]);
    let left = Number(seconds) || 60;
    this.setData({ [dataPath]: left });
    this._timers[timerKey] = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this._timers[timerKey]);
        this._timers[timerKey] = null;
        this.setData({ [dataPath]: 0 });
      } else {
        this.setData({ [dataPath]: left });
      }
    }, 1000);
  },

  // ---- 邮箱绑定 ----
  onEmailInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['emailForm.' + key]: e.detail.value });
  },

  async onSendEmailCode() {
    const email = String(this.data.emailForm.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return toastError('请输入有效的邮箱地址');
    }
    try {
      const res = await api.sendCode({
        purpose: 'bind_email',
        channel: 'email',
        target: email,
      });
      this.setData({ 'emailForm.challengeId': String((res && res.challenge_id) || '') });
      this.startCooldown('email', 'emailForm.cooldown', (res && res.cooldown_seconds) || 60);
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (e) {
      /* request 层已提示 */
    }
  },

  async onBindEmail() {
    const email = String(this.data.emailForm.email || '').trim().toLowerCase();
    const challengeId = this.data.emailForm.challengeId;
    const code = String(this.data.emailForm.code || '').trim();
    if (!email) return toastError('请输入邮箱地址');
    if (!challengeId) return toastError('请先发送邮箱验证码');
    if (!code) return toastError('请输入验证码');

    this.setData({ bindingEmail: true });
    try {
      const vRes = await api.verifyCode({ challenge_id: challengeId, code });
      const ticket = vRes && vRes.ticket;
      if (!ticket) throw { message: '验证码校验失败' };

      await api.bindEmail({ email, ticket });
      wx.showToast({ title: '邮箱绑定成功', icon: 'success' });
      this.setData({ 'emailForm.code': '', 'emailForm.challengeId': '' });
      await this.fetchProfile();
    } catch (e) {
      if (e && e.message && !e.code) toastError(e.message);
    } finally {
      this.setData({ bindingEmail: false });
    }
  },

  // ---- 手机号绑定/修改 ----
  onPhoneInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['phoneForm.' + key]: e.detail.value });
  },

  async onSendPhoneVerifyCode() {
    const boundEmail = String(this.data.profile.email || '').trim();
    if (!boundEmail) {
      return toastError('修改已绑定的手机号前，请先在上方绑定邮箱');
    }
    try {
      const res = await api.sendCode({
        purpose: 'student_change_mobile',
        channel: 'email',
        target: boundEmail,
      });
      this.setData({ 'phoneForm.challengeId': String((res && res.challenge_id) || '') });
      this.startCooldown('phone', 'phoneForm.cooldown', (res && res.cooldown_seconds) || 60);
      wx.showToast({ title: '已向绑定邮箱发码', icon: 'success' });
    } catch (e) {
      /* request 层已提示 */
    }
  },

  async onBindPhone() {
    const mobile = String(this.data.phoneForm.mobile || '').trim();
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      return toastError('请输入正确的 11 位手机号');
    }

    const currentMobile = String(this.data.profile.mobile || '').trim();
    const needsTicket = Boolean(currentMobile && currentMobile !== mobile);

    this.setData({ bindingPhone: true });
    try {
      let ticket = '';
      if (needsTicket) {
        const challengeId = this.data.phoneForm.challengeId;
        const code = String(this.data.phoneForm.code || '').trim();
        if (!challengeId || !code) {
          this.setData({ bindingPhone: false });
          return toastError('更换手机号请先获取并输入邮箱验证码');
        }
        const vRes = await api.verifyCode({ challenge_id: challengeId, code });
        ticket = (vRes && vRes.ticket) || '';
        if (!ticket) throw { message: '验证码校验失败' };
      }

      await api.bindPhone({ mobile, ...(ticket ? { ticket } : {}) });
      wx.showToast({ title: '手机号已更新', icon: 'success' });
      this.setData({ 'phoneForm.code': '', 'phoneForm.challengeId': '' });
      await this.fetchProfile();
    } catch (e) {
      if (e && e.message && !e.code) toastError(e.message);
    } finally {
      this.setData({ bindingPhone: false });
    }
  },

  // ---- 换班申请 ----
  onTargetClassChange(e) {
    const idx = Number(e.detail.value);
    const picked = this.data.classOptions[idx];
    this.setData({
      classIndex: idx,
      'classChangeForm.target_class_id': picked ? String(picked.id) : '',
    });
  },

  onClassReasonInput(e) {
    this.setData({ 'classChangeForm.reason': e.detail.value });
  },

  async onChooseEvidence() {
    const uploaded = await chooseAndUploadImages({
      source: 'class-change-request',
      maxCount: 6,
      currentCount: this.data.evidenceImages.length,
    });
    if (uploaded.length > 0) {
      this.setData({
        evidenceImages: this.data.evidenceImages.concat(uploaded),
      });
    }
  },

  onRemoveEvidence(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const next = this.data.evidenceImages.slice();
    next.splice(idx, 1);
    this.setData({ evidenceImages: next });
  },

  onPreviewRecordEvidence(e) {
    const fileIds = e.currentTarget.dataset.ids || [];
    previewByFileIds(fileIds, 0);
  },

  async onSubmitClassChange() {
    const { profile, classChangeForm, evidenceImages } = this.data;
    if (!profile.is_bound) return toastError('当前尚未绑定班级，请使用首次绑定班级功能');
    if (!profile.head_teacher_user_id) return toastError('当前班级未绑定班主任，暂无法换班');
    if (!classChangeForm.target_class_id) return toastError('请选择目标班级');
    const reason = String(classChangeForm.reason || '').trim();
    if (!reason) return toastError('请填写换班申请原因');

    const fileIds = evidenceImages.map((item) => item.id);
    this.setData({ submittingClassChange: true });
    try {
      await api.createClassChange({
        target_class_id: classChangeForm.target_class_id,
        reason,
        ...(fileIds.length
          ? { evidence_file_id: fileIds[0], evidence_file_ids: fileIds }
          : {}),
      });
      wx.showToast({ title: '换班申请已提交', icon: 'success' });
      this.setData({
        classIndex: -1,
        'classChangeForm.target_class_id': '',
        'classChangeForm.reason': '',
        evidenceImages: [],
      });
      await this.fetchClassChangeRequests();
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ submittingClassChange: false });
    }
  },
});
