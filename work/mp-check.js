/*
 * 小程序侧自检：
 * 1. 用打桩的 wx / Page / App 把首页逻辑真正跑起来，验证渲染、筛选、应用、复制；
 * 2. 校验小程序生成的分享码和网页版逐字节一致（这是最容易出错的地方）。
 * 用法：node work/mp-check.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mp = path.join(root, 'miniprogram');
const problems = [];

/* ---------- 打桩 wx ---------- */
const clipboard = [];
let scrolled = false;

global.wx = {
  getWindowInfo: function () { return { windowWidth: 390, windowHeight: 844 }; },
  getSystemInfoSync: function () { return { windowWidth: 390, windowHeight: 844 }; },
  createSelectorQuery: function () {
    return {
      select: function () {
        return {
          boundingClientRect: function (cb) {
            cb({ width: 342, height: 342 });
            return { exec: function () { } };
          }
        };
      }
    };
  },
  setClipboardData: function (opt) {
    clipboard.push(opt.data);
    if (opt.success) opt.success();
  },
  pageScrollTo: function () { scrolled = true; },
  showToast: function () { }
};

let pageConfig = null;
global.Page = function (cfg) { pageConfig = cfg; };
global.App = function () { };

/* ---------- 加载页面 ---------- */
require(path.join(mp, 'pages', 'index', 'index.js'));
if (!pageConfig) throw new Error('Page() 没有被调用，index.js 可能没正常加载');

const page = Object.create(pageConfig);
page.data = JSON.parse(JSON.stringify(pageConfig.data));
page.stageSize = 0;
page.setData = function (patch, cb) {
  Object.assign(this.data, patch);
  if (typeof cb === 'function') cb();
};
page.onLoad.call(page);
page.onReady.call(page);

const log = [];
log.push('FLAT_KEYS=' + Object.keys(page.data.flat).length);
log.push('STAGE_SIZE=' + page.stageSize);
log.push('PREVIEW_LINES=' + page.data.lines.length + ' DOT=' + (page.data.dot ? 'yes' : 'no'));
log.push('CODE_LEN=' + page.data.code.length + ' PREFIX=' + page.data.code.slice(0, 7));
log.push('CATS=' + page.data.cats.map(function (c) { return c.id + ':' + c.count; }).join(' '));
log.push('LIST_PAGE1=' + page.data.list.length + ' TOTAL=' + page.data.total + ' MORE=' + page.data.hasMore);
log.push('THUMB_LINES=' + page.data.list[0].thumb.length);
log.push('RESULT_TEXT=' + page.data.resultText);

/* 分类筛选 */
page.onCat.call(page, { currentTarget: { dataset: { id: 'dot' } } });
log.push('FILTER_DOT_TOTAL=' + page.data.total + ' LIST=' + page.data.list.length);
page.onCat.call(page, { currentTarget: { dataset: { id: 'all' } } });

/* 搜索 */
page.onSearch.call(page, { detail: { value: '青色' } });
log.push('SEARCH_青色_TOTAL=' + page.data.total + ' ALL_MATCH=' +
  page.data.list.every(function (item) { return (item.name + item.desc).indexOf('青色') >= 0; }));
page.onSearch.call(page, { detail: { value: '绝不存在的东西' } });
log.push('SEARCH_NONE_TOTAL=' + page.data.total + ' TEXT=' + page.data.resultText);
page.onSearch.call(page, { detail: { value: '' } });

/* 翻页 */
page.onMore.call(page);
log.push('AFTER_MORE=' + page.data.list.length);

/* 套用预设 + 复制 */
const before = page.data.code;
page.onApply.call(page, { currentTarget: { dataset: { index: 0 } } });
log.push('APPLY_CHANGED=' + (page.data.code !== before) + ' SCROLLED=' + scrolled);
page.onCopy.call(page);
page.onCopyPreset.call(page, { currentTarget: { dataset: { index: 1 } } });
log.push('CLIPBOARD_ITEMS=' + clipboard.length + ' FIRST_OK=' + (clipboard[0] === page.data.code));

/* 滑块 / 开关 / 颜色 / 场景 */
page.onSlide.call(page, { currentTarget: { dataset: { key: 'innerThickness' } }, detail: { value: 5 } });
log.push('SLIDER_SYNC=' + (page.data.code.indexOf('0t;5;') > 0) + ' DISPLAY=' + page.data.display.innerThickness);
page.onSwitch.call(page, { currentTarget: { dataset: { key: 'outerShow' } }, detail: { value: true } });
log.push('SWITCH_SYNC=' + (page.data.code.indexOf('1b;1;') > 0));
page.onColor.call(page, { currentTarget: { dataset: { index: 5 } } });
log.push('COLOR_SYNC=' + (page.data.code.indexOf('c;5;') > 0));
page.onScene.call(page, { currentTarget: { dataset: { key: 'range' } } });
log.push('SCENE=' + page.data.sceneKey + ' TARGET=' + page.data.scene.target);
page.onFire.call(page);
log.push('FIRE_OK=yes');
page.onRandom.call(page);
page.onReset.call(page);
log.push('AFTER_RESET_CODE_LEN=' + page.data.code.length);

/* ---------- 关键校验：分享码和网页版是否完全一致 ---------- */
const html = fs.readFileSync(path.join(root, 'outputs', 'valorant-crosshair-lab.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
function slice(from, to) {
  const a = script.indexOf(from);
  let b = script.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('slice failed -> ' + from);
  const c = script.lastIndexOf('/*', b);
  if (c > a) b = c;
  return script.slice(a, b);
}
const webApi = new Function(
  slice('var PRESET_COLORS', 'var SCALE = 2;') +
  slice('function clone(obj)', '* 状态') +
  slice('function buildCode(cfg) {', '* 准星绘制') +
  '\nreturn { buildAllPresets: buildAllPresets };'
)();

const webPresets = webApi.buildAllPresets();
const C = require(path.join(mp, 'utils', 'crosshair.js'));
const mpPresets = require(path.join(mp, 'utils', 'presets.js'));

log.push('MP_PRESETS=' + mpPresets.length + ' WEB_PRESETS=' + webPresets.length);

let mismatch = 0;
let mismatchExample = '';
mpPresets.forEach(function (preset, i) {
  const rebuilt = C.buildCode(C.toConfig(C.fromConfig(preset.cfg)));
  if (rebuilt !== preset.code) {
    mismatch++;
    if (!mismatchExample) mismatchExample = preset.name + '\n    小程序: ' + rebuilt + '\n    预设值: ' + preset.code;
  }
  if (webPresets[i] && webPresets[i].code !== preset.code) {
    mismatch++;
    if (!mismatchExample) mismatchExample = preset.name + '\n    网页版: ' + webPresets[i].code + '\n    小程序: ' + preset.code;
  }
});
log.push('CODE_MISMATCH=' + mismatch);
if (mismatchExample) log.push(mismatchExample);

/* 缩略图几何是否正常（不应该出现负尺寸或超大尺寸） */
let badThumb = 0;
mpPresets.slice(0, 120).forEach(function (preset) {
  C.thumbViews(preset.cfg, 64).forEach(function (line) {
    const w = parseFloat((line.style.match(/width:([\d.]+)px/) || [0, 0])[1]);
    const h = parseFloat((line.style.match(/height:([\d.]+)px/) || [0, 0])[1]);
    if (!(w > 0) || !(h > 0) || w > 200 || h > 200) badThumb++;
  });
});
log.push('BAD_THUMB_GEOMETRY=' + badThumb);
log.push('PROBLEMS=' + (problems.length ? problems.join(' ~~ ') : 'none'));

console.log(log.join('\n'));
