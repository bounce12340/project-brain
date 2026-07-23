CREATE TABLE reg_entry_files (
  entry_id TEXT NOT NULL REFERENCES reg_entries(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  UNIQUE(entry_id, file_id)
);

CREATE INDEX idx_reg_entry_files_entry_position
  ON reg_entry_files(entry_id, position);

CREATE INDEX idx_reg_entry_files_file
  ON reg_entry_files(file_id);

INSERT OR IGNORE INTO reg_entry_files (entry_id, file_id, position)
SELECT id, file_id, 0
FROM reg_entries
WHERE file_id IS NOT NULL;
