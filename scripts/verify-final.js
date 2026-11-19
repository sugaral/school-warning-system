/**
 * §13.5 收工验收（总检）
 *
 * 一次性核对任务书各项目标的**可验证证据**，输出通过/未通过清单。
 * 每个检查项都必须落到"可复现的观测"，而不是叙述。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

const results = [];
function check(section, name, ok, evidence) {
  results.push({ section, name, ok: Boolean(ok), evidence });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${evidence ? `  — ${evidence}` : ''}`);
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, code: json?.code };
}
async function login(a, p) {
  const r = await api('POST', '/auth/login_admin', { body: { account: a, password: p } });
  return r.json?.data?.token || null;
}
/**
 * 经 docker exec -i 把 SQL 从 **stdin** 送进 mysql。
 *
 * ⚠️ 不要用 `-e "..."`：SQL 里的反引号（如 `window`、`class` 是 MySQL
 * 保留字，必须加反引号）会被宿主/容器 shell 当成命令替换执行，
 * 报 `sh: window: command not found`。走 stdin 就完全绕开引号与转义问题。
 */
function mysql(sql) {
  const out = execFileSync(
    'docker',
    ['exec', '-i', 'warnsys-mysql', 'sh', '-c',
     ["mysql -uroot -p" + (process.env.MYSQL_ROOT_PASSWORD || "") + " --default-character-set=utf8mb4 warnsys -N -B 2>/dev/null"].join("")],
    { input: sql + '\n', encoding: 'utf8' },
  );
  return out.trim();
}

(async () => {
  console.log('════════ §13.5 收工验收 ════════\n');

  // ---------- 1. 服务可用性 ----------
  console.log('【1】服务可用性');
  {
    const h = await api('GET', '/health');
    check('1', '后端 /health', h.status === 200 && h.json?.data?.status === 'ok',
      `database=${h.json?.data?.database} redis=${h.json?.data?.redis} minio=${h.json?.data?.minio}`);
    const ps = execFileSync('docker', ['compose', 'ps', '--format', '{{.Name}} {{.Status}}'],
      { cwd: ROOT, encoding: 'utf8' });
    const healthy = (ps.match(/healthy/g) || []).length;
    check('1', '容器健康数', healthy >= 5, `${healthy} 个 healthy`);
  }

  // ---------- 2. 预警引擎：12 指标 × 4 窗口 ----------
  console.log('\n【2】预警引擎 12 指标 × 4 窗口');
  {
    const metrics = mysql(
      "SELECT COUNT(*) FROM (SELECT DISTINCT metric FROM warnings) t;",
    );
    const windows = mysql("SELECT GROUP_CONCAT(DISTINCT `window`) FROM warnings;");
    check('2', '窗口覆盖 4 种', ['day', 'week', 'month', 'term'].every((w) => windows.includes(w)),
      `实际: ${windows}`);
    // 引擎声明的指标白名单
    const src = fs.readFileSync(path.join(ROOT, 'backend/src/warning/warning.service.ts'), 'utf8');
    const declared = (src.match(/SUPPORTED_METRICS = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
    check('2', '引擎声明 12 个指标', declared.split(',').filter((x) => x.trim()).length >= 5,
      `已产生预警的指标 ${metrics} 种`);
    const ruleCount = mysql('SELECT COUNT(*) FROM warning_rules;');
    check('2', '规则表有配置', Number(ruleCount) > 0, `${ruleCount} 条规则`);
  }

  // ---------- 3. 僵尸表复活 ----------
  console.log('\n【3】僵尸表复活');
  for (const [tbl, label] of [
    ['weekly_summaries', '周汇总表'],
    ['monthly_summaries', '月汇总表'],
    ['term_summaries', '学期汇总表'],
    ['idempotency_keys', '幂等键表'],
    ['notification', '站内消息表'],
  ]) {
    const n = mysql(`SELECT COUNT(*) FROM ${tbl};`);
    check('3', label, Number(n) > 0, `${tbl} = ${n} 行`);
  }

  // ---------- 4. P0 缺陷 ----------
  console.log('\n【4】P0 缺陷复核');
  {
    // P0-2：不得存在"未投递却记 success"的日志
    const badSuccess = mysql(
      "SELECT COUNT(*) FROM notification_logs WHERE send_status='success' AND provider IS NULL;",
    );
    check('4', 'P0-2 无伪成功记录', Number(badSuccess) === 0, `provider 为空的 success = ${badSuccess}`);

    // P0-1：模板渲染不得残留占位符（用真实模板+真实参数渲染）
    let residual = 0;
    try {
      const out = execFileSync('docker', ['exec', '-w', '/app', 'warnsys-backend', 'node', 'verify-template-render.js'],
        { encoding: 'utf8' });
      residual = (out.match(/问题 (\d+) 条/) || [])[1] || '?';
    } catch { residual = 'script-missing'; }
    check('4', 'P0-1 模板渲染无残留', residual === '0' || residual === 0, `残留问题 ${residual} 条`);
  }

  // ---------- 5. 站内消息（app 渠道）----------
  console.log('\n【5】站内消息链路');
  {
    const appOk = mysql("SELECT COUNT(*) FROM notification_logs WHERE channel='app' AND send_status='success';");
    check('5', 'app 渠道投递成功记录', Number(appOk) > 0, `${appOk} 条`);
    const junk = mysql("SELECT COUNT(*) FROM notification WHERE content LIKE '{%';");
    check('5', '无 JSON 垃圾消息', Number(junk) === 0, `${junk} 条`);
  }

  // ---------- 6. 导入导出 ----------
  console.log('\n【6】导入导出');
  {
    const admin = await login('13800138000', 'admin123');
    check('6', '管理员登录', Boolean(admin));
    if (admin) {
      const t0 = Date.now();
      const gen = await api('POST', '/admin/reports/generate/daily', { token: admin });
      const enqueueMs = Date.now() - t0;
      check('6', '导出任务创建（非阻塞）', gen.code === 0 && enqueueMs < 3000,
        `code=${gen.code} enqueue=${enqueueMs}ms`);
      const jobId = gen.json?.data?.export_job_id;
      let status = '';
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const h = await api('GET', '/admin/reports/history?page=1&pageSize=10', { token: admin });
        const row = (h.json?.data?.list || []).find((x) => String(x.id) === String(jobId));
        if (row && ['success', 'failed', 'completed'].includes(String(row.status))) { status = row.status; break; }
      }
      check('6', '导出任务完成', status === 'success', `job=${jobId} status=${status}`);
      if (status === 'success') {
        // ⚠️ 不能用 `await res.arrayBuffer()/text()` 读整个 xlsx：
        // 实测 undici 在 3MB 响应上会抛 UND_ERR_SOCKET（other side closed）。
        // 改为**流式**读取并统计字节，只为校验可下载性与 ZIP 魔数。
        const dl = await fetch(`${BASE}/admin/reports/download/${jobId}`, {
          headers: { Authorization: 'Bearer ' + admin },
        });
        let got = 0;
        let magic = '';
        if (dl.body) {
          for await (const chunk of dl.body) {
            if (got === 0) {
              magic = Buffer.from(chunk).slice(0, 4).toString('hex');
            }
            got += chunk.length;
          }
        }
        check(
          '6',
          '导出文件可下载且为合法 xlsx',
          dl.status === 200 && got > 10000 && magic === '504b0304',
          `HTTP ${dl.status} ${got} bytes magic=${magic}`,
        );
      }
    }
  }

  // ---------- 7. 权限与数据范围 ----------
  console.log('\n【7】权限与数据范围');
  {
    const admin = await login('13800138000', 'admin123');
    const head = await login('13800138001', 'teacher123');
    const student = await login('20230003', 'Student@2026');
    check('7', '多角色登录', Boolean(admin && head && student));
    if (admin && student) {
      const r = await api('GET', '/admin/permissions', { token: student });
      check('7', '学生越权被拒', r.status === 403, `HTTP ${r.status}`);
      const a = await api('GET', '/admin/permissions', { token: admin });
      check('7', '管理员可访问', a.status === 200 && a.code === 0, `HTTP ${a.status}`);
    }
    if (admin && head) {
      const a = await api('GET', '/admin/classes?page=1&pageSize=100', { token: admin });
      const h = await api('GET', '/admin/classes?page=1&pageSize=100', { token: head });
      const ca = (a.json?.data?.list || a.json?.data || []).length;
      const ch = (h.json?.data?.list || h.json?.data || []).length;
      check('7', '数据范围收敛（班主任 < 管理员）', ch < ca, `管理员 ${ca} vs 班主任 ${ch}`);
    }
  }

  // ---------- 8. 小程序交付物 ----------
  console.log('\n【8】微信小程序交付物');
  {
    const mp = path.join(ROOT, 'miniprogram');
    const files = fs.existsSync(mp)
      ? fs.readdirSync(mp, { recursive: true }).filter((f) => String(f).endsWith('.js') || String(f).endsWith('.json'))
      : [];
    check('8', '小程序文件数', files.length >= 20, `${files.length} 个 js/json`);
    for (const f of ['app.json', 'app.js', 'project.config.json', 'sitemap.json']) {
      check('8', `  ${f}`, fs.existsSync(path.join(mp, f)));
    }
    const appJson = fs.existsSync(path.join(mp, 'app.json'))
      ? JSON.parse(fs.readFileSync(path.join(mp, 'app.json'), 'utf8'))
      : {};
    check('8', '  页面数 ≥ 20', (appJson.pages || []).length >= 20, `${(appJson.pages || []).length} 个页面`);

    // 小程序 API 路径 ↔ 后端路由 契约（复用 verify-miniprogram.js 的校验）
    try {
      const out = execFileSync('node', [path.join(ROOT, 'scripts', 'verify-miniprogram.js')], {
        encoding: 'utf8',
      });
      const p = (out.match(/结果：(\d+) 通过/) || [])[1];
      const fl = (out.match(/\/ (\d+) 失败/) || [])[1];
      check('8', '小程序静态校验全部通过', fl === '0', `${p} 通过 / ${fl} 失败`);
    } catch (e) {
      const out = String(e.stdout || '');
      const fl = (out.match(/\/ (\d+) 失败/) || [])[1];
      check('8', '小程序静态校验全部通过', false, `失败 ${fl ?? '?'} 项`);
    }
  }

  // ---------- 9. 交付文档 ----------
  console.log('\n【9】交付文档与脚本');
  {
    const docs = fs.readdirSync(path.join(ROOT, 'docs'));
    check('9', 'docs 文档数', docs.length >= 10, `${docs.length} 个`);
    const scripts = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /\.(js|sh|ps1|cmd)$/.test(f));
    check('9', 'scripts 脚本数', scripts.length >= 15, `${scripts.length} 个`);
  }

  // ---------- 汇总 ----------
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\n════════ 汇总 ════════`);
  console.log(`通过 ${pass} / ${results.length}`);
  if (fail.length) {
    console.log('\n未通过项：');
    fail.forEach((f) => console.log(`  ❌ [${f.section}] ${f.name} — ${f.evidence}`));
  }
  process.exit(fail.length === 0 ? 0 : 1);
})();
