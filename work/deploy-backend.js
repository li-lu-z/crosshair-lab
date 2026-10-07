/*
 * 后端一键部署的**全部逻辑**都在这个 Node 脚本里，.cmd 只负责启动它。
 *
 * 为什么不用批处理写逻辑：cmd.exe 解析 UTF-8 批处理时会在多字节字符上错位，
 * 中文提示可能变成乱码甚至被当成命令执行；而且用 for /f 解析 wrangler 的 JSON
 * 输出非常容易取错字段（之前就踩过：把 "database_id" 这个键名当成了值）。
 * 交给 Node 之后，正则解析和中文输出都稳定。
 *
 * 用法：node work/deploy-backend.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const patchConfig = require('./patch-config.js');

const root = path.join(__dirname, '..');
const backendDir = path.join(root, 'backend');
const DB_NAME = 'crosshair-lab';
const PROJECT = 'valorant-crosshair';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const URL_RE = /https:\/\/[^\s"']+\.workers\.dev/i;

function step(n, title) {
  console.log('\n[' + n + '/7] ' + title);
}

function runCapture(args) {
  const result = spawnSync(wranglerCmd(args), {
    cwd: backendDir,
    encoding: 'utf8',
    shell: true
  });
  const text = String(result.stdout || '') + String(result.stderr || '');
  return { ok: result.status === 0, text: text.trim() };
}

function runLive(args) {
  const result = spawnSync(wranglerCmd(args), {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true
  });
  return result.status === 0;
}

/*
 * 拼成一条命令字符串再交给 shell，而不是传参数数组。
 * 传数组 + shell:true 在 Node 24 会报 DEP0190 警告（参数不会被转义）。
 * 这里的参数全部来自脚本内部常量（数据库名、固定参数），没有用户输入，拼接是安全的。
 */
function wranglerCmd(args) {
  return 'npx.cmd --yes wrangler ' + args.join(' ');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(function (resolve) {
    rl.question(question, function (answer) {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

/* 先从配置里读，读不到就从命令输出里找；优先找和数据库同名的那一行 */
function findUuid(text, name) {
  const lines = String(text).split(/\r?\n/);
  const near = lines.find(function (l) { return l.indexOf(name) >= 0 && UUID_RE.test(l); });
  if (near) return near.match(UUID_RE)[0];
  const any = String(text).match(UUID_RE);
  return any ? any[0] : '';
}

function readConfiguredId() {
  if (!fs.existsSync(patchConfig.wranglerConfigPath)) return '';
  const text = fs.readFileSync(patchConfig.wranglerConfigPath, 'utf8');
  const found = text.match(/"database_id":\s*"([^"]*)"/);
  if (!found) return '';
  return UUID_RE.test(found[1]) ? found[1] : '';
}

/* 从 wrangler deploy 的输出里找出 Worker 地址 */
function findWorkerUrl(text) {
  const match = String(text).match(URL_RE);
  return match ? match[0].replace(/\/+$/, '') : '';
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('  准星实验室 · 后端一键部署');
  console.log('  建数据库 → 建表 → 部署 API → 接回网页');
  console.log('============================================================');

  if (!fs.existsSync(path.join(backendDir, 'wrangler.jsonc'))) {
    console.log('\n[错误] 找不到 backend/wrangler.jsonc');
    console.log('       请把这个脚本放在项目根目录下的 work 里，也就是和 backend、outputs 同级。');
    return 1;
  }

  /* ---------- 1. 登录 ---------- */
  step(1, '检查 Cloudflare 登录状态');
  const whoami = runCapture(['whoami']);
  if (whoami.text.indexOf('You are logged in') >= 0) {
    console.log('      已登录，跳过授权。');
  } else {
    console.log('      还没登录，下面会自动打开浏览器让你授权。');
    console.log('      授权成功后，浏览器里那个 localhost 报错页直接关掉就行。');
    if (!runLive(['login'])) return fail('登录没有完成');
  }

  /* ---------- 2. 拿到数据库 ID ---------- */
  step(2, '准备 D1 数据库 ' + DB_NAME);
  let dbId = readConfiguredId();
  if (dbId) {
    console.log('      配置里已经是合法 ID，跳过创建：' + dbId);
  } else {
    console.log('      先查一下是不是已经建过了 ...');
    const list = runCapture(['d1', 'list']);
    dbId = findUuid(list.text, DB_NAME);

    if (!dbId) {
      console.log('      没查到，开始创建 ...');
      const created = runCapture(['d1', 'create', DB_NAME]);
      console.log(created.text);
      dbId = findUuid(created.text, DB_NAME);
    } else {
      console.log('      已经存在，直接复用：' + dbId);
    }
  }

  if (!dbId) {
    console.log('');
    console.log('      没能自动读到数据库 ID。');
    console.log('      到 Cloudflare 后台 Workers 和 Pages → D1 里复制 ' + DB_NAME + ' 的 ID 粘进来。');
    dbId = await ask('      数据库 ID: ');
    if (!UUID_RE.test(dbId)) return fail('这个 ID 看起来不是合法的 UUID');
  }

  /* ---------- 3. 写入配置 ---------- */
  step(3, '把数据库 ID 写进 backend/wrangler.jsonc');
  if ((readConfiguredId() || '') !== dbId) {
    const text = fs.readFileSync(patchConfig.wranglerConfigPath, 'utf8');
    /* 备份放到 work/backups，避免混进任何会被发布的目录 */
    const backupDir = path.join(root, 'work', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, 'wrangler.jsonc.bak');
    if (!fs.existsSync(backup)) fs.copyFileSync(patchConfig.wranglerConfigPath, backup);

    /* 无论里面是占位符还是被写坏的键名，统一替换成真 ID */
    const updated = text.replace(/"database_id":\s*"[^"]*"/, '"database_id": "' + dbId + '"');
    if (updated === text) {
      console.log('      没找到 database_id 字段，请检查 wrangler.jsonc。');
      return fail('配置文件里缺少 database_id');
    }
    fs.writeFileSync(patchConfig.wranglerConfigPath, updated, 'utf8');
    console.log('      已写入（原文件备份为 wrangler.jsonc.bak）');
  } else {
    console.log('      已经是对的，跳过。');
  }

  /* ---------- 4. 建表 ---------- */
  step(4, '建表 ...');
  if (!runLive(['d1', 'execute', DB_NAME, '--remote', '--file=./schema.sql'])) {
    return fail('建表失败');
  }

  /* ---------- 5. 部署 Worker ---------- */
  step(5, '部署 Worker ...');
  const deployed = runCapture(['deploy']);
  console.log(deployed.text);
  let workerUrl = findWorkerUrl(deployed.text);
  if (!workerUrl) {
    console.log('');
    console.log('      没能自动读到 Worker 地址，把上面输出里的 https://xxx.workers.dev 粘进来。');
    workerUrl = await ask('      Worker 地址: ');
    if (!URL_RE.test(workerUrl)) return fail('这个地址看起来不对');
    workerUrl = workerUrl.replace(/\/+$/, '');
  } else {
    console.log('      地址：' + workerUrl);
  }

  /* ---------- 6. 写回网页 ---------- */
  step(6, '把 Worker 地址写进网页的 API_BASE');
  patchConfig.htmlPaths.forEach(function (file) {
    patchConfig.patchApiBase(file, workerUrl);
  });

  /* ---------- 7. 重新部署网页 ---------- */
  step(7, '重新部署网页，让线上生效');
  const answer = await ask('      现在重新部署网页吗？输入 Y 回车执行，直接回车跳过: ');
  if (answer.toUpperCase() === 'Y') {
    const result = spawnSync('npx.cmd --yes wrangler pages deploy . --project-name ' + PROJECT, {
      cwd: path.join(root, 'outputs'),
      stdio: 'inherit',
      shell: true
    });
    if (result.status !== 0) return fail('网页部署失败');
  } else {
    console.log('      已跳过。稍后双击 deploy-web.cmd 也能补上。');
  }

  console.log('');
  console.log('============================================================');
  console.log('  完成');
  console.log('============================================================');
  console.log('');
  console.log('  自测清单：');
  console.log('    1 浏览器打开 ' + workerUrl + '/api/health，应看到 {"ok":true,...}');
  console.log('    2 打开网页，点「生成短链」，出现 /s/ 开头的链接');
  console.log('    3 用无痕窗口打开那条短链，应跳回网页并自动载入那支准星');
  console.log('    4 回到网页首页，「大家都在用的准星」里应该出现它');
  console.log('');
  console.log('  想撤销对配置文件的修改：node work/patch-config.js restore');
  console.log('');
  return 0;
}

function fail(message) {
  console.log('');
  console.log('[失败] ' + message);
  console.log('       把上面的完整输出发给 Codex 看看。');
  console.log('       想撤销配置改动：node work/patch-config.js restore');
  return 1;
}

/* 被当作模块引用时只导出解析函数，方便单独测试 */
if (require.main === module) {
  main().then(function (code) {
    process.exitCode = code;
  });
} else {
  module.exports = {
    findUuid: findUuid,
    readConfiguredId: readConfiguredId,
    findWorkerUrl: findWorkerUrl
  };
}
