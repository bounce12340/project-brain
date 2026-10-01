-- 會議記錄與外出上課紀錄。兩者欄位幾乎一樣，共用一張表、用 kind 區分：
-- 會議可以掛在某個專案底下（看得到那個專案的人才看得到），上課多一格主辦單位。
-- 時間存台北時間的「YYYY-MM-DDTHH:MM」，與 datetime-local 輸入框同格式，字串排序即時間排序。
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('meeting', 'course')),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT NOT NULL DEFAULT '',
  attendees TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_meetings_kind_start ON meetings(kind, starts_at);
CREATE INDEX idx_meetings_start ON meetings(starts_at);
CREATE INDEX idx_meetings_project ON meetings(project_id);
