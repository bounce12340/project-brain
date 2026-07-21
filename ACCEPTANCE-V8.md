# SPEC-V8 驗收紀錄

執行日期：2026-07-22（Asia/Taipei）  
正式站：<https://projects.uic-ai.com>  
部署 Version ID：`3f3726e2-e52e-4c8d-ba03-32fe4ef7fc17`

## 結論

**PARTIAL PASS**。SPEC-V8 §5 的 4 大項均已實際執行，沒有跳過：typecheck／150 tests／build、bundle 差異、remote migration、deploy 與三個 cron、正式站兩種 BD 報告、權限、timeline、401、intern 視野、法規筆數、title、cleanup、`/help` 與 README 都有實測結果。

唯一不符合規格字面值的是 §5.3 的「627 筆法規不變」：正式 E2E 開始前是 628，結束仍是 628。本輪沒有建立、刪除或修改 `reg_entries`，沒有刪除來源不明的那一筆來迎合驗收；因此「本輪資料不變」PASS，「等於 627」FAIL。開放決策已記入 `DECISIONS.md`。

全程只建立並清除 V8 專用 `is_demo=1` 身分與 fixture；隨機密碼、salt、hash、session cookie 只存在程序記憶體，沒有輸出或落檔。沒有查詢、登入、修改、重設、停用或刪除禁止帳號，也沒有讀取、修改或輸出任何 secret。

## 1. Typecheck、test、build 與 bundle（§5.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；12 test files、150 tests、0 failed |
| V8 新測試 | PASS；`tests/v8-core.test.ts` 8/8 |
| `npm run build` | PASS；Vite 654 modules、22 個 dist 檔案 |
| `npx wrangler deploy --dry-run` | PASS；Total Upload 2551.49 KiB、gzip 614.69 KiB |

Bundle 與 V7.1 驗收基線比較：

| 指標 | V7.1 | V8 | 差異 |
|---|---:|---:|---:|
| Total Upload | 2542.10 KiB | 2551.49 KiB | +9.39 KiB |
| gzip | 612.67 KiB | 614.69 KiB | +2.02 KiB |

V8 的 8 個測試覆蓋：上月跨年邊界、UTC／台北日期邊界、private 排除、報告產生權限、同組 member／intern 與跨組讀取權限、月報 cron 分流、timeline 組別結構、字級 token snapshot。

## 2. Remote migration、deploy 與 cron（§5.2）

**PASS**。

- `npx wrangler d1 migrations apply project-brain-db --remote`：`0007_v8.sql` 執行 4 commands，狀態成功。
- 套用後獨立執行 `npx wrangler d1 migrations list project-brain-db --remote`：`No migrations to apply`。
- 第一組合指令在成功訊息後曾出現一次 Cloudflare API 7403 尾端錯誤；獨立重驗 exit 0，沒有隱藏此異常。
- `npx wrangler deploy`：成功；Worker Startup Time 17 ms。
- Wrangler 部署輸出明列 3 個 trigger：`0 1 * * *`、`30 0 * * 1`、`30 0 1 * *`。
- 正式部署 Version ID：`3f3726e2-e52e-4c8d-ba03-32fe4ef7fc17`。

## 3. 正式站 E2E（§5.3）

可重跑腳本：`scripts/v8-e2e.mjs`。正式資料 fixture 為 V8 專用 `is_demo=1` 帳號、兩個專案與其任務／進度／KR／BD 事件／費用；所有 ID 都使用 `*_e2e_v8_*` 固定前綴，以便精準清理。

剛部署後第一次執行在第一個 `POST /api/reports/ai/generate` 得到 404；先前已通過 title 200、未登入 401，finally cleanup 成功。未改程式碼或放寬斷言，稍後完整重跑通過所有 V8 功能檢查；這表示首次執行很可能仍命中部署前路由，但此原因僅為推論，未查證。

### 3.1 BD 組週報與月報

**PASS**。

| 操作 | 狀態 | 內容檢查 | AI |
|---|---:|---|---|
| BD demo member 產生「BD組・上週」 | 201 | 含公開 BD fixture；不含保密 fixture 名稱；文末含「保密專案未納入」 | 正常，`fallback=false` |
| BD demo member 產生「BD組・上月」 | 201 | 含公開 BD fixture；不含保密 fixture 名稱；文末含「保密專案未納入」 | 正常，`fallback=false` |

兩筆 read-back 的 `scope_name` 都是「BD組」，`period_type` 分別為 `week`、`month`。

### 3.2 權限

**PASS**。

- BD demo member 嘗試產生臨床組週報：403。
- 臨床組 demo member 嘗試讀 BD 組報告：403。
- BD 組 demo intern 讀同組報告：200。
- unit tests 另確認 non-admin 不可含 private、全公司與含 private 報告只有 admin 可讀。

### 3.3 Timeline 與回歸

| 項目 | 結果 |
|---|---|
| timeline API 組別泳道 | PASS；回傳 3 個目前可見的 group lanes，含 `grp_bd` |
| 展開任務資料 | PASS；公開 BD fixture 含任務 id、start／due、done 與 assignee name |
| private 隔離 | PASS；BD member timeline 不含未授權的 private fixture |
| intern 視野 | PASS；被加入的公開 fixture 可見，private fixture 不可見 |
| 未登入 | PASS；`GET /api/timeline` 回 401 |
| 首頁 title | PASS；HTTP 200 且含 `<title>艾爾水晶-專案進度</title>` |
| 法規資料本輪不變 | PASS；E2E 前 628、後 628 |
| 規格字面 627 | **FAIL**；正式基線已是 628 |

## 4. Cleanup、help 與 README（§5.4）

### Cleanup

**PASS**。E2E `finally` 執行精準清理後，remote D1 read-back：

- `demo_users=0`
- `demo_sessions=0`
- `demo_projects=0`
- `demo_reports=0`
- `reg_entries=628`，query 為唯讀且 `rows_written=0`

### `/help` 與正式 assets

**PASS**。正式站下列資產皆 HTTP 200 且 read-back 含指定內容：

- Help：`組別週報與月報`
- Reports：`含保密專案（僅管理員可讀）`
- Timeline：`timeline-expanded-projects`
- Profile：`18.5px`
- CSS：`data-fontsize`

README 已更新報告權限、組別泳道與任務展開、17／18.5px 字級、第三個月報 cron 與 LLM fallback 說明。

## 5. 實作與範圍檢查

- migration 0007 新增 `period_type` CHECK 與 `include_private` 安全標記；既有未知內容報告預設 restricted。
- 報告彙整包含專案進度變化、進度更新、完成任務與 KR、臨床收案、BD 事件、費用小計與逾期警示。
- timeline today 線貫穿全部泳道，專案／任務條為 16／14px，甘特 today 線為 3px，里程碑與列距同步加大。
- 字級 preference 由 `<html data-fontsize>` 驅動並保存在 localStorage。
- 未新增 dependency，未留下 TODO／FIXME 代替實作。
