-- 多公司（多租戶）第 4 階段：法規動態、AI 報表歸屬公司。
-- 既有資料全部歸給 UIC（co_uic）。新資料的 company_id 一律由程式寫入，欄位沒有預設值。

-- 法規動態：加欄位、回填，唯一索引改成每家公司各自一份（同一則 TFDA 公告每家公司各有自己的草稿）。
ALTER TABLE reg_entries ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE reg_entries SET company_id = 'co_uic';

DROP INDEX idx_reg_entries_import_key;
DROP INDEX idx_reg_entries_source_ref;
CREATE UNIQUE INDEX idx_reg_entries_import_key ON reg_entries(company_id, entry_date, title);
CREATE UNIQUE INDEX idx_reg_entries_source_ref ON reg_entries(company_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX idx_reg_entries_company ON reg_entries(company_id, status, entry_date DESC);

-- 安全網：沒帶 company_id 的新增（例如還沒改到的匯入路徑）依建立者的公司補上；查不到建立者的維持 NULL，
-- 任何公司都看不到，不會誤入別家。
CREATE TRIGGER trg_reg_entries_company_fill AFTER INSERT ON reg_entries
WHEN NEW.company_id IS NULL AND NEW.created_by IS NOT NULL
BEGIN
  UPDATE reg_entries SET company_id = (SELECT g.company_id FROM users u JOIN groups g ON g.id = u.group_id WHERE u.id = NEW.created_by)
  WHERE id = NEW.id;
END;

-- 駁回記錄（墓碑）：主鍵從 source_ref 改成 (company_id, source_ref)。沒有其他表參照它，直接重建。
CREATE TABLE tfda_rejected_backup AS SELECT source_ref, title, rejected_by, rejected_at FROM tfda_rejected WHERE source_ref IS NOT NULL;
DROP TABLE tfda_rejected;
CREATE TABLE tfda_rejected (
  company_id TEXT NOT NULL REFERENCES companies(id),
  source_ref TEXT NOT NULL,
  title TEXT,
  rejected_by TEXT,
  rejected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id, source_ref)
);
INSERT INTO tfda_rejected (company_id, source_ref, title, rejected_by, rejected_at)
SELECT 'co_uic', source_ref, title, rejected_by, rejected_at FROM tfda_rejected_backup;
DROP TABLE tfda_rejected_backup;

-- AI 週報／月報：scope='all' 變成「這家公司全部專案」，由 company_id 界定。
ALTER TABLE ai_reports ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE ai_reports SET company_id = COALESCE((SELECT g.company_id FROM groups g WHERE g.id = ai_reports.scope), 'co_uic');
CREATE INDEX idx_ai_reports_company ON ai_reports(company_id, created_at DESC);
