/*
 * 同步网页文件。
 *
 * 背景：Cloudflare Pages 的首页入口必须是 index.html，而平时编辑的是
 * valorant-crosshair-lab.html，两份内容必须一致，否则线上会和本地脱节。
 * 这里把 valorant-crosshair-lab.html 当作唯一源文件，同步到 index.html。
 *
 * 用法：
 *   node work/sync-html.js          同步
 *   node work/sync-html.js --check  只检查两份是否一致（部署前可用）
 */
const fs = require('fs');
const path = require('path');

const outputs = path.join(__dirname, '..', 'outputs');
const source = path.join(outputs, 'valorant-crosshair-lab.html');
const target = path.join(outputs, 'index.html');

const checkOnly = process.argv.includes('--check');

if (!fs.existsSync(source)) {
  console.log('找不到源文件 ' + source);
  process.exit(2);
}

const sourceText = fs.readFileSync(source, 'utf8');

if (checkOnly) {
  const same = fs.existsSync(target) && fs.readFileSync(target, 'utf8') === sourceText;
  console.log(same ? 'OK  两份文件一致' : 'DRIFT  两份文件不一致，请运行 node work/sync-html.js');
  process.exit(same ? 0 : 1);
}

const before = fs.existsSync(target) ? fs.statSync(target).size : 0;
fs.writeFileSync(target, sourceText, 'utf8');

console.log('已同步到我 index.html');
console.log('  源文件 valorant-crosshair-lab.html: ' + Math.round(sourceText.length / 1024) + ' KB');
console.log('  同步前 index.html: ' + Math.round(before / 1024) + ' KB');
console.log('  同步后 index.html: ' + Math.round(fs.statSync(target).size / 1024) + ' KB');
