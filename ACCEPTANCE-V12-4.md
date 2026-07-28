# V12.4 驗收紀錄

驗收日期：2026-07-28（Asia/Taipei）

本文件逐項對應 `SPEC-V12-4.md` §5。只有實際執行並看到成功輸出的項目標為 PASS。Production E2E 僅建立隨機唯一 id 的 fresh demo user、memory-only 隨機 session，以及由正式 API 新建後立刻標記 `is_demo=1` 的 private demo project；所有資料均在 `finally` 清除並回讀為 0。全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未讀取或變更任何 secret，未建立、核准、修改或刪除真實 TFDA draft／published／tombstone，也未寫入使用者真實專案。

## 1. Typecheck／test／build／migration／deploy（§5.1）

實際執行：

```text
npm run typecheck
npm test
npm run build
git diff --check
npx wrangler deploy --dry-run
npx wrangler d1 migrations list project-brain-db --remote
npx wrangler d1 migrations apply project-brain-db --remote
npx wrangler d1 execute project-brain-db --remote --command "PRAGMA table_info(milestones); ..."
npx wrangler deploy
```

結果：

- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，27 test files、282 tests 全部通過；`tests/v12-4-history-events.test.ts` 8/8。
- Vite：PASS，664 modules transformed，production assets 成功產出。
- `git diff --check`：PASS。
- Deploy dry-run：PASS，24 assets，Worker bindings 解析成功。
- Migration `0012_v12_4.sql`：PASS；remote 套用成功，之後 `No migrations to apply`。
- Migration 前 milestones 共 9 筆，其中使用者真實專案 5 筆；migration 後 9/9 都是 `kind='milestone'`。`kind` 為 `TEXT NOT NULL DEFAULT 'milestone'`，event 非 done 的非法筆數為 0。
- Deploy：PASS；custom domain `projects.uic-ai.com`，Worker startup 20 ms，Version ID `d8aae694-5f3e-4415-865f-abfcf4e50ada`。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

結果：PASS。

## 2. 歷程事件不影響自動進度（§5.2）

Production fresh demo project 使用自動進度，建立 2 個 tasks，將其中 1 個標為完成，再逐筆建立 3 個 `kind='event'`：

| 驗收點 | 實際結果 |
|---|---:|
| tasks | 2 |
| completed tasks | 1 |
| history events | 3 |
| events `done=1` | 3/3 |
| 建立 events 前進度 | 50% |
| 建立 3 events 後進度 | 50% |

程式查詢亦逐一驗證：

- `recomputeAutoProgress` 的 milestone 分子／分母皆有 `kind='milestone'`。
- dashboard overdue KPI、daily cron、risk input、週/月報逾期警示皆有相同排除條件。
- event POST 固定寫入 `done=1`；event PATCH 不能切回未完成。

結果：PASS。

## 3. AI 過去／未來日期分流與人工套用（§5.3）

先發布以下進度：

```text
2025/12/09 已完成會議；預計 2026/12/01 提供文件
```

正式 `POST /api/ai/progress-links` 實際回應：

```json
{
  "complete": [],
  "create": [],
  "milestones": [
    {"title": "提供文件", "due_date": "2026-12-01"}
  ],
  "events": [
    {"title": "已完成會議", "event_date": "2025-12-09"}
  ],
  "dates": [],
  "fallback": false
}
```

Read-back：

| 驗收點 | 實際結果 |
|---|---|
| `events` | PASS；恰 1 筆，`2025-12-09` |
| `milestones` | PASS；恰 1 筆，`2026-12-01` |
| 人工套用前 | PASS；milestones/events 資料完全未變 |
| 套用 event | PASS；`kind='event'`、`done=1`，進度仍為 50% |
| 套用 milestone | PASS；`kind='milestone'`、`done=0`，進度由 50% 變為 33% |

33% 是 2 tasks＋1 milestone 中只有 1 個 task 完成的 `1/3` 四捨五入結果；4 個 history events 全部未進入分子或分母。Modal 的 event title/date 可編輯、checkbox 預設不勾、可逐筆排除，並提供全選／取消全選；套用仍逐項呼叫既有 milestone POST。

結果：PASS。

## 4. Calendar／Gantt／timeline 與 API kind（§5.4）

Production homepage 與 lazy chunks 實際抓取成功（2 個 entry assets、20 個 chunks）：

- built assets 同時含「歷程事件」與 `History events`。
- calendar/timeline `event_date` branch 存在。
- calendar event 使用 secondary-color `bg-star-dim` 圓點 branch。
- project Gantt 與 `/timeline` 含 `goldDim`＋`fill:"none"` 的空心淡金菱形 branch。
- project detail API 每筆 milestone/event 都回傳 `kind`；demo read-back 4 筆皆為 `kind='event'`。
- `/api/timeline` demo project 回傳 4 筆 events，日期與標題完整。
- Gantt tooltip 由 i18n 組成「歷程：標題（日期）」／`History: title (date)` 語意。

結果：PASS。

## 5. 迴歸與真實資料保護（§5.5）

Production E2E 前後：

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
- real projects：`7d5ec7403debdd0e2495205c65b3861db97c4a7c16f3530fe3b8821aec4e4d32`
- real tasks：`99bd54ee96051319b267957fd58ffdd7099a30c3765844350ca8c271b84d17ac`
- real milestones：`e60dc5e94766cd2ea0c2dbfea22ed9fb30f43d12a2f474f43bda12ac0199cdac`
- real progress：`3e8ec700486db8f379961ff0fea8110fbd06f89e3b2a376d547ef5614218ca03`

結果：PASS。

## 6. Demo cleanup／README／help／DECISIONS（§5.6）

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
| notifications | 0 |
| users | 0 |
| sessions | 0 |
| audit_log | 0 |

- API project delete 成功；補償清理後所有 demo scopes 回讀為 0。
- `README.md`／`README.zh-TW.md`：已說明 history events 的呈現、人工建議流程與進度／提醒排除，並加入 v12.4 版本列。
- `/help`：中英說明已更新；i18n exact key parity 測試 PASS。
- `DECISIONS.md`：已記錄「歷史日期不做成里程碑」的原因、event API 不變量、deterministic AI 分流與 open decision 狀態。
- Open decisions：無。Remote baseline 與所有受保護 fingerprints 在 E2E 前後一致。

結果：PASS。

## 7. 未通過嘗試

- 最後一次 read-back 組合指令中的 `rg` pattern 因 PowerShell 引號解析成未閉合 regex，該組合指令因此 exit 1；同一組合中較早執行的 typecheck、282 tests 與 build 都已明確 PASS。隨後以多個 `-e` pattern 重跑 read-back，exit 0，並確認 worktree clean、關鍵查詢／UI branch／驗收結論均存在。這是診斷命令 quoting 錯誤，不是產品、部署或 E2E 失敗。

## §5 總結

`SPEC-V12-4.md` §5.1–§5.6 已全部實際執行並 PASS。沒有跳過、無法驗證或粉飾為成功的項目。
