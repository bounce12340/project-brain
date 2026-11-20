-- 登入失敗節流：不再用「帳號」單一維度鎖人（知道 Email 的人能一直鎖死本人）。
-- 改成三組計數：(帳號, IP)、IP（跨帳號）、帳號（跨 IP，高門檻安全網）。
-- key_hash 是 kind + 內容的 SHA-256；account_hash 是 Email 的 SHA-256，讓重設密碼時能一次清掉該帳號的所有 IP 鎖定。
CREATE TABLE IF NOT EXISTS login_throttle (
  key_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pair','ip','account')),
  account_hash TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_throttle_account ON login_throttle(account_hash);
CREATE INDEX IF NOT EXISTS idx_login_throttle_updated ON login_throttle(updated_at);
