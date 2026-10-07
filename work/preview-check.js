/*
 * 检查预览版页面（work/preview-with-backend.html）渲染是否正常。
 * 用法：NODE_PATH=<jsdom 目录> node work/preview-check.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const file = path.join(__dirname, 'preview-with-backend.html');
const html = fs.readFileSync(file, 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', function (e) { problems.push(e.message); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'https://preview.test/'
});

setTimeout(function () {
  const doc = dom.window.document;
  const lines = [];

  lines.push('短链按钮可见: ' + (doc.getElementById('shareActions').hidden === false));
  lines.push('热门榜区块可见: ' + (doc.getElementById('hot').hidden === false));
  lines.push('榜单条目数: ' + doc.querySelectorAll('.rank-item').length);
  lines.push('榜单第一名: ' + (doc.querySelector('.rank-name') || {}).textContent);
  lines.push('统计文字: ' + (doc.querySelector('.rank-stat') || {}).textContent);
  lines.push('预览提示条: ' + (doc.body.textContent.indexOf('预览模式') >= 0));
  lines.push('准星线条数: ' + doc.querySelectorAll('#crosshairLayer rect').length);
  lines.push('预设卡片数: ' + doc.querySelectorAll('.preset').length);

  /* 点一下「生成短链」，看演示流程是否走通 */
  const shortenBtn = doc.getElementById('shortenBtn');
  shortenBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  setTimeout(function () {
    lines.push('短链结果显示: ' + (doc.getElementById('shortenResult').hidden === false));
    lines.push('短链内容: ' + doc.getElementById('shortenLink').textContent);

    /* 套用榜单第一支 */
    const rankBtn = doc.querySelector('[data-rank]');
    rankBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    lines.push('套用后分享码长度: ' + doc.getElementById('codeOut').textContent.length);

    lines.push('脚本报错: ' + (problems.length ? problems.join(' ~~ ') : '无'));
    console.log(lines.join('\n'));
    dom.window.close();
  }, 200);
}, 300);
