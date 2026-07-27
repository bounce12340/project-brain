# v12：進度紀錄 → 任務連動（AI 建議，人工確認）

> 使用者實例：在「RA：Fenogal 200mg 成品規格變更」寫了 6 筆進度，但看板／清單／日曆／甘特不動——因為進度紀錄與任務卡是兩套資料。本版讓「寫進度」能一併推動任務卡，但**任何寫入都必須經人工勾選確認**，AI 不得自動改資料。

## 1. 流程（使用者已選定）

1. 使用者在專案「進度紀錄」發布一筆（沿用現行流程，**進度先存，不被 AI 拖慢**）。
2. 發布成功後前端呼叫 `POST /api/ai/progress-links`，回傳建議；**有建議才**跳出確認 modal，沒建議或呼叫失敗則靜默（僅 console 記錄），不影響已存進度。
3. Modal「偵測到這筆進度可能影響以下任務」分兩區，皆預設**不勾選**：
   - **標記完成**：清單列出候選未完成任務（標題＋所屬階段＋AI 判定理由一句）。
   - **新增任務**：AI 從進度文字抽出的新待辦（可就地編輯標題、選階段、選到期日；階段預設專案第一個未完成階段，日期預設空）。
4. 按「套用所選」→ 逐項寫入（完成＝PATCH done=1；新增＝POST 任務）→ 回饋 toast（例：已完成 2 項、新增 1 項）→ 重新載入任務資料；auto 進度模式會自然重算。按「略過」關閉，不留痕。

## 2. API

- `POST /api/ai/progress-links` {project_id, content, progress_update_id?}
  - 權限：需具該專案 canEditProgress。
  - 輸入給 LLM：進度內文＋該專案**未完成任務清單**（id/title/stage）＋階段名稱清單。
  - 回 JSON `{complete: [{task_id, reason}], create: [{title, stage_name?, due_date?}]}`；寬鬆解析、失敗回空陣列（HTTP 200，附 `fallback:true`），**絕不 500 影響前端**。
  - 硬性約束（prompt＋後端雙重驗證）：`task_id` 必須存在於傳入的未完成清單，否則丟棄；`create` 最多 5 筆、標題 ≤ 80 字；`due_date` 須為合法未來日期否則清空；`complete` 只保留 AI 明確表示「已完成／已送出／已取得」的項目，模糊語氣（將要、預計、規劃）不得列入。
  - 語言跟隨介面（沿用 v9 的 `lang` 參數規則）。
- 套用階段沿用既有 `PATCH /api/tasks/:id` 與 `POST /api/projects/:id/tasks`，不新增寫入端點（權限與 audit 自然沿用）。

## 3. UI 細節

- Modal 為既有 drawer/dialog 樣式，雙主題與 i18n（中英）齊備，key-parity 測試須綠。
- 每個「標記完成」項目顯示 AI 理由（≤30 字），讓使用者判斷是否誤判。
- 「新增任務」項目的階段以下拉選（該專案階段），到期日以 date input。
- Modal 開啟時焦點管理與 Esc 關閉正常；套用中顯示 loading，失敗顯示錯誤但不回滾已成功的項目（逐項報告）。
- 個人設定加開關「進度紀錄後顯示任務建議」（預設開，localStorage 記憶，key `AIUR_PROGRESS_LINKS`）——覺得吵可關掉。

## 4. 測試（vitest ≥8）

回應清洗（不存在 task_id 丟棄、create 上限與長度、非法/過去日期清空）、模糊語氣不列入 complete 的 prompt 契約測試（以 fixture 回應驗證清洗層）、fallback 空陣列、權限（無編輯權 403）、i18n parity、設定開關預設值。

## 5. 驗收（ACCEPTANCE-V12.md；demo 帳號；不碰 usr_admin、真實草稿與 secrets）

1. typecheck／test／build 全綠；deploy 成功（無 migration）。
2. 正式站 E2E（用**新建的 demo 專案**，不得動使用者真實專案）：
   a. 專案含 2 張未完成任務卡 → 發布進度「已完成安定性數據收集，下週送補件資料」→ `progress-links` 回應含 1 筆 complete（對應安定性卡）與 1 筆 create（補件資料）；記錄 fallback 與否。
   b. 套用 → 該卡 done=1、新任務存在且階段正確 → 專案 auto 進度上升。
   c. 模糊語氣測試：「預計下週完成 X」→ complete 為空（不得誤標）。
   d. 無編輯權帳號呼叫 → 403。
   e. 清理 demo 專案與其所有子資料，read-back 0。
3. 迴歸：401、published 631、真實草稿與 tombstone 數不變、title。
4. README／help 補說明；DECISIONS 增量；結果如實寫入 ACCEPTANCE-V12.md。

## 6. 紀律

同 SPEC-V4 §6。commit：API→清洗與測試→Modal UI→設定開關→驗收。**AI 不得在無使用者勾選的情況下寫入任何任務資料**是本版最高原則。
