/*
 * 把 Windows 批处理文件统一转成 CRLF 换行。
 *
 * 为什么需要：cmd.exe 解析 .cmd/.bat 时要求 CRLF，如果文件是 LF，
 * 它会把命令切得乱七八糟（比如把 create 解析成 reate）。
 * 编辑器/补丁工具默认写 LF，所以每次改完 .cmd 都跑一下这个脚本。
 *
 * 用法：node work/to-crlf.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = [];

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(cmd|bat)$/i.test(entry.name)) {
      targets.push(full);
    }
  });
}

walk(root);

targets.forEach(function (file) {
  const text = fs.readFileSync(file, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  if (normalized !== text) {
    fs.writeFileSync(file, normalized, 'utf8');
    console.log('已转成 CRLF: ' + path.relative(root, file));
  } else {
    console.log('本来就是 CRLF: ' + path.relative(root, file));
  }
});

if (!targets.length) console.log('没有找到 .cmd / .bat 文件');
