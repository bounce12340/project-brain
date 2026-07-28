# V12.2 驗收紀錄

驗收日期：2026-07-28（Asia/Taipei）

本文件逐項對應 `SPEC-V12-2.md` §4。只有實際執行並看到成功輸出的項目標為 PASS。production E2E 僅建立固定 V12.2 demo user、memory-only 隨機 session，以及由正式 API 新建後標記 `is_demo=1` 的 fresh project；每次嘗試均在 `finally` 刪除並回讀。全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未讀取或變更 secret 值，未建立、核准、修改或刪除真實 TFDA draft／published／tombstone，也未寫入使用者真實專案。

## 1. Typecheck／test／build／deploy（§4.1）

實際執行：

```text
npm run typecheck
npm test
npm run build
git diff --check
npx wrangler deploy
```

結果：

- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，25 test files、270 tests 全部通過；V12.2 專項共 21 tests。
- Vite：PASS，664 modules transformed，production assets 成功產出。
- `git diff --check`：PASS。
- Deploy：PASS；custom domain `projects.uic-ai.com`，Worker startup 20 ms，最終 Version ID `e22bddae-b4b7-4adc-a775-fbae5ab6e53d`。
- Migration：未執行；本版沒有 schema 變更，符合「deploy 成功（無 migration）」。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

## 2. 時區（§4.2）

### 2.1 自動測試

`tests/v12-2-timezone.test.ts` 實際執行 4 tests，全部 PASS：

| Fixture | 驗證結果 |
|---|---|
| `2026-07-28 02:07:18` | 視為 UTC，台北顯示 `10:07` |
| `2026-07-28T02:07:18` | 視為 UTC |
| `2026-07-28T02:07:18Z` | 原樣解析，不重複偏移；台北顯示 `10:07` |
| `2026-07-28` | 維持台北零時，UTC instant `2026-07-27T16:00:00.000Z` |
| 相對時間 | 依修正後 UTC instant 計算「3 小時前」 |

在套用修正前，特意以舊解析實作跑同一組測試，曾有 3/4 失敗（naive 顯示 `02:07`、相對時間差 11 小時）；修正後才全綠。

### 2.2 Production asset

最終 E2E 抓取正式站 entry script 與 20 個 chunks，結果：

- homepage HTTP 200。
- title 為 `艾爾水晶-專案進度`。
- built asset 含 naive datetime 的空格轉 `T` 與補 `Z` 正規化邏輯。
- `parseServerDate` 已由 API 日期格式化與進度相對時間共用；後端 storage 未改，沒有資料遷移。

結果：PASS。

## 3. 重複提交防呆（§4.3）

### 3.1 自動測試與 UI contract

`tests/v12-2-dedup.test.ts` 8 tests 全部 PASS：

- 里程碑相同 `project_id + title + due_date` 回 409。
- `due_date = NULL` 以 null-safe 比對，同樣防重。
- 錯誤訊息精確為 `相同里程碑已存在`。
- 里程碑、看板任務、階段、KR、待辦、CCR、證照、費用、收案登錄九個快速新增入口皆有 submitting、disabled 與 loading 文字。
- zh／en i18n key exact parity。

### 3.2 Production demo

對 fresh demo project 連續送出相同標題與日期：

| 呼叫 | 結果 |
|---|---|
| 第一次 `POST /api/projects/:id/milestones` | 201 |
| 第二次相同 POST | 409，`相同里程碑已存在` |
| Remote D1 read-back | 該 `(project,title,due_date)` count = 1 |

結果：PASS。最終 E2E 完成後 demo project 與 milestone 均清除。

## 4. Progress links（§4.4）

### 4.1 自動測試

`tests/v12-2-progress-links.test.ts` 9 tests 全部 PASS，覆蓋：

- 未來／過去日期分流。
- milestone 最多 5 筆、Unicode 80 字、重複與非法日期清洗。
- `dates.task_id` 只接受傳入的既有未完成任務、同任務最多一筆。
- 既有任務完成點不重複建立 milestone。
- LLM 把有日期的交付物放錯 `create` 時，server deterministic 歸入 milestone。
- 原有 `complete`／`create` 行為不回歸。
- 四陣列 prompt、歷史日期禁令、UI 預設不勾、套用走既有 endpoints、i18n parity。

### 4.2 Production demo

Fresh demo project 先建立既有未完成任務「審查 X 文件」，再發布：

```text
Hina 預計於 2026/12/01 提供 X 文件；收到 X 文件後，既有任務「審查 X 文件」應於 2026/12/31 前完成（為期一個月）。2025/12/09 已完成會議。
```

正式 `POST /api/ai/progress-links` 最終回應：

```json
{
  "complete": [],
  "create": [],
  "milestones": [
    {"title": "Hina 提供 X 文件", "due_date": "2026-12-01"}
  ],
  "dates": [
    {
      "task_id": "<fresh-demo-task-id>",
      "due_date": "2026-12-31",
      "reason": "收到 X 文件後一個月內完成"
    }
  ],
  "fallback": false
}
```

Read-back：

| 驗收 | 結果 |
|---|---|
| milestone | PASS；恰 1 筆，`2026-12-01` |
| 2025 歷史日期物件 | PASS；0 |
| dates 指向既有未完成任務 | PASS |
| dates 合法未來日期 | PASS；`2026-12-31` |
| 人工套用前 | PASS；task／milestone 資料完全未變 |
| 套用 milestone | PASS；既有 milestone POST 建立並 read-back 正確 |
| 套用 task date | PASS；既有 task PATCH 後 read-back `2026-12-31` |

結果：PASS。

## 5. 迴歸與真實資料保護（§4.5）

最終 production E2E：

| 驗收 | 結果 |
|---|---|
| 未登入 API | PASS；401 |
| homepage／title | PASS；200／`艾爾水晶-專案進度` |
| published | PASS；前後皆 631 |
| 真實 TFDA drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| TFDA tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| 真實 projects | PASS；前後皆 32，完整 fingerprint 相同 |
| 真實 tasks | PASS；前後皆 10，完整 fingerprint 相同 |
| 真實 milestones | PASS；前後皆 5，完整 fingerprint 相同 |
| 真實 progress | PASS；前後皆 124，完整 fingerprint 相同 |

Fingerprints：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`9c15d24bee175da5e1360ddb44f151f31e5adddde9148292e68bf2308f0ae861`
- real tasks：`c9ac9ee51d1673e0e7235b81b2281116048215b4706c4b3479a18d36ee6d801b`
- real milestones：`e599fa458b512284619393b4e8da7a7d04eaa6c82d44df5a206f44e0a12a63c4`
- real progress：`3e8ec700486db8f379961ff0fea8110fbd06f89e3b2a376d547ef5614218ca03`

最終 cleanup read-back：

| Demo table / scope | count |
|---|---:|
| projects | 0 |
| stages | 0 |
| tasks | 0 |
| progress_updates | 0 |
| project_members | 0 |
| milestones | 0 |
| files | 0 |
| automation_rules | 0 |
| key_results | 0 |
| users | 0 |
| sessions | 0 |
| audit_log | 0 |

結果：PASS。API project delete 成功，補償清理後所有 V12.2 demo 資料回讀為 0；受保護 fingerprints 不變。

## 6. README／help／DECISIONS（§4.6）

- `README.md`／`README.zh-TW.md`：PASS；版本與測試數更新為 v12.2／270，說明 AI 可建議 milestone／既有任務日期、所有建議預設不勾且須人工套用、歷史日期不建立物件，以及 server timestamps 以 UTC 儲存、介面以台北顯示。
- `/help`：PASS；中英 `help.progressLinksText` 與 `help.scheduleText` 已更新，i18n parity 測試通過，production chunk 驗證 milestone 與 task-date UI 均存在。
- `DECISIONS.md`：PASS；增量記錄時區解析、null-safe milestone 防重、progress-links 清洗、production LLM bucket normalization 與 open decision 狀態。
- Open decisions：無。正式基線與所有受保護 fingerprints 前後一致。

## 7. 未通過嘗試與修正歷程

以下嘗試均未冒充 PASS，且每次 `finally` cleanup 都回讀 demo 資料為 0、受保護 fingerprints 不變：

1. Version `4a864193-561a-4f1c-afbb-ab0c37ece22d` 剛部署後立即跑 E2E：第二個重複 milestone POST 暫時得到 201，而不是 409。稍後相同測試得到 409，判定為部署傳播期間仍命中舊 Worker；沒有忽略這次失敗。
2. 同版本再次執行：防重 PASS，但 LLM 同時回傳「Hina 提供 X 文件」與「審查 X 文件完成」兩個 milestones，未把既有任務完成點只放在 `dates`。新增 prompt 約束與 server 清洗，commit `a02aab0`。
3. Version `5dec119e-0f6a-41e6-a123-c3e04fd57f6d`：清洗後 milestones 為空，未達恰 1 筆。
4. 同版本診斷執行：原始有效回應把「取得 Hina 提供的 X 文件」放進 `create`，milestones 空；`dates` 已正確為 `2026-12-31`。因此加入 dated deliverable deterministic normalization，commit `6f85c9d`。
5. Version `e22bddae-b4b7-4adc-a775-fbae5ab6e53d`：全部 §4 production E2E 驗收 PASS，cleanup PASS。

## Commits

1. `429a993 fix: normalize server timestamps as UTC`
2. `016e6c5 fix: guard quick creates and duplicate milestones`
3. `b0c325d feat: derive milestones and task dates from progress`
4. `a02aab0 fix: separate task dates from milestones`
5. `6f85c9d fix: normalize dated deliverables as milestones`

