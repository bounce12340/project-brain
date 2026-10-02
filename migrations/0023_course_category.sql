-- 公司外訓加一個分類：藥品、再生醫療、食品、醫療器材、化粧品、其他。
-- 存代碼（drug、regenerative、food、device、cosmetic、other），畫面再依語言顯示；空字串是還沒分類。
-- 會議記錄不用分類，一律是空字串。
ALTER TABLE meetings ADD COLUMN category TEXT NOT NULL DEFAULT '';
