# 艾爾水晶-專案進度 v3：員工自助註冊＋管理員核准

> 增量規格，疊在 SPEC.md（v1）與 SPEC-V2.md（v2，均已上線）之上；未提及的行為一律不變。

## 0. 目標

公開的 `/register` 頁：員工填姓名、公司 Email、自訂密碼、選組別，通過 **Email 驗證碼**確認信箱後送出申請；帳號進入「待核准」狀態，**管理員核准後才能登入**。核准／拒絕都寄信通知申請人。

## 1. 環境事實

- wrangler OAuth 已重新登入、可部署（credentials 在 `C:\Users\BDAIPC\.wrangler\config\default.toml`）。
- AgentMail 寄信管線既有可用（`worker/services/mailer.ts`）。
- **驗收全程不得登入、修改、重設既有 admin（usr_admin）**；核准流程的驗收用臨時建立的 demo admin（見 §7）。

## 2. Schema（migrations/0004_register.sql）

- users 加欄：`approval_status` TEXT CHECK IN ('pending','approved','rejected') DEFAULT 'approved'（既有帳號全為 approved）。
- 新表 `email_verifications`(id pk, email, code_hash, purpose DEFAULT 'register', expires_at, attempts INTEGER DEFAULT 0, verified INTEGER DEFAULT 0, created_at)。
- 新表 `app_settings`(key pk, value)；種子 `('registration_enabled','1')`。

## 3. 註冊流程

1. `/register`（公開路由；登入頁加「申請帳號」連結）：姓名、Email、密碼×2（沿用 ≥8 碼規則）、組別下拉（公開 meta API 提供）、驗證碼欄＋「取得驗證碼」鈕。
2. 取得驗證碼 → 寄 6 位數字碼（15 分鐘有效、同一 email 60 秒冷卻、最多驗 5 次；DB 存 SHA-256(code)）。信件主旨 `[艾爾水晶] 註冊驗證碼`。
3. 送出 → 驗證碼正確 → 建立使用者：role `member`、選定組別、`approval_status='pending'`、`must_change_password=0`、`onboarding_done=0`、Email 正規化小寫。畫面顯示「申請已送出，管理員核准後會寄信通知你」。
4. 同時通知所有 active admin（站內＋Email）：「新註冊申請：姓名（email）／組別」，連到 /admin。
5. `pending` 或 `rejected` 帳號登入 → 403「帳號尚未核准」／「申請未通過」。核准前看不到任何資料。

防濫用：send-code 與 submit 各加同 IP 每日上限（D1 計數即可）；Email 已註冊 → 409「此 Email 已註冊」。AgentMail 未設或寄送失敗 → send-code 回明確錯誤，**不得跳過驗證直接建帳號**。

## 4. 管理員核准介面

/admin 新增「註冊申請」卡：
- 待核清單：姓名／Email／申請組別／申請時間；每列可於核准前調整**角色（member/intern）與組別**，按「核准」或「拒絕」。
- 核准 → `approval_status='approved'`＋寄信「帳號已核准，立即登入」（含網址）；拒絕 → `approval_status='rejected'`＋寄信婉拒。兩者皆記 audit_log。
- 卡片頂部「開放自助註冊」開關（寫 app_settings；關閉時 /register 顯示「目前未開放自助註冊」且 API 拒收）。
- 既有使用者管理頁要能看到／刪除 pending 與 rejected 帳號。

## 5. API 增補

- GET `/api/register/meta`（公開）：`{enabled, groups:[{id,name}]}`。
- POST `/api/register/send-code` {email}（公開；429 冷卻、409 已註冊）。
- POST `/api/register/submit` {name,email,password,group_id,code}（公開）。
- GET `/api/admin/registrations`；POST `/api/admin/registrations/:userId/approve` {role?,group_id?}；POST `/api/admin/registrations/:userId/reject`；POST `/api/admin/registration-toggle` {enabled}（皆 admin only）。
- 登入端點對 pending/rejected 回 403 與對應繁中訊息。

## 6. 測試（vitest 新增 ≥10）

OTP 產生／雜湊／過期／次數上限；submit 各種擋法（錯碼、過期、重複 Email、弱密碼、註冊關閉）；pending 登入被擋；核准後可登入；admin-only 端點權限；IP 上限計數。

## 7. 驗收（全部執行並寫入 ACCEPTANCE-V3.md）

1. `npm run typecheck`、`npm test`、`npm run build` 全綠。
2. `npx wrangler d1 migrations apply project-brain-db --remote` 成功。
3. `npx wrangler deploy` 成功。
4. **真實 E2E**（對正式網址）：
   a. 以 email `uic_ai@agentmail.to` 走完整註冊：send-code → 用 AgentMail API（Bearer `AGENTMAIL_API_KEY`，讀 `.dev.vars`）到 `GET https://api.agentmail.to/v0/inboxes/uic_ai@agentmail.to/messages` 取回驗證碼 → submit 成功 → 該帳號登入被擋 403（pending）。
   b. 用 D1 建一個臨時 demo admin（`qaadmin@demo.local`，is_demo=1，密碼雜湊自行以 node script 產生）→ 以其登入 → GET /api/admin/registrations 看到申請 → approve（指定 intern 角色驗證角色調整）→ 申請人信箱（AgentMail inbox）收到核准信 → 該帳號登入成功 200 → 以 intern 身分 GET /api/projects 驗證受限視野。
   c. 負向：錯誤驗證碼 422、重複 Email 409、registration-toggle 關閉後 meta.enabled=false 且 submit 被拒 → 再開回來。
   d. 清理：刪除測試註冊帳號與其 session、刪除 qaadmin 與其 session（D1 執行，記錄指令）；確認 `SELECT COUNT(*) FROM users WHERE email IN (...)` 為 0。
   e. 迴歸：未登入 /api/projects 401；intern1 恰 1 專案；GET / title 含「艾爾水晶」。
   f. 唯讀確認 usr_admin 的 approval_status='approved' 且本輪 updated_at 未變。
5. /help 與首次導覽文案補上「申請帳號／核准」一段；README 更新。
6. 每項指令與結果如實寫入 ACCEPTANCE-V3.md；DECISIONS.md 增量記錄。

## 8. 紀律

同 SPEC-V2 §9：小步 commit、不問問題、不新增重型依賴、不放寬既有權限、不碰 secrets 與 usr_admin。同錯 3 次換方案並記錄。
