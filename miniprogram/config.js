/**
 * 全局配置
 *
 * ⚠️ 本地/局域网联调说明（微信开发者工具 & 真机调试）：
 *  1. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
 *  2. 本机调试用 dev (http://localhost:82)，手机真机同一局域网下请切换为 lan (http://10.133.86.177:82)
 */
const ENV = {
  // 本地开发（微信开发者工具模拟器直连 Snowy 后端 82 端口）
  dev: {
    baseUrl: 'http://localhost:82',
    envName: '本机开发',
  },
  // 局域网模式（真机调试 / 同网段手机访问宿主机 IP）
  lan: {
    baseUrl: 'http://10.133.86.177:82',
    envName: '局域网模式',
  },
  // 生产：必须是已备案并配置到「request 合法域名」的 HTTPS 域名
  prod: {
    baseUrl: 'https://www.xueyeyujing.asia',
    envName: '生产环境',
  },
};

const STORAGE_BASE_URL = 'warnsys_custom_base_url';
const STORAGE_ENV_MODE = 'warnsys_env_mode';

function detectDefaultMode() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function') {
      const accountInfo = wx.getAccountInfoSync();
      const envVersion = accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion;
      if (envVersion === 'release' || envVersion === 'trial') {
        return 'prod';
      }
    }
    if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      const sys = wx.getSystemInfoSync();
      // 真机非 devtools 环境下，开发版默认优先使用局域网 IP
      if (sys && sys.platform && sys.platform !== 'devtools') {
        return 'lan';
      }
    }
  } catch (e) {
    /* ignore */
  }
  return 'dev';
}

function getNetworkMode() {
  try {
    const savedMode = typeof wx !== 'undefined' ? wx.getStorageSync(STORAGE_ENV_MODE) : '';
    if (savedMode && (ENV[savedMode] || savedMode === 'custom')) {
      return savedMode;
    }
  } catch (e) {
    /* ignore */
  }
  return detectDefaultMode();
}

function getBaseUrl() {
  try {
    const savedMode = getNetworkMode();
    if (savedMode === 'custom') {
      const customUrl = typeof wx !== 'undefined' ? wx.getStorageSync(STORAGE_BASE_URL) : '';
      if (customUrl) return String(customUrl).replace(/\/+$/, '');
    }
    if (ENV[savedMode]) {
      return ENV[savedMode].baseUrl;
    }
  } catch (e) {
    /* ignore */
  }
  return ENV[detectDefaultMode()].baseUrl;
}

function setCustomBaseUrl(url, mode) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const targetMode = mode || 'custom';
  try {
    if (typeof wx !== 'undefined') {
      wx.setStorageSync(STORAGE_ENV_MODE, targetMode);
      if (cleanUrl) {
        wx.setStorageSync(STORAGE_BASE_URL, cleanUrl);
      } else {
        wx.removeStorageSync(STORAGE_BASE_URL);
      }
    }
  } catch (e) {
    /* ignore */
  }
  return getBaseUrl();
}

const DEFAULT_MODE = detectDefaultMode();

module.exports = {
  ENV,
  ...ENV[DEFAULT_MODE],
  getBaseUrl,
  getNetworkMode,
  setCustomBaseUrl,
  STORAGE_BASE_URL,
  STORAGE_ENV_MODE,
  /** 与 Snowy C 端约定：通过 token 请求头传递 Sa-Token */
  TOKEN_HEADER: 'token',
  TOKEN_PREFIX: '',
  /** 本地存储键 */
  STORAGE_TOKEN: 'warnsys_token',
  STORAGE_STUDENT: 'warnsys_student',
  /**
   * 微信一次性订阅消息模板 ID（需在微信公众平台申请后填入）
   */
  SUBSCRIBE_TEMPLATE_IDS: [],
  REQUEST_TIMEOUT: 30000,
};
