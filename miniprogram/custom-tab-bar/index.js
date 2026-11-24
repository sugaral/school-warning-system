function svgDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function buildHomeIcon(color) {
  return svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="' +
      color +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3 10.5L12 3l9 7.5"/>' +
      '<path d="M5 9.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5"/>' +
      '<path d="M9.5 21v-6a2.5 2.5 0 0 1 5 0v6"/>' +
      '</svg>',
  );
}

function buildWarningIcon(color) {
  return svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="' +
      color +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2.5L4 6v6c0 5.25 3.4 9.7 8 10.8 4.6-1.1 8-5.55 8-10.8V6l-8-3.5z"/>' +
      '<path d="M12 8.2v4.3"/>' +
      '<circle cx="12" cy="15.8" r="0.9" fill="' +
      color +
      '"/>' +
      '</svg>',
  );
}

function buildProfileIcon(color) {
  return svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="' +
      color +
      '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="8.2" r="3.6"/>' +
      '<path d="M5 19.8c.9-3.4 3.6-5.3 7-5.3s6.1 1.9 7 5.3"/>' +
      '</svg>',
  );
}

Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: buildHomeIcon('#6f6875'),
        selectedIcon: buildHomeIcon('#2f7a53'),
      },
      {
        pagePath: '/pages/warnings/warnings',
        text: '我的预警',
        icon: buildWarningIcon('#6f6875'),
        selectedIcon: buildWarningIcon('#2f7a53'),
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        icon: buildProfileIcon('#6f6875'),
        selectedIcon: buildProfileIcon('#2f7a53'),
      },
    ],
  },

  methods: {
    switchTab(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const path = e.currentTarget.dataset.path;
      if (!path) return;
      if (this.data.selected !== idx) {
        this.setData({ selected: idx });
      }
      wx.switchTab({ url: path });
    },
  },
});
