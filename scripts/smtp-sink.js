/**
 * 极简 SMTP 收信服务（仅用于本地端到端验证）
 *
 * 不依赖任何第三方库，用 Node 内置 net 实现足够支撑 nodemailer 的最小 SMTP 会话：
 *   greeting -> EHLO -> AUTH LOGIN -> MAIL FROM -> RCPT TO -> DATA -> . -> QUIT
 * 收到邮件后把原始报文落盘到 _mail_sink_out/，并打印摘要。
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SINK_PORT || 2525);
const OUT = path.join(__dirname, '..', '_mail_sink_out');
fs.mkdirSync(OUT, { recursive: true });

let seq = 0;

const isBase64 = (s) => s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

const server = net.createServer((sock) => {
  let buf = '';
  let mode = 'cmd'; // 'cmd' | 'auth-user' | 'auth-pass' | 'data'
  let raw = [];
  let envelope = { from: null, to: [] };

  const send = (line) => sock.write(line + '\r\n');

  send('220 localhost SMTP sink ready');

  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      // ---- DATA 阶段：原样收集，直到单独一行的 "." ----
      if (mode === 'data') {
        if (line === '.') {
          const eml = raw.join('\r\n');
          seq += 1;
          const file = path.join(OUT, `mail-${String(seq).padStart(3, '0')}.eml`);
          fs.writeFileSync(file, eml, 'utf8');
          console.log(
            `\n=== 收到第 ${seq} 封邮件 -> ${file} ===\n` +
              `MAIL FROM: ${envelope.from}\nRCPT TO: ${envelope.to.join(', ')}\n` +
              `--- 原始报文 ---\n${eml}\n=== END ===\n`,
          );
          envelope = { from: null, to: [] };
          raw = [];
          mode = 'cmd';
          send('250 OK queued');
        } else {
          raw.push(line);
        }
        continue;
      }

      // ---- AUTH LOGIN 的用户名/密码两步 ----
      if (mode === 'auth-user' || mode === 'auth-pass') {
        const wasUser = mode === 'auth-user';
        mode = wasUser ? 'auth-pass' : 'cmd';
        send(wasUser ? '334 UGFzc3dvcmQ6' : '235 Authentication successful');
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        send('250-localhost');
        send('250-AUTH LOGIN PLAIN');
        send('250-8BITMIME');
        send('250 SIZE 10485760');
      } else if (upper.startsWith('AUTH LOGIN')) {
        // "AUTH LOGIN" 之后还剩内容则是内联用户名，否则等服务端索取
        const inline = line.slice('AUTH LOGIN'.length).trim();
        if (inline && isBase64(inline)) {
          mode = 'auth-pass';
          send('334 UGFzc3dvcmQ6');
        } else {
          mode = 'auth-user';
          send('334 VXNlcm5hbWU6');
        }
      } else if (upper.startsWith('AUTH PLAIN')) {
        send('235 Authentication successful');
      } else if (upper.startsWith('MAIL FROM')) {
        envelope.from = line.replace(/^MAIL FROM:\s*/i, '');
        send('250 OK');
      } else if (upper.startsWith('RCPT TO')) {
        envelope.to.push(line.replace(/^RCPT TO:\s*/i, ''));
        send('250 OK');
      } else if (upper.startsWith('DATA')) {
        mode = 'data';
        raw = [];
        send('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper.startsWith('QUIT')) {
        send('221 Bye');
        sock.end();
      } else if (upper.startsWith('RSET') || upper.startsWith('NOOP')) {
        send('250 OK');
      } else {
        send('250 OK');
      }
    }
  });

  sock.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SMTP sink listening on 0.0.0.0:${PORT}, output -> ${OUT}`);
});
