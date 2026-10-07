/*
 * 解析逻辑的回归测试。
 *
 * 起因：第一版用批处理的 for /f 解析 wrangler 输出，把 JSON 里的
 * "database_id" 这个**键名**当成了值写进配置，导致 d1 execute 报 Invalid uuid。
 * 现在解析搬到 Node 里，这里用真实输出格式把它钉住。
 *
 * 用法：node work/parse-test.js
 */
const path = require('path');
const deploy = require('./deploy-backend.js');

const results = [];
function check(label, actual, expected) {
  results.push({ label: label, ok: actual === expected, actual: actual, expected: expected });
}

/* ---------- 1. wrangler 4.x 的真实输出：JSON 格式 ---------- */
const JSON_FORMAT = `
 ⛅️ wrangler 4.147.0
────────────────────────────
✅ Successfully created DB 'crosshair-lab' in region WNAM
Created your new D1 database.

To access your new D1 Database in your Worker, add the following snippet to your configuration file:
{
  "d1_databases": [
    {
      "binding": "crosshair_lab",
      "database_name": "crosshair-lab",
      "database_id": "c93b8367-038b-4920-9150-6937bc788853"
    }
  ]
}
`;
check('JSON 格式能取到 UUID（之前就是这里取错的）',
  deploy.findUuid(JSON_FORMAT, 'crosshair-lab'),
  'c93b8367-038b-4920-9150-6937bc788853');

/* ---------- 2. 老版本的 TOML 格式也要认得 ---------- */
const TOML_FORMAT = `
[[d1_databases]]
binding = "DB"
database_name = "crosshair-lab"
database_id = "aaaabbbb-cccc-dddd-eeee-ffff00001111"
`;
check('TOML 格式也能取到 UUID',
  deploy.findUuid(TOML_FORMAT, 'crosshair-lab'),
  'aaaabbbb-cccc-dddd-eeee-ffff00001111');

/* ---------- 3. d1 list 的表格输出：同一行里既有名字又有 ID ---------- */
const LIST_FORMAT = `
┌──────────────┬──────────────────────────────────────┬────────────────────┐
│ name         │ uuid                                 │ created_at         │
├──────────────┼──────────────────────────────────────┼────────────────────┤
│ other-db     │ 11111111-2222-3333-4444-555555555555 │ 2026-01-01         │
│ crosshair-lab│ 99999999-8888-7777-6666-555555555555 │ 2026-10-07         │
└──────────────┴──────────────────────────────────────┴────────────────────┘
`;
check('d1 list 里会挑中同名的那个，而不是第一个',
  deploy.findUuid(LIST_FORMAT, 'crosshair-lab'),
  '99999999-8888-7777-6666-555555555555');

/* ---------- 4. 没有任何 UUID 时返回空串，而不是乱给一个值 ---------- */
check('没有 UUID 时返回空字符串', deploy.findUuid('nothing here', 'crosshair-lab'), '');
check('空输入安全', deploy.findUuid('', 'crosshair-lab'), '');

/* ---------- 5. deploy 输出里的 Worker 地址 ---------- */
const DEPLOY_OUTPUT = `
Total Upload: 12.34 KiB / gzip: 4.56 KiB
Uploaded crosshair-lab-api (2.11 sec)
Deployed crosshair-lab-api triggers (1.02 sec)
  https://crosshair-lab-api.example.workers.dev
Current Version ID: 8f3d2c1b
`;
check('能取到 Worker 地址',
  deploy.findWorkerUrl(DEPLOY_OUTPUT),
  'https://crosshair-lab-api.example.workers.dev');
check('地址结尾的斜杠会被去掉',
  deploy.findWorkerUrl('see https://x.workers.dev/ here'),
  'https://x.workers.dev');
check('没有地址时返回空字符串', deploy.findWorkerUrl('no url'), '');

/* ---------- 6. 真实的采集文件（如果还在的话） ---------- */
const fs = require('fs');
const captured = path.join(process.env.TEMP || '', 'vcl-deploy', 'd1create.txt');
if (fs.existsSync(captured)) {
  const text = fs.readFileSync(captured, 'utf8');
  const id = deploy.findUuid(text, 'crosshair-lab');
  check('从真实采集的 wrangler 输出里也能提取',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id), true);
  console.log('（真实采集文件里读到的 ID: ' + id + '）');
} else {
  console.log('（没找到采集文件，跳过真实样本用例）');
}

/* ---------- 7. 配置文件本身是否还能被 wrangler 解析 ---------- */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

{
  const fsx = fs;
  const configPath = path.join(__dirname, '..', 'backend', 'wrangler.jsonc');
  const raw = fsx.readFileSync(configPath, 'utf8');
  let parsed = null;
  let error = '';
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (e) {
    error = e.message;
  }
  check('wrangler.jsonc 是合法 JSONC', !!parsed, true);
  if (!parsed) console.log('    解析失败: ' + error);
  check('配置里 database_id 是合法 UUID',
    !!(parsed && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.d1_databases[0].database_id)),
    true);
  check('配置里保留了中文注释', raw.indexOf('部署前') >= 0, true);
  check('配置里的 SITE_BASE 没被写坏',
    !!(parsed && parsed.vars.SITE_BASE === 'https://valorant-crosshair.pages.dev'),
    true);
}

/* ---------- 汇总 ---------- */
const failed = results.filter(function (r) { return !r.ok; });
console.log('通过 ' + (results.length - failed.length) + ' / ' + results.length + ' 项');
failed.forEach(function (r) {
  console.log('  ✗ ' + r.label + '  期望=' + r.expected + '  实际=' + r.actual);
});
if (failed.length) process.exitCode = 1;
