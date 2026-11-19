// 容器内：原生 http 下载导出文件 -> 校验 ZIP/xlsx 结构
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');

// Token 通过文件传入（避免经 shell 传参时被引号/特殊字符破坏）
const TOKEN_FILE = process.env.TOKEN_FILE || '/tmp/_tok.txt';
const TOKEN = String(process.env.TOKEN || '').trim() || fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const JOB = process.argv[2] || '30';

function download(p) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 3000, path: p, method: 'GET',
        headers: { Authorization: 'Bearer ' + TOKEN } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function listZipEntries(buf) {
  const entries = [];
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    entries.push({ name, method, compSize, dataStart });
    off = dataStart + compSize;
  }
  return entries;
}

(async () => {
  const r = await download('/admin/reports/download/' + JOB);
  console.log('HTTP', r.status, 'bytes=', r.buf.length);
  const magic = r.buf.slice(0, 4).toString('hex');
  console.log('magic =', magic, magic === '504b0304' ? 'OK 合法 ZIP/xlsx' : 'FAIL 非 ZIP');

  const entries = listZipEntries(r.buf);
  const names = entries.map((e) => e.name);
  console.log('ZIP 条目数 =', entries.length);
  entries.slice(0, 6).forEach((e) => console.log('   -', e.name));
  ['[Content_Types].xml', 'xl/workbook.xml'].forEach((n) =>
    console.log('  ', names.includes(n) ? 'OK' : 'FAIL', '含', n),
  );

  const ss = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (ss) {
    const raw = r.buf.slice(ss.dataStart, ss.dataStart + ss.compSize);
    const xml = ss.method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    console.log('OK sharedStrings 解压成功, <si> 条目 =', (xml.match(/<si>/g) || []).length);
  }

  const sheet = entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
  if (sheet) {
    const raw = r.buf.slice(sheet.dataStart, sheet.dataStart + sheet.compSize);
    const xml = sheet.method === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8');
    console.log('OK sheet1 解压成功, 行数 =', (xml.match(/<row /g) || []).length);
  }
})().catch((e) => console.log('ERR', e.message));
