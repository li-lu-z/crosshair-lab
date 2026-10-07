/*
 * 一键把项目推送到 GitHub。
 *
 * 它会依次处理这几件事（每一步都会打印结果）：
 *   1. 把项目目录加入 git 的信任白名单（解决 dubious ownership）
 *   2. 检查 / 设置提交身份（没设过会问你一次）
 *   3. 提交所有文件
 *   4. 关联远程仓库
 *   5. 推送（首次会弹浏览器让你登录 GitHub）
 *
 * 用法：双击根目录的 push-to-github.cmd，或运行 node work/push-to-github.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

const REPO_URL = 'https://github.com/li-lu-z/crosshair-lab.git';   /* 换仓库时改这一行 */
const COMMIT_MESSAGE = 'feat: 准星实验室 —— 单文件 Web 应用 + 微信小程序 + Worker/D1 后端';

const root = path.join(__dirname, '..');
const rootPosix = root.replace(/\\/g, '/');

function step(n, total, title) {
  console.log('\n[' + n + '/' + total + '] ' + title);
}

/* 捕获输出 */
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    out: String(result.stdout || '').trim(),
    err: String(result.stderr || '').trim()
  };
}

/* 直接继承终端，交互式命令（push 会弹登录窗口）必须用这个 */
function gitLive(args) {
  const result = spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  return result.status === 0;
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

/*
 * 连通性预检：直接向 github.com 发一个 HEAD 请求。
 * 国内访问 GitHub 经常被重置，而且是间歇性的，所以失败会重试几次。
 * 这样就不用在 git 那边等半天，最后只得到一个看不懂的报错。
 */
function pingGithub(timeoutMs) {
  return new Promise(function (resolve) {
    const req = https.request({ host: 'github.com', method: 'HEAD', timeout: timeoutMs }, function (res) {
      res.resume();
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, reason: '连接超时' }); });
    req.on('error', function (error) { resolve({ ok: false, reason: error.message }); });
    req.end();
  });
}

async function checkGithubWithRetry(attempts, timeoutMs) {
  for (let i = 1; i <= attempts; i++) {
    const result = await pingGithub(timeoutMs);
    if (result.ok) {
      console.log('      第 ' + i + ' 次尝试连通，GitHub 可达（HTTP ' + result.status + '）');
      return true;
    }
    console.log('      第 ' + i + ' 次尝试失败：' + result.reason);
    if (i < attempts) {
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
  }
  return false;
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('  准星实验室 · 推送到 GitHub');
  console.log('  仓库：' + REPO_URL);
  console.log('============================================================');

  /* ---------- 1. 信任白名单 ---------- */
  step(1, 5, '把项目目录加入 git 信任白名单');
  const trusted = git(['config', '--global', '--get-all', 'safe.directory']);
  if (trusted.out.split('\n').indexOf(rootPosix) >= 0) {
    console.log('      已经在白名单里，跳过。');
  } else {
    const added = git(['config', '--global', '--add', 'safe.directory', rootPosix]);
    console.log(added.ok ? '      已加入：' + rootPosix : '      加入失败：' + added.err);
  }

  /* ---------- 2. 仓库与身份 ---------- */
  step(2, 5, '检查仓库和提交身份');
  if (!fs.existsSync(path.join(root, '.git'))) {
    console.log('      没有 .git，先初始化 ...');
    const init = git(['init', '-b', 'main']);
    if (!init.ok) return fail('初始化失败：' + init.err);
  } else {
    console.log('      仓库已存在，分支：' + (git(['branch', '--show-current']).out || 'main'));
  }

  let name = git(['config', '--global', 'user.name']).out;
  if (!name) {
    name = await ask('      请输入提交用的名字（通常填 GitHub 用户名）: ');
    if (!name) return fail('名字不能为空');
    git(['config', '--global', 'user.name', name]);
    console.log('      已设置 user.name = ' + name);
  } else {
    console.log('      user.name 已设置：' + name);
  }

  let email = git(['config', '--global', 'user.email']).out;
  if (!email) {
    console.log('      提示：这个邮箱会写进每一次提交记录，公开仓库里谁都能看到。');
    console.log('      不想暴露真实邮箱的话，可以用 GitHub 给你的 xxxxx+用户名@users.noreply.github.com');
    email = await ask('      请输入提交用的邮箱: ');
    if (!email) return fail('邮箱不能为空');
    git(['config', '--global', 'user.email', email]);
    console.log('      已设置 user.email = ' + email);
  } else {
    console.log('      user.email 已设置：' + email);
  }

  /* ---------- 3. 提交 ---------- */
  step(3, 5, '提交所有文件');
  const added = git(['add', '-A']);
  if (!added.ok) return fail('git add 失败：' + added.err);

  const staged = git(['diff', '--cached', '--name-only']).out;
  const count = staged ? staged.split('\n').length : 0;
  console.log('      暂存了 ' + count + ' 个文件');

  const head = git(['rev-parse', '--verify', 'HEAD']);
  if (head.ok) {
    const changed = git(['status', '--porcelain']).out;
    if (changed) {
      console.log('      已有提交，把新改动追加成一次提交 ...');
      if (!gitLive(['commit', '-m', 'chore: 更新'])) return fail('提交失败');
    } else {
      console.log('      没有新改动，跳过提交。');
    }
  } else {
    console.log('      这是第一次提交 ...');
    if (!gitLive(['commit', '-m', COMMIT_MESSAGE])) return fail('提交失败');
  }

  /* ---------- 4. 关联远程 ---------- */
  step(4, 5, '关联远程仓库');
  const remotes = git(['remote']).out;
  if (remotes.split('\n').indexOf('origin') >= 0) {
    console.log('      origin 已存在，更新地址 ...');
    if (!git(['remote', 'set-url', 'origin', REPO_URL]).ok) return fail('更新远程地址失败');
  } else {
    if (!git(['remote', 'add', 'origin', REPO_URL]).ok) return fail('添加远程仓库失败');
    console.log('      已添加 origin');
  }
  console.log('      地址：' + git(['remote', 'get-url', 'origin']).out);

  /* ---------- 5. 推送 ---------- */
  step(5, 5, '推送到 GitHub');

  console.log('      先检查能不能连上 github.com ...');
  const reachable = await checkGithubWithRetry(3, 8000);
  if (!reachable) {
    console.log('');
    console.log('============================================================');
    console.log('  连不上 GitHub，这不是你的配置问题');
    console.log('============================================================');
    console.log('');
    console.log('  国内访问 github.com 经常出现 "Connection was reset"，而且是间歇性的。');
    console.log('  按下面顺序试，通常第一条或第二条就能解决：');
    console.log('');
    console.log('  1 等一两分钟重新双击本脚本 —— 重置是间歇的，重试往往就过了');
    console.log('     （所以脚本自带重试，你也可以多跑几次）');
    console.log('');
    console.log('  2 换网络：用手机热点、或者换个 Wi-Fi，成功率立刻不一样');
    console.log('');
    console.log('  3 如果你有代理软件（Clash / v2ray 之类），让 git 走代理：');
    console.log('       git config --global http.proxy http://127.0.0.1:7890');
    console.log('       git config --global https.proxy http://127.0.0.1:7890');
    console.log('     端口按你代理软件里的实际设置改。用完想取消：');
    console.log('       git config --global --unset http.proxy');
    console.log('       git config --global --unset https.proxy');
    console.log('');
    console.log('  4 以上都不行，告诉 Codex，它带你换 SSH 走 443 端口那条路。');
    console.log('');
    return fail('网络不通，推送没有开始（你的代码和配置都是好的）');
  }

  /*
   * 让 Git Credential Manager 走「设备码」流程。
   * 之前卡住的原因就是它想弹图形窗口、而窗口没出现，于是命令静悄悄地一直等。
   * 设备码模式不依赖弹窗：它会直接在终端打印一个网址和一串码。
   */
  git(['config', '--global', 'credential.gitHubAuthModes', 'device']);
  console.log('      登录方式：设备码（不依赖弹窗，也不需要令牌）');
  console.log('');
  console.log('      等一下终端会打印一行 https://github.com/login/device 和一串验证码，');
  console.log('      形如 1A2B-3C4D。打开那个网址、输入这串码、确认授权就行。');
  console.log('');
  if (!gitLive(['push', '-u', 'origin', 'main'])) {
    console.log('');
    console.log('      如果提示认证失败，多半是验证码没输完或过期了——重新运行本脚本再试一次即可。');
    return fail('推送失败');
  }

  console.log('');
  console.log('============================================================');
  console.log('  推送完成');
  console.log('============================================================');
  console.log('');
  console.log('  接下来：');
  console.log('    1 打开 https://github.com/li-lu-z/crosshair-lab 确认文件都在');
  console.log('    2 点顶部 Actions 标签，看 tests 是绿勾还是红叉');
  console.log('    3 红叉就把失败步骤的日志发给 Codex');
  console.log('');
  return 0;
}

function fail(message) {
  console.log('');
  console.log('[失败] ' + message);
  return 1;
}

main().then(function (code) {
  process.exitCode = code;
});
