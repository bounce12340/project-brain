# SPEC-V7-1 驗收紀錄

執行日期：2026-07-21（Asia/Taipei）  
正式站：<https://projects.uic-ai.com>  
部署 Version ID：`48801693-d937-4a5d-a34f-f5001c4724aa`

## 結論

**PARTIAL PASS**。SPEC-V7-1 §3 的所有項目都已實際執行，沒有跳過：新抽取行為、mode、key_points、typecheck、142 tests、build、deploy、single／multi 正式 AI E2E、401、資料筆數、cleanup 與正式 `/help` 均有實測結果。

唯一未符合字面驗收值的是 §3.3c 的「既有 627 筆」：正式 E2E 開始前已是 653 筆，測試前後皆維持 653。唯讀建立時間分布證實原始匯入仍是 627 筆，另有本輪開始前於 09:07 新增 17 筆、09:12 新增 9 筆。本輪沒有建立、刪除或修改任何 `reg_entries` 來迎合數字，因此該子項列為 **FAIL（基線已漂移）**；處置決策已記入 `DECISIONS.md`。

全程只建立及清除專用 `is_demo=1` RA/PV member，沒有登入、讀取、修改、重設、停用或刪除 `usr_admin`，也沒有讀取、修改或輸出任何 secret。

## 1. Vitest（§3.1）

先新增 v7.1 行為測試並實際看到 4 項紅燈，再完成實作。最終 `tests/v7-core.test.ts` 為 16/16 PASS，其中 v7.1 新增 4 tests：

| 規格項目 | 測試結果 |
|---|---|
| single 模式多筆自動歸一 | PASS；2 筆歸為 1 筆，日期取最早、標題取第一個、key_points 串接 |
| multi 模式邊界定義 | PASS；prompt 明定只有不同發文日期或不同公告標題才拆分，同公告條文／品項／附表／子項目不得拆 |
| key_points 摘要＋條列結構 | PASS；第一行無符號，後續行正規化為 `•` |
| mode 預設值 | PASS；缺值／`single` 為 single，只有明確 `multi` 才切換 |

完整 `npm test`：PASS，11 test files、142 tests，0 failed。

## 2. Typecheck、test、build 與 deploy（§3.2）

| 指令 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；11 files、142 tests |
| `npm run build` | PASS；Vite 653 modules、22 個 dist 檔案 |
| `npx wrangler deploy --dry-run` | PASS；Total Upload 2,542.10 KiB、gzip 612.67 KiB |
| `npx wrangler deploy` | PASS；custom domain 與 2 個既有 cron triggers 成功，Worker startup 15 ms |

正式部署 Version ID：`48801693-d937-4a5d-a34f-f5001c4724aa`。

## 3. 正式站 E2E（§3.3）

可重跑腳本：`scripts/v7-1-e2e.mjs`。測試身分為 `usr_e2e_v71_ra`（`grp_general` member、`is_demo=1`）；隨機密碼、salt、hash 與 session cookie 只存在程序記憶體，沒有輸出或落檔。

### 3a. 單則公告模式

**PASS**。輸入一則含發文日期、文號、公告標題及 3 個修正項目的自擬醫療器材公告，明確送出 `mode: "single"`：

- `POST /api/regwatch/ai-extract`：200。
- 回傳恰好 1 筆。
- `key_points` 恰好 4 行：第 1 行為無 `•` 摘要，後 3 行皆以 `•` 開頭。

### 3b. 多則彙整模式

**PASS**。輸入兩則具不同日期、文號與標題的自擬公告，明確送出 `mode: "multi"`：

- `POST /api/regwatch/ai-extract`：200。
- 回傳恰好 2 筆。
- 日期 read-back 為 `2026-07-22`、`2026-07-23`。

### 3c. 回歸

| 項目 | 結果 |
|---|---|
| 未登入 | PASS；`GET /api/regwatch` 回 401 |
| E2E 不改法規資料 | PASS；測試前 653、測試後 653 |
| 規格字面總數 627 | **FAIL**；開始前已是 653 |
| 原始 627 筆 cohort | PASS（唯讀計數）；09:00 前 627 筆，之後 26 筆 |

唯讀 minute 分布：07:39 244 筆、07:40 297 筆、07:41 32 筆、07:42 54 筆，共 627；09:07 17 筆、09:12 9 筆，共新增 26。沒有刪除這 26 筆，因其並非本輪 E2E 建立。

### 3d. Demo cleanup

**PASS**。E2E 的 `finally` 已清除專用 demo session、audit 與 user；remote D1 read-back：`demo_users=0`、`demo_sessions=0`。腳本沒有匯入法規條目，因此沒有正式法規資料需要清除。

第一次 E2E 執行在讀到 653 後依原腳本立即中止，cleanup 成功；為確保 §3a／§3b 仍被實際執行，腳本改為保留 627 斷言但延後判定。第二次執行完成 single、multi、401、前後計數與 cleanup，最後仍以 exit 1 如實呈現 627 基線不符，沒有放寬或繞過驗收。

## 4. `/help` 與正式 UI（§3.4）

**PASS**。

- `/help` 的「法規 AI 匯入」已說明：預設單則公告、摘要＋`•` 條列，以及只有不同日期或不同公告標題才選多則彙整。
- 正式 `HelpPage` asset：HTTP 200，read-back 含「預設選單則公告」與「摘要後以 • 條列」。
- 正式 `RegwatchPage` asset：HTTP 200，read-back 含「單則公告（預設）」與「多則彙整」。

## 5. 實作範圍與決策

- API JSON 與 multipart 均接受 `mode: "single" | "multi"`，缺值預設 single。
- single 即使 LLM 或切塊回多筆，後端仍強制歸一；multi 保留既有跨公告拆解與 title 去重。
- prompt 已寫死公告邊界、key_points 結構與「一則公告／三修正項目 → 一筆」few-shot。
- UI 預設 radio 為「單則公告」，可切換「多則彙整」。
- `README.md`、`DECISIONS.md` 與 `/help` 已同步更新。
- 未新增 dependency、migration、TODO 或 FIXME。
