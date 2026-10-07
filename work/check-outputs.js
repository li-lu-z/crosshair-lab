/*
 * 部署目录体检：outputs 是 Cloudflare Pages 的上传目录，
 * 里面出现任何多余文件都会一起被发布出去（之前就误传过两个 .bak 备份）。
 * 部署前跑一遍，发现多余文件就拦下来。
 *
 * 用法：node work/check-outputs.js
 */
const fs = require('fs');
const path = require('path');

const outputs = path.join(__dirname, '..', 'outputs');

/* 只允许这两个文件上线；点开头的（如 .wrangler）不会被上传，跳过 */
const ALLOWED = ['index.html', 'valorant-crosshair-lab.html'];

function checkOutputs() {
  if (!fs.existsSync(outputs)) {
    return { ok: false, extra: [], missing: ALLOWED };
  }
  const names = fs.readdirSync(outputs);
  const extra = names.filter(function (name) {
    return !name.startsWith('.') && ALLOWED.indexOf(name) < 0;
  });
  const missing = ALLOWED.filter(function (name) {
    return names.indexOf(name) < 0;
  });
  return { ok: extra.length === 0 && missing.length === 0, extra: extra, missing: missing };
}

if (require.main !== module) {
  module.exports = { checkOutputs: checkOutputs, allowed: ALLOWED };
  return;
}

const result = checkOutputs();
if (result.ok) {
  console.log('OK  部署目录干净，只有 ' + ALLOWED.join(' 和 '));
} else {
  if (result.extra.length) {
    console.log('发现多余文件，它们会被一起发布到线上：');
    result.extra.forEach(function (name) { console.log('  - ' + name); });
  }
  if (result.missing.length) {
    console.log('缺少必需文件：' + result.missing.join(', '));
  }
  process.exitCode = 1;
}
