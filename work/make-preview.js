/*
 * 生成「后端已接通」的预览版页面，方便在后端部署前先看新模块长什么样。
 *
 * 做法：
 *   1. 把 API_BASE 换成假地址；
 *   2. 在主脚本之前插一段 window.fetch 桩，返回构造好的假数据。
 * 输出到 work/preview-with-backend.html，不影响 outputs 里的正式文件。
 *
 * 用法：node work/make-preview.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'outputs', 'valorant-crosshair-lab.html'), 'utf8');
const presets = require(path.join(root, 'miniprogram', 'utils', 'presets.js'));

/* 从真实预设里挑几支当榜单数据，这样「套用这支」点下去是真的能用的 */
function pickByName(name, fallbackIndex) {
  const found = presets.filter(function (p) { return p.name === name; })[0];
  return found || presets[fallbackIndex];
}

const ranked = [
  { preset: pickByName('青色细线', 1), hits: 128, applies: 46, copies: 71 },
  { preset: pickByName('小绿点', 5), hits: 96, applies: 38, copies: 52 },
  { preset: pickByName('经典白四线', 0), hits: 74, applies: 21, copies: 40 },
  { preset: pickByName('大开口十字', 9), hits: 51, applies: 17, copies: 25 },
  { preset: pickByName('静态练习', 25), hits: 33, applies: 12, copies: 19 },
  { preset: pickByName('四点框', 22), hits: 18, applies: 6, copies: 9 }
].map(function (item, index) {
  return {
    id: 'demo' + String(index + 1).padStart(2, '0'),
    code: item.preset.code,
    name: item.preset.name,
    hits: item.hits,
    applies: item.applies,
    copies: item.copies
  };
});

const mock = `
<script>
/* ===== 演示用的假接口：只在预览文件里存在，正式页面没有这段 ===== */
(function () {
  var RANKED = ${JSON.stringify(ranked)};
  function reply(data, status) {
    return Promise.resolve({
      ok: (status || 200) < 400,
      status: status || 200,
      json: function () { return Promise.resolve(data); }
    });
  }
  window.fetch = function (url) {
    if (url.indexOf('/api/top') >= 0) return reply({ limit: 8, items: RANKED });
    if (url.indexOf('/api/share') >= 0) return reply({ id: 'k3m9x2', code: RANKED[0].code, name: '自定义准星', hits: 0, applies: 0, copies: 0 });
    if (url.indexOf('/api/event') >= 0) return reply({ ok: true });
    return reply({ error: 'not_found' }, 404);
  };
})();
<\/script>
`;

let output = source.replace("var API_BASE = '';", "var API_BASE = 'https://demo-api.local';");

/* 假接口必须跑在主脚本之前 */
const marker = '<script>\n(function () {';
if (output.indexOf(marker) < 0) throw new Error('没找到主脚本入口，页面结构可能变了');
output = output.replace(marker, mock + marker);

/* 顶部加一条提示，避免和正式文件混淆 */
output = output.replace(
  '<header class="nav">',
  '<div style="background:#ff4655;color:#fff;text-align:center;padding:8px 16px;font-size:13px;font-weight:600">' +
  '预览模式：短链与热门榜用的是演示数据，正式页面需要部署后端才会出现</div>\n<header class="nav">'
);

const target = path.join(__dirname, 'preview-with-backend.html');
fs.writeFileSync(target, output, 'utf8');

console.log('已生成: ' + target);
console.log('榜单条数: ' + ranked.length);
console.log('文件大小: ' + Math.round(fs.statSync(target).size / 1024) + ' KB');
console.log('榜单名称: ' + ranked.map(function (r) { return r.name; }).join(' / '));
