# 執行資料搬遷（已獲使用者核准的一次性任務）＋匯入介面補檔案上傳

> 使用者已在對話中核准：以一次性臨時管理身分執行 migration/import-payload-final.json 的正式匯入（32 專案＋約 110 筆進度＋630 筆法規），並清理臨時身分。與 SPEC-V3/V4/V6 驗收使用臨時帳號的紀律完全相同。

## 1. 匯入介面補強（先做，避免未來貼上限制）

- `/admin` 批次匯入卡加「選擇檔案」按鈕（`<input type="file" accept=".json">`，FileReader 讀入後填進既有 textarea 並觸發預覽），其餘流程不變。
- typecheck／test／build 通過後部署。

## 2. 執行匯入

1. 讀 `IMPORT.md` 確認 API 合約。payload 位於 `migration/import-payload-final.json`（已在 .gitignore，**不得 commit**）。
2. 建立一次性匯入身分（同 V3/V4/V6 驗收模式）：
   - users 插入 `usr_import_tmp`（is_demo=1、role admin、group grp_qa、approval approved、`password_hash` 設為字面值 `'!'`——非法格式，永遠無法登入）。
   - sessions 插入一筆：id ＝ 自產隨機 token 的 sha256、user_id=usr_import_tmp、expires_at ＝ 1 小時後。token 僅存於程序記憶體，**不得輸出或落檔**。
3. `POST https://projects.uic-ai.com/api/admin/import`，帶 `Cookie: sid=<token>` 與同源 `Origin`，body 為 payload 檔內容。
4. 回應統計原文記錄。

## 3. 驗證（D1 唯讀）

- `SELECT COUNT(*) FROM projects WHERE external_key IS NOT NULL` ＝ 32。
- `SELECT COUNT(*) FROM reg_entries` ＝ 630。
- `[DST]高長Prolia+ACC trial`：clinical_settings.target_n=205、clinical_enrollments 筆數 >0。
- QA GDP/GMP 專案 licenses ＝ 3 筆。
- owner 分布查詢：專案 owner 應只落在 michael／dennis／allan／elvis 的帳號與 usr_admin（Josh 的 RA 案）。
- progress_updates 匯入筆數與回應統計一致。
- 冪等抽驗：重送同 payload 一次 → 回應應為 updated/skipped，各 COUNT 不變。

## 4. 清理與紀錄

- 刪除 usr_import_tmp 的 session 與 user，read-back 0。
- 全程指令、統計、驗證結果、任何被拒項目如實寫入 `IMPORT-RUN.md`；決策記 DECISIONS.md。
- 不碰 `usr_admin` 與 secrets；不 commit payload；token 不落檔不輸出。
