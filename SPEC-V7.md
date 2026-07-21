# 艾爾水晶-專案進度 v7：法規動態 AI 分析匯入

> 增量規格，疊在 SPEC.md～SPEC-V6.md＋SPEC-IMPORT.md 之上；未提及行為不變。

## 0. 目標

/regwatch 新增「AI 匯入」：使用者貼上公告文字或上傳檔案（.txt／.pdf 文字層），AI 解析成一或多筆結構化法規條目，預覽可編輯後一鍵匯入，並保留原始檔可回查。

## 1. 使用流程

1. /regwatch 工具列新增「AI 匯入」鈕（權限同新增：RA/PV 組成員與 admin）。
2. 開啟 drawer：兩種輸入擇一——(a) 貼上文字 textarea；(b) 上傳單一檔案（accept `.txt,.pdf`，上限 10 MB）。附選填「來源連結」欄。
3. 送出 → POST `/api/regwatch/ai-extract` → 回傳條目陣列（一份月彙整公告可能含多筆，必須支援多筆拆解）。
4. 預覽表格：每列可直接編輯（日期／類型／產品線／類別／標題／重點）、可勾選排除；顯示與現有資料 `(entry_date,title)` 撞鍵的列並標示「已存在，將略過」。
5. 「確認匯入」→ 批次建立（沿用既有判重規則），回報 created/skipped；若有上傳檔案，原始檔存 R2 並讓每筆條目帶 `file_id`，列表列可下載原始檔。

## 2. 後端

- POST `/api/regwatch/ai-extract`（multipart 或 JSON）：
  - `.txt`／貼上文字：直接取文字。
  - `.pdf`：用 `unpdf`（Workers 相容、輕量）抽文字層；抽不到文字（掃描檔）→ 422「此 PDF 無文字層，請貼上文字或提供文字版」。**不引入 OCR**。
  - 文字長度 >24,000 字元 → 依頁或段落切塊、逐塊呼叫 LLM 後合併結果（去重同 title）；總上限 120,000 字元，超過回 422。
- LLM（走既有 `llm.ts`）：繁中 system prompt，要求嚴格 JSON 陣列，每筆：`entry_date`（YYYY-MM-DD；民國年須換算）、`entry_type`（announcement|meeting，預設 announcement）、`product_line`（限九選一：藥品/醫療器材/化粧品/健康食品/食品/再生醫療/包裝容器/寵物食品/其他；判不出用其他）、`category`（≤10 字短標籤，如 查登/GDP/標示/回收）、`title`（≤100 字）、`key_points`（條列式重點，用「•」開頭、換行分隔，風格比照既有資料）。寬鬆 JSON 解析；LLM 失敗或解析失敗 → 502「AI 服務暫時無法使用，可改用手動新增」，不得 crash。
- POST `/api/regwatch/batch`（確認匯入用）：陣列寫入，judge 判重 `(entry_date,title)` 回 created/skipped；寫 audit_log（`regwatch_ai_import`，含筆數與是否附檔）。
- 檔案：沿用 FileStore/R2；migration 0006：`files.project_id` 改為 NULLABLE（regwatch 上傳無專案歸屬），`reg_entries` 加 `file_id` TEXT NULL；下載權限：登入者皆可（與 regwatch 讀取一致）；刪除條目不刪共用原始檔，最後一筆引用刪除時一併刪 R2 物件。
- 新依賴僅允許 `unpdf`；bundle 增量如實記錄。

## 3. 測試（vitest ≥8）

民國年換算、product_line 白名單 fallback、切塊合併去重、撞鍵判定、無文字層 PDF 422、超長 422、batch 判重統計、files.project_id NULL 權限路徑。

## 4. 驗收（ACCEPTANCE-V7.md；demo 帳號；不碰 usr_admin 與 secrets）

1. typecheck／test／build 全綠；記錄 bundle 差異。
2. migration 0006 remote 套用；deploy 成功。
3. 正式站 E2E：
   a. 貼上一段含 2 則公告的中文文字（自擬，含民國日期）→ ai-extract 回 2 筆、欄位合規（記錄 fallback 與否）→ batch 匯入 created=2 → 列表可見 → 再匯一次 skipped=2。
   b. 產生一個含文字層的測試 PDF（可用既有工具或 node 腳本）→ 上傳 → 抽取成功 → 匯入 1 筆且 `file_id` 非空 → 下載原始檔 bytes 一致。
   c. 權限：intern 呼叫 ai-extract → 403。
   d. 清理 E2E 建立的條目與檔案；read-back 0。
4. 迴歸：未登入 401、/regwatch 既有 627 筆數不變、title 含艾爾水晶。
5. /help 補「AI 匯入」段；README、DECISIONS.md 更新；結果如實寫入 ACCEPTANCE-V7.md。

## 5. 紀律

同 SPEC-V4 §6。小步 commit：migration→抽取後端→前端 drawer→batch→驗收。
