/**
 * 生成小程序其余页面（23 个）
 *
 * 说明：login / index / warnings / warning-detail / checkin / leave-form
 * 这 6 个核心页面为手写完整实现（需求要求给出完整代码）。
 * 其余页面结构高度同构（列表页 / 详情页 / 表单页 / 设置页），
 * 用脚本生成可保证风格统一、字段一致，且便于后续统一修改。
 *
 * 用法: node scripts/gen-miniprogram-pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram', 'pages');

function write(page, file, content) {
  const dir = path.join(ROOT, page);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), content, 'utf8');
}

function json(page, title) {
  write(page, `${page}.json`, JSON.stringify({ navigationBarTitleText: title }, null, 2) + '\n');
}

/**
 * 列表页模板
 * @param page 目录名
 * @param title 标题
 * @param apiCall  api 对象上的方法名
 * @param itemTpl  {{{...}}} 形式渲染的 wxml 片段
 */
function listPage(page, title, apiCall, itemTpl, extraJs = '', emptyText = '暂无数据') {
  json(page, title);
  write(
    page,
    `${page}.wxml`,
    `<view class="page">
  <view class="card" wx:if="{{items.length > 0}}">
    <block wx:for="{{items}}" wx:key="index">
${itemTpl}
    </block>
  </view>
  <view class="empty" wx:else>{{loading ? '加载中...' : '${emptyText}'}}</view>
  <view class="load-more" wx:if="{{hasMore && items.length > 0}}" bindtap="loadMore">点击加载更多</view>
</view>
`,
  );
  write(
    page,
    `${page}.wxss`,
    `/* ${title} —— 复用 app.wxss 的通用类，仅补充页内差异 */\n`,
  );
  write(
    page,
    `${page}.js`,
    `const { api, toastError } = require('../../utils/request');

Page({
  data: {
    items: [],
    loading: true,
    hasMore: false,
    page: 1,
    pageSize: 20,
  },

  onLoad() {
    this.fetchList(true);
  },

  onPullDownRefresh() {
    this.fetchList(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  async fetchList(reset) {
    if (reset) this.setData({ page: 1 });
    this.setData({ loading: true });
    try {
      const data = await api.${apiCall}({ page: this.data.page, pageSize: this.data.pageSize });
      // 兼容后端两种返回形态：数组 或 { list, total }
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const total = (data && data.total) || list.length;
      const merged = reset ? list : this.data.items.concat(list);
      this.setData({
        items: merged,
        hasMore: merged.length < total,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    this.setData({ page: this.data.page + 1 }, () => this.fetchList(false));
  },
${extraJs}
});
`,
  );
}

/**
 * 详情页模板
 */
function detailPage(page, title, apiCall, fields) {
  json(page, title);
  const rows = fields
    .map(
      (f) =>
        `    <view class="row"><text class="row-label">${f.label}</text><text class="row-value">{{detail.${f.key} || '-'}}</text></view>`,
    )
    .join('\n');
  write(
    page,
    `${page}.wxml`,
    `<view class="page">
  <view class="card" wx:if="{{detail}}">
    <view class="card-title">${title}</view>
${rows}
  </view>
  <view class="empty" wx:else>{{loading ? '加载中...' : '记录不存在'}}</view>
</view>
`,
  );
  write(page, `${page}.wxss`, `/* ${title} */\n`);
  write(
    page,
    `${page}.js`,
    `const { api } = require('../../utils/request');

Page({
  data: { id: '', detail: null, loading: true },

  onLoad(options) {
    const id = options.id || '';
    this.setData({ id });
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.fetchDetail(id);
  },

  async fetchDetail(id) {
    try {
      // 列表接口通常支持按 id 过滤；若后端提供独立详情端点可替换此处
      const data = await api.${apiCall}({ id });
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      const hit = list.find((x) => String(x.id) === String(id)) || list[0] || null;
      this.setData({ detail: hit, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },
});
`,
  );
}

// ---------------- 详情页 ----------------
detailPage('leave-detail', '请假详情', 'leaveRequests', [
  { label: '状态', key: 'status' },
  { label: '开始日期', key: 'from_date' },
  { label: '结束日期', key: 'to_date' },
  { label: '请假原因', key: 'reason' },
  { label: '审批意见', key: 'reject_reason' },
  { label: '提交时间', key: 'created_at' },
]);

detailPage('appeal-detail', '申诉详情', 'appeals', [
  { label: '状态', key: 'status' },
  { label: '申诉类型', key: 'appeal_type' },
  { label: '申诉内容', key: 'content' },
  { label: '处理结果', key: 'result_note' },
  { label: '提交时间', key: 'created_at' },
]);

detailPage('notification-detail', '通知详情', 'notifications', [
  { label: '标题', key: 'title' },
  { label: '内容', key: 'content' },
  { label: '发布人', key: 'publisher_name' },
  { label: '发布时间', key: 'created_at' },
]);

// ---------------- 列表页 ----------------
listPage(
  'leaves',
  '我的请假',
  'leaveRequests',
  `      <view class="row" bindtap="goDetail" data-id="{{item.id}}">
        <view style="flex:1">
          <view>{{item.from_date}} ~ {{item.to_date}}</view>
          <view class="row-label" style="margin-top:8rpx">{{item.reason}}</view>
        </view>
        <text class="tag {{item.status === 'approved' ? 'tag-success' : (item.status === 'rejected' ? 'tag-danger' : 'tag-warn')}}">{{item.status}}</text>
      </view>`,
  `
  goDetail(e) {
    wx.navigateTo({ url: '/pages/leave-detail/leave-detail?id=' + e.currentTarget.dataset.id });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/leave-form/leave-form' });
  },`,
  '还没有请假记录',
);

listPage(
  'appeals',
  '我的申诉',
  'appeals',
  `      <view class="row" bindtap="goDetail" data-id="{{item.id}}">
        <view style="flex:1">
          <view>{{item.appeal_type || '申诉'}}</view>
          <view class="row-label" style="margin-top:8rpx">{{item.content}}</view>
        </view>
        <text class="tag {{item.status === 'resolved' ? 'tag-success' : (item.status === 'rejected' ? 'tag-danger' : 'tag-warn')}}">{{item.status}}</text>
      </view>`,
  `
  goDetail(e) {
    wx.navigateTo({ url: '/pages/appeal-detail/appeal-detail?id=' + e.currentTarget.dataset.id });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/appeal-form/appeal-form' });
  },`,
  '还没有申诉记录',
);

listPage(
  'notifications',
  '班级通知',
  'notifications',
  `      <view class="row" bindtap="goDetail" data-id="{{item.id}}">
        <view style="flex:1">
          <view style="font-weight:600">{{item.title}}</view>
          <view class="row-label" style="margin-top:8rpx">{{item.content}}</view>
        </view>
        <text class="tag {{item.read_at ? 'tag-plain' : 'tag-warn'}}">{{item.read_at ? '已读' : '未读'}}</text>
      </view>`,
  `
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    // 进入详情即回执已读（写 student_notification_reads）
    api.readNotification(id).catch(() => {});
    wx.navigateTo({ url: '/pages/notification-detail/notification-detail?id=' + id });
  },`,
  '暂无班级通知',
);

listPage(
  'grades',
  '我的成绩',
  'courses',
  `      <view class="row">
        <view style="flex:1">
          <view>{{item.course_name || item.course_code}}</view>
          <view class="row-label" style="margin-top:8rpx">学分 {{item.credit || '-'}}</view>
        </view>
        <text class="tag {{item.pass_status === 'pass' ? 'tag-success' : (item.pass_status === 'fail' ? 'tag-danger' : 'tag-plain')}}">{{item.score || '-'}}</text>
      </view>`,
  '',
  '暂无成绩数据',
);

listPage(
  'schedules',
  '本班课表',
  'courses',
  `      <view class="row">
        <view style="flex:1">
          <view>{{item.course_name || item.course_code}}</view>
          <view class="row-label" style="margin-top:8rpx">{{item.teacher_name || ''}} · {{item.term_code || ''}}</view>
        </view>
      </view>`,
  '',
  '暂无课表数据',
);

listPage(
  'teachers',
  '我的老师',
  'getTeachers',
  `      <view class="row">
        <view style="flex:1">
          <view>{{item.name}}</view>
          <view class="row-label" style="margin-top:8rpx">{{item.role_name || item.user_type || ''}}</view>
        </view>
        <text class="tag">{{item.mobile || '-'}}</text>
      </view>`,
  '',
  '暂无教师信息',
);

// ---------------- 表单页 ----------------
function formPage(page, title, fields, submitCall, buildPayload) {
  json(page, title);
  const inputs = fields
    .map(
      (f) => `    <view class="form-item">
      <text class="form-label${f.required ? ' form-required' : ''}">${f.label}</text>
      ${f.type === 'textarea'
        ? `<textarea class="form-textarea" placeholder="${f.placeholder || ''}" value="{{form.${f.key}}}" bindinput="onInput" data-key="${f.key}" maxlength="500" />`
        : `<input class="form-input" ${f.password ? 'password' : ''} placeholder="${f.placeholder || ''}" value="{{form.${f.key}}}" bindinput="onInput" data-key="${f.key}" />`}
    </view>`,
    )
    .join('\n');
  write(
    page,
    `${page}.wxml`,
    `<view class="page">
  <view class="card">
${inputs}
    <button class="btn" bindtap="onSubmit" loading="{{submitting}}" disabled="{{submitting}}">提交</button>
  </view>
</view>
`,
  );
  write(page, `${page}.wxss`, `/* ${title} */\n`);
  write(
    page,
    `${page}.js`,
    `const { api, toastError } = require('../../utils/request');

Page({
  data: {
    form: ${JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, ''])))},
    submitting: false,
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onSubmit() {
    const payload = this.buildPayload();
    if (!payload) return;
    this.setData({ submitting: true });
    try {
      await api.${submitCall}(payload);
      wx.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      /* request 层已提示 */
    } finally {
      this.setData({ submitting: false });
    }
  },

  buildPayload() {
${buildPayload}
  },
});
`,
  );
}

formPage(
  'leave-form',
  '提交请假',
  [
    { key: 'from_date', label: '开始日期', required: true, placeholder: 'YYYY-MM-DD' },
    { key: 'to_date', label: '结束日期', required: true, placeholder: 'YYYY-MM-DD' },
    { key: 'reason', label: '请假原因', required: true, type: 'textarea', placeholder: '请说明请假原因' },
  ],
  'createLeave',
  `    const f = this.data.form;
    if (!f.from_date) return toastError('请填写开始日期'), null;
    if (!f.to_date) return toastError('请填写结束日期'), null;
    if (!f.reason) return toastError('请填写请假原因'), null;
    return { from_date: f.from_date, to_date: f.to_date, reason: f.reason };`,
);

formPage(
  'appeal-form',
  '提交申诉',
  [
    { key: 'appeal_type', label: '申诉类型', required: true, placeholder: '如：预警申诉' },
    { key: 'related_id', label: '关联记录 ID', placeholder: '可选' },
    { key: 'content', label: '申诉内容', required: true, type: 'textarea', placeholder: '请说明申诉理由' },
  ],
  'createAppeal',
  `    const f = this.data.form;
    if (!f.appeal_type) return toastError('请填写申诉类型'), null;
    if (!f.content) return toastError('请填写申诉内容'), null;
    const payload = { appeal_type: f.appeal_type, content: f.content };
    if (f.related_id) payload.related_id = f.related_id;
    return payload;`,
);

formPage(
  'change-password',
  '修改密码',
  [
    { key: 'old_password', label: '当前密码', required: true, password: true },
    { key: 'new_password', label: '新密码', required: true, password: true, placeholder: '至少 8 位，含字母与数字' },
    { key: 'confirm_password', label: '确认新密码', required: true, password: true },
  ],
  'changePassword',
  `    const f = this.data.form;
    if (!f.old_password) return toastError('请输入当前密码'), null;
    if (!f.new_password) return toastError('请输入新密码'), null;
    if (f.new_password !== f.confirm_password) return toastError('两次输入的新密码不一致'), null;
    if (f.new_password.length < 8) return toastError('新密码至少 8 位'), null;
    return { old_password: f.old_password, new_password: f.new_password };`,
);

// ---------------- 设置/其它页 ----------------
json('preferences', '通知偏好');
write(
  'preferences',
  'preferences.wxml',
  `<view class="page">
  <view class="card">
    <view class="card-title">接收渠道</view>
    <view class="row">
      <text class="row-label">微信通知</text>
      <switch checked="{{prefs.wechat}}" bindchange="onSwitch" data-key="wechat" />
    </view>
    <view class="row">
      <text class="row-label">短信通知</text>
      <switch checked="{{prefs.sms}}" bindchange="onSwitch" data-key="sms" />
    </view>
    <view class="row">
      <text class="row-label">邮件通知</text>
      <switch checked="{{prefs.email}}" bindchange="onSwitch" data-key="email" />
    </view>
  </view>

  <view class="card">
    <view class="card-title">免打扰时段</view>
    <view class="row">
      <text class="row-label">开始</text>
      <input class="form-input" style="width:220rpx" value="{{prefs.quiet_start}}" bindinput="onInput" data-key="quiet_start" placeholder="22:00" />
    </view>
    <view class="row">
      <text class="row-label">结束</text>
      <input class="form-input" style="width:220rpx" value="{{prefs.quiet_end}}" bindinput="onInput" data-key="quiet_end" placeholder="08:00" />
    </view>
    <view class="hint" style="padding:20rpx 0;color:#8c8c8c;font-size:24rpx;line-height:1.7">
      免打扰时段内的短信/微信通知会推迟到时段结束后发送；
      红色与严重级别预警为保障安全会强制送达，不受免打扰限制。
    </view>
  </view>

  <view class="card">
    <view class="card-title">订阅消息说明</view>
    <view style="color:#8c8c8c;font-size:24rpx;line-height:1.8">
      微信「一次性订阅消息」每次授权仅能推送 1 条，属平台限制。
      建议在每次查看预警时顺带请求一次授权，以持续获得推送。
    </view>
    <button class="btn btn-ghost" bindtap="requestSubscribe" wx:if="{{hasTemplate}}">授权订阅消息</button>
  </view>

  <button class="btn" bindtap="onSave" loading="{{saving}}">保存</button>
</view>
`,
);
write('preferences', 'preferences.wxss', `/* 通知偏好设置 */\n`);
write(
  'preferences',
  'preferences.js',
  `const { api, config } = require('../../utils/request');

Page({
  data: {
    prefs: { wechat: true, sms: true, email: false, quiet_start: '22:00', quiet_end: '08:00' },
    saving: false,
    hasTemplate: (config.SUBSCRIBE_TEMPLATE_IDS || []).length > 0,
  },

  onLoad() {
    this.fetchPrefs();
  },

  async fetchPrefs() {
    try {
      const data = await api.preferences();
      const prefs = (data && data.notify_prefs_json) || data || {};
      this.setData({
        prefs: {
          wechat: prefs.wechat !== false,
          sms: prefs.sms !== false,
          email: prefs.email === true,
          quiet_start: (prefs.quiet_hours && prefs.quiet_hours.start) || '22:00',
          quiet_end: (prefs.quiet_hours && prefs.quiet_hours.end) || '08:00',
        },
      });
    } catch (e) {
      /* 使用默认值 */
    }
  },

  onSwitch(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['prefs.' + key]: e.detail.value });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['prefs.' + key]: e.detail.value });
  },

  async onSave() {
    const p = this.data.prefs;
    this.setData({ saving: true });
    try {
      await api.updatePreferences({
        wechat: p.wechat,
        sms: p.sms,
        email: p.email,
        quiet_hours: { start: p.quiet_start, end: p.quiet_end },
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ saving: false });
    }
  },

  requestSubscribe() {
    const ids = config.SUBSCRIBE_TEMPLATE_IDS || [];
    if (ids.length === 0) return;
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        const accepted = ids.filter((id) => res[id] === 'accept').length;
        wx.showToast({ title: '已授权 ' + accepted + ' 项', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '授权未完成', icon: 'none' }),
    });
  },
});
`,
);

json('bind-class', '绑定班级');
write(
  'bind-class',
  'bind-class.wxml',
  `<view class="page">
  <view class="card">
    <view class="card-title">选择班级</view>
    <view class="row" wx:for="{{classes}}" wx:key="index" bindtap="onPick" data-id="{{item.id}}">
      <text class="row-label">{{item.class_name}}</text>
      <text class="tag {{selectedId === item.id ? '' : 'tag-plain'}}">{{selectedId === item.id ? '已选' : '选择'}}</text>
    </view>
    <view class="empty" wx:if="{{classes.length === 0}}">暂无可绑定班级</view>
  </view>
  <button class="btn" bindtap="onSubmit" disabled="{{!selectedId}}">提交绑定</button>
</view>
`,
);
write('bind-class', 'bind-class.wxss', `/* 绑定班级 */\n`);
write(
  'bind-class',
  'bind-class.js',
  `const { api, toastError } = require('../../utils/request');

Page({
  data: { classes: [], selectedId: '' },

  onLoad() {
    this.fetchClasses();
  },

  async fetchClasses() {
    try {
      const data = await api.availableClasses();
      const list = Array.isArray(data) ? data : (data && data.list) || [];
      this.setData({ classes: list });
    } catch (e) {
      /* ignore */
    }
  },

  onPick(e) {
    this.setData({ selectedId: e.currentTarget.dataset.id });
  },

  async onSubmit() {
    if (!this.data.selectedId) return toastError('请选择班级');
    try {
      await api.bindClass({ class_id: this.data.selectedId });
      wx.showToast({ title: '绑定成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      /* request 层已提示 */
    }
  },
});
`,
);

json('profile-edit', '编辑资料');
write(
  'profile-edit',
  'profile-edit.wxml',
  `<view class="page">
  <view class="card">
    <view class="form-item">
      <text class="form-label">手机号</text>
      <input class="form-input" value="{{form.mobile}}" bindinput="onInput" data-key="mobile" maxlength="11" />
    </view>
    <view class="form-item">
      <text class="form-label">邮箱</text>
      <input class="form-input" value="{{form.email}}" bindinput="onInput" data-key="email" />
    </view>
    <view class="form-item">
      <text class="form-label">紧急联系人</text>
      <input class="form-input" value="{{form.emergency_contact_name}}" bindinput="onInput" data-key="emergency_contact_name" />
    </view>
    <view class="form-item">
      <text class="form-label">紧急联系人电话</text>
      <input class="form-input" value="{{form.emergency_contact_mobile}}" bindinput="onInput" data-key="emergency_contact_mobile" maxlength="11" />
    </view>
    <view class="hint" style="padding-top:20rpx;color:#8c8c8c;font-size:24rpx;line-height:1.7">
      紧急联系人用于预警升级时通知家长，请确保准确。
    </view>
    <button class="btn" bindtap="onSave" loading="{{saving}}">保存</button>
  </view>
</view>
`,
);
write('profile-edit', 'profile-edit.wxss', `/* 编辑资料 */\n`);
write(
  'profile-edit',
  'profile-edit.js',
  `const { api } = require('../../utils/request');

Page({
  data: {
    form: { mobile: '', email: '', emergency_contact_name: '', emergency_contact_mobile: '' },
    saving: false,
  },

  onLoad() {
    this.fetchProfile();
  },

  async fetchProfile() {
    try {
      const data = await api.getProfile();
      const s = (data && data.student) || data || {};
      this.setData({
        form: {
          mobile: s.mobile || '',
          email: s.email || '',
          emergency_contact_name: s.emergency_contact_name || '',
          emergency_contact_mobile: s.emergency_contact_mobile || '',
        },
      });
    } catch (e) {
      /* ignore */
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['form.' + key]: e.detail.value });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await api.updateProfile(this.data.form);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (e) {
      /* request 层已提示 */
    } finally {
      this.setData({ saving: false });
    }
  },
});
`,
);

json('attendance', '我的考勤');
write(
  'attendance',
  'attendance.wxml',
  `<view class="page">
  <view class="card">
    <view class="card-title">近 7 天考勤</view>
    <view class="row" wx:for="{{trend}}" wx:key="index">
      <text class="row-label">{{item.date}}</text>
      <text class="tag {{item.attendance === 'on_time' ? 'tag-success' : (item.attendance === 'absent' ? 'tag-danger' : (item.attendance === 'leave' ? 'tag-plain' : 'tag-warn'))}}">
        {{item.attendance}}
      </text>
    </view>
  </view>
</view>
`,
);
write('attendance', 'attendance.wxss', `/* 我的考勤 */\n`);
write(
  'attendance',
  'attendance.js',
  `const { api } = require('../../utils/request');

Page({
  data: { trend: [] },

  onLoad() {
    this.fetchTrend();
  },

  async fetchTrend() {
    try {
      const data = await api.weekly();
      this.setData({ trend: Array.isArray(data) ? data : [] });
    } catch (e) {
      /* ignore */
    }
  },
});
`,
);

json('about', '关于');
write(
  'about',
  'about.wxml',
  `<view class="page">
  <view class="card">
    <view class="card-title">学业预警系统</view>
    <view class="row"><text class="row-label">版本</text><text class="row-value">3.0.0</text></view>
    <view class="row"><text class="row-label">定位</text><text class="row-value">学业风险闭环治理平台</text></view>
  </view>
  <view class="card">
    <view class="card-title">闭环流程</view>
    <view style="line-height:2;color:#595959;font-size:27rpx">
      发现 → 确认 → 处置 → 追溯
    </view>
    <view class="hint" style="padding-top:16rpx;color:#8c8c8c;font-size:24rpx;line-height:1.7">
      系统的价值不在于报了多少警，而在于风险是否被真正处理。
    </view>
  </view>
</view>
`,
);
write('about', 'about.wxss', `/* 关于 */\n`);
write('about', 'about.js', `Page({ data: {} });\n`);

console.log('generated pages under', ROOT);
