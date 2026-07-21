# 艾爾水晶-專案進度 v8：組別報表、時間軸強化、可讀性調整

> 增量規格，疊在既有全部規格之上；未提及行為不變。

## 1. 報表：依組別產生週報與月報

- /reports 新增「產生報告」控制列：組別下拉（member 只能選自己的組；admin 可選任一組或「全公司」）＋期間（本週／上週／本月／上月）＋「產生」鈕 → 以 LLM 產生該組該期間的 markdown 報告（彙整：專案進度變化、progress_updates 摘要、完成任務與 KR、臨床收案、BD 案件事件與費用小計、逾期警示）。
- ai_reports 加欄 `period_type` CHECK IN ('week','month')（migration 0007）；既有列補 'week'。
- **保密隔離規則**：組別報告與全公司報告的生成一律**排除 visibility='private' 專案**，報告末註記「保密專案未納入」；admin 可另勾「含保密專案」產生僅 admin 可讀的版本。預生成組別報告開放**該組成員**可讀；全公司報告維持 admin（DECISIONS 同步更新 v2 的舊決策）。
- 新增 cron `30 0 1 * *`（台北每月 1 日 08:30）：自動產生上月月報（全公司＋各組，遵守上述隔離）；wrangler.jsonc triggers 同步加入，scheduled handler 依 cron 字串分流。
- 報告視圖右上加「列印」鈕（沿用既有 @media print 樣式）。

## 2. 時間軸強化

- **依組別泳道**：/timeline 依組別分區（組名標題列＋該組專案列），頂部組別篩選下拉（預設全部；intern 僅見自己可見專案，規則不變）。
- **任務區塊上軸**：每條專案列可展開（▶），顯示該專案任務的時間條（start_date→due_date；無 start 用建立日；done 任務條加勾記與降透明度），沿用甘特 SVG 工具函式；hover 任務條顯示 tooltip（任務名＋起訖＋負責人）——這即可回答「某時間點在執行哪些項目」。展開狀態記 localStorage。
- today 線貫穿全部泳道。

## 3. 可讀性（全站）

- 基礎字級 16px → **17px**；`text-xs` 級距升為 13px、`text-sm` 升為 15px（以 Tailwind fontSize token 調整，不逐檔改 class）；行高對應微調；對比度不得低於 SPEC-V5 §1 底線。
- 「字級」偏好切換（標準 17px｜大 18.5px）：放 /profile，localStorage 記憶，`<html>` data-fontsize 屬性驅動。
- 時間軸與甘特加粗：任務條高 8→14px、專案主條 10→16px、today 線 2→3px、里程碑菱形等比放大；泳道列距對應調整避免擁擠。

## 4. 測試（vitest ≥6）

上月期間邊界計算（Asia/Taipei、跨年）、報告生成排除 private 專案、月報 cron 字串分流、組別報告讀取權限（本組 member 可讀、他組 403、intern 本組可讀）、timeline API 組別分組結構、字級 token 快照。

## 5. 驗收（ACCEPTANCE-V8.md；demo 帳號；不碰 usr_admin 與 secrets）

1. typecheck／test／build 全綠；bundle 差異記錄。
2. migration 0007 remote 套用；deploy 成功（三個 cron 註冊確認）。
3. 正式站 E2E：BD demo member 產生「BD組・上週」週報與「BD組・上月」月報 → 200、內容含該組專案且**不含**保密專案名；該 member 嘗試產生臨床組報告 → 403；timeline API 回應含組別泳道結構與展開任務條資料；迴歸（未登入 401、intern 視野、627 筆法規不變、title）。
4. E2E 資料清理；/help 與 README 更新；結果如實寫入 ACCEPTANCE-V8.md。

## 6. 紀律

同 SPEC-V4 §6。commit 順序：migration→報表→cron→timeline→字級與加粗→驗收。
