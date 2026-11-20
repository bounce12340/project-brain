-- 多公司第 3 階段：共用工作區（聯絡人、會議與外訓、批次匯入申請）依公司隔離。
-- 既有資料全部屬於 UIC。新資料一律由程式寫入建立者的公司，不靠預設值。
-- 待辦與通知以帳號為單位，不另開欄位：待辦只能關聯同公司的專案，通知只發給同公司的帳號（由程式檢查）。
ALTER TABLE contacts ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE contacts SET company_id = 'co_uic';
CREATE INDEX idx_contacts_company ON contacts(company_id, organization, name);

ALTER TABLE meetings ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE meetings SET company_id = 'co_uic';
CREATE INDEX idx_meetings_company ON meetings(company_id, kind, starts_at);

ALTER TABLE import_requests ADD COLUMN company_id TEXT REFERENCES companies(id);
UPDATE import_requests SET company_id = 'co_uic';
CREATE INDEX idx_import_requests_company ON import_requests(company_id, status, created_at);
