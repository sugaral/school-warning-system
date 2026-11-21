const { api, config, toastError } = require('../../utils/request');

Page({
  data: {
    allClasses: [],
    orgs: [],
    selectedOrgIndex: -1,
    filteredClasses: [],
    selectedId: '',
    keyword: '',
    loading: true,
    submitting: false,
  },

  onLoad() {
    this.fetchClasses();
  },

  async fetchClasses() {
    this.setData({ loading: true });
    try {
      const data = await api.availableClasses();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const orgMap = {};
      const orgs = [{ id: '', org_name: '全部学院' }];
      list.forEach((cls) => {
        const oid = String(cls.org_id || '');
        const oname = cls.org_name || '未分类学院';
        if (oid && !orgMap[oid]) {
          orgMap[oid] = true;
          orgs.push({ id: oid, org_name: oname });
        }
      });

      this.setData({
        allClasses: list,
        orgs,
        selectedOrgIndex: 0,
        loading: false,
      });
      this.applyFilter();
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onOrgChange(e) {
    this.setData({
      selectedOrgIndex: Number(e.detail.value),
      selectedId: '',
    });
    this.applyFilter();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  applyFilter() {
    const { allClasses, orgs, selectedOrgIndex, keyword } = this.data;
    const selectedOrg = orgs[selectedOrgIndex] || { id: '' };
    const kw = String(keyword || '').trim().toLowerCase();

    const filtered = allClasses.filter((cls) => {
      if (selectedOrg.id && String(cls.org_id) !== String(selectedOrg.id)) {
        return false;
      }
      if (kw) {
        const text = (cls.class_name + ' ' + cls.org_name + ' ' + (cls.head_teacher_name || '')).toLowerCase();
        return text.indexOf(kw) !== -1;
      }
      return true;
    });

    this.setData({ filteredClasses: filtered });
  },

  onPick(e) {
    this.setData({ selectedId: String(e.currentTarget.dataset.id) });
  },

  async onSubmit() {
    if (!this.data.selectedId) return toastError('请先选择班级');
    this.setData({ submitting: true });
    try {
      const res = await api.bindClass({ class_id: this.data.selectedId });
      if (res && res.token) {
        wx.setStorageSync(config.STORAGE_TOKEN, res.token);
      }
      const cached = wx.getStorageSync(config.STORAGE_STUDENT) || {};
      const updated = Object.assign({}, cached, {
        id: (res && res.student_id) || cached.id,
        class_id: (res && res.class_id) || this.data.selectedId,
        class_name: (res && res.class_name) || cached.class_name,
        org_id: (res && res.org_id) || cached.org_id,
        org_name: (res && res.org_name) || cached.org_name,
        is_bound: true,
      });
      getApp().setStudent(updated);

      wx.showToast({ title: '班级绑定成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }, 700);
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ submitting: false });
    }
  },
});
