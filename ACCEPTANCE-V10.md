# SPEC-V10 驗收紀錄

驗收日期：2026-07-23（Asia/Taipei）

正式站：<https://projects.uic-ai.com>

最終部署 Version ID：`8019fa30-74b1-4812-a957-e28217193a9f`

## 結論

**PARTIAL PASS**。SPEC-V10 §5 的所有項目均已實際執行：typecheck、173 tests、build、migration 0008 remote/backfill、deploy、正式站公告日與施行日分流、多檔前後對照分析、2 檔儲存與下載、條目刪除後 D1/R2 孤兒清理、401、排序、title、E2E cleanup、Help、README 與 DECISIONS。

唯一 FAIL 是 §5.2d 指定正式站既有法規須為 628 筆；E2E 前後實際都是 **631**。本輪建立的唯一測試條目已刪除，專用 demo user／session／files／entries read-back 均為 0，因此 3 筆差異不是 V10 E2E 遺留。本輪未刪除、修改或重新歸類來源不明的正式法規資料來迎合數字；此差異已寫入 `DECISIONS.md` 的 open decision。

全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未讀取、修改或輸出任何 secret 值。正式 E2E 只使用隨機密碼的 `usr_e2e_v10_ra` demo fixture，密碼只存在程序記憶體；cleanup 成功。

## 1. Typecheck、test、build（§5.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test -- --reporter=verbose` | PASS；15 test files、173/173 tests |
| V10 專項 | PASS；10/10 tests，超過規格要求的 ≥8 |
| `npm run build` | PASS；Vite 7.3.6、660 modules |
| `wrangler deploy --dry-run` | PASS；Worker 2,563.52 KiB raw／617.75 KiB gzip |
| `wrangler check startup` | PASS；完成本機 startup profile 分析；產生的暫存 profile 已刪除 |

V10 專項實際覆蓋：

1. 公告日與施行日 prompt 分流及 few-shot。
2. 民國年換算。
3. `date_suspect` 第 90／91 天邊界與台北日界。
4. 多檔檔名分隔標頭。
5. 對照表／修正條文／現行條文訊號。
6. 前後對照段落正規化。
7. migration 0008 junction/backfill SQL。
8. junction 與 legacy `file_id` 合併去重。
9. 刪除條目的孤兒檔判定。
10. i18n key parity 與 English `Announced`。

最終 `dist` read-back：22 個檔案、864,028 B；其中 assets 21 個、863,231 B。`RegwatchPage` chunk 為 14,976 B，主 `index` chunk 為 241,048 B，最大 `LineChart` chunk 為 377,202 B。

## 2. Migration 0008 remote 與 deploy（§5.1）

remote migration 前唯讀：

- `reg_entries.file_id IS NOT NULL`：4 筆。

`npx wrangler d1 migrations apply project-brain-db --remote`：

- PASS；`0008_v10.sql` 執行 5 commands。
- `reg_entry_files` schema read-back 含兩個外鍵、`position >= 0` 與 `UNIQUE(entry_id,file_id)`。
- junction rows：4。
- legacy 非空 `file_id` 漏回填：0。
- 最終 `d1 migrations list --remote`：`No migrations to apply`。

第一次把 preflight 串成一個命令時，誤對 `d1 migrations apply` 加了 Wrangler 4.112 不支援的 `--yes`，所以該次只印 help／`Unknown argument: yes`，migration 沒有套用，後續查 junction 如實得到 `no such table`；同一串的 migrations list 另出現一次 Cloudflare API 7403。停止該串接方式後，以此版本支援的非互動語法獨立重跑，migration 與最終 list/read-back 均成功。這些初次失敗不列為 PASS，也未被省略。

`npx wrangler deploy`：

- PASS；20 個新或修改的 assets 上傳成功。
- Worker startup：16 ms。
- custom domain：`projects.uic-ai.com`。
- 三個既有 cron 均保留。
- Version ID：`8019fa30-74b1-4812-a957-e28217193a9f`。

## 3. 正式站 E2E（§5.2）

執行：`node scripts/v10-e2e.mjs`。腳本在正式 D1 建立單一 V10 專用 RA/PV demo member，以正式 API 登入、抽取、匯入、下載與刪除；finally 依專用 user id 精確清理並 read-back。

### 3a. 公告日與施行日

輸入為單一 `.txt`：

- 公告日：民國 115/7/20。
- 施行日：民國 116/3/1。

結果：

| 斷言 | 結果 |
|---|---|
| `POST /api/regwatch/ai-extract` | PASS；HTTP 200 |
| single entries | PASS；1 筆 |
| `entry_date` | PASS；`2026-07-20` |
| 第一個重點條列 | PASS；`• 施行日：2027-03-01` |
| `date_suspect` | PASS；`false` |

### 3b. 主文＋對照表多檔包

輸入為兩個 `.txt`：主文含公告日期、文號、標題與立法目的；對照表含第 3 條與第 5 條各一組現行／修正文字。

| 斷言 | 結果 |
|---|---|
| multi-file ai-extract | PASS；HTTP 200 |
| 預設 single | PASS；整包 1 筆 |
| 對照段標題 | PASS；含 `修正重點（前後對照）` |
| 舊→新摘要 | PASS；第 3 條與第 5 條共 2 條 |
| batch | PASS；`created=1, skipped=0` |
| junction | PASS；同一 entry 關聯 2 個 files |
| 列表 read-back | PASS；`files.length=2` |
| 登入者逐檔下載 | PASS；2/2 HTTP 200 |
| bytes | PASS；主文與對照表皆逐 byte 相等 |
| R2 刪除前 read-back | PASS；2/2 objects 存在 |

### 3c. 刪除與孤兒清理

| 斷言 | 結果 |
|---|---|
| `DELETE /api/regwatch/:id` | PASS；HTTP 200、`deleted_files=2` |
| `reg_entries` | PASS；0 |
| `reg_entry_files` | PASS；0 |
| `files` | PASS；0 |
| R2 objects | PASS；0（兩個 storage keys 皆讀取失敗，表示已不存在） |

### 3d. 迴歸

| 斷言 | 結果 |
|---|---|
| 未登入 `/api/regwatch` | PASS；401 |
| 首頁 | PASS；HTTP 200 |
| title | PASS；含 `艾爾水晶-專案進度` |
| 公告日期排序 | PASS；`entry_date DESC, created_at DESC` 逐列檢查通過 |
| E2E 前後筆數不變 | PASS；631 → 631 |
| 規格指定 628 筆 | **FAIL**；正式基線為 631 |

## 4. E2E cleanup（§5.3）

E2E 主流程輸出 `cleanup: true`。finally 後 remote D1 另行 read-back：

| fixture 資源 | 剩餘 |
|---|---:|
| `users.id='usr_e2e_v10_ra'` | 0 |
| 該 user sessions | 0 |
| 該 user 建立的 reg entries | 0 |
| 該 user 上傳的 files | 0 |

正式 `reg_entries` 最終總數仍為 631。沒有為了符合 628 移除任何非 fixture 資料。

## 5. Help、README、DECISIONS（§5.3）

- `/help`：PASS；中英皆說明公告日期排序、最多 5 檔、單檔／總量限制、施行日條列、90 天警示、前後對照摘要、逐檔下載與掃描 PDF 限制。
- `README.md`：PASS；版本／測試更新為 V10／173，功能總覽與 AI 匯入章節涵蓋公告日期、多檔、junction/R2 清理。
- `DECISIONS.md`：PASS；記錄台北日界、junction＋legacy 相容、對照表不臆造、batch read-back ids／補償清理，以及 631 對 628 的 open decision。
- 本文件如實保留首次 migration CLI 失敗與正式基線 FAIL，沒有把未通過項目寫成通過。
