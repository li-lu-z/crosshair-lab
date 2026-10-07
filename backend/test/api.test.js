/*
 * 后端接口测试（不依赖任何第三方库）
 *
 * 思路：Worker 只依赖标准的 Request / Response / D1 三个接口，
 * 所以本地用 node:sqlite 造一个真的 SQLite 库、按 D1 的 API 包一层，
 * 再用真的 Request 对象去调 worker.fetch —— 测的是真代码和真 SQL。
 *
 * 运行：node backend/test/api.test.js
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'schema.sql'), 'utf8');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(label + (detail ? '  →  ' + detail : ''));
  }
}

/* ---------- 用真 SQLite 模拟 D1 ---------- */
function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);

  function statement(sql, params) {
    return {
      bind: function () { return statement(sql, Array.from(arguments)); },
      first: async function () {
        const row = db.prepare(sql).get(...params);
        return row === undefined ? null : row;
      },
      all: async function () {
        return { results: db.prepare(sql).all(...params) };
      },
      run: async function () {
        const info = db.prepare(sql).run(...params);
        return { success: true, meta: info };
      }
    };
  }

  return {
    prepare: function (sql) { return statement(sql, []); },
    /* 测试里直接查库用 */
    raw: db
  };
}

const DB = createD1();
const env = {
  DB: DB,
  SITE_BASE: 'https://valorant-crosshair.pages.dev',
  ALLOWED_ORIGINS: 'https://valorant-crosshair.pages.dev, http://localhost:8080'
};

function createCtx() {
  const pending = [];
  return {
    pending: pending,
    waitUntil: function (promise) { pending.push(Promise.resolve(promise)); }
  };
}

async function call(method, path, body, headers) {
  const ctx = createCtx();
  const request = new Request('https://api.test' + path, {
    method: method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await worker.fetch(request, env, ctx);
  await Promise.all(ctx.pending);
  let payload = null;
  const text = await response.clone().text();
  if (text) {
    try { payload = JSON.parse(text); } catch (error) { payload = text; }
  }
  return { status: response.status, headers: response.headers, body: payload, response: response };
}

const SAMPLE = '0;s;1;P;c;5;h;1;t;1;o;1;d;0;z;2;a;1;m;0;0b;1;0t;1;0l;4;0o;2;0a;1;0m;0;0s;1;0f;0;0e;1;1b;0;1t;2;1l;2;1o;10;1a;1;1m;1;1s;1;1f;1;1e;1';
const OTHER = '0;s;1;P;h;0;d;1;z;3;a;1;0b;0;0t;2;0l;6;0o;3;0a;1;0m;0;0f;0;1b;0;1t;2;1l;2;1o;10;1a;1;1m;0;1f;0';

/* ---------- 1. 健康检查与路由 ---------- */
{
  const health = await call('GET', '/api/health');
  check('健康检查返回 200', health.status === 200, 'status=' + health.status);
  check('健康检查返回 ok', health.body && health.body.ok === true);

  const root = await call('GET', '/');
  check('根路径返回服务说明', root.status === 200 && Array.isArray(root.body.endpoints));

  const missing = await call('GET', '/api/不存在');
  check('未知路径返回 404', missing.status === 404);
}

/* ---------- 2. 创建短链 ---------- */
let shareId = '';
{
  const created = await call('POST', '/api/share', { code: SAMPLE, name: '青色细十字' });
  check('创建短链返回 200', created.status === 200, 'status=' + created.status);
  check('短链 ID 是 6 位小写字母数字', /^[0-9a-z]{6}$/.test(created.body.id), JSON.stringify(created.body.id));
  check('返回的分享码与提交一致', created.body.code === SAMPLE);
  check('初始计数为 0', created.body.hits === 0 && created.body.applies === 0 && created.body.copies === 0);
  shareId = created.body.id;

  const again = await call('POST', '/api/share', { code: SAMPLE, name: '重复提交' });
  check('同一支准星重复提交复用同一个短链', again.body.id === shareId, again.body.id + ' vs ' + shareId);

  const other = await call('POST', '/api/share', { code: OTHER });
  check('不同的准星会拿到不同短链', other.body.id !== shareId);

  const stored = DB.raw.prepare('SELECT COUNT(*) AS n FROM shares').get();
  check('数据库里确实只存了两行（重复的被复用）', stored.n === 2, 'n=' + stored.n);
}

/* ---------- 3. 入参校验 ---------- */
{
  const empty = await call('POST', '/api/share', { code: '   ' });
  check('空分享码被拒绝', empty.status === 400 && empty.body.error === 'invalid_code');

  const tooLong = await call('POST', '/api/share', { code: 'a'.repeat(201) });
  check('超长分享码被拒绝', tooLong.status === 400);

  const badChars = await call('POST', '/api/share', { code: '0;P;<script>alert(1)</script>' });
  check('含非法字符的分享码被拒绝', badChars.status === 400);

  const notJson = await call('POST', '/api/share', '这不是 JSON');
  check('非法 JSON 被拒绝', notJson.status === 400 && notJson.body.error === 'invalid_json');

  const wrongMethod = await call('GET', '/api/share');
  check('错误的请求方法返回 405', wrongMethod.status === 405);
}

/* ---------- 4. 读取短链并计数 ---------- */
{
  const read = await call('GET', '/api/share/' + shareId);
  check('读取短链返回 200', read.status === 200, 'status=' + read.status);
  check('读取时打开数 +1', read.body.hits === 1, 'hits=' + (read.body && read.body.hits));

  await call('GET', '/api/share/' + shareId);
  const third = await call('GET', '/api/share/' + shareId);
  check('多次读取持续累加', third.body.hits === 3, 'hits=' + third.body.hits);

  const wrongId = await call('GET', '/api/share/ABC123');
  check('大写短链 ID 被拒绝', wrongId.status === 400);

  const notFound = await call('GET', '/api/share/zzzzzz');
  check('不存在的短链返回 404', notFound.status === 404);
}

/* ---------- 5. 埋点 ---------- */
{
  const apply = await call('POST', '/api/event', { id: shareId, type: 'apply' });
  check('apply 事件记录成功', apply.status === 200 && apply.body.ok === true);

  const copy = await call('POST', '/api/event', { id: shareId, type: 'copy' });
  check('copy 事件记录成功', copy.status === 200);

  const row = DB.raw.prepare('SELECT applies, copies FROM shares WHERE id = ?').get(shareId);
  check('applies 计数写进数据库', row.applies === 1, 'applies=' + row.applies);
  check('copies 计数写进数据库', row.copies === 1, 'copies=' + row.copies);

  const events = DB.raw.prepare('SELECT COUNT(*) AS n FROM events').get();
  check('事件流水表也写入了', events.n === 2, 'n=' + events.n);

  const badType = await call('POST', '/api/event', { id: shareId, type: 'drop_table' });
  check('未知事件类型被拒绝', badType.status === 400 && badType.body.error === 'invalid_type');

  /* 典型的注入尝试：因为列名走白名单，这里必须被挡掉 */
  const injection = await call('POST', '/api/event', { id: shareId, type: 'hits = 999' });
  check('注入形态的事件类型被拒绝', injection.status === 400);
  const survived = DB.raw.prepare('SELECT hits FROM shares WHERE id = ?').get(shareId);
  check('注入尝试没有改动数据', survived.hits === 3, 'hits=' + survived.hits);

  const unknownId = await call('POST', '/api/event', { id: 'zzzzzz', type: 'apply' });
  check('给不存在的短链埋点返回 404', unknownId.status === 404);
}

/* ---------- 6. 热门榜与统计 ---------- */
{
  const top = await call('GET', '/api/top?limit=5');
  check('热门榜返回 200', top.status === 200);
  check('热门榜按打开数排序', top.body.items[0].id === shareId, JSON.stringify(top.body.items.map(function (i) { return i.hits; })));
  check('热门榜条数受 limit 约束', top.body.items.length <= 5);

  const badLimit = await call('GET', '/api/top?limit=abc');
  check('非法 limit 回落到默认值', badLimit.body.limit === 10, 'limit=' + badLimit.body.limit);

  const hugeLimit = await call('GET', '/api/top?limit=9999');
  check('limit 上限被夹住', hugeLimit.body.limit === 50, 'limit=' + hugeLimit.body.limit);

  const stats = await call('GET', '/api/stats');
  check('统计接口返回汇总', stats.status === 200 && stats.body.totals.shares === 2, JSON.stringify(stats.body.totals));
  check('统计接口按类型汇总事件', Array.isArray(stats.body.events) && stats.body.events.length === 2, JSON.stringify(stats.body.events));
}

/* ---------- 7. 短链跳转 ---------- */
{
  const redirect = await call('GET', '/s/' + shareId);
  check('短链跳转返回 302', redirect.status === 302, 'status=' + redirect.status);

  const location = redirect.headers.get('Location');
  const target = new URL(location);
  check('跳转目标是配置里的站点', target.origin === 'https://valorant-crosshair.pages.dev', location);
  check('跳转带上分享码且编码正确', target.searchParams.get('c') === SAMPLE);
  check('跳转带上短链 ID，前端才能回传埋点', target.searchParams.get('s') === shareId, target.searchParams.get('s'));
  check('跳转锚点指向设计器', target.hash === '#designer');

  const gone = await call('GET', '/s/zzzzzz');
  check('不存在的短链跳转返回 404', gone.status === 404);
}

/* ---------- 8. 跨域 ---------- */
{
  const preflight = await call('OPTIONS', '/api/share', undefined, {
    Origin: 'https://valorant-crosshair.pages.dev',
    'Access-Control-Request-Method': 'POST'
  });
  check('预检请求返回 204', preflight.status === 204, 'status=' + preflight.status);
  check('预检允许的方法包含 POST', preflight.headers.get('Access-Control-Allow-Methods').indexOf('POST') >= 0);

  const allowed = await call('GET', '/api/health', undefined, { Origin: 'https://valorant-crosshair.pages.dev' });
  check('白名单内的来源被原样放行', allowed.headers.get('Access-Control-Allow-Origin') === 'https://valorant-crosshair.pages.dev');

  const localhost = await call('GET', '/api/health', undefined, { Origin: 'http://localhost:8080' });
  check('白名单支持多个来源', localhost.headers.get('Access-Control-Allow-Origin') === 'http://localhost:8080');

  const stranger = await call('GET', '/api/health', undefined, { Origin: 'https://evil.example' });
  const echoed = stranger.headers.get('Access-Control-Allow-Origin');
  check('不在白名单的来源不会被原样放行', echoed !== 'https://evil.example', 'returned=' + echoed);
  check('响应带上 Vary: Origin', stranger.headers.get('Vary') === 'Origin');
}

/* ---------- 汇总 ---------- */
console.log('通过 ' + passed + ' 项');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：');
  failures.forEach(function (item) { console.log('  ✗ ' + item); });
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
