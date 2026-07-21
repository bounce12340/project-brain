PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO groups (id, name, type) VALUES ('grp_qa', 'QA組', 'general');
INSERT OR IGNORE INTO project_members (project_id, user_id, added_by) VALUES ('prj_bd', 'usr_clinical2', 'usr_bd1');

ALTER TABLE projects ADD COLUMN progress_mode TEXT NOT NULL DEFAULT 'manual' CHECK (progress_mode IN ('manual', 'auto'));
ALTER TABLE projects ADD COLUMN risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high'));
ALTER TABLE projects ADD COLUMN risk_summary TEXT;
ALTER TABLE projects ADD COLUMN risk_suggestions TEXT;
ALTER TABLE projects ADD COLUMN risk_updated_at TEXT;

ALTER TABLE tasks ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN done_at TEXT;
ALTER TABLE tasks ADD COLUMN start_date TEXT;

ALTER TABLE users ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0;

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (task_id != depends_on_task_id),
  UNIQUE(task_id, depends_on_task_id)
);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('task_done','task_moved_to_stage','milestone_done','progress_reached')),
  trigger_param TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('notify_user','assign_task_to','create_todo_for','log_update')),
  action_param_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  action_param_text TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX idx_task_dependencies_parent ON task_dependencies(depends_on_task_id);
CREATE INDEX idx_task_comments_task_created ON task_comments(task_id, created_at);
CREATE INDEX idx_files_project_task ON files(project_id, task_id, created_at);
CREATE INDEX idx_automation_project_enabled ON automation_rules(project_id, enabled);
