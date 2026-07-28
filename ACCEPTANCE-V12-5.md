# V12.5 驗收紀錄

驗收日期：2026-07-28（Asia/Taipei）

本文件逐項對應 `SPEC-V12-5.md` §6。只有實際執行且看到成功輸出的項目標為 PASS。Production E2E 僅建立隨機唯一 id 的 fresh demo user、memory-only 隨機 session，以及由正式 API 新建後立刻標記 `is_demo=1` 的 private demo project；所有資料均在 `finally` 清除並逐表回讀為 0。全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未讀取或變更任何 secret，未建立、核准、修改或刪除真實 TFDA draft／published／tombstone，也未寫入使用者真實專案。

## 1. Typecheck／test／build／deploy（§6.1）

實際執行：

```text
git diff --check
npm run typecheck
npm test
npm run build
node --check scripts/v12-5-acceptance.mjs
npx wrangler deploy --dry-run
npx wrangler d1 migrations list project-brain-db --remote
npx wrangler deploy
```

結果：

- `git diff --check`：PASS。
- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，28 test files、295 tests 全部通過；`tests/v12-5-task-dependency-dates.test.ts` 13/13。
- V12.5 純函式實際覆蓋：多前置取最晚、跨月、跨年、任一前置無日期回 null、空起始日自動帶入、保留工期平移、touched 不覆蓋、移除全部不清日期，以及無到期日提示。
- Vite：PASS，665 modules transformed，production assets 成功產出。
- Deploy dry-run：PASS，24 assets，Worker bindings 解析成功。
- Migration：PASS；本版沒有 migration，remote 回覆 `No migrations to apply!`。
- Deploy：PASS；19 個新／異動 assets 上傳成功，custom domain `projects.uic-ai.com`，Worker startup 16 ms，Version ID `36307ff7-ebdc-4239-b7bd-0bf5250dccbf`。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

結果：PASS。

## 2. Fresh demo E2E：依賴接續與手動保護（§6.2）

正式站以 fresh private demo project 建立：

- A：`due_date=2026-09-10`
- B：無起訖日
- C：`due_date=2026-09-15`
- D：無起訖日，用於驗證 server 不會自行計算日期

日期建議邏輯由 13 個元件／純函式 Vitest 與 production built asset branch 驗證；資料寫入則由正式 API E2E 驗證。

| 驗收點 | 實際結果 |
|---|---|
| B 選 A 的建議起始日 | PASS；`2026-09-11` |
| 儲存後 API `B.start_date` | PASS；`2026-09-11` |
| B 原本沒有到期日 | PASS；儲存後仍為 `null` |
| B 手動改為 `2026-09-20` | PASS |
| 再加入較晚的前置 C | PASS；前端建議為 `2026-09-16`，API read-back 仍為手動值 `2026-09-20` |
| touched 建議 UI | PASS；built asset 含中英建議字串、「套用」狀態 branch 與 `suggestion` branch |
| server 不得自動算日期 | PASS；D 只 PATCH `dependency_ids=[A]` 後 `start_date`／`due_date` 仍皆為 `null` |
| 依賴與 task 同批儲存 | PASS；正式 PATCH read-back 同時取得完整 `dependency_ids` 與日期 |

結果：PASS。

## 3. Built asset：依賴區塊排序與呈現（§6.3）

正式 homepage、2 個 entry assets 與 20 個 lazy chunks 均實際抓取成功。

- `data-task-drawer-section="dependencies"` 在 `data-task-drawer-section="dates"` 之前：PASS。
- built assets 含中英「依前置任務帶入，可修改」：PASS。
- built assets 含中英手動日期建議：PASS。
- built assets 含中英「前置任務缺到期日」提示：PASS。
- built assets 含 `auto-applied`、`suggestion`、`missing-due-date` 三種狀態 branch：PASS。
- source／Vitest 確認依賴選項以 `任務標題（到期日）` 顯示，空值使用中英「未設定」：PASS。
- i18n exact key parity 由 TypeScript `Record<TransKey, string>` 與 typecheck 驗證：PASS。
- 樣式只使用既有雙主題 token（`border-nexus-line`、`text-star-dim`、`text-psi`、`text-gold-bright`），沒有硬編主題色：PASS。

結果：PASS。

## 4. 迴歸與真實資料保護（§6.4）

Production E2E 前後：

| 驗收 | 結果 |
|---|---|
| 未登入 API | PASS；401 |
| homepage／title | PASS；200／`艾爾水晶-專案進度` |
| 循環依賴 | PASS；422／`依賴關係會形成循環`，拒絕後依賴仍為空 |
| published | PASS；前後皆 631 |
| 真實 TFDA drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| TFDA tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| 真實 projects | PASS；前後皆 32，完整 fingerprint 相同 |
| 真實 tasks | PASS；前後皆 10，完整 fingerprint 相同 |

Fingerprints：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`7d5ec7403debdd0e2495205c65b3861db97c4a7c16f3530fe3b8821aec4e4d32`
- real tasks：`99bd54ee96051319b267957fd58ffdd7099a30c3765844350ca8c271b84d17ac`

結果：PASS。

## 5. Demo cleanup／README／help／DECISIONS（§6.5）

最終 cleanup read-back：

| Demo table / scope | count |
|---|---:|
| projects | 0 |
| stages | 0 |
| tasks | 0 |
| task_dependencies | 0 |
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
- `README.md`／`README.zh-TW.md`：已補依賴優先、自動接續與手動保護說明及 v12.5 版本列。
- `/help`：中英說明已補「依賴先選、保留工期、手動不覆蓋、按儲存才寫入」。
- `DECISIONS.md`：已記錄 task＋依賴同批 PATCH、缺日期不猜測、套用建議後 touched 狀態，以及重新開啟時的規格解讀。
- Open decisions：無。Remote baseline 與所有受保護 fingerprints 在 E2E 前後一致。

結果：PASS。

## 6. 未通過嘗試

- 第一次 production E2E 的產品/API 驗證、422、cleanup 與 fingerprints 全部通過，但驗收器把 minified JSX marker 猜成 `data-task-drawer-section:"dependencies"`；實際 built asset 是 `"data-task-drawer-section":"dependencies"`，因此 built asset 排序斷言 FAIL。先讀取實際產物後只修正驗收器字串，第二次完整 E2E 全部 PASS。第一次建立的 demo fixture 亦在 `finally` 清理並逐表回讀 0。
- 查驗實際 asset 時，第一次診斷命令把 `dist/assets/*.js` 直接交給 Windows `rg`，因 PowerShell 未展開 wildcard 而 exit 1；改為 `Get-ChildItem` 取得精確檔名後 `Select-String -LiteralPath` 成功讀到實際 marker。這是診斷命令路徑錯誤，不是產品、deploy 或資料驗收失敗。

## §6 總結

`SPEC-V12-5.md` §6.1–§6.5 已全部實際執行並 PASS。沒有跳過、無法驗證或粉飾為成功的項目。
