// 解码 sink 捕获的邮件，逐个 part 还原为可读文本
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '_mail_sink_out');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.eml')).sort();
if (!files.length) { console.log('尚无捕获邮件'); process.exit(0); }

const decodeHeader = (v) =>
  v.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (m, b64) => Buffer.from(b64, 'base64').toString('utf8'));

for (const f of files) {
  const eml = fs.readFileSync(path.join(dir, f), 'utf8');
  const [head, ...rest] = eml.split(/\r?\n\r?\n/);
  const body = rest.join('\n\n');

  console.log('\n########## ' + f + ' ##########');
  for (const line of head.split(/\r?\n/)) {
    if (/^(Subject|From|To):/i.test(line)) console.log(decodeHeader(line));
  }

  // part 由 boundary 分隔；只取 text/plain 部分
  const parts = body.split(/^----.*$/m);
  for (const p of parts) {
    if (!/Content-Type:\s*text\/plain/i.test(p)) continue;
    const m = p.match(/Content-Transfer-Encoding:\s*base64\s*([\s\S]*)$/i);
    if (!m) {
      console.log('--- text/plain (raw) ---\n' + p.trim());
      continue;
    }
    const b64 = m[1].replace(/[^A-Za-z0-9+/=]/g, '');
    const text = Buffer.from(b64, 'base64').toString('utf8');
    console.log('--- text/plain 解码 ---');
    console.log(text);
    console.log('--- 占位符残留检查 ---');
    const resid = text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
    const bsN = text.includes('\\n');
    console.log('残留占位符: ' + (resid ? resid.join(', ') : '无'));
    console.log('字面量 \\\\n : ' + (bsN ? '存在(异常)' : '无'));
  }
}
