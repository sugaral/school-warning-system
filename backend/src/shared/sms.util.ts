import { renderTemplate } from './template.util';

export interface SmsConfig {
  enabled: boolean;
  provider: string;
  signName: string;
  gatewayUrl: string;
  gatewayMethod: 'POST' | 'PUT' | 'PATCH' | 'GET';
  gatewayHeaders: Record<string, string>;
  gatewayBodyTemplate: string;
  successField: string;
  successValue: string;
  messageIdField: string;
  retryCount: number;
  retryIntervalMinutes: number;
  openApiEnabled: boolean;
  openApiKey: string;
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

function toInteger(value: unknown, defaultValue: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseHeaders(rawHeaders: unknown) {
  if (!rawHeaders) {
    return {} as Record<string, string>;
  }

  if (typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    return Object.fromEntries(
      Object.entries(rawHeaders as Record<string, any>)
        .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
        .filter(([key, value]) => Boolean(key) && Boolean(value)),
    );
  }

  try {
    const parsed = JSON.parse(String(rawHeaders));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, any>)
          .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
          .filter(([key, value]) => Boolean(key) && Boolean(value)),
      );
    }
  } catch {
    // Ignore invalid JSON and fall back to an empty header map.
  }

  return {} as Record<string, string>;
}

function getValueByPath(source: any, path: string) {
  if (!source || !path) {
    return undefined;
  }

  return String(path)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === null || current === undefined) {
        return undefined;
      }
      return current[segment];
    }, source);
}

function normalizeMobileList(input: string | string[]) {
  const values = Array.isArray(input) ? input : [input];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeSmsConfig(raw: any = {}): SmsConfig {
  const provider = String(raw.provider || raw.smsProvider || 'custom_http')
    .trim()
    .toLowerCase();

  return {
    enabled: toBoolean(raw.enabled, false),
    provider,
    signName: String(raw.signName || raw.smsSignName || '').trim(),
    gatewayUrl: String(raw.gatewayUrl || raw.smsGatewayUrl || '').trim(),
    gatewayMethod: (String(raw.gatewayMethod || 'POST').trim().toUpperCase() as any) || 'POST',
    gatewayHeaders: parseHeaders(raw.gatewayHeaders || raw.smsGatewayHeaders),
    gatewayBodyTemplate: String(raw.gatewayBodyTemplate || raw.smsGatewayBodyTemplate || '').trim(),
    successField: String(raw.successField || raw.smsSuccessField || '').trim(),
    successValue: String(raw.successValue || raw.smsSuccessValue || '').trim(),
    messageIdField: String(raw.messageIdField || raw.smsMessageIdField || 'messageId').trim(),
    retryCount: toInteger(raw.retryCount, 3, 0, 10),
    retryIntervalMinutes: toInteger(raw.retryIntervalMinutes, 5, 1, 120),
    openApiEnabled: toBoolean(raw.openApiEnabled, false),
    openApiKey: String(raw.openApiKey || '').trim(),
  };
}

export function isSmsConfigReady(config: SmsConfig) {
  return Boolean(config.enabled && config.gatewayUrl);
}

export async function sendSms(
  config: SmsConfig,
  payload: {
    mobiles: string | string[];
    content: string;
    templateCode?: string;
    params?: Record<string, any>;
  },
) {
  if (!isSmsConfigReady(config)) {
    throw new Error('短信服务尚未配置完整，请先在系统配置中完成短信网关配置');
  }

  const mobiles = normalizeMobileList(payload.mobiles);
  if (mobiles.length === 0) {
    throw new Error('短信接收手机号不能为空');
  }

  const normalizedContent = String(payload.content || '').trim();
  if (!normalizedContent) {
    throw new Error('短信内容不能为空');
  }

  const params = payload.params && typeof payload.params === 'object' ? payload.params : {};
  const renderParams: Record<string, any> = {
    mobile: mobiles[0],
    mobiles: mobiles.join(','),
    mobiles_json: JSON.stringify(mobiles),
    content: normalizedContent,
    template_code: String(payload.templateCode || '').trim(),
    sign_name: config.signName,
    timestamp: new Date().toISOString(),
    params_json: JSON.stringify(params),
  };

  Object.entries(params).forEach(([key, value]) => {
    renderParams[key] =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  });

  let requestBody: string | Record<string, any> = {
    mobile: mobiles[0],
    mobiles,
    content: normalizedContent,
    template_code: String(payload.templateCode || '').trim(),
    sign_name: config.signName,
    params,
    timestamp: renderParams.timestamp,
  };

  if (config.gatewayBodyTemplate) {
    const renderedBody = renderTemplate(config.gatewayBodyTemplate, renderParams);
    try {
      requestBody = JSON.parse(renderedBody);
    } catch {
      requestBody = renderedBody;
    }
  }

  const method = config.gatewayMethod || 'POST';
  const headers = {
    ...config.gatewayHeaders,
  };

  let body: string | undefined;
  if (method !== 'GET') {
    if (typeof requestBody === 'string') {
      body = requestBody;
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'text/plain; charset=utf-8';
      }
    } else {
      body = JSON.stringify(requestBody);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
    }
  }

  const response = await fetch(config.gatewayUrl, {
    method,
    headers,
    body,
  });

  const rawText = await response.text();
  let parsed: any = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  let success = response.ok;
  if (success && config.successField) {
    const actualValue = getValueByPath(parsed, config.successField);
    success = config.successValue
      ? String(actualValue ?? '') === config.successValue
      : Boolean(actualValue);
  }

  const messageIdValue =
    getValueByPath(parsed, config.messageIdField) ||
    getValueByPath(parsed, 'data.messageId') ||
    getValueByPath(parsed, 'data.msgId');

  return {
    success,
    provider: config.provider || 'custom_http',
    msgId: messageIdValue ? String(messageIdValue) : undefined,
    error: success
      ? undefined
      : rawText || `sms_gateway_request_failed:${response.status}`,
    rawResponse: parsed ?? rawText,
  };
}
