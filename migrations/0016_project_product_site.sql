-- 專案的「相關性」原本只寫在名稱裡，而且有三種不一致的寫法：`[DST] …`（括號後有無空格
-- 不一致）、`RA：…`／`QA：…` 前綴，以及像 `Salagen初級包材變更` 這種沒有任何分隔符的
-- 產品名開頭。靠字串比對分群會漏掉最該連在一起的案子——BD 組的 `Plenvu` 與一般組的
-- `RA：啟動Plenvu註冊` 是同一個產品但不同組別，前綴分群一定拆開。
--
-- 因此把產品與廠區升為欄位。兩者都預設空字串而非 NULL，讓分群不必處理三態。
ALTER TABLE projects ADD COLUMN product TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN site TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_projects_product ON projects(product);

-- 一次性回填，只填得出來的，判斷不了的留空讓人自己補。規則跑過正式資料：32 筆中 22 筆
-- 有值，留空的 10 筆是 QA 行政作業、預算管理、藥品監視、A2 Healthcare、Kewpie 來訪與
-- 矯味劑變更——它們本來就不隸屬單一產品，硬塞一個反而會製造假的關聯。
-- 只更新目前為空的列，避免蓋掉之後手動填的內容。
UPDATE projects SET product = CASE
  WHEN name LIKE '[DST]%'    THEN 'DST'
  WHEN name LIKE '[AJT]%'    THEN 'AJT'
  WHEN name LIKE '[FLN]%'    THEN 'FLN'
  WHEN name LIKE '[清腸]%'   THEN '清腸'
  WHEN name LIKE '%Salagen%' THEN 'Salagen'
  WHEN name LIKE '%Plenvu%'  THEN 'Plenvu'
  WHEN name LIKE '%Fenogal%' THEN 'Fenogal 200mg'
  WHEN name LIKE '%Gastrilex%' THEN 'Gastrilex'
  WHEN name LIKE '%Bowklean%'  THEN 'Bowklean'
  WHEN name LIKE '%Pathone%'   THEN 'Pathone'
  WHEN name LIKE '%Xonrid%'    THEN 'Xonrid'
  WHEN name LIKE '%舒摩兒%'   THEN '舒摩兒'
  WHEN name LIKE '%舒逸敏%'   THEN '舒逸敏'
  ELSE ''
END
WHERE product = '';
