ALTER TABLE reg_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('published', 'draft'));
ALTER TABLE reg_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'tfda_rss'));
ALTER TABLE reg_entries ADD COLUMN source_ref TEXT;

UPDATE reg_entries
SET status = 'published', source = 'manual';

CREATE UNIQUE INDEX idx_reg_entries_source_ref
  ON reg_entries(source_ref)
  WHERE source_ref IS NOT NULL;

ALTER TABLE reg_entries RENAME COLUMN created_by TO legacy_created_by;
ALTER TABLE reg_entries ADD COLUMN created_by TEXT REFERENCES users(id);
UPDATE reg_entries SET created_by = legacy_created_by;
ALTER TABLE reg_entries DROP COLUMN legacy_created_by;
