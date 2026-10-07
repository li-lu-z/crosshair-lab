/*
 * 校验脚本：从页面里抽出纯逻辑（预设数据 + 分享码生成）在 Node 里跑一遍，
 * 不需要浏览器就能确认预设数量、分类覆盖和分享码格式是否正确。
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'outputs', 'valorant-crosshair-lab.html');
const html = fs.readFileSync(file, 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function slice(from, to) {
  const a = script.indexOf(from);
  let b = script.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('slice failed -> ' + from);
  /* 结束标记常落在注释块中间，回退到该注释块的起点，避免截出半个注释 */
  const commentStart = script.lastIndexOf('/*', b);
  if (commentStart > a) b = commentStart;
  return script.slice(a, b);
}

const constants = slice('var PRESET_COLORS', 'var SCALE = 2;');
const helpers = slice('function clone(obj)', '* \u72b6\u6001');
const codeFn = slice('function buildCode(cfg) {', '* \u51c6\u661f\u7ed8\u5236');

const api = new Function(
  constants + helpers + codeFn +
  '\nreturn { PRESET_CATS: PRESET_CATS, buildAllPresets: buildAllPresets, merge: merge, buildCode: buildCode, decodeConfig: decodeConfig };'
)();

const presets = api.buildAllPresets();
const cats = api.PRESET_CATS.filter(function (c) { return c.id !== 'all'; }).map(function (c) { return c.id; });

console.log('PRESET_COUNT=' + presets.length);
console.log('CATS=' + api.PRESET_CATS.map(function (c) {
  const n = c.id === 'all' ? presets.length : presets.filter(function (p) { return p.cat === c.id; }).length;
  return c.id + ':' + n;
}).join(' '));

const used = presets.map(function (p) { return p.cat; });
const unknown = used.filter(function (c) { return cats.indexOf(c) < 0; });
const unused = cats.filter(function (c) { return used.indexOf(c) < 0; });
console.log('UNKNOWN_CAT=' + (unknown.length ? unknown.join(',') : 'none'));
console.log('UNUSED_CAT=' + (unused.length ? unused.join(',') : 'none'));

const codes = [];
let malformed = 0;
presets.forEach(function (p) {
  if (!p.name || !p.desc || !p.cfg) { console.log('MISSING_FIELD=' + p.name); return; }
  const code = p.code;
  if (code !== api.buildCode(p.cfg)) console.log('CODE_MISMATCH=' + p.name);
  codes.push(code);
  const parts = code.split(';');
  const okPrefix = code.indexOf('0;s;1;P;') === 0;
  const okPairs = parts.length % 2 === 0;
  if (!okPrefix || !okPairs) { malformed++; console.log('BAD_CODE=' + p.name + ' => ' + code); }
});
console.log('MALFORMED=' + malformed);
console.log('UNIQUE_CODES=' + new Set(codes).size);

const dup = new Map();
codes.forEach(function (code, i) {
  if (dup.has(code)) console.log('DUPLICATE=' + presets[i].name + ' <-> ' + dup.get(code));
  else dup.set(code, presets[i].name);
});

console.log('--- codes ---');
const nameCount = {};
presets.forEach(function (p) { nameCount[p.name] = (nameCount[p.name] || 0) + 1; });
const dupNames = Object.keys(nameCount).filter(function (n) { return nameCount[n] > 1; });
console.log('DUPLICATE_NAMES=' + (dupNames.length ? dupNames.join(',') : 'none'));

console.log('--- 样例（生成的前 8 支）---');
presets.slice(29, 37).forEach(function (p) {
  console.log(p.name + '  [' + p.cat + ']\n    ' + p.desc);
});
console.log('--- 样例（最后 3 支）---');
presets.slice(-3).forEach(function (p) {
  console.log(p.name + '  [' + p.cat + ']\n    ' + p.desc);
});

/* ---------- 静态检查：脚本引用的 id 是否都真实存在、HTML 里有没有重复 id ---------- */
const refs = Array.from(new Set((script.match(/\$\('#([\w-]+)'\)/g) || []).map(function (s) {
  return s.slice(4, -2);
})));
const htmlIds = (html.match(/id="([\w-]+)"/g) || []).map(function (s) { return s.slice(4, -1); });
const missing = refs.filter(function (id) { return htmlIds.indexOf(id) < 0; });
const dupIds = htmlIds.filter(function (id, i) { return htmlIds.indexOf(id) !== i; });

console.log('JS_ID_REFS=' + refs.length + ' HTML_IDS=' + htmlIds.length);
console.log('MISSING_IDS=' + (missing.length ? missing.join(',') : 'none'));
console.log('DUPLICATE_IDS=' + (dupIds.length ? dupIds.join(',') : 'none'));

/* ---------- 解码器往返校验：decode → buildCode 必须还原出一模一样的分享码 ---------- */
let decodeFail = 0;
let decodeExample = '';
presets.forEach(function (p) {
  const decoded = api.decodeConfig(p.code);
  if (!decoded) { decodeFail++; return; }
  const rebuilt = api.buildCode(decoded);
  if (rebuilt !== p.code) {
    decodeFail++;
    if (!decodeExample) decodeExample = p.name + '\n    原文: ' + p.code + '\n    还原: ' + rebuilt;
  }
});
console.log('DECODE_ROUNDTRIP_FAIL=' + decodeFail);
if (decodeExample) console.log(decodeExample);

/* 边界：空串和垃圾串应该返回 null，而不是给出一个乱准星 */
console.log('DECODE_EMPTY_IS_NULL=' + (api.decodeConfig('') === null));
console.log('DECODE_GARBAGE_IS_NULL=' + (api.decodeConfig('这不是分享码') === null));
console.log('DECODE_NO_P_SECTION_IS_NULL=' + (api.decodeConfig('0;s;1;c;5') === null));

/* 只写了部分字段的码：没写到的应该回落到默认值 */
const partial = api.decodeConfig('0;P;c;5;h;0');
console.log('DECODE_PARTIAL=' + JSON.stringify({
  color: partial.colorIndex,
  outlines: partial.outlines,
  innerLength: partial.inner.length,
  outerShow: partial.outer.show
}));
