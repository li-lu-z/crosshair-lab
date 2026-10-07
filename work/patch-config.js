/*
 * 安全地修改两个配置文件：把数据库 ID 写进 wrangler.jsonc，把 Worker 地址写进网页。
 *
 * 安全约定：
 *   - 改之前先备份成 .bak，出问题可以直接换回去
 *   - 找不到要替换的目标就退出码 2，不做任何写入
 *   - 已经填过了（不是占位符）就退出码 3，跳过
 *
 * 用法：
 *   node work/patch-config.js db  <database_id>
 *   node work/patch-config.js api <https://xxx.workers.dev>
 *   node work/patch-config.js restore          （从 .bak 还原）
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const QUOTE = String.fromCharCode(39);   /* 单引号，避免在批处理里转义地狱 */
/* 备份统一放在 work/backups：outputs 是部署目录，放那儿会被一起传到线上 */
const backupDir = path.join(root, 'work', 'backups');

const mode = process.argv[2];
const value = process.argv[3];

function backup(file) {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(file, path.join(backupDir, path.basename(file) + '.bak'));
}

function patchLiteral(file, from, to, label) {
  if (!fs.existsSync(file)) {
    console.log('SKIP  找不到文件 ' + file);
    return 2;
  }
  const text = fs.readFileSync(file, 'utf8');
  if (text.indexOf(from) < 0) {
    console.log('ALREADY  ' + label + ' 里已经没有占位符，跳过');
    return 3;
  }
  backup(file);
  fs.writeFileSync(file, text.split(from).join(to), 'utf8');
  console.log('PATCHED ' + label);
  return 0;
}

function patchApiBase(file, url) {
  if (!fs.existsSync(file)) {
    console.log('SKIP  找不到文件 ' + file);
    return 2;
  }
  const text = fs.readFileSync(file, 'utf8');
  const pattern = new RegExp('var API_BASE = ' + QUOTE + '[^' + QUOTE + ']*' + QUOTE + ';');
  if (!pattern.test(text)) {
    console.log('MISS  ' + path.basename(file) + ' 里没找到 var API_BASE 那一行');
    return 2;
  }
  if (text.indexOf('var API_BASE = ' + QUOTE + url + QUOTE) >= 0) {
    console.log('ALREADY  ' + path.basename(file) + ' 已经指向这个地址');
    return 3;
  }
  backup(file);
  fs.writeFileSync(file, text.replace(pattern, 'var API_BASE = ' + QUOTE + url + QUOTE + ';'), 'utf8');
  console.log('PATCHED ' + path.basename(file));
  return 0;
}

function restore(file) {
  const saved = path.join(backupDir, path.basename(file) + '.bak');
  if (!fs.existsSync(saved)) {
    console.log('SKIP  ' + path.basename(file) + ' 没有备份');
    return;
  }
  fs.copyFileSync(saved, file);
  fs.unlinkSync(saved);
  console.log('RESTORED ' + path.basename(file));
}

/* 作为模块被引用时只导出函数，不执行命令行逻辑 */
if (require.main !== module) {
  module.exports = {
    patchLiteral: patchLiteral,
    patchApiBase: patchApiBase,
    restore: restore,
    wranglerConfigPath: path.join(root, 'backend', 'wrangler.jsonc'),
    htmlPaths: [
      path.join(root, 'outputs', 'index.html'),
      path.join(root, 'outputs', 'valorant-crosshair-lab.html')
    ]
  };
  return;
}

if (mode === 'db') {
  if (!value) { console.log('缺少 database_id'); process.exit(2); }
  const code = patchLiteral(
    path.join(root, 'backend', 'wrangler.jsonc'),
    'REPLACE_WITH_YOUR_DATABASE_ID',
    value,
    'backend/wrangler.jsonc'
  );
  process.exit(code === 3 ? 0 : code);
}

/* 修复模式：不管当前写的是什么，直接覆盖成给定的 ID（写坏时用） */
if (mode === 'db-force') {
  const file = path.join(root, 'backend', 'wrangler.jsonc');
  if (!value) { console.log('缺少 database_id'); process.exit(2); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    console.log('这不是一个合法的 UUID: ' + value);
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(/"database_id":\s*"[^"]*"/, '"database_id": "' + value + '"');
  if (updated === text) {
    console.log('没找到 database_id 字段');
    process.exit(2);
  }
  backup(file);
  fs.writeFileSync(file, updated, 'utf8');
  console.log('PATCHED backend/wrangler.jsonc → ' + value);
  process.exit(0);
}

if (mode === 'api') {
  if (!value) { console.log('缺少 Worker 地址'); process.exit(2); }
  const url = value.replace(/\/+$/, '');
  let worst = 0;
  ['index.html', 'valorant-crosshair-lab.html'].forEach(function (name) {
    const code = patchApiBase(path.join(root, 'outputs', name), url);
    if (code === 2) worst = 2;
  });
  process.exit(worst);
}

if (mode === 'restore') {
  restore(path.join(root, 'backend', 'wrangler.jsonc'));
  ['index.html', 'valorant-crosshair-lab.html'].forEach(function (name) {
    restore(path.join(root, 'outputs', name));
  });
  process.exit(0);
}

console.log('用法:');
console.log('  node work/patch-config.js db  <database_id>');
console.log('  node work/patch-config.js api <https://xxx.workers.dev>');
console.log('  node work/patch-config.js restore');
process.exit(2);
