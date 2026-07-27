# v11.3：法規動態依公告月份篩選（年份＋月份下拉）

## 1. UI（/regwatch 篩選列）

- 既有「年份」數字輸入框改為**年份下拉**：選項「全部年份」＋ 2018 至當年（Asia/Taipei）遞減排列。
- 新增**月份下拉**：「全部月份」＋ 1月～12月；**僅在已選特定年份時啟用**（年份=全部時月份下拉 disabled 並重設為全部）。
- 選單變更即重新載入清單（沿用既有篩選行為與分頁重設）；月份與其他篩選（產品線／類型／關鍵字）可疊加。
- i18n：月份選項雙語（zh：1月…12月；en：Jan…Dec），「全部年份／全部月份」等新字串齊備，key-parity 測試須綠。

## 2. API

- GET `/api/regwatch` 加 `month` 參數（1–12，選填）：與既有 `year` 疊加，過濾條件為 `entry_date` 落在該年月（`substr(entry_date,1,7)='YYYY-MM'` 或等價 range 比較）；**無 `year` 時忽略 `month`**。非法值（0、13、非數字）忽略不報錯。
- 分頁計數（total／total_pages）同步反映月份過濾。

## 3. 測試（vitest ≥4）

年月組合過濾 SQL 正確性（含跨年界）、month 無 year 時忽略、非法 month 忽略、i18n parity。

## 4. 驗收（ACCEPTANCE-V11-3.md）

1. typecheck／test／build 全綠；deploy 成功（無 migration）。
2. 正式站 E2E（demo 可讀帳號）：`year=2026&month=7` 回傳筆數與 D1 唯讀 `substr(entry_date,1,7)='2026-07'` 計數一致；`month=7`（無 year）與不帶參數結果一致；built asset 含月份下拉與 disabled 邏輯。
3. 迴歸：401、published 總數不變、title；真實草稿與 tombstone 不動。
4. 結果如實寫入 ACCEPTANCE-V11-3.md；/help 一句補充；DECISIONS 增量。

## 5. 紀律

同 SPEC-V4 §6。小步 commit；不碰 usr_admin 與 secrets。
