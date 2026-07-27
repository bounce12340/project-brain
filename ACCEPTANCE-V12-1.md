# V12.1 驗收紀錄

驗收日期：2026-07-27（Asia/Taipei）

本文件逐項對應 `SPEC-V12-1.md` §6。只有實際執行並看到成功輸出的項目標為 PASS；production E2E 全程只使用三個固定 V12.1 demo users 與一個由正式 API 新建、標記 `is_demo=1` 的 private demo project。未登入、修改、重設、停用或刪除 `usr_admin`，未讀取或輸出任何 secret 值，也未修改任何真實 TFDA 草稿、tombstone 或使用者真實專案。

## 1. Typecheck／test／build、remote migration、deploy（§6.1）

### 1.1 品質檢查

依序實際執行：

```text
npm run typecheck
npm test
npm run build
```

結果：

- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，22 test files、248 tests 全部通過；V12.1 專項為 13 tests。
- Vite build：PASS，663 modules transformed，`dist/index.html` 與 23 個 asset files 成功產出。
- 測試 stderr 有一筆 V11 既有的預期錯誤隔離訊息 `TFDA cron pre-step failed / offline`；對應測試仍 PASS，用來證明 TFDA 前置步驟失敗不阻斷 reminders/digest，並非本版失敗。

### 1.2 Migration 0011 remote

實際執行：

```text
npx wrangler d1 migrations apply project-brain-db --remote
```

結果：PASS。

- Wrangler 4.112.0 列出唯一 pending migration：`0011_v12_1.sql`。
- Remote APAC D1 執行 3 commands，migration status `✅`。
- 隨後 remote read-back：
  - `d1_migrations.name = 0011_v12_1.sql`
  - `pragma_table_info('progress_updates')` 含 `edited_at`
  - `pragma_table_info('progress_updates')` 含 `edited_by`

本機 migration 也先行實際套用並 read-back 同兩欄，結果 PASS。

### 1.3 Deploy

實際執行：

```text
npx wrangler deploy
```

結果：PASS。

- 讀取 24 個 assets，20 個新／變更 assets 上傳成功，3 個既有 assets 沿用。
- Worker upload 與三條 cron triggers 部署成功。
- Custom domain：`projects.uic-ai.com`。
- Worker startup time：21 ms。
- Current Version ID：`3ed3133a-cecf-4e2d-aa94-2aad1de8def2`。
- 部署的 implementation source commit：`07dab60`（其後只增補本驗收文件與 README 實測數字）。

## 2. Production E2E：fresh demo project（§6.2）

實際執行：

```text
node scripts/v12-1-acceptance.mjs
```

結果：PASS，exit 0，46 秒。

驗收器先精確清理固定的 V12.1 demo ids，再建立三個 `is_demo=1` demo users（owner／author／same-group other）與短效 session；project 由 owner 透過正式 `POST /api/projects` 新建為 private project，再以該次回傳的 project id＋固定 demo owner 雙條件標記 `is_demo=1`。沒有重用或修改任何既有專案。

### 2.1 作者編輯自己的進度

Author 先透過正式 `POST /api/projects/:id/progress-updates` 建立 snapshot 0 的紀錄，再呼叫：

```text
PATCH /api/progress-updates/:id
{"content":"V12.1 作者修正後進度，snapshot 仍須保留"}
```

Read-back：

| 驗收 | 結果 |
|---|---|
| HTTP | PASS；200 |
| content | PASS；更新為修正後內容 |
| edited_at | PASS；`2026-07-27T09:02:13.754Z`，非空 |
| edited_by | PASS；`usr_e2e_v12_1_author` |
| progress_snapshot | PASS；0 → 0，未變 |
| projects.last_activity_at | PASS；等於本次 `edited_at` |
| audit_log | PASS；唯一一筆 `progress_edited`，entity type `progress_update`、entity id 精確命中該 update |

Audit summary：

```text
編輯進度紀錄：「V12.1 作者修正後進度，snapshot 仍須保留」
```

### 2.2 同組 member 不可修改他人進度

另一個已加入同一 private demo project 的 same-group member 對上述 update 呼叫相同 PATCH。

- 結果：PASS；HTTP 403。
- D1 read-back：content、edited_at、edited_by、progress_snapshot 全部與被拒前相同。
- 沒有新增 audit 或其他副作用。

### 2.3 Owner 刪除他人進度與 audit trail

Owner 呼叫：

```text
DELETE /api/progress-updates/:id
```

結果：

- PASS；HTTP 200。
- `progress_updates` 該 id read-back count = 0。
- `audit_log` 有唯一一筆 `progress_deleted`，entity type／id 正確。
- Delete audit summary 含被刪內文前 40 個 Unicode 字元：

```text
刪除進度紀錄：「V12.1 作者修正後進度，snapshot 仍須保留」
```

### 2.4 Auto 完成紀錄可刪且不回滾

同一 fresh demo project 另建一個 task；author 將其標為 done，使 auto progress 產生 `✔ 完成任務…` update。Owner 刪除該 auto update 後 read-back：

| 項目 | 結果 |
|---|---:|
| auto progress update count | 0 |
| task.done | 1 |
| project.progress | 100 |

結果：PASS；只刪日誌，任務完成狀態與自動進度沒有回滾。

### 2.5 Demo 清理

驗收器在 `finally` 先呼叫正式 project DELETE，再以固定 V12.1 demo user ids 做精確補償清理，最後 read-back：

| Demo 資料 | 最終 count |
|---|---:|
| projects（固定 demo owner） | 0 |
| demo users | 0 |
| demo sessions | 0 |
| demo actor audit rows | 0 |

結果：PASS。Fresh demo project、其 cascade 子資料、三個 demo users/session 與本輪 audit 均已刪除。

## 3. 迴歸與真實資料保護（§6.3）

| 驗收 | 結果 |
|---|---|
| 未登入 `GET /api/projects` | PASS；401 |
| production homepage | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度` |
| production JS | PASS；1 entry script＋20 chunks 可抓取 |
| built timeline controls | PASS；含 edit／delete data attributes 與新版刪除確認文案 |
| published | PASS；前後皆 631 |
| 真實 TFDA drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| 真實 projects | PASS；前後皆 33，完整 fingerprint 相同 |
| 真實 tasks | PASS；前後皆 5，完整 fingerprint 相同 |
| 真實 progress updates | PASS；前後皆 117，完整 fingerprint 相同 |

完整 fingerprints：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`ff9894f1d6499cfa4a2634cfd219d4b47f6387a5ac81561b9ec0e9953d34b0e2`
- real tasks：`53fc99feca837c45c3b17ec0e69ba00f45121d72aa1767816b689ac1a2cea11a`
- real progress：`1f2a57f8926edb2157328a94bf87b12adaa57c7164ab9c1e7be454cb4b7b0380`

`real progress` 的 fingerprint 與 V12 舊文件不同，是因 migration 0011 對每列 schema 增加兩個 NULL 欄位；本輪 E2E 的 migration 後 baseline 與 cleanup 後 fingerprint 完全相同，既有 117 筆內容未被 E2E 修改。

## 4. README／help／DECISIONS（§6.4）

- `README.md`／`README.zh-TW.md`：PASS；補作者／owner／admin 權限、就地編輯、snapshot 不變、不可復原刪除、audit 保留與 auto 紀錄不回滾說明，並增列 v12.1。
- `/help`：PASS；中英新增「編輯與刪除進度紀錄」，production built chunk 已部署。
- i18n：PASS；zh／en keys exact parity。
- `DECISIONS.md`：PASS；增量記錄每筆 `can_edit`、D1 batch audit、Unicode 40 字摘要、nullable TEXT `edited_by`、DELETE 不 touch activity、auto 前綴 UI 解讀與 open decision 狀態。
- Open decisions：無。正式 migration、deploy、E2E 未出現需要資料擁有者裁決的新差異。

## 5. 測試覆蓋與限制揭露

V12.1 專項 13 tests 覆蓋：

- 作者／owner／admin／同組他人／intern 作者／intern 他人的權限矩陣。
- PATCH 保留 snapshot、寫 edited 欄位、touch project、audit。
- 被拒 PATCH 無副作用。
- Owner 刪除 auto update 與 `progress_deleted` summary。
- Unicode 前 40 字截斷。
- 台北 `YYYY/MM/DD HH:mm` 編輯時間。
- auto 前綴辨識、就地 textarea、edit／delete controls 與 i18n parity。

本次 production E2E 以正式 HTTP API、remote D1 read-back 與 production built assets 驗證，不是瀏覽器滑鼠／視覺簽核。SPEC-V12-1 §6 沒有要求逐頁視覺驗收；因此沒有把 source contract 或 built asset 存在冒充為視覺確認。所有 §6 指定的資料、權限、部署、迴歸與清理項目都已實際執行並得到 PASS。

## Commits

1. `70d5772 feat: add audited progress update mutations`
2. `26f7717 feat: edit progress updates in timeline`
3. `07dab60 docs: add v12.1 guidance and acceptance runner`

