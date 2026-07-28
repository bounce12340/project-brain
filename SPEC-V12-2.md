# v12.2：時區顯示修復＋重複防呆＋進度紀錄可產生里程碑與日期

> 三個問題皆由使用者實際使用暴露，均有明確證據：
> (1) **時區 bug**：`src/api.ts:34` 對無時區標記的 datetime 字串（DB 的 `CURRENT_TIMESTAMP` 產出，如 `2026-07-28 02:07:18`）直接 `new Date(value)`，瀏覽器以**本地時區**解析，導致 UTC 值被當成台北時間 → 全站這類時間戳**早 8 小時**（使用者實例：10:07 寫的進度顯示 02:07）。`done_at` 這類帶 `Z` 的 ISO 字串則正常。
> (2) **重複里程碑**：`ProjectDetailPage.tsx:54` `addMilestone` 提交期間未禁用按鈕、後端亦無重複檢查 → 連點產生 9 筆重複（實例：同專案「收到CTD文件」×5、「預計收到CTD文件」×4）。
> (3) 使用者在進度紀錄寫的日期只是文字，不會成為里程碑／任務日期，故時間軸／日曆／甘特無反應。

## 1. 時區修復（最高優先）

- `formatDate`（src/api.ts）解析規則改為：
  - 長度 10（`YYYY-MM-DD`）→ 維持現行 `+08:00` 處理。
  - 含 `Z` 或 `+hh:mm`／`-hh:mm` 偏移 → 原樣 `new Date(value)`。
  - **其餘（naive datetime，含 `YYYY-MM-DD HH:MM:SS` 與 `YYYY-MM-DDTHH:MM:SS`）→ 一律視為 UTC**：正規化為 `value.replace(" ", "T") + "Z"` 後再 parse。
- 相同規則抽成單一 `parseServerDate(value)` 工具函式，**全前端共用**：`src/progress-updates.ts`（相對時間）、任何 `new Date(` 直接吃後端時間戳之處（逐一 grep 修正，含 timeline／甘特／日曆／通知／稽核／報表列表）。
- 後端不改儲存格式（維持 UTC）；不做資料遷移。
- 測試：naive 字串（空格與 T 兩種）視為 UTC、帶 Z 不重複偏移、date-only 維持台北零時、相對時間（「3 小時前」）以修正後基準計算。

## 2. 重複提交防呆

- 快速新增表單一律加「送出中禁用」：里程碑、任務（看板欄內）、階段、KR、待辦、CCR、證照、費用、收案登錄——逐一檢查並補上 `submitting` 狀態（送出中按鈕 disabled 且顯示 loading 文字），成功後才 reset。
- 後端里程碑 POST 加防重：同 project_id ＋同 title ＋同 due_date（NULL 視為相等）已存在 → 回 409「相同里程碑已存在」，前端顯示提示不新增。**僅限里程碑**（任務允許同名，例如「補件」可能多輪）。
- 測試：後端防重（含 due_date NULL）、409 訊息、i18n parity。

## 3. 進度紀錄 → 里程碑與日期（擴充 v12 的 progress-links）

`POST /api/ai/progress-links` 回應結構擴充為 `{complete, create, milestones, dates}`，全部沿用 v12 的「預設不勾、人工套用才寫入」原則：

- `milestones[]`：`{title, due_date}`——從進度文字抽出「未來的、可交付的節點」（例：「Hina預計於2026/08/14提供CTD文件」→ 里程碑「收到CTD文件」2026-08-14）。最多 5 筆；套用時呼叫既有里程碑 POST（受 §2 防重保護）。
- `dates[]`：`{task_id, due_date, reason}`——為**既有未完成任務**建議到期日（例：「收到CTD文件進行審查(為期一個月)」→ 2026-09-14）。task_id 必須存在於傳入清單，日期須為合法未來日期，否則丟棄。套用時 PATCH 任務 due_date。
- 歷史日期（過去日期）**不建立**任何物件——它們是敘事，只留在進度紀錄。prompt 明確要求。
- Modal 增加對應兩區塊（可就地編輯標題／日期、可排除），toast 統計含「新增里程碑 N、設定日期 M」。
- i18n 中英齊備；key-parity 測試須綠。
- 測試：未來/過去日期分流、milestones 上限與清洗、dates 的 task_id 驗證、既有 complete/create 行為不回歸。

## 4. 驗收（ACCEPTANCE-V12-2.md；demo 專案，不得動使用者真實資料）

1. typecheck／test／build 全綠；deploy 成功（無 migration）。
2. 時區：以 fixture 驗證 `2026-07-28 02:07:18` 在台北顯示為 `10:07`（現行為 02:07）；帶 Z 的值不變；date-only 不變。前端 built asset 含正規化邏輯。
3. 防呆：正式站對 demo 專案連續兩次 POST 同標題同日期里程碑 → 第二次 409；demo 專案清除。
4. progress-links：demo 專案發布含「預計於 2026/12/01 提供 X 文件」與「2025/12/09 已完成會議」的進度 → 回應 `milestones` 含 1 筆（2026-12-01）、**不含**任何 2025 歷史日期物件；`dates` 針對既有任務給合法未來日期；套用後資料正確；清除 demo。
5. 迴歸：401、published 631、真實草稿與 tombstone 不變、使用者真實專案 fingerprints 不變、title。
6. README／help 更新（說明進度紀錄可產生里程碑與日期、時區一律台北）；DECISIONS 增量；結果如實寫入 ACCEPTANCE-V12-2.md。

## 5. 紀律

同 SPEC-V4 §6。commit：時區修復→防呆→progress-links 擴充→驗收。時區修復必須先獨立 commit 並確認測試涵蓋，避免與其他改動混淆。
