-- 任務自訂欄位：每個專案自己定義（文字、數字、日期、單選），看板與清單可依欄位顯示與篩選。
CREATE TABLE task_fields (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','date','select')),
  options_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, name)
);
CREATE INDEX idx_task_fields_project ON task_fields(project_id, position);

CREATE TABLE task_field_values (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES task_fields(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (task_id, field_id)
);
CREATE INDEX idx_task_field_values_field ON task_field_values(field_id);
