/*
 * 准星实验室 · 后端 API（Cloudflare Worker + D1）
 *
 * 职责很小但很集中：
 *   1. 短链      —— 把 130 字符的准星分享码压成 6 位短链，方便在聊天里发
 *   2. 埋点计数  —— 打开 / 套用 / 复制各记一笔，用来做热门榜
 *   3. 热门榜    —— 按打开数和套用数排序
 *
 * 设计原则：不引入任何依赖，路由和 SQL 都写在这一个文件里，方便直接跑测试。
 */

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 6;
const ID_PATTERN = /^[0-9a-z]{6}$/;

const CODE_MAX_LENGTH = 200;
const CODE_PATTERN = /^[0-9A-Za-z;#._-]+$/;

const NAME_MAX_LENGTH = 40;
const BODY_MAX_LENGTH = 4096;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/* 事件类型 → 数据库列名。用白名单映射，避免把用户输入拼进 SQL */
const EVENT_COLUMNS = {
  open: 'hits',
  apply: 'applies',
  copy: 'copies'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === 'OPTIONS') {
      return withCors(request, env, new Response(null, { status: 204 }));
    }

    try {
      const response = await route(request, env, ctx, url, path);
      return withCors(request, env, response);
    } catch (error) {
      return withCors(request, env, json({
        error: 'server_error',
        message: String((error && error.message) || error)
      }, 500));
    }
  }
};

async function route(request, env, ctx, url, path) {
  if (path === '/' ) {
    return json({
      service: 'crosshair-lab-api',
      endpoints: [
        'GET  /api/health',
        'POST /api/share      { code, name }',
        'GET  /api/share/:id',
        'POST /api/event      { id, type }',
        'GET  /api/top?limit=10',
        'GET  /api/stats',
        'GET  /s/:id          跳转到站点并带上分享码'
      ]
    });
  }

  if (path === '/api/health') {
    return json({ ok: true, time: Math.floor(Date.now() / 1000) });
  }

  if (path === '/api/share') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    return createShare(request, env);
  }

  if (path.startsWith('/api/share/')) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return readShare(path.slice('/api/share/'.length), env, ctx);
  }

  if (path === '/api/event') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    return recordEvent(request, env);
  }

  if (path === '/api/top') {
    return listTop(url, env);
  }

  if (path === '/api/stats') {
    return readStats(env);
  }

  if (path.startsWith('/s/')) {
    return redirectShort(path.slice('/s/'.length), env, ctx);
  }

  return json({ error: 'not_found' }, 404);
}

/* ---------------- 短链 ---------------- */

async function createShare(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const codeProblem = validateCode(code);
  if (codeProblem) return json({ error: 'invalid_code', message: codeProblem }, 400);

  const name = String(body.name || '').slice(0, NAME_MAX_LENGTH);

  /* 同一支准星复用同一个短链，先查一次，省掉大部分重试 */
  const existing = await findShareByCode(env, code);
  if (existing) return json(existing);

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId(ID_LENGTH);
    try {
      await env.DB
        .prepare('INSERT INTO shares (id, code, name, hits, applies, copies, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)')
        .bind(id, code, name, Math.floor(Date.now() / 1000))
        .run();
      return json({ id, code, name, hits: 0, applies: 0, copies: 0 });
    } catch (error) {
      /* 唯一索引冲突：可能是 id 撞了，也可能是并发的同一支准星先进来了 */
      const raced = await findShareByCode(env, code);
      if (raced) return json(raced);
    }
  }

  return json({ error: 'id_collision' }, 500);
}

async function readShare(id, env, ctx) {
  if (!ID_PATTERN.test(id)) return json({ error: 'invalid_id' }, 400);

  const row = await env.DB
    .prepare('SELECT id, code, name, hits, applies, copies FROM shares WHERE id = ?')
    .bind(id)
    .first();

  if (!row) return json({ error: 'not_found' }, 404);

  /* 统计不阻塞响应：交给 waitUntil 在后台更新 */
  ctx.waitUntil(bump(env, id, 'hits'));

  return json({ ...row, hits: row.hits + 1 });
}

async function redirectShort(id, env, ctx) {
  if (!ID_PATTERN.test(id)) return json({ error: 'invalid_id' }, 400);

  const row = await env.DB
    .prepare('SELECT code FROM shares WHERE id = ?')
    .bind(id)
    .first();

  if (!row) return new Response('短链不存在或已失效', { status: 404 });

  ctx.waitUntil(bump(env, id, 'hits'));

  const target = new URL(env.SITE_BASE || 'https://valorant-crosshair.pages.dev');
  target.searchParams.set('c', row.code);
  target.searchParams.set('s', id);
  target.hash = 'designer';
  return Response.redirect(target.toString(), 302);
}

/* ---------------- 埋点 ---------------- */

async function recordEvent(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';

  if (!ID_PATTERN.test(id)) return json({ error: 'invalid_id' }, 400);
  if (!Object.prototype.hasOwnProperty.call(EVENT_COLUMNS, type)) {
    return json({ error: 'invalid_type', allowed: Object.keys(EVENT_COLUMNS) }, 400);
  }

  const result = await bump(env, id, EVENT_COLUMNS[type]);
  /* UPDATE 命中 0 行说明这个短链不存在；不能只看有没有抛异常 */
  const changed = result && result.meta ? Number(result.meta.changes || 0) : 0;
  if (!changed) return json({ error: 'not_found' }, 404);

  await env.DB
    .prepare('INSERT INTO events (share_id, type, created_at) VALUES (?, ?, ?)')
    .bind(id, type, Math.floor(Date.now() / 1000))
    .run();

  return json({ ok: true });
}

/* 列名来自白名单常量，不来自请求体，所以这里的拼接是安全的 */
function bump(env, id, column) {
  if (!Object.values(EVENT_COLUMNS).includes(column)) {
    return Promise.resolve(null);
  }
  return env.DB
    .prepare('UPDATE shares SET ' + column + ' = ' + column + ' + 1 WHERE id = ?')
    .bind(id)
    .run();
}

/* ---------------- 榜单与统计 ---------------- */

async function listTop(url, env) {
  const limit = clampLimit(url.searchParams.get('limit'));
  const { results } = await env.DB
    .prepare('SELECT id, code, name, hits, applies, copies FROM shares ORDER BY hits DESC, applies DESC, created_at DESC LIMIT ?')
    .bind(limit)
    .all();

  return json({ limit, items: results || [] });
}

async function readStats(env) {
  const totals = await env.DB
    .prepare('SELECT COUNT(*) AS shares, COALESCE(SUM(hits), 0) AS hits, COALESCE(SUM(applies), 0) AS applies, COALESCE(SUM(copies), 0) AS copies FROM shares')
    .first();

  const byType = await env.DB
    .prepare('SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC')
    .all();

  return json({ totals, events: byType.results || [] });
}

/* ---------------- 工具函数 ---------------- */

async function findShareByCode(env, code) {
  const row = await env.DB
    .prepare('SELECT id, code, name, hits, applies, copies FROM shares WHERE code = ?')
    .bind(code)
    .first();
  return row || null;
}

function validateCode(code) {
  if (!code) return '分享码不能为空';
  if (code.length > CODE_MAX_LENGTH) return '分享码长度超过 ' + CODE_MAX_LENGTH;
  if (!CODE_PATTERN.test(code)) return '分享码包含非法字符';
  return null;
}

/* 取模前先丢掉尾部，避免随机数偏置（36 不能整除 256） */
function newId(length) {
  const limit = Math.floor(256 / ID_ALPHABET.length) * ID_ALPHABET.length;
  const buffer = new Uint8Array(length * 2);
  let out = '';
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (let i = 0; i < buffer.length && out.length < length; i++) {
      if (buffer[i] < limit) out += ID_ALPHABET[buffer[i] % ID_ALPHABET.length];
    }
  }
  return out;
}

function clampLimit(raw) {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, value);
}

function normalizePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

async function readJson(request) {
  const text = await request.text();
  if (!text || text.length > BODY_MAX_LENGTH) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/*
 * CORS：白名单可配置，逗号分隔；没配置就放开，方便本地起服务器调试。
 * 只允许白名单里的来源携带凭据访问，其它来源会被浏览器拦下。
 */
function withCors(request, env, response) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String((env && env.ALLOWED_ORIGINS) || '')
    .split(',')
    .map(function (item) { return item.trim(); })
    .filter(Boolean);

  let allowOrigin = '*';
  if (allowed.length) {
    allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  }

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');

  return new Response(response.body, { status: response.status, headers });
}
