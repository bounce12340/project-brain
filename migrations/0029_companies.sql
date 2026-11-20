-- 多公司（多租戶）第 1 階段：公司、組別歸屬公司、系統管理員、邀請註冊。
-- 每個帳號經由所屬組別屬於一家公司。既有的組別與帳號全部歸給 UIC（co_uic），使用上沒有改變。
-- 新公司建立時是「建置中」（setup），帳號在公司開通前不能登入；資料隔離全部完成後才開放開通。

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'suspended')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO companies (id, name, status) VALUES ('co_uic', 'UIC', 'active');

-- 組別名稱原本全系統唯一，改成同一家公司內唯一。SQLite 改不了既有的 UNIQUE，只能重建 groups。
-- stage_templates.group_id 以 ON DELETE SET NULL 參照 groups，DROP TABLE 會把它清成 NULL，所以先備份、重建後放回。
-- users.group_id、projects.group_id 沒有連動動作，靠 defer_foreign_keys 在交易結束時才檢查，重建後 id 不變即可通過。
PRAGMA defer_foreign_keys = true;

CREATE TABLE stage_templates_group_backup AS SELECT id, group_id FROM stage_templates WHERE group_id IS NOT NULL;

-- 先複製一份，DROP 後用同一個名字重建再放回：SQLite 只有在同名的父表重新插入資料時，才會把延後的外鍵違規解除。
CREATE TABLE groups_backup AS SELECT id, name, type FROM groups;

DROP TABLE groups;

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('clinical', 'bd', 'general', 'qa')),
  company_id TEXT NOT NULL REFERENCES companies(id),
  UNIQUE (company_id, name)
);

INSERT INTO groups (id, name, type, company_id) SELECT id, name, type, 'co_uic' FROM groups_backup;

DROP TABLE groups_backup;

CREATE INDEX idx_groups_company ON groups(company_id);

UPDATE stage_templates SET group_id = (SELECT b.group_id FROM stage_templates_group_backup b WHERE b.id = stage_templates.id)
WHERE id IN (SELECT id FROM stage_templates_group_backup);

DROP TABLE stage_templates_group_backup;

-- 系統管理員：可以建立公司、發邀請、看各公司的帳號。和公司內的「管理員」角色分開。
ALTER TABLE users ADD COLUMN is_system_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_system_admin = 1 WHERE id = 'usr_admin';

-- 邀請碼：系統管理員發給新公司的第一位管理員，或公司管理員發給同仁。只存雜湊。
CREATE TABLE company_invites (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 500),
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_company_invites_company ON company_invites(company_id, created_at DESC);
