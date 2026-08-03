-- 依階段名稱套用五色語意配色。
--
-- 背景：stages.color 的欄位預設是 '#6366f1'，而建立專案／匯入資料的 INSERT 都沒有帶
-- color，因此正式庫 168 筆 stages 裡有 155 筆是同一個靛藍。全域時間軸的圖例因此整片同色，
-- 讀者無法從顏色分辨階段。寫入路徑已在同一次變更改為明確帶入顏色，這裡補正既有資料。
--
-- 配色來自 worker/services/stage-colors.ts，已以 OKLCH 檢定：在深色 (#0D1526) 與淺色
-- (#FBF9F4) 圖表底色上，亮度帶、彩度下限、全配對 CVD 分離與對比皆通過。
--
-- 依名稱比對、不動 id 與 position，因此不影響任務歸屬或排序。使用者自訂且不在清單內的
-- 階段名稱維持原顏色，不會被這支 migration 覆蓋。

-- 未開始
UPDATE stages SET color = '#0284c7' WHERE name IN ('待辦', '啟動準備', '準備文件', '開立');

-- 進行中
UPDATE stages SET color = '#d97706' WHERE name IN ('進行中', '執行中', '收案中', '根因調查', '措施擬定');

-- 等待外部
UPDATE stages SET color = '#7c3aed' WHERE name IN ('送件', '審查中', 'IRB 送審', '效期確認');

-- 需處理
UPDATE stages SET color = '#e11d48' WHERE name IN ('補件', '收到補件並進行回覆');

-- 完成
UPDATE stages SET color = '#15803d' WHERE name IN ('完成', '結案', '核准領證', '報告');
