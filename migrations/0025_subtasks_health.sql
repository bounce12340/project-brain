-- 子任務：任務底下的輕量檢查清單。只顯示在任務上（例如 2/4），不計入專案自動進度。
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id, position);
CREATE INDEX idx_subtasks_assignee ON subtasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- 狀態燈號：發進度紀錄時選「順利／有風險／落後」；專案顯示最近一次標示的燈號。
ALTER TABLE progress_updates ADD COLUMN health TEXT CHECK (health IN ('on_track','at_risk','off_track'));
ALTER TABLE projects ADD COLUMN health TEXT CHECK (health IN ('on_track','at_risk','off_track'));
ALTER TABLE projects ADD COLUMN health_at TEXT;
