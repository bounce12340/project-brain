# V13.2 驗收紀錄

驗收日期：2026-07-29（Asia/Taipei）

本文件逐項對應 `SPEC-V13-2.md` §6。只有實際執行並看到成功輸出的項目標為 PASS；兩次 E2E harness 失敗嘗試也如實記錄。Production 寫入範圍只包含隨機 id、`is_demo=1` 的隔離 fixture，清理後相關 users、sessions、projects、audit log 均回讀為 0。未修改、核准或刪除任何真實 TFDA draft／published／tombstone、使用者真實專案或 `usr_admin` 資料列，也未讀取或輸出任何 secret 值。

## 1. Typecheck／test／build／migration／deploy（§6.1）

實際執行：

```text
npm run typecheck
npm test -- --run
npm run build
node --check scripts/v13-2-acceptance.mjs
node scripts/v13-2-acceptance.mjs --verify-built
node scripts/v13-2-acceptance.mjs --verify-migration
npx wrangler d1 migrations list project-brain-db --remote
npx wrangler deploy
```

結果：

- TypeScript：PASS；`tsc --noEmit` exit 0。
- Vitest：PASS；31 test files、336 tests 全部通過。
- V13.2 新增 `tests/v13-2-milestone-periods.test.ts`：PASS；16 tests，超過規格要求的 6 tests，涵蓋日期驗證／清空、bar／diamond 資料分支、台北日界逾期、完成紋理、依內容產生圖例、AI `end_date` 清洗及日曆期間展開。
- Vite：PASS；669 modules transformed，production assets 成功產出。
- Acceptance script syntax：PASS。
- Deploy：PASS；25 個 assets 上傳，Worker startup 16 ms，custom domain `projects.uic-ai.com`，Version ID `0fb9fcd4-6323-4dcd-8f7d-223e0ddac40e`。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

### 1.1 Migration 0013

- PASS；`migrations/0013_v13_2.sql` 是新檔，內容只有 `ALTER TABLE milestones ADD COLUMN end_date TEXT;`。
- PASS；獨立 commit `50ac475` 只顯示 `A migrations/0013_v13_2.sql`，沒有修改 0001–0012。檔案 SHA-256：`33ECD8B1FC06C0D31F09F6C8278B9E4C754AA5FB7AC5BEA080A2F66051337C22`。
- PASS；實際執行 remote apply，Wrangler 顯示 `0013_v13_2.sql ✅`；再次 list 顯示 `No migrations to apply!`。
- PASS；不是只依賴 Vitest。`--verify-migration` 直接查 remote D1：
  - `sqlite_master.sql` 實際包含 `..., kind TEXT ... , end_date TEXT)`。
  - `PRAGMA table_info(milestones)` 回傳 `cid=8, name=end_date, type=TEXT, notnull=0, dflt_value=null, pk=0`。

本節結果：PASS。

## 2. Production E2E 與 cleanup（§6.2）

E2E 建立一個隨機 id 的 `is_demo=1` 專案、專用 demo user/session、stage、2 tasks、4 milestones/events；沒有把 fixture 寫入真實專案。

| 驗收 | 實際結果 |
|---|---|
| 里程碑期間 | PASS；建立 `due_date=2026-09-01`、`end_date=2026-09-30`，API read-back 的 `end_date` 相同，資料集判定 `bar` |
| 歷程事件期間 | PASS；建立 `2026-02-06 ~ 2026-03-23`，API read-back 的 `end_date` 相同，資料集判定 `bar` |
| 單點里程碑 | PASS；`end_date=null`，資料集判定 `diamond` |
| 不合法期間 | PASS；`end_date < due_date` 回 422 |
| 清空期間 | PASS；PATCH 清空後 read-back `end_date=null` |

Harness 的失敗嘗試沒有冒充 PASS：

1. 第一次 prepare 請求得到 403 且沒有回應 body。
2. 第二次加入錯誤 body 顯示後確認是 `Origin 驗證失敗`。
3. 驗收腳本為 demo login 與 mutation request 加上正式站同源 `Origin` 後，第三次完整 E2E 通過。這是驗收 harness 缺少既有 CSRF header，不是放寬 production Origin 驗證。

視覺驗收完成後執行 `node scripts/v13-2-acceptance.mjs --cleanup`：

| Demo scope | cleanup 後 count |
|---|---:|
| users | 0 |
| sessions | 0 |
| projects | 0 |
| audit_log | 0 |

本節結果：PASS。

## 3. Built asset 驗證（§6.3）

最終 build 後執行 `node scripts/v13-2-acceptance.mjs --verify-built`，掃描 25 個 `dist` files：

| 項目 | 實際結果 |
|---|---|
| 時間刻度 | PASS；`data-gantt-time-font-size=14`、`data-gantt-time-font-weight=600` |
| 左側標籤 | PASS；`data-gantt-label-font-size=14` |
| 專案標籤欄 | PASS；`data-gantt-label-width=210` |
| 期間分支 | PASS；milestone／event period marker 與雙端點邏輯存在 |
| 完成狀態 | PASS；SVG 45° pattern marker、30% base opacity 與 ✓ overlay 存在 |
| 逾期狀態 | PASS；danger 色、3px 右端標 marker 與逾期判定存在 |
| Marker 總數 | PASS；驗收腳本的 10 個必要 marker 全部找到 |

本節結果：PASS。

## 4. Browser 視覺確認（§6.4）

執行者以 Chrome 操作已部署的 `https://projects.uic-ai.com`，只查看上述隔離 demo。視覺檢查後把原本的亮色主題與 browser viewport 還原。

### 4.1 專案甘特

| 項目 | 實際結果 |
|---|---|
| 亮色桌面 1440×900 | PASS；期間、點、圖例與標籤可讀 |
| 暗色桌面 1440×900 | PASS；事件淡金虛線期間、金色里程碑期間、斜紋與紅端標均有足夠對比 |
| 窄螢幕 390×844 | PASS；document width 375，沒有頁面級水平溢出；甘特容器 client width 339、scroll width 6085，保留獨立水平捲動 |
| 里程碑期間 | PASS；1 個金色橫條，起訖各有小菱形；水平捲到 9 月後實際看見 `09-01 ~ 09-30` |
| 歷程期間 | PASS；1 個半透明淡金橫條、虛線描邊與雙端點；桌面首屏實際看見 `02-06 ~ 03-23` |
| 單點 | PASS；無 `end_date` 的里程碑維持菱形 |
| 完成任務 | PASS；1 個斜線 pattern，條左端保留 ✓；水平捲到 6 月後實際看見 |
| 逾期 | PASS；DOM 2 個 red end markers，畫面實際看見 task 右端紅線與逾期 milestone 菱形紅線 |
| 時間刻度 | PASS；computed `14px / 600` |
| 列標籤 | PASS；三個抽查列 computed `14px / 500` |
| 圖例 | PASS；實際內容為階段、里程碑、里程碑期間、歷程期間、完成（斜紋）、逾期（紅端標） |

### 4.2 全域 `/timeline`

桌面暗色實際畫面與展開 demo 後的 DOM：

- 時間刻度 contract 與 computed style 均為 `14px / 600`。
- label contract 為 14；展開後兩個 demo task labels 均為 `14px / 500`。
- demo 歷程期間 marker 1、完成 pattern 1、逾期端標 1。
- 圖例依實際資料顯示歷程期間、完成（斜紋）與逾期（紅端標）。

本節結果：PASS。

## 5. 迴歸與資料保護（§6.5）

在建立任何 demo 前先保存 remote fingerprints，cleanup 後重新查詢並逐項比對：

| 驗收 | Before | After | 結果 |
|---|---:|---:|---|
| 未登入 API | — | 401 | PASS |
| homepage／title | — | 200／`艾爾水晶-專案進度` | PASS |
| published | 631 | 631 | PASS |
| 真實 TFDA drafts | 16 | 16 | PASS |
| TFDA tombstones | 4 | 4 | PASS |
| 使用者真實 projects | 32 | 32 | PASS |
| 使用者真實 tasks | 16 | 16 | PASS |
| 使用者真實 milestones/events | 30 | 30 | PASS |
| 使用者真實 progress updates | 137 | 137 | PASS |

Fingerprints（before = after）：

- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`98059ba18a61b9cb979931d4cd9c45ed5b738d0d7f982f8d516bde86cf0e44d0`
- real tasks：`831514f27395253fcd21220c60101c67af00c7272e99729689f2d038f6cda9c2`
- real milestones/events：`91ed13a1de52c94faf2433f07c6d82f3d333b3c5678ac3b8b95029d427580de4`
- real progress：`3d16b02862e823cca29c22650eaad4924fbe419ea1ccdd3cf67820f1b925bd31`

驗收腳本沒有查詢或修改 `usr_admin`；E2E mutation 全部使用專用 demo identity。Chrome 視覺驗收開始時瀏覽器已有既存登入狀態，畫面操作只切換 view/theme、水平捲動並讀取隔離 demo；沒有送出專案、帳號或正式資料 mutation。

本節結果：PASS。

## 6. README／help／DECISIONS（§6.6）

- README：PASS；`README.md` 與 `README.zh-TW.md` 已說明單點與期間的填法。
- Import 文件：PASS；`IMPORT.md` 已說明 `milestones[]`／`events[]` 的選填 `end_date`、日期順序及範例。
- Help：PASS；新增「里程碑／歷程期間」共用 HelpTip 與 `/help` 內容，明示「填了畫橫條、不填是單點」。
- DECISIONS：PASS；增量記錄日期驗證／清空語意、import 與 progress-links 欄位映射、期間視覺與內容驅動圖例、隔離 E2E 範圍。
- Open decisions：無；production fingerprints 沒有差異，也沒有規格外的真實資料需要裁決。
- 本文件：PASS；§6.1–§6.6 的實際指令、失敗嘗試、結果、browser 操作、cleanup 與 fingerprints 均已如實記錄。

本節結果：PASS。

## Commits

1. `50ac475` — `feat: add milestone end date migration`
2. `f1d1b26` — `feat: support milestone period data flows`
3. `0a94442` — `feat: render gantt periods and task states`
4. `c0b0f2d` — `docs: explain milestone period entry`
5. `8bec83a` — `feat: expose gantt readability contracts`

## 最終結論

`SPEC-V13-2.md` §6.1–§6.6：全部 PASS。Migration 0013 是新檔且 remote `sqlite_master`／`PRAGMA table_info` 已直接證明 `end_date TEXT NULL` 存在；隔離 demo 已清除；保護範圍的正式資料 before／after 完全一致。
