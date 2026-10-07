/*
 * 端到端检查：用 jsdom 真正执行页面脚本，验证预设渲染、分页、搜索、分类筛选
 * 以及设计器的联动是否正常。
 * 用法：npm install --prefix <dir> jsdom，然后 NODE_PATH=<dir>/node_modules node work/dom-check.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.join(__dirname, '..', 'outputs', 'valorant-crosshair-lab.html');
const html = fs.readFileSync(file, 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', function (e) { problems.push('jsdomError: ' + e.message); });
vc.on('error', function () { problems.push('console.error: ' + Array.prototype.join.call(arguments, ' ')); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'file:///' + file.replace(/\\/g, '/'),
  /* 页面现在配了真实后端地址，会主动 fetch；这里给个必定失败的桩，
     让后端功能静默降级，从而只测本地功能（也顺便验证降级路径不报错） */
  beforeParse: function (window) {
    window.fetch = function () {
      return Promise.resolve({
        ok: false,
        status: 503,
        json: function () { return Promise.resolve({ error: 'stub' }); }
      });
    };
  }
});

const win = dom.window;
const doc = win.document;
win.addEventListener('error', function (e) { problems.push('window.error: ' + e.message); });

function fire(el, type) {
  el.dispatchEvent(new win.Event(type, { bubbles: true }));
}

function cards() {
  return Array.prototype.slice.call(doc.querySelectorAll('.preset'));
}

/* 卡片上的可见文字（标题 + 描述），用于校验搜索结果确实都命中关键词 */
function cardText() {
  return cards().map(function (c) { return c.textContent; });
}

setTimeout(function () {
  const log = [];
  const filterBtns = function () {
    return Array.prototype.slice.call(doc.querySelectorAll('.filter-btn'));
  };
  const resultText = function () { return doc.getElementById('presetResult').textContent; };
  const moreWrap = function () { return doc.getElementById('presetMoreWrap'); };
  const codeOut = doc.getElementById('codeOut');

  log.push('TOTAL_LABEL=' + doc.getElementById('presetCount').textContent);
  log.push('FILTERS=' + filterBtns().map(function (b) { return b.textContent; }).join(' | '));
  log.push('PAGE1_CARDS=' + cards().length + ' RESULT=' + resultText() + ' MORE_VISIBLE=' + !moreWrap().hidden);
  log.push('THUMB_RECTS=' + doc.querySelectorAll('.preset-thumb svg rect').length);

  /* 翻页 */
  fire(doc.getElementById('presetMore'), 'click');
  log.push('PAGE2_CARDS=' + cards().length + ' RESULT=' + resultText());

  /* 分类筛选：点射型 */
  fire(filterBtns()[2], 'click');
  log.push('FILTER_DOT_CARDS=' + cards().length + ' RESULT=' + resultText() + ' MORE_VISIBLE=' + !moreWrap().hidden);
  fire(doc.getElementById('presetMore'), 'click');
  log.push('FILTER_DOT_ALL=' + cards().length + ' MORE_VISIBLE=' + !moreWrap().hidden);

  /* 回到全部 */
  fire(filterBtns()[0], 'click');
  log.push('BACK_ALL_CARDS=' + cards().length + ' RESULT=' + resultText());

  /* 搜索 */
  const search = doc.getElementById('presetSearch');
  search.value = '青色';
  fire(search, 'input');
  const qText = cardText();
  log.push('SEARCH_青色_CARDS=' + qText.length + ' ALL_MATCH=' + qText.every(function (t) { return t.indexOf('青色') >= 0; }));
  search.value = '纯中心点';
  fire(search, 'input');
  log.push('SEARCH_纯中心点=' + cards().length + ' RESULT=' + resultText());
  search.value = '不存在的东西';
  fire(search, 'input');
  log.push('SEARCH_NONE_CARDS=' + cards().length + ' RESULT=' + resultText());
  search.value = '';
  fire(search, 'input');
  log.push('SEARCH_CLEARED=' + cards().length);

  /* 应用到设计器 */
  const before = codeOut.textContent;
  fire(cards()[0].querySelector('[data-apply]'), 'click');
  log.push('APPLY_CHANGED=' + (codeOut.textContent !== before) + ' CODE=' + codeOut.textContent.slice(0, 30));

  /* 滑块与开关联动 */
  const thickness = doc.getElementById('innerThickness');
  thickness.value = '5';
  fire(thickness, 'input');
  log.push('SLIDER_SYNC=' + (codeOut.textContent.indexOf('0t;5;') > 0));

  const outlineToggle = doc.querySelector('[data-panel="outline"] [data-panel-toggle]');
  outlineToggle.checked = false;
  fire(outlineToggle, 'change');
  log.push('DISABLE_LINK=' + doc.getElementById('outlineOpacity').disabled + ' CODE_H0=' + (codeOut.textContent.indexOf('h;0;') > 0));

  /* 其余按钮不应抛错 */
  try {
    fire(doc.getElementById('randomBtn'), 'click');
    fire(doc.getElementById('fireBtn'), 'click');
    fire(doc.getElementById('copyBtn'), 'click');
    fire(doc.getElementById('resetBtn'), 'click');
    const move = doc.getElementById('moveToggle');
    move.checked = true;
    fire(move, 'change');
    log.push('BUTTONS=ok');
  } catch (err) {
    log.push('BUTTONS=throw:' + err.message);
  }

  log.push('PROBLEMS=' + (problems.length ? problems.join(' ~~ ') : 'none'));
  console.log(log.join('\n'));
  win.close();
}, 500);
