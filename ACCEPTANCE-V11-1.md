# SPEC-V11-1 驗收紀錄

驗收日期：2026-07-26（Asia/Taipei）

正式站：<https://projects.uic-ai.com>

部署 Version ID：`f069df99-8bea-4437-b020-343da5f77d42`

## 結論

**整體 FAIL（實作已部署；production 資料基線不符合規格）**。

SPEC-V11-1 的 API、UI source、i18n、測試、build、deploy 與合成資料批次流程均已實作及執行。production E2E 實際完成 3 筆合成草稿的 2 筆 batch delete（含 1 個孤兒附件）與 1 筆 batch approve，並完整清除 fixture。

但 E2E 在建立任何合成資料前讀到的真實 TFDA draft 已是 **9 筆，不是規格指定的 20 筆**；同時沒有 published TFDA，表示 V11 驗收後原有 20 筆中已有 11 筆在本輪前被刪除。本輪沒有重建、核准、刪除或改寫剩餘 9 筆，前中後完整 fingerprint 一致。因 §4.3 的 20 筆字面條件已無法成立，本文件不得標 PASS。

production UI browser runtime 也不可用，因此 checkbox 實際點擊與雙主題視覺標「無法驗證」；production API E2E 與自動化 source 測試不冒充瀏覽器簽核。

全程未讀取、修改或輸出 secret，未查詢、登入、更新、重設、停用或刪除 `usr_admin`。正式驗收只使用固定 `*_e2e_v11_1_*` 合成 ids 與隨機 demo 密碼；fixture 最終 read-back 全為 0。

## 1. Typecheck／test／build／deploy（§4.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；18 test files、200/200 tests |
| V11.1 專項 | PASS；8/8 tests（規格要求 ≥5） |
| `npm run build` | PASS；Vite 7.3.6、660 modules |
| `npx wrangler deploy --dry-run` | PASS；2,579.26 KiB raw／622.46 KiB gzip |
| `npx wrangler d1 migrations list project-brain-db --remote` | PASS；`No migrations to apply` |
| `npx wrangler deploy` | PASS；Worker startup 16 ms；20 assets 上傳 |
| `git diff --check` | PASS |

正式部署保留 custom domain `projects.uic-ai.com` 與三個既有 cron；Version ID 為 `f069df99-8bea-4437-b020-343da5f77d42`。本版沒有 schema 變更或 migration。

V11.1 的 8 個專項測試涵蓋：

1. 非 RA/PV manager 呼叫批次端點回 403。
2. action、空 ids、100／101 ids 邊界。
3. approve 混入 published／不存在 id 時只處理 draft。
4. 重複 id 只處理一次，其餘計 skipped。
5. delete 只刪 draft 並移除孤兒附件。
6. 共用於 published 的附件不會被刪除。
7. 每批只寫一筆 `regwatch_draft_batch` audit，摘要含 action／requested／processed／skipped。
8. checkbox stopPropagation、danger 動作、確認文案與中英 key parity。

## 2. 合成草稿 batch delete／approve E2E（§4.2）

執行：`node scripts/v11-1-acceptance.mjs`，目標為正式站與 remote D1／R2。

固定合成資料：

- `reg_e2e_v11_1_delete_plain`
- `reg_e2e_v11_1_delete_file`
- `reg_e2e_v11_1_approve`
- `file_e2e_v11_1_orphan`
- demo user `usr_e2e_v11_1_ra`

### Batch delete

`POST /api/regwatch/drafts/batch`，`action=delete`，選 2 筆：

| 斷言 | 結果 |
|---|---|
| API response | PASS；`processed=2, skipped=0` |
| 被選 2 筆剩餘 | PASS；0 |
| 未選第 3 筆 | PASS；仍為 1 筆 draft |
| `reg_entry_files` 合成 link | PASS；0 |
| D1 合成 file row | PASS；0 |
| R2 合成 object | PASS；0 |

### Batch approve

`POST /api/regwatch/drafts/batch`，`action=approve`，選剩餘 1 筆：

| 斷言 | 結果 |
|---|---|
| API response | PASS；`processed=1, skipped=0` |
| D1 status | PASS；`published` |
| published API 關鍵字查詢 | PASS；可見 |
| batch audit | PASS；delete／approve 共 2 筆，摘要筆數正確 |

### Cleanup

PASS。合成 users、sessions、entries、files、junction 與 R2 object 最終皆為 0；published 回到 631。

### UI 實際操作

**無法驗證**。已依序嘗試：

1. `browser` skill：兩次 tool discovery 均無所需 Node browser control tool。
2. `computer-use` skill：同樣缺少其必要 Node control tool。
3. `orca-cli` 內嵌 browser：runtime 曾回 ready，但 `tab create` 逾時後 runtime 消失；獨立重啟回 `Cannot find module 'zod'`。

因此沒有虛構「點 checkbox 未展開」、「確認框畫面」、「focus-visible」或雙主題的實際瀏覽器結果。這些行為有 source／Vitest／build 證據，但沒有 runtime 視覺簽核。

## 3. 真實 TFDA drafts 保護（§4.3）

**FAIL（production 前置基線已不符規格；本輪保護成功）**。

第一次 E2E 在建立任何 fixture 前即中止：

```text
expected 20 real TFDA drafts before E2E, got 9
```

唯讀 aggregate：

| status | source | count |
|---|---|---:|
| published | manual | 631 |
| draft | tfda_rss | 9 |

沒有 `published/tfda_rss` rows。固定 V11.1 fixture entries、files、user、session 在這次中止後 read-back 均為 0。

調整腳本讓其以「當下 production baseline」做保護後完整執行，其真實 TFDA snapshot：

| 時點 | draft count | SHA-256 fingerprint |
|---|---:|---|
| E2E 前 | 9 | `477e9bd26cb06251bde4fe6940318aeca29475872802bd55b75e11c8eaa96600` |
| batch delete／approve 後 | 9 | 同前 |
| fixture cleanup 後 | 9 | 同前 |

fingerprint 由 9 筆的 `id, source_ref, status, entry_date, title, updated_at` 依 id 排序後計算。本輪剩餘 9 筆前後完全不變，但無法使已消失的 11 筆「保持不變」，且禁止藉由重建真實資料來迎合驗收。

驗收腳本在完整流程與 cleanup 後仍刻意 exit 1：

```text
SPEC-V11-1 expected 20 real TFDA drafts, production baseline was 9
```

此 open decision 已寫入 `DECISIONS.md`。

## 4. 迴歸（§4.4）

| 斷言 | 結果 |
|---|---|
| 未登入 `GET /api/regwatch` | PASS；401 |
| D1 published count（cleanup 後） | PASS；631 |
| 正式首頁 | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度` |

## 5. 文件與紀律（§4.5）

- `ACCEPTANCE-V11-1.md`：本文件，包含 PASS／FAIL／無法驗證與第一次失敗。
- `DECISIONS.md`：已增量記錄可見頁選取、重複 id 計數、無 migration、9/20 資料漂移與 browser runtime 限制。
- `README.md`：版本更新為 v11.1／200 tests，補上批次核准／刪除操作與本規格連結。
- 小步 commits：
  - `d4645fa feat: add regwatch draft batch API`
  - `87a521a feat: add regwatch draft batch selection UI`
  - `a1006c8 test: add v11.1 production acceptance flow`
  - `e4463dc test: preserve current TFDA draft baseline`

## 最終判定

功能實作與 deploy 可用；§4.1、API／資料層 §4.2、§4.4、§4.5 已通過。§4.3 因 production 在本輪前已由 20 筆變成 9 筆而 FAIL；UI browser runtime 為無法驗證。基於誠實條款，整體結論維持 **FAIL**，不可宣告完整 production acceptance PASS。
