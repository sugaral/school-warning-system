const nodemailer: {
  createTransport: (options: any) => {
    sendMail: (payload: any) => Promise<{ messageId?: string }>;
  };
} = require('nodemailer');

const KNOWN_MOJIBAKE_TEXT_MAP: Record<string, string> = {
  '\u701b\ufe3f\u7b1f\u68f0\u52ee\ue11f\u7eef\u8364\u7cba': '学业预警系统',
  '\u7ee0\uff04\u608a\u7ed4\ue21c\u6ae5\u8930\u66e2\u7359\u7487\u4f7a\u721c': '管理端登录验证码',
  '\u95ad\ue1be\ue188\u6960\u5c83\u7609\u942e\u4f80\u20ac\u6c31\u7161': '邮箱验证码通知',
};

export interface EmailConfig {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

export function normalizeEmailDisplayText(value: unknown, fallback = '') {
  const text = String(value || '').trim();
  if (!text) {
    return fallback;
  }

  return KNOWN_MOJIBAKE_TEXT_MAP[text] || text;
}

function toBoolean(value: unknown, defaultValue: boolean) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return Boolean(value);
}

export function normalizeEmailConfig(raw: any = {}): EmailConfig {
  const provider = String(raw.smtpProvider || raw.provider || 'qq').toLowerCase();
  const defaultHost = 'smtp.qq.com';
  const defaultPort = Number(raw.smtpPort || 465);
  const secure =
    raw.smtpSecure !== undefined
      ? toBoolean(raw.smtpSecure, defaultPort === 465)
      : defaultPort === 465;
  const user = String(raw.smtpUser || raw.smtpAccount || raw.smtpFrom || '').trim();
  const pass = String(raw.smtpPass || raw.smtpAuthCode || '').trim();
  const from = String(raw.smtpFrom || user || '').trim();
  const fromName = normalizeEmailDisplayText(
    raw.smtpFromName || raw.fromName || '学业预警系统',
    '学业预警系统',
  );

  return {
    enabled: toBoolean(raw.enabled, true),
    provider,
    host: String(raw.smtpHost || defaultHost).trim(),
    port: defaultPort,
    secure,
    user,
    pass,
    from,
    fromName,
  };
}

export function isEmailConfigReady(config: EmailConfig) {
  return Boolean(
    config.enabled &&
      config.host &&
      config.port &&
      config.user &&
      config.pass &&
      config.from,
  );
}

let cachedTransporter: any = null;
let cachedConfigKey = '';

export async function sendEmail(
  config: EmailConfig,
  payload: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
  },
) {
  if (!isEmailConfigReady(config)) {
    throw new Error('邮件服务尚未配置完整，请先在系统配置中填写 QQ 邮箱 SMTP 信息');
  }

  const configKey = `${config.host}:${config.port}:${config.user}:${config.pass}`;
  if (!cachedTransporter || cachedConfigKey !== configKey) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    cachedConfigKey = configKey;
  }

  return cachedTransporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.from}>` : config.from,
    to: Array.isArray(payload.to) ? payload.to.join(',') : payload.to,
    subject: normalizeEmailDisplayText(payload.subject, '系统通知'),
    html: payload.html,
    text: payload.text,
  });
}
