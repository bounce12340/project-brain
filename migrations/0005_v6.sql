ALTER TABLE groups RENAME COLUMN type TO legacy_type;
ALTER TABLE groups ADD COLUMN type TEXT NOT NULL DEFAULT 'general'
  CHECK (type IN ('clinical', 'bd', 'general', 'qa'));
UPDATE groups SET type = CASE WHEN id = 'grp_qa' THEN 'qa' ELSE legacy_type END;
ALTER TABLE groups DROP COLUMN legacy_type;

ALTER TABLE projects ADD COLUMN external_key TEXT;
CREATE UNIQUE INDEX idx_projects_external_key ON projects(external_key) WHERE external_key IS NOT NULL;

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'TFDA',
  license_no TEXT,
  issued_at TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '有效' CHECK (status IN ('有效','換證中','已過期','已停用')),
  note TEXT NOT NULL DEFAULT '',
  last_notified_stage TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ccr_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ccr_no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('產品','文件','供應商','製程','設備','其他')),
  description TEXT NOT NULL,
  reason TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('重大','次要')),
  impact_assessment TEXT,
  status TEXT NOT NULL DEFAULT '申請' CHECK (status IN ('申請','評估中','已核准','執行中','效期確認','已結案','駁回')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  closed_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ccr_events (
  id TEXT PRIMARY KEY,
  ccr_id TEXT NOT NULL REFERENCES ccr_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('狀態變更','備註','重開')),
  from_status TEXT,
  to_status TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE key_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  quarter TEXT NOT NULL CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]Q[1-4]'),
  status TEXT NOT NULL DEFAULT '未開始' CHECK (status IN ('未開始','進行中','完成','暫停')),
  note TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_quarter_goals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  quarter TEXT NOT NULL CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]Q[1-4]'),
  objective TEXT NOT NULL,
  UNIQUE(project_id, quarter)
);

CREATE TABLE reg_entries (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'announcement' CHECK (entry_type IN ('announcement','meeting')),
  product_line TEXT NOT NULL CHECK (product_line IN ('藥品','醫療器材','化粧品','健康食品','食品','再生醫療','包裝容器','寵物食品','其他')),
  category TEXT,
  title TEXT NOT NULL,
  key_points TEXT,
  link TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_licenses_project_expiry ON licenses(project_id, expires_at);
CREATE INDEX idx_ccr_project_status ON ccr_records(project_id, status, created_at);
CREATE INDEX idx_ccr_events_record ON ccr_events(ccr_id, created_at);
CREATE INDEX idx_key_results_project_quarter ON key_results(project_id, quarter, position);
CREATE INDEX idx_reg_entries_filters ON reg_entries(entry_date DESC, product_line, entry_type);
CREATE UNIQUE INDEX idx_reg_entries_import_key ON reg_entries(entry_date, title);
