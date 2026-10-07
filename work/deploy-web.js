/*
 * 更新线上网页：先同步 index.html，再部署到 Cloudflare Pages。
 * 用法：node work/deploy-web.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outputs = path.join(root, 'outputs');
const source = path.join(outputs, 'valorant-crosshair-lab.html');
const target = path.join(outputs, 'index.html');
const { checkOutputs } = require('./check-outputs.js');

console.log('');
console.log('============================================================');
console.log('  准星实验室 · 更新线上网页');
console.log('============================================================');

if (!fs.existsSync(source)) {
  console.log('\n[错误] 找不到 ' + source);
  process.exit(1);
}

console.log('\n[1/2] 同步 index.html ...');
const text = fs.readFileSync(source, 'utf8');
const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (before === text) {
  console.log('      两份本来就一致，跳过。');
} else {
  fs.writeFileSync(target, text, 'utf8');
  console.log('      已同步（' + Math.round(before.length / 1024) + ' KB → ' + Math.round(text.length / 1024) + ' KB）');
}

console.log('\n[2/2] 部署到 Cloudflare Pages ...');
const folder = checkOutputs();
if (!folder.ok) {
  if (folder.extra.length) {
    console.log('      [中止] 部署目录里有不该上传的文件：');
    folder.extra.forEach(function (name) { console.log('        - outputs\\' + name); });
    console.log('      请把它们删掉或移到 work 目录，然后重新运行。');
  }
  if (folder.missing.length) {
    console.log('      [中止] 缺少文件：' + folder.missing.join(', '));
  }
  process.exit(1);
}

const command = 'npx.cmd --yes wrangler pages deploy . --project-name valorant-crosshair';
const result = spawnSync(command, {
  cwd: outputs,
  stdio: 'inherit',
  shell: true
});

if (result.status !== 0) {
  console.log('\n[失败] 部署没有成功，把上面的输出发给 Codex 看看。');
  process.exit(1);
}

console.log('');
console.log('完成。线上地址不变：https://valorant-crosshair.pages.dev');
console.log('刷新看不到新版就按 Ctrl+F5 强制刷新一次。');
console.log('');
