/*
 * 前后端联动检查（jsdom + 假接口）：
 *   场景一：配置了 API_BASE 时，短链按钮、热门榜是否正常出现并工作；
 *   场景二：打开 ?c=分享码 的短链落地页时，准星是否被正确载入；
 *   同时确认热门榜里的名称做了 HTML 转义（防止别人起个带标签的名字）。
 *
 * 用法：NODE_PATH=<jsdom 目录> node work/backend-integration-check.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.join(__dirname, '..', 'outputs', 'valorant-crosshair-lab.html');
const html = fs.readFileSync(file, 'utf8');

const SAMPLE = '0;s;1;P;c;5;h;1;t;1;o;1;d;0;z;2;a;1;m;0;0b;1;0t;1;0l;4;0o;2;0a;1;0m;0;0s;1;0f;0;0e;1;1b;0;1t;2;1l;2;1o;10;1a;1;1m;1;1s;1;1f;1;1e;1';

const results = [];
function check(label, condition, detail) {
  results.push({ label: label, ok: !!condition, detail: detail });
}

function jsonResponse(data, status) {
  return {
    ok: (status || 200) < 400,
    status: status || 200,
    json: function () { return Promise.resolve(data); }
  };
}

function makeFetch(calls, options) {
  const opts = options || {};
  return function (url, init) {
    calls.push({ url: url, init: init });
    if (url.indexOf('/api/top') >= 0) {
      return Promise.resolve(jsonResponse({
        limit: 8,
        items: [{
          id: 'abc123',
          code: SAMPLE,
          name: opts.badName ? '<img src=x onerror=alert(1)>' : '青色准星',
          hits: 12,
          applies: 3,
          copies: 5
        }]
      }));
    }
    if (url.indexOf('/api/share') >= 0) {
      return Promise.resolve(jsonResponse({ id: 'abc123', code: SAMPLE, name: '青色准星', hits: 0, applies: 0, copies: 0 }));
    }
    if (url.indexOf('/api/event') >= 0) {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    return Promise.resolve(jsonResponse({ error: 'not_found' }, 404));
  };
}

function boot(pageUrl, options) {
  const opts = options || {};
  const calls = [];
  const problems = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', function (e) { problems.push('jsdomError: ' + e.message); });

  /* 源文件里的 API_BASE 现在指向真实后端，两种场景都用正则强制改成测试值 */
  const target = opts.withBackend ? 'https://api.test' : '';
  const source = html.replace(/var API_BASE = '[^']*';/, "var API_BASE = '" + target + "';");
  if (source === html) throw new Error('没能改写 API_BASE，页面结构可能变了');

  const dom = new JSDOM(source, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: pageUrl,
    beforeParse: function (window) {
      window.fetch = makeFetch(calls, opts);
    }
  });

  return { dom: dom, calls: calls, problems: problems };
}

function tick(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms || 60); });
}

function fire(el, type) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}

(async function run() {
  /* ---------- 场景一：没配后端时，相关 UI 必须保持隐藏 ---------- */
  {
    const env = boot('https://site.test/');
    await tick();
    const doc = env.dom.window.document;
    check('未配置后端时不显示短链按钮', doc.getElementById('shareActions').hidden === true);
    check('未配置后端时不显示热门榜', doc.getElementById('hot').hidden === true);
    check('未配置后端时不发任何请求', env.calls.length === 0, 'calls=' + env.calls.length);
    check('未配置后端时页面照常渲染准星', doc.querySelectorAll('#crosshairLayer rect').length > 0);
    env.dom.window.close();
  }

  /* ---------- 场景二：配置了后端，短链与热门榜可用 ---------- */
  {
    const env = boot('https://site.test/', { withBackend: true });
    await tick();
    const doc = env.dom.window.document;

    check('配置后端后显示短链按钮', doc.getElementById('shareActions').hidden === false);
    check('启动时拉取了热门榜', env.calls.some(function (c) { return c.url.indexOf('/api/top') >= 0; }));
    check('热门榜渲染出条目', doc.querySelectorAll('.rank-item').length === 1);
    check('热门榜展示统计数字', doc.querySelector('.rank-stat').textContent.indexOf('打开 12') >= 0,
      doc.querySelector('.rank-stat') && doc.querySelector('.rank-stat').textContent);
    check('热门榜区块变为可见', doc.getElementById('hot').hidden === false);

    const codeBefore = doc.getElementById('codeOut').textContent;
    fire(doc.getElementById('shortenBtn'), 'click');
    await tick();

    const shareCall = env.calls.find(function (c) { return c.url.indexOf('/api/share') >= 0; });
    check('生成了短链请求', !!shareCall);
    check('短链请求带上当前分享码', shareCall && JSON.parse(shareCall.init.body).code === codeBefore);
    check('短链结果显示出来', doc.getElementById('shortenResult').hidden === false);
    check('短链地址正确', doc.getElementById('shortenLink').textContent === 'https://api.test/s/abc123',
      doc.getElementById('shortenLink').textContent);

    fire(doc.querySelector('[data-rank]'), 'click');
    await tick();
    check('套用热门准星后设计器同步', doc.getElementById('codeOut').textContent === SAMPLE,
      doc.getElementById('codeOut').textContent.slice(0, 30));

    check('两个场景都没有脚本报错', env.problems.length === 0, env.problems.join(' ~~ '));
    env.dom.window.close();
  }

  /* ---------- 场景三：姓名里的 HTML 必须被转义 ---------- */
  {
    const env = boot('https://site.test/', { withBackend: true, badName: true });
    await tick();
    const doc = env.dom.window.document;
    check('恶意名称不会生成真实标签', doc.querySelectorAll('#rankList img').length === 0);
    check('恶意名称被转义后原样显示', doc.querySelector('.rank-name').textContent.indexOf('<img') === 0,
      doc.querySelector('.rank-name') && doc.querySelector('.rank-name').textContent);
    env.dom.window.close();
  }

  /* ---------- 场景四：短链落地页 ---------- */
  {
    const landing = 'https://site.test/?c=' + encodeURIComponent(SAMPLE) + '&s=abc123';
    const env = boot(landing, { withBackend: true });
    await tick();
    const doc = env.dom.window.document;

    check('短链落地后自动载入那支准星', doc.getElementById('codeOut').textContent === SAMPLE,
      doc.getElementById('codeOut').textContent.slice(0, 30));
    check('落地后回传了 apply 埋点', env.calls.some(function (c) {
      return c.url.indexOf('/api/event') >= 0 && JSON.parse(c.init.body).type === 'apply';
    }));
    check('落地页没有脚本报错', env.problems.length === 0, env.problems.join(' ~~ '));

    /* 从短链进来后再点复制，应该回传 copy 埋点 */
    fire(doc.getElementById('copyBtn'), 'click');
    await tick();
    check('复制后回传 copy 埋点', env.calls.some(function (c) {
      return c.url.indexOf('/api/event') >= 0 && JSON.parse(c.init.body).type === 'copy';
    }));
    env.dom.window.close();
  }

  /* ---------- 汇总 ---------- */
  const failed = results.filter(function (r) { return !r.ok; });
  console.log('通过 ' + (results.length - failed.length) + ' / ' + results.length + ' 项');
  failed.forEach(function (r) {
    console.log('  ✗ ' + r.label + (r.detail ? '  →  ' + r.detail : ''));
  });
  if (failed.length) process.exitCode = 1;
})();
