-- 多公司第 2 階段：階段範本每家公司各自一份。
-- 範本原本全系統只有一份、名稱全域唯一；現在多一個 company_id，名稱改成同公司內唯一。既有範本全部歸給 UIC。
-- 專案的公司不另外存，由專案組別（groups.company_id）推得，所以 projects 不需要新欄位。
-- SQLite 改不了既有的 UNIQUE，只能重建 stage_templates：先備份、DROP、用同一個名字重建再放回。
-- 沒有其他表以外鍵參照 stage_templates；group_id 是 ON DELETE SET NULL 的子欄位，DROP 的是子表，不會動到 groups。
PRAGMA defer_foreign_keys = true;

CREATE TABLE stage_templates_backup AS SELECT id, name, group_id, stages_json FROM stage_templates;

DROP TABLE stage_templates;

CREATE TABLE stage_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  stages_json TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  UNIQUE (company_id, name)
);

INSERT INTO stage_templates (id, name, group_id, stages_json, company_id)
  SELECT id, name, group_id, stages_json, 'co_uic' FROM stage_templates_backup;

DROP TABLE stage_templates_backup;

CREATE INDEX idx_stage_templates_company ON stage_templates(company_id);
