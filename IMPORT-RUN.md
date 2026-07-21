# SPEC-IMPORT 執行紀錄

執行日期：2026-07-21（Asia/Taipei）  
正式站：<https://projects.uic-ai.com>  
部署 Version ID：`af789f4b-d444-4ee3-a6ab-962895d16b55`

## 結論

**PARTIAL PASS**。匯入介面、部署、32 個專案、110 筆進度、臨床設定／收案、owner 分布、冪等重送與臨時身分 cleanup 均通過。兩項資料驗證未達規格：正式 `reg_entries` 為 627（要求 630），`QA：GDP/GMP` licenses 為 2（要求 3）。兩項皆源自 `migration/import-payload-final.json` 本身：630 個法規元素只有 627 個 `(entry_date,title)` 唯一鍵，且該 QA 專案只提供 2 筆 license。沒有捏造或覆寫正式業務資料；open decisions 已寫入 `DECISIONS.md`。

全程沒有登入、修改、重設、停用或刪除 `usr_admin`，沒有讀取或變更 secrets。session token 只存在各次 PowerShell 程序記憶體，未輸出、未寫檔。payload 已由 `.gitignore` 的 `migration/*.json` 排除，未加入 Git。

## 1. 匯入介面、測試與部署

實作：

- `src/pages/AdminPage.tsx` 新增 `<input type="file" accept=".json">` 的「選擇檔案」按鈕。
- 使用 `FileReader.readAsText`；成功後將內容填入既有 textarea，並立即觸發同一份 JSON 預覽。
- 讀檔失敗顯示錯誤；選取後清空 input value，允許重選同檔。
- 預覽解析抽到 `src/import-preview.ts`，新增 `tests/import-preview.test.ts`。

實際執行與結果：

```text
npx vitest run tests/import-preview.test.ts
→ 首次 FAIL：Cannot find module '../src/import-preview'（先建立失敗測試）
→ 實作後 PASS：1 file、2 tests

npm run typecheck
→ PASS（exit 0）

npm test
→ PASS：10 files、126 tests

npm run build
→ PASS：653 modules transformed；dist 產生成功

npx wrangler deploy --dry-run
→ PASS：22 assets；Total Upload 266.00 KiB / gzip 56.45 KiB

npx wrangler deploy
→ PASS：19 個新／異動 assets 上傳，2 個沿用
→ Worker Startup Time 5 ms
→ custom domain 與兩個 cron trigger 部署成功
→ Current Version ID af789f4b-d444-4ee3-a6ab-962895d16b55
```

部署後 smoke：

```text
GET https://projects.uic-ai.com/ → 200
GET /assets/AdminPage-mMHCOq3M.js → 200
asset contains FileReader=true、.json=true、選擇檔案=true
```

## 2. API 合約、payload 與正式匯入

已讀 `IMPORT.md`。payload：

```text
path: migration/import-payload-final.json
size: 512,185 bytes（低於 API 5 MB 上限）
SHA-256: 0886A41932ECE491D0E5E41FAFB2536C09EAE3D1185EF065B366007FD3705657
projects array: 32
progress_updates array: 110
reg_entries array: 630
git check-ignore -v → .gitignore:7 migration/*.json
```

### 2.1 建立一次性身分

前置唯讀：

```sql
SELECT
  (SELECT COUNT(*) FROM users WHERE id='usr_import_tmp') AS temp_users,
  (SELECT COUNT(*) FROM sessions WHERE user_id='usr_import_tmp') AS temp_sessions,
  (SELECT COUNT(*) FROM groups WHERE id='grp_qa') AS qa_groups;
```

結果：`temp_users=0`、`temp_sessions=0`、`qa_groups=1`。Michael、Dennis、Allan、Elvis email 與 `usr_admin` 皆為 active approved；Elvis 實際 id 為 `usr_b3386e34a2c945309c`。

token 由 `RandomNumberGenerator.GetBytes(32)` 產生並只保留於 PowerShell 變數；session id 在記憶體計算 `SHA-256(token)`。實際 D1 SQL（動態值以記憶體變數表示）：

```sql
INSERT INTO users
  (id,email,name,password_hash,role,group_id,must_change_password,is_demo,approval_status,onboarding_done)
VALUES
  ('usr_import_tmp','import-tmp@demo.local','一次性匯入','!','admin','grp_qa',0,1,'approved',1);

INSERT INTO sessions (id,user_id,expires_at)
VALUES (<sha256-in-memory>,'usr_import_tmp',<UTC-now-plus-1-hour>);
```

Wrangler 回報兩句各 `changes=1`。未顯示 token；hash 值也未寫入本紀錄。

### 2.2 POST 與首輪逾時

實際請求形態（敏感值只以變數存在）：

```powershell
$payload = Get-Content -Raw migration/import-payload-final.json
Invoke-WebRequest `
  -Uri 'https://projects.uic-ai.com/api/admin/import' `
  -Method Post `
  -Headers @{ Cookie = "sid=$token"; Origin = 'https://projects.uic-ai.com' } `
  -ContentType 'application/json' `
  -Body $payload
```

首輪本地命令在 180 秒逾時，沒有收到 HTTP response。隨後唯讀結果：projects 32、progress 110、reg_entries 573、batch_import audit 0，證明請求只完成部分寫入。首輪被終止的 PowerShell 程序消失後 token 無法復原。

依冪等合約，刪除該 user 唯一的舊 session、以新 memory-only token 建立 1 小時替代 session，再重送完全相同 payload。替代 session SQL 各 `changes=1`。第二次 POST 成功：

```text
HTTP 200
{"projects":{"created":0,"updated":32},"tasks":{"created":0,"skipped":0},"progress_updates":{"created":0,"skipped":110},"reg_entries":{"created":54,"skipped":576},"warnings":[]}
```

首輪部分查詢的 573 與第二次 response 的 skipped 576 相差 3；這表示在兩次觀測間首輪 server-side 工作又完成 3 個 key（此句為依觀測作的推論）。沒有用推論改寫任何 COUNT。

## 3. D1 唯讀驗證

以下均以 `npx wrangler d1 execute project-brain-db --remote --command <SQL>` 實際執行。

| 項目 | SQL 摘要 | 實際結果 | 判定 |
|---|---|---:|---|
| external project | `COUNT(*) FROM projects WHERE external_key IS NOT NULL` | 32 | PASS |
| 法規總數 | `COUNT(*) FROM reg_entries` | 627（要求 630） | **FAIL** |
| 高長 target | exact name join `clinical_settings` | `target_n=205` | PASS |
| 高長收案 | correlated `COUNT(*) clinical_enrollments` | 16（>0） | PASS |
| QA GDP/GMP licenses | exact project join `licenses` | 2（要求 3） | **FAIL** |
| owner allowlist | imported projects group by owner | 5 個允許帳號；disallowed=0 | PASS |
| progress | imported projects progress count | 110；distinct import keys=110 | PASS |

Owner 分布原始統計：

```text
usr_admin / bounceto12340@gmail.com: 11
usr_allan / allan@uicgroup.com.tw: 9
usr_b3386e34a2c945309c / elvis@uicgroup.com.tw: 5
usr_dennis / dennis@uicgroup.com.tw: 5
usr_michael / michael@uicgroup.com.tw: 2
```

QA license read-back：

```text
GDP / 公司 / 2027-10-28
GDP / 公司 / 2029-07-28
```

Payload 深查證實：630 個法規元素只有 627 個 `(entry_date,title)` unique keys。重複組：

1. `2023-02-17`／「藥品查驗登記審查準則」及「藥品生體可用率及生體相等性試驗作業準則」修正(草案)討論會：meeting/其他 與 announcement/藥品。
2. `2020-03-11`／食品及相關產品標示宣傳廣告涉及不實誇張易生誤解或醫療效能認定準則第四條、第六條修正草案：健康食品 與 食品。
3. `2022-12-07`／網際網路購物包裝限制使用對象及實施方式：化粧品 與 包裝容器。

API 合約明定只以 `(entry_date,title)` 判重，因此 3 個後出現元素各計 `skipped`；未自行變更 title。

### 3.1 冪等抽驗

為避免沿用不可復原的 token，再次將臨時 user 的唯一 session 換成新 memory-only token。重送前：

```text
projects=32, reg_entries=627, progress_updates=110, qa_licenses=2
```

再次 POST 同一個、未修改的 payload：

```text
HTTP 200
{"projects":{"created":0,"updated":32},"tasks":{"created":0,"skipped":0},"progress_updates":{"created":0,"skipped":110},"reg_entries":{"created":0,"skipped":630},"warnings":[]}
```

重送後：

```text
projects=32, reg_entries=627, progress_updates=110, qa_licenses=2
```

所有 COUNT 不變；created 全為 0，projects 全為 updated，其餘 payload 元素皆為 skipped。冪等行為 PASS。

## 4. Cleanup

首次直接執行：

```sql
DELETE FROM sessions WHERE user_id='usr_import_tmp';
DELETE FROM users WHERE id='usr_import_tmp';
```

D1 拒絕：`FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY`。後續唯讀依賴盤點：

```text
sessions=1
projects.owner_id=0
project_members=0
tasks.assignee_id=0
progress_updates.author_id=0
clinical_enrollments.created_by=16
licenses.created_by=2
ccr actors/events=0
reg_entries.created_by=627
audit_log.user_id=2
temp_users=1
```

為保留正式匯入資料並清掉臨時 user，實際執行：

```sql
UPDATE clinical_enrollments
SET created_by=(SELECT p.owner_id FROM projects p WHERE p.id=clinical_enrollments.project_id)
WHERE created_by='usr_import_tmp';

UPDATE licenses
SET created_by=(SELECT p.owner_id FROM projects p WHERE p.id=licenses.project_id)
WHERE created_by='usr_import_tmp';

UPDATE reg_entries SET created_by='usr_admin' WHERE created_by='usr_import_tmp';
UPDATE audit_log SET user_id=NULL WHERE user_id='usr_import_tmp';
DELETE FROM sessions WHERE user_id='usr_import_tmp';
DELETE FROM users WHERE id='usr_import_tmp';
```

Wrangler 實際 changes：16、2、627、2、1、1。緊接 read-back：

```text
temp_sessions=0
temp_users=0
enrollment_refs=0
license_refs=0
reg_refs=0
audit_refs=0
usr_admin: role=admin, is_active=1, approval_status=approved
```

Cleanup PASS。`usr_admin` 帳號列沒有被 UPDATE；只讓 627 筆法規的 required foreign key 引用該既有 RA 管理帳號。

## 5. 被拒、失敗與工具錯誤清單

- 首輪 POST：本地 180 秒逾時，HTTP response 未取得；D1 部分寫入已如上記錄並以冪等重送續行。
- 規格驗證：`reg_entries=627`（非 630）、QA licenses=2（非 3）；均標 FAIL，未偽造通過。
- Cleanup 首次直接刪 user：D1 foreign key 拒絕；完成引用歸屬後重試成功。
- 第一次引用盤點使用 13 段 `UNION ALL`：D1 回 `too many terms in compound SELECT`；改為 scalar subqueries 後成功，無寫入。
- 第一次部署後 smoke 變數誤用 `$home`：PowerShell 回 `Cannot overwrite variable HOME because it is read-only or constant.`；改用 `$importHomeResponse` 後成功，無正式資料寫入。
- 搜尋階段曾有 PowerShell/rg quoting 與 Windows glob 錯誤（`unclosed group`、`SPEC*.md`／`migrations/*.sql` 路徑錯誤）；改用 literal search 或目錄搜尋後完成，無檔案或正式資料寫入。

## 6. 安全與 Git 檢查

- token：只在 3 個非互動 PowerShell 程序記憶體內，各程序結束即消失；沒有 stdout、檔案或文件值。
- session id：由 token SHA-256 產生，只有 D1 儲存；cleanup 後相關 session=0。
- password hash：依規格只以字面值 `!` 寫入臨時 user；cleanup 後 user=0。
- secrets：未讀取、輸出或修改 `.dev.vars`／Cloudflare secrets。
- payload：`migration/import-payload-final.json` 保持 Git ignored，未加入 commit。
- `usr_admin`：沒有登入、修改、重設、停用或刪除；cleanup 後仍為 active approved admin。
