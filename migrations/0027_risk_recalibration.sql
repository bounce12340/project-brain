-- AI 風險分析改用明確的評分標準並以負責人的燈號優先：進行中與暫停的專案全部標成「待重新分析」，
-- 每 10 分鐘的排程會依序重做（每輪 6 個），舊的等級在重做前照常顯示。
UPDATE projects SET risk_updated_at = NULL WHERE status IN ('active', 'paused');
