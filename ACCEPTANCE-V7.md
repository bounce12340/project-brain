# SPEC-V7 驗收紀錄

執行日期：2026-07-21（Asia/Taipei）
正式站：<https://projects.uic-ai.com>
最終部署 Version ID：`b2888b49-746e-40ea-a75a-274f2e2b5a76`

## 結論

**PASS**。SPEC-V7 §4.1～§4.5 已逐項實際執行；正式站文字、PDF、權限、判重、下載 bytes 與清理驗收全部通過。E2E 全程只使用隨機密碼、`is_demo=1` 的暫時 RA/PV member 與 intern，沒有登入、修改、重設、停用或刪除 `usr_admin`，也沒有讀取、修改或輸出任何 secret。

## 1. Typecheck、測試、build 與 bundle

最終部署前實際執行：

| 指令 | 結果 |
|---|---|
| `npm run typecheck` | PASS（`tsc --noEmit`，exit 0） |
| `npm test` | PASS（11 files、138 tests） |
| `npm run build` | PASS（Vite 653 modules、22 個 dist 檔案） |
| `npx wrangler deploy --dry-run` | PASS；Worker 可成功 bundle |

V7 新增 `tests/v7-core.test.ts` 共 12 tests，涵蓋民國年換算與無效日期、product line fallback、JSON 陣列寬鬆解析、24,000 字元切塊、跨塊 title 去重、欄位正規化、撞鍵標示、無文字 PDF 與超長輸入的 422 對應、batch 判重統計、`files.project_id IS NULL` 登入下載路徑。

Bundle 差異以乾淨的 V6 commit `6246005` 暫存副本與相同 Wrangler 4.112.0 重測：

| 項目 | V6 基線 | V7 | 差異 |
|---|---:|---:|---:|
| Worker upload | 266.00 KiB | 2,538.79 KiB | +2,272.79 KiB |
| Worker gzip | 56.45 KiB | 611.72 KiB | +555.27 KiB |
| `RegwatchPage` chunk | 6,529 bytes | 12,310 bytes | +5,781 bytes |
| 最大前端 JS chunk | 377,202 bytes | 377,202 bytes | 0 bytes |

Worker 增量主要來自規格唯一允許的新依賴 `unpdf` 內含的 serverless PDF.js；依賴安裝後 `npm audit` 為 0 vulnerabilities。測試 PDF `tests/fixtures/v7-text-layer.pdf` 為 1,758 bytes，已用 `pdftotext` 確認文字層，另以 PyMuPDF 渲染 PNG 並目視確認無裁切、重疊或缺字。

## 2. Migration 0006 與部署

- `npx wrangler d1 migrations apply project-brain-db --local`：PASS，9 commands。
- `npx wrangler d1 migrations apply project-brain-db --remote`：PASS，9 commands；`0006_v7.sql` 狀態成功。
- remote schema read-back：`files.project_id` 已為 nullable 且保留 `projects(id) ON DELETE CASCADE`；`reg_entries.file_id` 已存在並為 `files(id) ON DELETE SET NULL`。
- remote `PRAGMA foreign_key_check`：0 rows。
- `npx wrangler deploy`：PASS；custom domain 與兩個既有 cron triggers 均部署成功，Worker startup 17 ms。

首次 deploy 嘗試曾因基線量測命令漏切到暫存目錄，使主工作樹 `node_modules` 被不完整的 `npm ci` 移除部分套件，Wrangler 回報 15 個 module resolve errors；migration 當時已成功。之後以現有 lockfile 執行 `npm install` 還原依賴，重新跑 typecheck／138 tests／build／dry-run 全綠後 deploy 成功；沒有修改 schema 或規避檢查。

## 3. 正式站 E2E

可重跑腳本：`scripts/v7-e2e.mjs`。測試身分為 `usr_e2e_v7_ra` 與 `usr_e2e_v7_intern`；密碼與 PBKDF2 salt 僅存在程序記憶體，沒有輸出或落檔。

### 3a. 貼上文字、多筆拆解與判重

- 輸入一段自擬中文文字，內含民國 115 年 7 月 21、22 日兩則公告。
- `POST /api/regwatch/ai-extract`：200，回 2 筆；日期正規化為 `2026-07-21`／`2026-07-22`，類型、九選一產品線、≤10 字 category、≤100 字 title 與「•」條列重點均合規。
- 產品線 fallback：**否**；兩筆皆由明確的「藥品／醫療器材」解析，沒有落到「其他」。
- 首次 `POST /api/regwatch/batch`：`created=2, skipped=0`；列表 keyword read-back 為 2 筆。
- 相同 payload 再匯：`created=0, skipped=2`。

### 3b. 文字層 PDF、R2 與下載

- 上傳 `tests/fixtures/v7-text-layer.pdf`：`ai-extract` 200，抽取為 1 筆。
- multipart `POST /api/regwatch/batch`：`created=1`、回傳非空 `file_id`；列表依該 `file_id` read-back 成功。
- 以 intern 登入下載 `/api/files/:id/download`：200；下載 1,758 bytes，與原始 fixture 逐 byte 相同。
- 這同時驗證 `files.project_id IS NULL` 走 regwatch 全員登入可讀路徑，既有 project file 仍走專案可見性檢查。

### 3c. 權限

- intern `POST /api/regwatch/ai-extract`：403。
- 未登入 `GET /api/projects`：401（迴歸）。

### 3d. 清理

- 最終 E2E `finally`：以 API 刪除三筆條目；PDF 條目為最後引用時同步刪除 R2 object 與 `files` row。
- remote D1 read-back：V7 E2E `reg_entries=0`、`files=0`、`users=0`。
- remote `PRAGMA foreign_key_check`：0 rows。

E2E 過程的失敗亦保留如下：首次執行在 deploy 後立即呼叫新路由曾暫時得到 404，未改程式後重跑即為 403/200 正常；第二次執行的產品行為已完成，但驗收腳本錯誤假設 AI 會保留 PDF title marker，導致 read-back 與自動清理失敗。當次資料已先以 `created_by`／`uploaded_by` 精確唯讀定位，再刪除唯一 R2 key 與對應 demo rows，read-back 為 0；腳本改為依 `file_id` 回查且依 demo 建立者掃頁清理。第三次從頭執行全綠。

## 4. 迴歸

- `GET /`：200，HTML title 含 `艾爾水晶-專案進度`。
- 未登入 API：401。
- `/regwatch` 正式資料：E2E 前 627 筆；清理後 627 筆，既有資料數不變。
- 最終 E2E demo rows：0；foreign key violations：0。

## 5. 文件與決策

- `/help` 已新增「法規 AI 匯入」操作、支援格式、預覽、判重、下載與掃描 PDF 限制。
- `README.md` 已新增 AI 匯入流程、10 MB 限制、R2 原始檔與不做 OCR 的說明。
- `DECISIONS.md` 已記錄確認匯入才落 R2、共用 `file_id`／最後引用清理、以及 JSON array 解析策略。
- `unpdf` 是唯一新增 dependency；未新增 OCR、UI library 或其他規格外依賴。
