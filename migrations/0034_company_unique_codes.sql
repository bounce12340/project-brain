-- 多公司：CCR 編號與專案代碼改成「各公司各自唯一」。
-- 原本兩者全系統唯一：A 公司用掉 CCR-2026-001，B 公司的第一張 CCR 只能從 002 起跳；
-- 專案代碼被別家用掉也不能用，等於能探測別家公司的代碼。
-- 既有資料全部屬於 UIC（co_uic），原本就不重複，改完不會衝突。

-- 專案：加 company_id（跟著組別的公司走），專案代碼的唯一索引改成每家公司一份。
-- company_id 一律由觸發器依 group_id 維護，程式不用自己寫。
ALTER TABLE projects ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE projects SET company_id = (SELECT g.company_id FROM groups g WHERE g.id = projects.group_id);

DROP INDEX idx_projects_external_key;
CREATE UNIQUE INDEX idx_projects_external_key ON projects(company_id, external_key) WHERE external_key IS NOT NULL;

CREATE TRIGGER trg_projects_company_insert AFTER INSERT ON projects
BEGIN
  UPDATE projects SET company_id = (SELECT g.company_id FROM groups g WHERE g.id = NEW.group_id) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_projects_company_group AFTER UPDATE OF group_id ON projects
BEGIN
  UPDATE projects SET company_id = (SELECT g.company_id FROM groups g WHERE g.id = NEW.group_id) WHERE id = NEW.id;
END;

CREATE TRIGGER trg_groups_company_projects AFTER UPDATE OF company_id ON groups
BEGIN
  UPDATE projects SET company_id = NEW.company_id WHERE group_id = NEW.id;
END;

-- CCR：欄位層級的 UNIQUE(ccr_no) 只能重建表格拿掉。ccr_events 參照它，一起備份重建，
-- 用原本的表名重建再放回資料（D1 的外鍵檢查延到交易結束，表名相同才對得上）。
CREATE TABLE ccr_records_backup AS SELECT * FROM ccr_records;
CREATE TABLE ccr_events_backup AS SELECT * FROM ccr_events;
DROP TABLE ccr_events;
DROP TABLE ccr_records;

CREATE TABLE ccr_records (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ccr_no TEXT NOT NULL,
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

INSERT INTO ccr_records (id,company_id,project_id,ccr_no,title,target_type,description,reason,classification,impact_assessment,status,requested_by,approved_by,requested_at,approved_at,closed_at,note,created_at,updated_at)
SELECT b.id,(SELECT p.company_id FROM projects p WHERE p.id = b.project_id),b.project_id,b.ccr_no,b.title,b.target_type,b.description,b.reason,b.classification,b.impact_assessment,b.status,b.requested_by,b.approved_by,b.requested_at,b.approved_at,b.closed_at,b.note,b.created_at,b.updated_at
FROM ccr_records_backup b;

INSERT INTO ccr_events (id,ccr_id,event_type,from_status,to_status,description,created_by,created_at)
SELECT id,ccr_id,event_type,from_status,to_status,description,created_by,created_at FROM ccr_events_backup;

DROP TABLE ccr_events_backup;
DROP TABLE ccr_records_backup;

CREATE UNIQUE INDEX idx_ccr_company_no ON ccr_records(company_id, ccr_no);
CREATE INDEX idx_ccr_project_status ON ccr_records(project_id, status, created_at);
CREATE INDEX idx_ccr_events_record ON ccr_events(ccr_id, created_at);

-- 安全網：沒帶 company_id 的新增依專案的公司補上（補上時若編號在這家公司重複，整筆新增失敗）。
CREATE TRIGGER trg_ccr_records_company_fill AFTER INSERT ON ccr_records
WHEN NEW.company_id IS NULL
BEGIN
  UPDATE ccr_records SET company_id = (SELECT p.company_id FROM projects p WHERE p.id = NEW.project_id) WHERE id = NEW.id;
END;
