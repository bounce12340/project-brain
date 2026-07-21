# SPEC-V2 驗收紀錄

驗收日期：2026-07-21（Asia/Taipei）  
正式網址：`https://projects.uic-ai.com`  
最終部署版本：`88495959-847b-442a-93c2-9bf35017a8d0`

## 結論

SPEC-V2 §8 的 7 個項目均已實際執行並記錄。§8.1、§8.2、§8.3、§8.4、§8.6、§8.7 通過；§8.5 **失敗**。失敗原因是只讀查詢發現 `usr_admin.must_change_password` 在驗收前已為 `0`，不符合規格要求的 `1`。本次工作未登入、重設、更新 admin，也未撤銷其既存 session；依「不得觸碰 admin」限制，未嘗試修正該值。

## 1. TypeScript、測試與建置

狀態：**PASS**

最終於 2026-07-21 執行：

```text
npm run typecheck
→ exit 0；tsc --noEmit 無錯誤

npm test
→ exit 0；6 個 test files、66 個 tests 全數通過

npm run build
→ exit 0；Vite production build 成功，647 modules transformed
→ 最大 JavaScript chunk：LineChart-ClsRgJwb.js 377.20 kB（gzip 前），低於 500 kB 目標
```

V2 新增測試共 24 個，超過要求的 15 個：

- `tests/v2-core.test.ts`：18 個，涵蓋自動進度、提及解析、自動化分派與單層防迴圈、`progress_reached` 向上跨越、依賴循環偵測。
- `tests/dates.test.ts`：6 個，涵蓋甘特／日曆日期工具與台北時區日期行為。

另執行 `git diff --check`，exit 0。

## 2. 正式 D1 migration

狀態：**PASS**

```text
npx wrangler d1 migrations apply project-brain-db --remote
→ exit 0；0003_v2.sql 成功套用，共執行 22 個 commands

npx wrangler d1 migrations list project-brain-db --remote
→ exit 0；No migrations to apply
```

Migration 建立／補齊 V2 schema、索引、QA組與 demo 驗收素材；未修改 admin 帳號。

## 3. 正式部署與檔案儲存 binding

狀態：**PASS**

最終部署：

```text
npx wrangler deploy
→ exit 0
→ custom domain: projects.uic-ai.com
→ env.DB: D1 project-brain-db
→ env.FILES: R2 project-brain-files
→ env.AI 與 env.ASSETS binding 正常
→ Current Version ID: 88495959-847b-442a-93c2-9bf35017a8d0
```

R2 binding 部署成功，因此沒有啟用 `FILES_KV` fallback。檔案儲存仍經 `FileStore` 介面封裝。

## 4. 正式網址 demo 帳號 smoke test

狀態：**PASS**

所有需登入操作只使用 `bd1`、`clinical2`、`intern1` 等 demo 帳號。測試資料以 tag `20260721112431` 區隔；未使用 admin 帳號。最後重新部署後另執行唯讀健康檢查，仍為 HTTP 200。

### 4a. Health 與品牌

```text
GET /api/health
→ HTTP 200；ok=true

GET /
→ HTTP 200；HTML title 含「艾爾水晶」
```

### 4b. QA組

以 demo 帳號登入後執行 `GET /api/groups`：HTTP 200，回傳資料含「QA組」。

### 4c. 自動進度

以 `bd1` 將 `prj_bd` 設為 auto，建立一筆關聯待辦後再標為完成：

```text
建立後 progress=33
完成後 progress=67
→ progress 確實上升
→ GET 專案回傳 progress=67
→ progress_updates 出現「✔ 完成待辦…（進度 67%）」紀錄
```

本機 API smoke 亦曾觀察另一組資料由 55% 上升至 67%。

### 4d. 留言與 @提及

以 `bd1` 在 `prj_bd` 任務留言提及 `@陳收案`：

```text
mentionables 對應到 usr_clinical2
→ 陳收案的 notifications 出現 type=mention
→ notification link 指向對應專案與 task query
```

後端僅在該專案可見的 active 使用者名單中做正規化精確解析；沒有提及或存取 admin。

### 4e. R2 檔案

使用 `tests/fixtures/upload-v2.txt` 執行上傳、下載、刪除：

```text
POST /api/projects/prj_bd/files → 成功
file id: file_a5cf57ca22bb476aaf
storage key: p/prj_bd/file_a5cf57ca22bb476aaf/upload-v2.txt

GET /api/files/{id}/download → HTTP 200
下載 bytes 與原檔逐 byte 相同

DELETE /api/files/{id} → 成功
後續 API 列表已無該檔，下載回 HTTP 404
npx wrangler r2 object get <storage-key> --remote ... → exit 1，R2 物件不存在
```

### 4f. 自動化

以 demo manager 建立「任務完成 → 通知林曉臨」規則並完成一個 demo 任務：

```text
rule id: rule_b83ae05b69634d6ead
task id: task_bc37b931527a4ff9bf
→ 林曉臨 notifications 出現規則通知
→ D1 audit_log 唯讀查詢出現 action=automation_fired，摘要含規則名
```

### 4g. AI 三端點

三個端點均以 demo 可見資料各呼叫一次：

```text
POST /api/ai/task-summary      → HTTP 200；摘要／未決事項 JSON shape 正確；fallback=false
POST /api/ai/project-risk      → HTTP 200；level/summary/suggestions JSON shape 正確；fallback=false
POST /api/ai/schedule-suggest  → HTTP 200；suggestions JSON array shape 正確，共 2 筆；fallback=false
```

### 4h. V1 權限迴歸

```text
未登入 GET /api/projects → HTTP 401
intern1 GET /api/projects → 恰 1 個可見專案
bd1 GET /api/projects/prj_private → HTTP 403
```

## 5. Admin 不變條件

狀態：**FAIL**

只讀執行：

```sql
SELECT must_change_password
FROM users
WHERE id='usr_admin';
```

實際結果為 `0`，不是規格要求的 `1`。補充只讀證據：`failed_count=0`、`locked_until=NULL`、`updated_at='2026-07-21 02:42:40' UTC`，且查得一筆既存 active admin session。

本輪 V2 smoke test 未登入 admin、未呼叫 admin 密碼重設或帳號更新 API、未執行針對 admin 的寫入 SQL，也未碰 secrets。由於使用者明令「不得觸碰 admin」，因此沒有把值改回 `1`，也沒有撤銷該 session。此項只能如實記為失敗；既存狀態的來源不在本次驗收中推定。

## 6. README、Help 與 Decisions

狀態：**PASS**

- `README.md` 已更新為「艾爾水晶-專案進度」，並列出 V2 任務多視圖、留言提及、R2 檔案、自動化、AI、時間軸與首次導覽等功能。
- `/help` 已提供與目前 UI 名稱一致的繁中功能說明及「重新播放導覽」。
- `DECISIONS.md` 已增量記錄 migration 相容策略、R2 abstraction、AI fallback、排程後端驗證、導覽行為、demo mention 素材與 admin 唯讀驗收異常。

## 7. 驗收記錄完整性

狀態：**PASS**

本文件逐項記錄 SPEC-V2 §8.1～§8.7 的實際命令或操作摘要、結果、部署版本、fallback 狀態，以及 §8.5 未達成事項，未將失敗包裝成通過。

## 額外限制與觀察

- 本機 Worker API、正式 curl/API、D1、R2、typecheck、Vitest、production build 與部署皆已實測。
- in-app Browser 執行環境沒有可用 browser instance（browser list 為空），因此未能補做瀏覽器視覺回歸；這不是 §8 指定項目，仍在此如實揭露。前端以 production build 與正式 HTML smoke 驗證。
