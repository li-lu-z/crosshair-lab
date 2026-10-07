# 准星实验室 · 后端 API

Cloudflare Worker + D1，为前端提供三件事：**短链分享**、**埋点计数**、**热门榜**。
零依赖，一个文件就是全部逻辑（`src/index.js`），本地不用装任何东西就能跑测试。

## 它解决什么问题

准星分享码有 130 多个字符，直接发到聊天里又长又难复制。这个后端把它压成 6 位短链：

```
0;s;1;P;c;5;h;1;t;1;o;1;d;0;z;2;...（130 字符）
                    ↓  存一次
https://crosshair-lab-api.xxx.workers.dev/s/k3m9x2
                    ↓  别人打开
自动跳回站点并载入这支准星，同时 +1 次打开
```

顺带把「打开 / 套用 / 复制」记下来，热门榜就能按真实使用情况排序。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| POST | `/api/share` | 存一支准星，返回短链 ID。**同一支准星永远返回同一个 ID** |
| GET | `/api/share/:id` | 按 ID 取回准星，并把打开数 +1 |
| POST | `/api/event` | 埋点，`type` 只能是 `open` / `apply` / `copy` |
| GET | `/api/top?limit=10` | 热门榜，按打开数、套用数排序，limit 上限 50 |
| GET | `/api/stats` | 汇总统计 |
| GET | `/s/:id` | 302 跳回站点，地址带上 `?c=分享码&s=短链ID` |

## 本地跑测试（不用联网、不用登录）

```powershell
cd backend
node test/api.test.js
```

原理：Worker 只依赖标准的 `Request` / `Response` / D1 三个接口，所以测试里用 Node 24 自带的
`node:sqlite` 造一个**真的 SQLite 库**，按 D1 的 API 包一层，再用真的 `Request` 对象去调
`worker.fetch`。测的是真代码、真 SQL，不是 mock。

当前覆盖 49 项，包括：短链幂等、入参校验、计数累加、热门榜排序、limit 边界、
短链跳转的 URL 编码、CORS 白名单，以及一次 SQL 注入尝试（`type` 走白名单映射，
注入串会被拒绝且数据不变）。

## 部署步骤

前置：Node 已装（你机器上是 v24.16.0），并且已经 `wrangler login` 过（之前部署 Pages 时已完成）。

> 注意：你机器的 PowerShell 禁止运行 `.ps1` 脚本，所以命令一律用 `npx.cmd`，
> 或者在 cmd 窗口里把 `npx.cmd` 换成 `npx`。

**第 1 步 · 创建数据库**

```powershell
cd backend
npx.cmd wrangler d1 create crosshair-lab
```

它会打印一段 `database_id = "xxxxxxxx-xxxx-..."`，**复制这串 ID**。

**第 2 步 · 把 ID 填进配置**

打开 `backend/wrangler.jsonc`，把 `REPLACE_WITH_YOUR_DATABASE_ID` 换成刚复制的那串。

顺便把 `vars` 里的两个值改成你的：

- `SITE_BASE`：短链跳回哪个站点，默认是 `https://valorant-crosshair.pages.dev`
- `ALLOWED_ORIGINS`：允许跨域的前端来源，多个用英文逗号分隔；**填你的 Pages 域名**

**第 3 步 · 建表**

```powershell
npx.cmd wrangler d1 execute crosshair-lab --remote --file=./schema.sql
```

成功会返回一串执行结果。可以顺手确认一下表建好了：

```powershell
npx.cmd wrangler d1 execute crosshair-lab --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

**第 4 步 · 部署**

```powershell
npx.cmd wrangler deploy
```

会打印 Worker 地址，形如 `https://crosshair-lab-api.<你的子域>.workers.dev`，**复制它**。

**第 5 步 · 验证后端**

浏览器直接打开 `<Worker地址>/api/health`，应该看到 `{"ok":true,"time":...}`。
再打开 `<Worker地址>/api/top?limit=5`，应该看到 `{"limit":5,"items":[]}`（数据库还是空的）。

**第 6 步 · 把前端接上去**

打开 `outputs/index.html`，搜这一行：

```js
var API_BASE = '';
```

把 Worker 地址填进去：

```js
var API_BASE = 'https://crosshair-lab-api.xxx.workers.dev';
```

然后重新部署网页：

```powershell
cd outputs
npx.cmd wrangler pages deploy . --project-name valorant-crosshair
```

刷新线上页面，设计器下方的分享码下面会多出「生成短链」，页面底部会多出「大家都在用的准星」。

## 上线后的自测清单

1. 点「生成短链」→ 出现 `.../s/xxxxxx` 形式的链接
2. 复制那条短链，在**无痕窗口**打开 → 应该跳回站点，并自动载入那支准星
3. 刷新站点首页 → 「大家都在用的准星」里应该出现刚才那支，打开数 ≥ 1
4. 从短链落地页点一次「复制」→ 热门榜里的复制数 +1
5. 重复点「生成短链」→ 短链不变（同一支准星复用同一个 ID）

## 成本与限制（面试会问，先想清楚）

- **免费额度**：D1 免费版每天 500 万次读、10 万次写，5GB 存储；Workers 每天 10 万次请求。
  这个体量的小工具远远用不完。
- **写入并发**：计数用的是 `UPDATE ... SET x = x + 1`，由数据库保证原子性，
  不会像 KV 那样出现读改写丢更新。这是当初选 D1 而不是 KV 的主要原因。
- **无鉴权**：任何人都能提交短链和埋点，所以加了长度、字符集、类型白名单三道校验，
  并用唯一索引把重复提交压掉。**没有做限流**，这是已知缺口，下一步用 Durable Object
  或按 IP 哈希的滑动窗口补上。
- **隐私**：不记录 IP、不记录 UA、不写 cookie，只存匿名计数。

## 下一步可以加什么

- 按 IP 哈希限流，防刷
- 短链过期时间与手动删除
- 按「颜色 / 形状」维度统计（events 表已经预留了 type，加一列维度即可）
- 用 Cache API 给 `/api/top` 加 60 秒缓存，把读请求打下去
