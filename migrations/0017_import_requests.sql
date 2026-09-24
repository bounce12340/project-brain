-- 一般使用者的批次匯入先存成待審核，管理員核准後才寫進專案資料。
-- payload 整份存在一列裡（D1 單列上限約 2 MB，API 端限制 1.5 MB）。
CREATE TABLE import_requests (
  id TEXT PRIMARY KEY,
  submitted_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'failed')),
  source_name TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_import_requests_status ON import_requests(status, created_at);
CREATE INDEX idx_import_requests_submitter ON import_requests(submitted_by, created_at);
