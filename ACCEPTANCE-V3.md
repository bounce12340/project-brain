# SPEC-V3 驗收紀錄

驗收日期：2026-07-21（Asia/Taipei）  
正式網址：`https://projects.uic-ai.com`

## 結論

SPEC-V3 §7.1～§7.6 已全部實際執行並看到輸出；最終均通過。一次 inbox parser 的驗收工具錯誤與修正過程亦於 §4a 如實保留。

## 1. TypeScript、測試與建置

狀態：**PASS**

```text
npm run typecheck
→ exit 0；tsc --noEmit 無錯誤

npm test
→ exit 0；7 個 test files、80 個 tests 全數通過
→ V3 新增 tests/registration.test.ts：14 個 tests（要求至少 10 個）

npm run build
→ exit 0；Vite production build 成功，648 modules transformed
→ 最大 JavaScript chunk：LineChart-DW5yMJmo.js 377.20 kB（gzip 前）
```

V3 測試涵蓋 6 位 OTP、SHA-256 雜湊、正確碼、錯碼、過期、5 次上限、Email 正規化、註冊關閉、重複 Email 409、弱密碼、不存在組別、pending/rejected/approved 登入判定、admin-only 權限判定與 IP 次數上限。

## 2. 正式 D1 migration

狀態：**PASS**

```text
npx wrangler d1 migrations apply project-brain-db --remote
→ exit 0；0004_register.sql 成功套用，7 個 commands

npx wrangler d1 migrations list project-brain-db --remote
→ exit 0；No migrations to apply
```

## 3. 正式部署

狀態：**PASS**

```text
npx wrangler deploy
→ exit 0；custom domain projects.uic-ai.com
→ D1、R2、Workers AI、Static Assets bindings 均載入
→ Worker Startup Time 5 ms
→ Current Version ID: b35f6092-1c64-4ca4-89d8-f1c464299b78
```

## 4. 正式網址真實 E2E

狀態：**PASS**

所有 HTTP 操作均對 `https://projects.uic-ai.com` 執行。需要 session 的角色各自使用獨立 PowerShell `WebRequestSession`；未登入或操作既有 `usr_admin`。`AGENTMAIL_API_KEY` 只從被 Git 忽略的 `.dev.vars` 讀入 PowerShell 記憶體並放入 Bearer header，未輸出、未寫檔、未提交。

### 4a. Email 驗證、送出申請與 pending 登入封鎖

正式操作 `uic_ai@agentmail.to`：

```text
POST /api/register/send-code
→ HTTP 200

GET https://api.agentmail.to/v0/inboxes/uic_ai@agentmail.to/messages
→ 找到主旨「[艾爾水晶] 註冊驗證碼」的新信
→ 從 preview 文案取得 6 位數 OTP（實際數值未輸出）

POST /api/register/submit（真實 OTP）
→ HTTP 201；status=pending
→ 訊息為「申請已送出，管理員核准後會寄信通知你」

POST /api/auth/login（正確密碼、核准前）
→ HTTP 403；「帳號尚未核准」
```

如實記錄一次驗收工具錯誤：第一版 inbox parser 對整個 message JSON 取第一組六位數，誤取到 `message_id` 內的數字，導致一次額外 submit 回 HTTP 422、後續登入因帳號尚未建立而回 401。檢視僅含遮罩值的欄位後，parser 改為限定 `preview` 中「驗證碼是：」後的六位數；沒有修改產品端驗證邏輯，之後以上完整流程通過。

### 4b. 臨時 demo admin、核准信與 intern 受限視野

以 Node WebCrypto 產生與產品相同格式的 PBKDF2-SHA256 hash，僅放在 PowerShell 變數，再由 D1 建立：

```text
qaadmin@demo.local
→ id=usr_qaadmin_v3、role=admin、group_id=grp_qa、is_demo=1
→ must_change_password=0、approval_status=approved
```

正式 E2E 結果：

```text
qaadmin POST /api/auth/login → HTTP 200
GET /api/admin/registrations → HTTP 200；看見 uic_ai@agentmail.to 申請
POST /api/admin/registrations/{id}/approve（role=intern, group_id=grp_clinical）
→ HTTP 200；email_sent=true

AgentMail inbox
→ 收到新主旨「[艾爾水晶] 帳號已核准」的信

申請人 POST /api/auth/login → HTTP 200
→ user.role=intern、group_id=grp_clinical
申請人 GET /api/projects → HTTP 200；0 個專案
→ 該 intern 未被加入任何 project_members，因此受限視野沒有洩漏其他專案
```

D1 唯讀確認 audit log 有 `registration_approved`，摘要為核准該 Email 且角色為 intern。

### 4c. 負向案例與註冊開關還原

```text
錯誤驗證碼 submit → HTTP 422
已註冊 Email 再 submit → HTTP 409；「此 Email 已註冊」

qaadmin POST /api/admin/registration-toggle {enabled:false} → HTTP 200
GET /api/register/meta → enabled=false
關閉時 POST /api/register/submit → HTTP 422；「目前未開放自助註冊」

finally 中 POST /api/admin/registration-toggle {enabled:true} → HTTP 200
再次 GET /api/register/meta → enabled=true
```

D1 唯讀確認 audit log 同時保留關閉與重新開放兩筆 `registration_toggle`。

### 4d. Cleanup

實際執行：

```sql
DELETE FROM sessions
WHERE user_id IN (
  SELECT id FROM users
  WHERE email IN ('uic_ai@agentmail.to','qaadmin@demo.local')
);

DELETE FROM users
WHERE email IN ('uic_ai@agentmail.to','qaadmin@demo.local');

DELETE FROM email_verifications
WHERE email='uic_ai@agentmail.to';
```

上述 SQL 以以下命令對正式 D1 執行：

```text
npx wrangler d1 execute project-brain-db --remote --command "<上述三句 SQL>"
→ exit 0；3 commands 成功
```

cleanup 後唯讀確認：

```text
SELECT COUNT(*) FROM users WHERE email IN (...) → 0
相關 sessions → 0
uic_ai@agentmail.to 的 email_verifications → 0
```

### 4e. V1 迴歸

```text
未登入 GET /api/projects → HTTP 401
intern1 登入 → HTTP 200
intern1 GET /api/projects → HTTP 200；恰 1 個可見專案
GET / → HTTP 200；HTML title 含「艾爾水晶」
```

### 4f. usr_admin 唯讀不變確認

開工 migration 前先唯讀取得基線：

```text
usr_admin.updated_at = 2026-07-21 02:42:40 UTC
```

cleanup 與迴歸後再唯讀執行：

```sql
SELECT id,approval_status,updated_at FROM users WHERE id='usr_admin';
```

結果：`approval_status='approved'`，`updated_at='2026-07-21 02:42:40'`，與開工基線相同。本輪未登入、修改、重設、停用、刪除或撤銷 `usr_admin` session。

## 5. Help、首次導覽與 README

狀態：**PASS**

- 登入頁已新增「申請帳號」連結，公開 `/register` 包含姓名、Email、密碼兩次、組別、OTP 與註冊關閉畫面。
- `/help` 新增「帳號申請與核准」段落，說明申請、管理員核准／拒絕與註冊開關。
- 首次導覽新增「新同仁先申請帳號，管理員核准後登入」步驟；總步數 11，仍符合 8～12 步限制。
- README 已改為自助註冊流程、pending/rejected 管理、核准結果與寄碼／OTP／IP 防濫用說明。
- production build 與正式部署均已包含上述前端 assets；正式 `/` title smoke 通過。

## 6. ACCEPTANCE 與 DECISIONS 完整性

狀態：**PASS**

- `DECISIONS.md` 已增量記錄公司 Email 網域未臆測、IP 上限與雜湊策略、OTP 寄信失敗處理、核准信失敗語意，以及 `usr_admin.updated_at` 基線。
- 本文件逐項記錄 SPEC-V3 §7.1～§7.6 的實際命令／操作摘要、HTTP 狀態、migration、部署版本、AgentMail 實測、負向案例、cleanup、迴歸及一次驗收 parser 失敗；沒有把未執行項目寫成通過。

## 最終結論

SPEC-V3 §7 的所有指定項目均已實際執行；最終結果全部通過。測試用帳號、sessions 與 OTP 資料已清除，註冊開關已恢復開啟，`usr_admin` 帳號列的 `updated_at` 保持開工基線不變。
