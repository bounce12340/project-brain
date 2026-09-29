-- 子專案：大專案（例如「預算管理」）底下掛幾個各自有看板、負責人與進度紀錄的子專案。
-- 只有一層：母專案本身不能再掛在別人底下，子專案底下也不能再有子專案（由 API 檢查）。
-- 母專案刪除時，子專案留下來變回一般專案。
ALTER TABLE projects ADD COLUMN parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_parent ON projects(parent_id);
