import { renderTemplate } from './template.util';

/**
 * P0-1 回归测试：模板占位符渲染
 *
 * 原缺陷：正则写成 `\\\\{key\\\\}`（两个字面反斜杠），只匹配 `\{key\}`，
 * 而全仓库模板都写 `{key}` → 一律不替换，用户收到字面量 `{code}`。
 */
describe('renderTemplate', () => {
  const params = {
    code: '123456',
    student_name: '张三',
    level_cn: '红色',
    student_no: '2023001',
  };

  describe('标准写法 {key}（全仓库模板实际使用的写法）', () => {
    it('替换单个占位符', () => {
      expect(renderTemplate('{code}', params)).toBe('123456');
    });

    it('替换嵌在句子中的占位符', () => {
      expect(renderTemplate('您的验证码是 {code}，请勿泄露', params)).toBe(
        '您的验证码是 123456，请勿泄露',
      );
    });

    it('替换多个不同占位符', () => {
      expect(renderTemplate('{student_name} 触发 {level_cn} 预警', params)).toBe(
        '张三 触发 红色 预警',
      );
    });

    it('同一占位符出现多次全部替换', () => {
      expect(renderTemplate('{code}-{code}-{code}', params)).toBe('123456-123456-123456');
    });

    it('模拟真实预警通知模板', () => {
      const tpl = '【学业预警】{student_name}（学号 {student_no}）触发{level_cn}预警，验证码 {code}';
      expect(renderTemplate(tpl, params)).toBe(
        '【学业预警】张三（学号 2023001）触发红色预警，验证码 123456',
      );
    });
  });

  describe('向后兼容旧写法 \\{key\\}', () => {
    it('替换 \\{key\\}', () => {
      expect(renderTemplate('\\{code\\}', params)).toBe('123456');
    });

    it('替换嵌在句子中的 \\{key\\} 且不残留反斜杠', () => {
      expect(renderTemplate('码是 \\{code\\} 完', params)).toBe('码是 123456 完');
    });
  });

  describe('未知占位符保留原样', () => {
    it('完全未知的占位符不被替换、不被清空', () => {
      expect(renderTemplate('{unknown}', params)).toBe('{unknown}');
    });

    it('未知与已知混合时只替换已知', () => {
      expect(renderTemplate('{unknown} 和 {code}', params)).toBe('{unknown} 和 123456');
    });
  });

  describe('String.replace 特殊替换字符陷阱', () => {
    it.each([
      ['$&', '$&'],
      ['$1', '$1'],
      ['$`', '$`'],
      ["$'", "$'"],
      ['$$', '$$'],
    ])('值 %s 按字面量输出', (value, expected) => {
      expect(renderTemplate('{x}', { x: value })).toBe(expected);
    });
  });

  describe('空值处理', () => {
    it('null 渲染为空串', () => {
      expect(renderTemplate('[{x}]', { x: null })).toBe('[]');
    });

    it('undefined 渲染为空串', () => {
      expect(renderTemplate('[{x}]', { x: undefined })).toBe('[]');
    });

    it('空字符串渲染为空串', () => {
      expect(renderTemplate('[{x}]', { x: '' })).toBe('[]');
    });

    it('数字与布尔值正常字符串化', () => {
      expect(renderTemplate('{n}/{b}', { n: 0, b: false })).toBe('0/false');
    });
  });

  describe('键名与边界的健壮性', () => {
    it('键名含正则元字符（点号）仍可匹配', () => {
      expect(renderTemplate('{a.b}', { 'a.b': 'OK' })).toBe('OK');
    });

    it('键名含加号仍可匹配', () => {
      expect(renderTemplate('{a+b}', { 'a+b': 'OK' })).toBe('OK');
    });

    it('无参数时原样返回', () => {
      expect(renderTemplate('{code}', {})).toBe('{code}');
    });

    it('空模板返回空串', () => {
      expect(renderTemplate('', params)).toBe('');
    });

    it('不含占位符的模板原样返回', () => {
      expect(renderTemplate('纯文本无占位符', params)).toBe('纯文本无占位符');
    });
  });

  describe('单遍扫描：值中内容不得被二次展开', () => {
    it('值中含其他占位符文本时不被再次替换', () => {
      // params={a:'{b}', b:'X'}：若按 key 逐次 replace，{a}→{b}→X（错误）
      expect(renderTemplate('{a}', { a: '{b}', b: 'X' })).toBe('{b}');
    });

    it('值中含 $& 等替换模式不被二次解释', () => {
      expect(renderTemplate('{a}|{b}', { a: '$&', b: 'ok' })).toBe('$&|ok');
    });
  });
});
