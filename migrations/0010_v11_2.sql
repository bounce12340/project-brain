CREATE TABLE tfda_rejected (
  source_ref TEXT PRIMARY KEY,
  title TEXT,
  rejected_by TEXT,
  rejected_at TEXT DEFAULT CURRENT_TIMESTAMP
);
