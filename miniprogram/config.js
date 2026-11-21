/**
 * 全局配置
 *
 * ⚠️ 本地联调说明（微信开发者工具）：
 *  1. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
 *  2. 把 baseUrl 改成你的本机地址：
 *     - 模拟器：http://localhost:3000
 *     - 真机预览：http://<你的局域网IP>:3000（手机与电脑需同网段）
 *  3. 后端需允许该来源：CORS_ALLOWED_ORIGINS 里加入对应地址
 *     （小程序原生请求不受浏览器 CORS 限制，但 web-view 场景需要）
 */
const ENV = {
  // 本地开发（微信开发者工具需关闭域名校验）
  dev: {
    baseUrl: 'http://localhost:3000',
    envName: '本地开发',
  },
  // 生产：必须是已备案并配置到「request 合法域名」的 HTTPS 域名
  prod: {
    baseUrl: 'https://www.xueyeyujing.asia',
    envName: '生产环境',
  },
};

// 切换环境：优先按小程序运行时版本自动切换（体验版/正式版走 prod，开发版走 dev）
let CURRENT = ENV.dev;
try {
  if (typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function') {
    const accountInfo = wx.getAccountInfoSync();
    const envVersion = accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion;
    if (envVersion === 'release' || envVersion === 'trial') {
      CURRENT = ENV.prod;
    }
  }
} catch (e) {
  CURRENT = ENV.dev;
}

module.exports = {
  ...CURRENT,
  /** 与服务端约定：token 通过该请求头传递（与后端 AuthGuard 一致） */
  TOKEN_HEADER: 'Authorization',
  TOKEN_PREFIX: 'Bearer ',
  /** 本地存储键 */
  STORAGE_TOKEN: 'warnsys_token',
  STORAGE_STUDENT: 'warnsys_student',
  /**
   * 微信一次性订阅消息模板 ID（需在微信公众平台申请后填入）
   * 注意平台限制：一次性订阅每次授权只能推送 1 条，详见 pages/preferences 说明
   */
  SUBSCRIBE_TEMPLATE_IDS: [],
  REQUEST_TIMEOUT: 30000,
};
