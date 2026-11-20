-- 多公司第 5 階段：AI 用量。每家公司每天呼叫語言模型的次數，用來設每日上限，
-- 避免單一公司把共用的 LLM 額度用光。上限由環境變數 AI_DAILY_CALL_CAP 設定（預設 5000）。
CREATE TABLE ai_usage (
  company_id TEXT NOT NULL REFERENCES companies(id),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day)
);
