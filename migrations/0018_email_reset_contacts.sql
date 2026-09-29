-- 通知信的取消訂閱連結：每位使用者一組隨機代碼，第一次寄通知信時產生，只能用來關掉通知信。
-- 收件人在 Gmail 按「取消訂閱」時會打到這個連結，關掉的是艾爾水晶自己的設定，
-- 不會變成寄信服務的退訂或垃圾信檢舉（那會讓之後所有的信，包括重設密碼，都寄不到他）。
ALTER TABLE users ADD COLUMN email_token TEXT;
CREATE UNIQUE INDEX idx_users_email_token ON users(email_token);

-- 忘記密碼：寄出一次性的重設連結，資料庫只存代碼的雜湊。
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);

-- 不用登入就能呼叫的端點的次數限制（依 IP 雜湊與台北日期計數）。
CREATE TABLE rate_limits (
  action TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (action, key_hash, window_date)
);

-- 聯絡人資料庫：外部醫院、公司的窗口。所有登入的人都能查看、新增與修改。
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_contacts_organization ON contacts(organization, name);
