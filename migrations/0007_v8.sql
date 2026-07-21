ALTER TABLE ai_reports ADD COLUMN period_type TEXT NOT NULL DEFAULT 'week'
  CHECK (period_type IN ('week', 'month'));

-- Existing V2 reports may contain private project names. Default them to the
-- restrictive value; V8 safe reports always insert include_private=0 explicitly.
ALTER TABLE ai_reports ADD COLUMN include_private INTEGER NOT NULL DEFAULT 1
  CHECK (include_private IN (0, 1));

CREATE INDEX idx_reports_scope_access_created
  ON ai_reports(scope, include_private, created_at DESC);
