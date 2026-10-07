/*
 * 发布前体检：提交到公开仓库之前跑一遍，检查容易翻车的东西。
 *
 * 覆盖：
 *   1. 本地绝对路径 / 用户名的泄露（截图、README 里最容易混进去）
 *   2. 疑似密钥（GitHub token、Cloudflare token、私钥、AK/SK 之类）
 *   3. 不该进仓库的本地状态文件（.wrangler 缓存、配置备份）
 *   4. 仓库该有的基础文件（.gitignore / .gitattributes / LICENSE）
 *
 * 用法：node work/check-publish.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const SKIP_DIRS = ['node_modules', '.git', '.wrangler', 'backups'];
const TEXT_EXT = ['.md', '.js', '.json', '.jsonc', '.cmd', '.html', '.wxml', '.wxss', '.sql', '.txt', '.yml', '.yaml'];

/* 只在这些文件里找路径泄露：数据文件（如 presets.js）和第三方文件跳过 */
const PATH_SCAN_SKIP = ['presets.js'];

const SECRET_PATTERNS = [
  { name: 'GitHub 令牌', re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/ },
  { name: 'GitHub 旧版令牌', re: /\b[0-9a-f]{40}\b/ },
  { name: 'Cloudflare API Token', re: /\b[A-Za-z0-9_-]{40}\b/ },
  { name: '私钥文件内容', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: '疑似硬编码密码', re: /(password|passwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i }
];

const LOCAL_PATH_PATTERNS = [
  { name: 'Windows 用户目录', re: /C:\\Users\\[^\\\s"']+/i },
  { name: 'macOS/Linux 用户目录', re: /\/Users\/[a-z0-9_.-]+/i },
  { name: '项目绝对路径', re: /Documents\\Codex\\/i }
];

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (SKIP_DIRS.indexOf(entry.name) >= 0) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

const files = walk(root, []);
const problems = [];
const notes = [];

files.forEach(function (file) {
  const rel = path.relative(root, file);
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const text = TEXT_EXT.indexOf(ext) >= 0 ? fs.readFileSync(file, 'utf8') : '';

  /* 1. 路径泄露 */
  if (text && PATH_SCAN_SKIP.indexOf(base) < 0) {
    LOCAL_PATH_PATTERNS.forEach(function (rule) {
      const hit = text.match(rule.re);
      if (hit) problems.push(rel + ' 含' + rule.name + '：' + hit[0]);
    });
  }

  /* 2. 疑似密钥 */
  if (text) {
    SECRET_PATTERNS.forEach(function (rule) {
      const hit = text.match(rule.re);
      if (hit) {
        const shown = hit[0].length > 12 ? hit[0].slice(0, 6) + '…（已截断）' : '（已截断）';
        problems.push(rel + ' 疑似' + rule.name + '：' + shown);
      }
    });
  }

  /* 3. 不该进仓库的文件 */
  if (/\.bak$/i.test(base)) problems.push(rel + ' 是配置备份，不应该提交');
  if (rel.indexOf('.wrangler') >= 0) problems.push(rel + ' 是部署工具的本地状态，不应该提交');
  if (base === 'preview-with-backend.html') notes.push(rel + ' 是脚本生成的预览文件，已在 .gitignore 里忽略');
});

/* 4. 基础文件 */
['.gitignore', '.gitattributes', 'README.md'].forEach(function (name) {
  if (!fs.existsSync(path.join(root, name))) problems.push('缺少仓库基础文件：' + name);
});
if (!fs.existsSync(path.join(root, 'LICENSE')) && !fs.existsSync(path.join(root, 'LICENSE.md'))) {
  notes.push('没有 LICENSE：公开仓库建议加一个（MIT 最常见）');
}

/* ---------- 5. 顺带体检 GitHub Actions 工作流（离线只能做结构检查） ---------- */
const workflowDir = path.join(root, '.github', 'workflows');
if (fs.existsSync(workflowDir)) {
  fs.readdirSync(workflowDir).forEach(function (name) {
    if (!/\.ya?ml$/i.test(name)) return;
    const file = path.join(workflowDir, name);
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);

    if (text.indexOf('\t') >= 0) {
      problems.push(rel + ' 含制表符，YAML 只允许空格缩进');
    }
    ['name:', 'on:', 'jobs:'].forEach(function (key) {
      if (text.indexOf('\n' + key) < 0 && text.indexOf(key) !== 0) {
        problems.push(rel + ' 缺少顶层键 ' + key);
      }
    });
    if (text.indexOf('runs-on:') < 0) {
      problems.push(rel + ' 缺少 runs-on，任务不知道跑在什么环境');
    }
    /* 每行结尾不要有多余空格，避免各种意外 */
    text.split('\n').forEach(function (l, i) {
      if (/[ \t]+$/.test(l)) problems.push(rel + ' 第 ' + (i + 1) + ' 行结尾有多余空格');
    });
  });
}

/* ---------- 输出 ---------- */
console.log('扫描文件数：' + files.length);
if (problems.length) {
  console.log('\n需要处理（' + problems.length + '）：');
  problems.forEach(function (item) { console.log('  ✗ ' + item); });
} else {
  console.log('\n没有发现阻塞发布的问题 ✓');
}
if (notes.length) {
  console.log('\n提示（' + notes.length + '）：');
  notes.forEach(function (item) { console.log('  · ' + item); });
}

process.exitCode = problems.length ? 1 : 0;
