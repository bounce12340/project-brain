# SPEC-V11-3 驗收紀錄

日期：2026-07-27

環境：production（`https://projects.uic-ai.com`、Cloudflare Workers／D1）＋本機 Vitest

範圍：`SPEC-V11-3.md` section 4 全部項目

## 結論

**PASS**。section 4 的 typecheck、test、build、無 migration 確認、deploy、production 年月 API 與 D1 唯讀計數比對、month 無 year 忽略、built asset、401、published 總數、title，以及 drafts／published／tombstones 完整指紋保護均已實際執行。

production 在本輪開始與結束皆為 **16 筆 drafts、631 筆 published、4 筆 tombstones**。本輪未建立、核准、刪除或更新任何真實法規條目或墓碑；只建立一個 V11.3 專用 demo reader 與 session，驗收後均已清除並 read-back 0。未查詢、登入、修改、重設、停用或刪除 `usr_admin`，也未讀取或修改 secrets。

## 1. Typecheck／test／build／deploy（§4.1）

| 驗收 | 結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；20 test files、212/212 tests |
| V11.3 專項 | PASS；6/6 tests，符合規格 ≥4 |
| `npm run build` | PASS；Vite 7.3.6、660 modules |
| `wrangler deploy --dry-run` | PASS；23 assets、2,580.45 KiB raw／622.73 KiB gzip |
| `git diff --check` | PASS |

`wrangler d1 migrations list project-brain-db --remote` 回 `No migrations to apply`；本版沒有新增或修改 migration。

production deploy：

- PASS；19 個新或修改 assets 上傳，3 個既有 assets 沿用。
- Worker startup：16 ms。
- custom domain 與三條既有 cron triggers 均部署成功。
- Current Version ID：`14ed09b8-9fa7-406c-88dc-b8414d6824f4`。

## 2. Production 年月篩選 E2E（§4.2）

執行 `node scripts/v11-3-acceptance.mjs`，使用驗收專用唯讀 demo account `usr_e2e_v11_3_reader`。帳號只用於已發布 regwatch GET；沒有對 regwatch 發出 POST、PATCH 或 DELETE。

| 驗收 | API | D1 唯讀 | 結果 |
|---|---:|---:|---|
| `year=2026&month=7` | total 0 | `substr(entry_date,1,7)='2026-07'` count 0 | PASS；完全一致 |
| `month=7`（無 year） | total 631 | published count 631 | PASS |
| `month=7` vs 無參數 | 完整 JSON response 相同 | — | PASS |

2026-07 的實際 production count 為 0；驗收沒有建立合成 regwatch entry 來製造非零資料，因 SPEC 明定真實 drafts 與 tombstones 不得碰，且 published 總數必須不變。SQL 正確性另由本機記憶體 D1 測試以 51 筆 2026-07、跨月與跨年資料實證，第一頁 50、第二頁 1、total 51、total_pages 2。

專項 6 tests 覆蓋：

1. year+month SQL 同時排除同年其他月份與其他年份，且 pagination count 同步。
2. month 無 year 時與無年月參數完全一致。
3. month=0 忽略。
4. month=13 忽略。
5. month=abc 忽略。
6. 台北當年至 2018 的年份序列、12 個月份、year 清空重設 month、disabled 邏輯及 i18n parity。

### Built asset

production HTML 的 1 個 entry script 與其 19 個 chunks 均已抓回檢查：

- PASS；含 `全部月份` 與 `All months`。
- PASS；Regwatch chunk 含月份下拉。
- PASS；Regwatch chunk 含 `disabled:!<state>.year`，即 year 為空時停用月份。

第一次 production E2E 的 API、D1、cleanup 與資料指紋保護均已通過，但驗收腳本只抓 HTML 直接引用的 entry script，沒有跟進 lazy-loaded Regwatch chunk，因而把 disabled asset check 誤報失敗。修正驗收器以跟進 Vite chunk graph 後重跑全綠；第一次失敗不冒充產品失敗，也不從紀錄刪除。

## 3. 迴歸與資料鐵則（§4.3）

| 驗收 | 結果 |
|---|---|
| 未登入 `GET /api/regwatch` | PASS；401 |
| D1 published | PASS；前後皆 631 |
| production homepage | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度` |
| 真實 drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| demo fixture cleanup | PASS；user 0、session 0 |

完整 fingerprints：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`

V11.2 驗收曾記錄 20 drafts／0 tombstones；本輪開工時已是 16／4。這項既存變化已如實記入 `DECISIONS.md` open decision，本輪沒有還原、刪除或改寫它。

## 4. Help、決策與紀律（§4.4／§5）

- `/help`：新增一句年月操作說明，指出先選年份才會啟用月份，且可與產品線、類型、關鍵字疊加。
- `DECISIONS.md`：已記錄台北當年到 2018、month parsing／忽略合約、清空 year 重設 month、無 migration，以及 production 16 drafts／4 tombstones 的 open decision。
- i18n：zh／en keys 完全 parity；zh 為 1月～12月，en 為 Jan～Dec。
- protected-scope addition scan：implementation／test／decision 新增行（不含本驗收紀錄本身）中 `usr_admin|secret` 為 0 matches。
- 沒有新增 dependency、沒有 TODO／FIXME 代替實作。

## Commits

1. `ec323e0 feat: add regwatch year and month filters`
2. `eed725c test: cover v11.3 filters and acceptance`
3. `2cb7dba docs: record v11.3 filter decisions`
4. `19d4b79 test: follow production asset chunks`

本文件只把實際執行且看到成功輸出的項目標為 PASS；第一次 asset 驗收器失敗、production 的零筆 2026-07 計數，以及開工前既有的 16 drafts／4 tombstones 均如實保留。
