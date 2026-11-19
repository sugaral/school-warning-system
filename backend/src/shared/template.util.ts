/**
 * 模板占位符渲染工具
 *
 * 背景（P0-1 缺陷修复）：
 * 原实现的正则为 new RegExp(`\\\\{${key}\\\\}`, 'g')，在 JS 字符串中
 * `\\\\` 转义后是两个「字面反斜杠」，即实际匹配 `\\{key\\}`
 * （键名两侧各一个反斜杠）。而随包发布的所有模板、seed.ts 与通知
 * fallback 全部写作 `{key}` —— 导致渲染「一律不替换」，
 * 用户会收到字面量 `{code}`、`{student_name}` 等。
 *
 * 修复策略：
 * 1. 主匹配目标为 `{key}`（单花括号、无反斜杠），这是全仓库模板的写法；
 *    同时向后兼容 `\{key\}`（历史自定义模板可能已按错误语义书写）。
 * 2. **单遍扫描**替换：对每个占位符只做一次正则替换。原实现按 key 逐个
 *    replace，导致「后一次迭代会重新扫描前一次替换结果」的二阶缺陷
 *    （params={a:'{b}',b:'X'} 时 `{a}` 会被错误地变成 `X`）。
 *    单遍扫描同时天然避免了「值里含占位符被再次展开」。
 * 3. replace 使用函数式回调而非替换字符串，避免 `$&`、`$1`、`$\``、
 *    `$'` 等特殊替换模式被 String.replace 二次解释。
 */

/**
 * 占位符整体语法：`{key}` 或 `\{key\}`（后者兼容旧写法）。
 * 用「非花括号的惰性串」作键名，可兼容含 `+`、`.` 等正则元字符的键；
 * 闭合花括号前允许一个可选反斜杠，以便正确吃掉 `\{key\}` 的尾部反斜杠。
 */
const PLACEHOLDER_PATTERN = /\\?\{([^{}]+?)\\?\}/g;

export function renderTemplate(template: string, params: Record<string, any> = {}) {
  if (template === null || template === undefined) return template as any;
  if (!params) return template;

  // 预先把参数值字符串化，避免在回调里重复计算
  const resolved = new Map<string, string>();
  for (const [key, value] of Object.entries(params)) {
    if (key === '') continue;
    resolved.set(key, value === null || value === undefined ? '' : String(value));
  }

  // 单遍扫描：只替换 params 中真实存在的键；未知占位符原样保留
  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    return resolved.has(key) ? (resolved.get(key) as string) : match;
  });
}
