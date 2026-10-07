-- 准星实验室 · 数据库结构（Cloudflare D1 / SQLite）
-- 执行方式：npx wrangler d1 execute crosshair-lab --remote --file=./schema.sql

-- 分享过的准星：一行就是一支准星
CREATE TABLE IF NOT EXISTS shares (
  id         TEXT    PRIMARY KEY,          -- 短链 ID，6 位小写字母数字
  code       TEXT    NOT NULL,             -- 准星分享码原文
  name       TEXT    NOT NULL DEFAULT '',  -- 用户看到的名称（可空）
  hits       INTEGER NOT NULL DEFAULT 0,   -- 短链被打开次数
  applies    INTEGER NOT NULL DEFAULT 0,   -- 被套用到设计器的次数
  copies     INTEGER NOT NULL DEFAULT 0,   -- 被复制分享码的次数
  created_at INTEGER NOT NULL              -- Unix 秒
);

-- 同一支准星保持同一个短链：靠唯一索引兜住并发重复提交
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_code ON shares (code);

-- 热门榜排序用：先看打开数，再看套用数
CREATE INDEX IF NOT EXISTS idx_shares_rank ON shares (hits DESC, applies DESC, created_at DESC);

-- 原始事件流水：用来回答「哪类准星最受欢迎」这类问题
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id   TEXT,
  type       TEXT    NOT NULL,             -- open / apply / copy
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (type, created_at DESC);
