-- 「我參與的專案」個人報告（scope='mine'）只給產生者本人（與同公司管理員）看，
-- 必須記錄這份報告屬於誰；組別／全公司報告此欄為 NULL。
ALTER TABLE ai_reports ADD COLUMN owner_user_id TEXT REFERENCES users(id);
CREATE INDEX idx_ai_reports_owner ON ai_reports(owner_user_id, created_at DESC);
