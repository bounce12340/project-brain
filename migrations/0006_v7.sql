DROP INDEX idx_files_project_task;

ALTER TABLE files RENAME COLUMN project_id TO legacy_project_id;
ALTER TABLE files ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
UPDATE files SET project_id = legacy_project_id;
ALTER TABLE files DROP COLUMN legacy_project_id;

CREATE INDEX idx_files_project_task ON files(project_id, task_id, created_at);

ALTER TABLE reg_entries ADD COLUMN file_id TEXT REFERENCES files(id) ON DELETE SET NULL;
CREATE INDEX idx_reg_entries_file ON reg_entries(file_id);
