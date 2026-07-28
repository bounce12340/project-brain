# v12.4：歷程事件（已發生的日期上時間軸／日曆／甘特）

> 使用者需求：進度紀錄裡已執行的日期（例：2025/12/09 CDE 第一次諮詢…2026/05/11 開始準備 CTD 共 12 筆）要能呈現在日曆與甘特圖上。
> 限制：不得把歷史日期做成一般里程碑——那會讓自動進度虛高（12 筆已完成 → 進度 67%，但實際工作尚未開始），重蹈本週剛修掉的假進度問題。

## 1. 資料模型（migration 0012）

- `milestones` 加欄：`kind` TEXT CHECK IN ('milestone','event') DEFAULT 'milestone'；既有資料 backfill 為 'milestone'。
- `event` 語意＝**已發生的事實**：`due_date` 存事件日期、`done` 恆為 1（建立時即設定，UI 不提供勾選切換）。

## 2. 進度計算（關鍵）

- 自動進度的分子與分母**一律排除 `kind='event'`**（`worker/services` 內的進度計算函式統一過濾）。
- 儀表板「逾期里程碑」KPI、每日 cron 的里程碑到期提醒同樣排除 event（已發生的事不需要提醒）。
- 測試必須覆蓋：專案含 N 個 event 時進度不變。

## 3. 呈現

- **甘特**：event 畫**空心淡金菱形**（gold-dim 描邊、無填色），與里程碑（實心金菱形）視覺可區分；hover tooltip 顯示「歷程：<標題>（日期）」。
- **日曆**：event 以次要色圓點顯示，點該日列出項目時標示「歷程」。
- **專案總覽**：里程碑區塊下方新增「歷程事件」清單（依日期正序，唯讀顯示＋刪除鈕；可手動新增：標題＋日期）。
- **/timeline**：專案列展開時一併顯示 event 標記（沿用甘特樣式）。
- i18n 中英齊備（「歷程事件」／"History events"），key-parity 測試須綠。

## 4. 進度紀錄 → 歷程事件（修訂 v12.2 §3 的規則）

- `POST /api/ai/progress-links` 回應再加 `events[]`：`{title, event_date}`——從進度文字抽出**過去日期**的已完成事實。
- 修訂 v12.2 的「歷史日期不建立任何物件」規則為：**過去日期 → 建議建立 `event`；未來日期 → 建議建立 `milestone`**（以 Asia/Taipei 今日為界）。
- 上限 20 筆（歷程通常較多）；標題 ≤ 60 字；同專案同標題同日期已存在則不重複建議。
- 沿用最高原則：預設不勾、人工勾選套用才寫入。
- Modal 新增「歷程事件」區塊，可就地編輯標題與日期、可排除、可全選（歷程常一次匯入多筆）。

## 5. 驗收（ACCEPTANCE-V12-4.md；demo 資料，不得動使用者真實專案）

1. typecheck／test／build 全綠；migration 0012 remote（backfill 筆數記錄）；deploy 成功。
2. 進度不受影響：demo 專案含 2 任務（1 完成）＋3 event → 進度為 50%（event 完全不計）。
3. AI 分流：發布含「2025/12/09 已完成會議」與「預計 2026/12/01 提供文件」的進度 → `events` 含 1 筆（2025-12-09）、`milestones` 含 1 筆（2026-12-01）；套用後資料正確、進度僅因 milestone 改變。
4. 呈現：built asset 含 event 的甘特／日曆樣式分支；API 回傳 kind 欄位。
5. 迴歸：401、published 631、真實草稿與 tombstone 不變、使用者真實專案 fingerprints 不變、title。
6. E2E demo 資料清除為 0；README／help 更新；DECISIONS 記錄「為何歷史日期不做成里程碑」；結果如實寫入 ACCEPTANCE-V12-4.md。

## 6. 紀律

同 SPEC-V4 §6。commit：migration→進度計算排除→呈現→AI 分流→驗收。**event 不得影響任何既有進度數值**是本版最高原則。
