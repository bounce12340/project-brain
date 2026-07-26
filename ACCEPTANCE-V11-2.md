# SPEC-V11-2 驗收紀錄

日期：2026-07-26

環境：production（`https://projects.uic-ai.com`、Cloudflare Workers／D1）＋本機 Vitest

範圍：`SPEC-V11-2.md` section 4 全部項目

## 結論

**PASS**。section 4 的 typecheck、test、build、remote migration、deploy、合成 TFDA 刪除墓碑 E2E、含相同 `source_ref` 的合成 feed skip、fixture cleanup、真實資料保護、401、published 631 與 title 均已實際執行。

正式資料最終仍為 **20 筆 `tfda_rss` drafts、631 筆 published**；兩組 `SELECT *` SHA-256 fingerprint 在 E2E 前、中、cleanup 後完全相同。`tfda_rejected` 最終為 0，沒有替真實草稿預寫墓碑。未查詢、登入、修改、重設、停用或刪除 `usr_admin`，也未讀取或修改 secrets。

## 1. Typecheck／test／build／migration／deploy（§4.1）

| 驗收 | 結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；19 test files、206/206 tests |
| V11.2 專項 | PASS；6/6 tests，符合規格 ≥4 |
| `npm run build` | PASS；Vite 7.3.6、660 modules |
| `wrangler deploy --dry-run` | PASS；2,580.17 KiB raw／622.64 KiB gzip |
| `git diff --check` | PASS |

### Remote migration 0010

`wrangler d1 migrations apply project-brain-db --remote`：

- PASS；`0010_v11_2.sql` 執行 2 commands，0.45 ms。
- remote schema read-back：
  - `source_ref TEXT PRIMARY KEY`
  - `title TEXT`
  - `rejected_by TEXT`
  - `rejected_at TEXT DEFAULT CURRENT_TIMESTAMP`
- migration 後立即 read-back：`tombstones=0`、`drafts=20`、`published=631`。
- 最終 `wrangler d1 migrations list project-brain-db --remote`：`No migrations to apply`。

第一次補查 schema 的 PowerShell 指令因 SQL 內雙引號被 CLI 切成額外參數而失敗；Wrangler 明確回報「必須提供 command/file」，沒有執行 SQL。改以 PowerShell 變數傳入不需跳脫的查詢後成功，結果如上。此命令建構失敗不冒充產品或 migration 失敗。

### Production deploy

- PASS；19 個新或修改 assets 上傳。
- Worker startup：17 ms。
- Current Version ID：`b0863d10-3f79-48ca-9fd7-aa2dc58464fa`。
- custom domain 與三條既有 cron triggers 均部署成功。

## 2. 合成 TFDA tombstone E2E（§4.2）

### 行為測試

開工先建立失敗測試並實際看到缺陷：

- 初次 V11.2 專項：2 passed、4 failed。
- 失敗內容符合待修行為：單筆／批次／published 刪除沒有 tombstone；合成 feed 被重建為 `new_drafts=1`。
- 實作後專項 6/6 與全套 206/206 均通過。

6 個專項覆蓋：

1. migration 0010 欄位。
2. 刪除 TFDA draft 寫入 `source_ref`、`title`、`rejected_by`、`rejected_at`。
3. batch delete 為每一筆 TFDA draft 寫墓碑。
4. 含相同 `source_ref` 的合成 feed 回 `skipped_rejected=1`、`new_drafts=0`，且不呼叫 AI、不重建條目。
5. 手動條目刪除不寫墓碑。
6. published TFDA 條目刪除同樣寫墓碑。

合成 feed 測試使用記憶體 SQLite/D1 adapter；每個 test 後關閉整個資料庫，因此合成條目與合成墓碑均清除。沒有對 production 呼叫真實 TFDA fetch，避免 feed 若有新公告時改動「20 筆真實 drafts」鐵則。

### Production API E2E

執行 `node scripts/v11-2-acceptance.mjs`，只使用固定 fixture：

- user：`usr_e2e_v11_2_ra`
- entry：`reg_e2e_v11_2_rejected`
- source ref：`9911261202`

結果：

| 檢查 | 結果 |
|---|---|
| 建立合成 TFDA draft | PASS |
| `DELETE /api/regwatch/reg_e2e_v11_2_rejected` | PASS；HTTP 200 |
| 合成 entry read-back | PASS；0 |
| tombstone source ref／title | PASS；與 fixture 完全相同 |
| `rejected_by` | PASS；`usr_e2e_v11_2_ra` |
| `rejected_at` | PASS；非空 |
| delete audit | PASS；1 row |
| cleanup | PASS；合成 user、session、entry、tombstone、audit 全部 read-back 0 |

## 3. 真實資料鐵則（§4.3）

E2E 使用 `SELECT * FROM reg_entries ... ORDER BY id` 建立完整 fingerprint，不只比較 count。

| 資料集 | E2E 前 | E2E 中 | cleanup 後 |
|---|---:|---:|---:|
| 真實 TFDA drafts | 20 | 20，fingerprint 相同 | 20，fingerprint 相同 |
| published entries | 631 | 631，fingerprint 相同 | 631，fingerprint 相同 |
| `tfda_rejected` | 0 | 1（僅合成 fixture） | 0 |

Fingerprints：

- 20 drafts：`7582d598ef9e7e520440fc0add4de4461a6d867c3d95881eb5af5aca3d6d10fc`
- 631 published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`

沒有核准、刪除、更新或重建這 20／631 筆，也沒有依 07-25 的已刪清單預寫任何真實 tombstone。

## 4. 迴歸（§4.4）

| 驗收 | 結果 |
|---|---|
| 未登入 `GET /api/regwatch` | PASS；401 |
| D1 published | PASS；631 |
| production homepage | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度` |

## 5. 文件、決策與紀律（§4.5／§5）

- `DECISIONS.md`：已記錄實證根因、三重判重順序、race-window INSERT 防護，以及反悔方式：
  `DELETE FROM tfda_rejected WHERE source_ref = ?`。
- `README.md`：已更新 v11.2、三重去重、TFDA draft／published 刪除墓碑與版本索引。
- `/admin`：未新增墓碑管理 UI。
- protected-scope addition scan：本輪 diff 新增行中 `usr_admin|secret` 為 0 matches。
- 沒有新增 dependency、沒有 TODO／FIXME 代替實作。
- 本輪沒有新的 open decision；規格指定的反悔手段已定案寫入 `DECISIONS.md`。

## Commits

1. `b014b53 fix: persist TFDA rejection tombstones`
2. `773437e test: add v11.2 production acceptance flow`
3. `8f81dd4 docs: document TFDA tombstone behavior`
4. `2ccd980 test: verify v11.2 fixture audit cleanup`

本文件保留初次紅燈測試與一次 schema 查詢命令的 quoting 失敗，不將未執行成功的檢查寫成 PASS。最終 PASS 只依據後續實際成功的完整測試、remote read-back、deploy 與兩次 production E2E。
