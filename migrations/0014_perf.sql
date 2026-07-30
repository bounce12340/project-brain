-- 專案內頁的任務列表對每個任務都跑一次 `SELECT COUNT(*) FROM files WHERE task_id=?`。
-- 既有的 idx_files_project_task(project_id, task_id, created_at) 因 task_id 不是最左欄，
-- 只能退化成 SCAN（實測 EXPLAIN QUERY PLAN 為 "SCAN f USING COVERING INDEX"），
-- 等於每個任務都全掃一次 files 索引。補上以 task_id 為首欄的索引改為 SEARCH 定位。
CREATE INDEX IF NOT EXISTS idx_files_task ON files(task_id);
