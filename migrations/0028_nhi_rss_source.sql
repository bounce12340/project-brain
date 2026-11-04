-- 健保署法規公告 RSS：reg_entries.source 多一個 'nhi_rss'。
-- SQLite 改不了既有欄位的 CHECK，只能重建 reg_entries。reg_entry_files 以 ON DELETE CASCADE 參照它，
-- DROP TABLE 會連帶刪掉附件關聯，所以先備份、重建後放回。欄位順序與定義照舊，只放寬 source。
PRAGMA defer_foreign_keys = true;

CREATE TABLE reg_entry_files_backup AS SELECT entry_id, file_id, position FROM reg_entry_files;

CREATE TABLE reg_entries_new (
  id TEXT PRIMARY KEY,
  entry_date TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'announcement' CHECK (entry_type IN ('announcement','meeting')),
  product_line TEXT NOT NULL CHECK (product_line IN ('藥品','醫療器材','化粧品','健康食品','食品','再生醫療','包裝容器','寵物食品','其他')),
  category TEXT,
  title TEXT NOT NULL,
  key_points TEXT,
  link TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'tfda_rss', 'nhi_rss')),
  source_ref TEXT,
  created_by TEXT REFERENCES users(id)
);

INSERT INTO reg_entries_new (id, entry_date, entry_type, product_line, category, title, key_points, link, created_at, updated_at, file_id, status, source, source_ref, created_by)
SELECT id, entry_date, entry_type, product_line, category, title, key_points, link, created_at, updated_at, file_id, status, source, source_ref, created_by
FROM reg_entries;

DROP TABLE reg_entries;
ALTER TABLE reg_entries_new RENAME TO reg_entries;

CREATE INDEX idx_reg_entries_filters ON reg_entries(entry_date DESC, product_line, entry_type);
CREATE UNIQUE INDEX idx_reg_entries_import_key ON reg_entries(entry_date, title);
CREATE INDEX idx_reg_entries_file ON reg_entries(file_id);
CREATE UNIQUE INDEX idx_reg_entries_source_ref ON reg_entries(source_ref) WHERE source_ref IS NOT NULL;

INSERT OR IGNORE INTO reg_entry_files (entry_id, file_id, position)
SELECT entry_id, file_id, position FROM reg_entry_files_backup;

DROP TABLE reg_entry_files_backup;
