# SPEC-V4 驗收紀錄

驗收日期：2026-07-21（Asia/Taipei）  
正式網址：`https://projects.uic-ai.com`

## 結論

SPEC-V4 §5.1～§5.4 均已實際執行。功能、部署、正式 E2E、負向案例、cleanup／角色還原與回歸最終通過。依規格禁止事項，本輪未登入或修改 `usr_admin`；最後管理員情境以正式 D1 唯讀計數及 Hono API 單元測試驗證，沒有為製造情境而停用或降級 `usr_admin`。

## 1. TypeScript、測試、建置與 migration list

狀態：**PASS**

```text
npm run typecheck
→ exit 0；tsc --noEmit 無錯誤

npm test
→ exit 0；8 個 test files、94 個 tests 全數通過
→ V4 新增 tests/admin-transfer.test.ts：14 個 tests（要求至少 8 個）

npm run build
→ exit 0；Vite production build 成功，648 modules transformed
→ 最大 JavaScript chunk：LineChart-CuU98ECv.js 377.20 kB（gzip 前）

npx wrangler d1 migrations list project-brain-db --remote
→ exit 0；No migrations to apply
```

V4 測試涵蓋：最後一名 active approved admin 的 API PATCH 降級與 DELETE 停用均回 422、複數管理員時允許降級、member／intern 接班資格、pending／停用／既有 admin／自己／不存在接班人拒絕、共同管理員結果、完全移轉的「先升後降」順序、共用密碼失敗計數與第五次鎖定 15 分鐘。

## 2. 正式部署

狀態：**PASS**

```text
npx wrangler deploy
→ exit 0；custom domain projects.uic-ai.com
→ D1、R2、Workers AI、Static Assets bindings 均載入
→ Worker Startup Time 6 ms
→ Current Version ID: c54d2115-d8df-4ce0-ae0e-e9d891ebe02f
```

## 3. 正式網址 E2E

狀態：**PASS**

所有 HTTP 操作均對 `https://projects.uic-ai.com` 執行，寫入 API 都帶同源 `Origin`。臨時帳號使用產品相同的 PBKDF2-SHA256 格式產生密碼雜湊；雜湊只存於 PowerShell 記憶體並送入 D1，未輸出或寫入 repo。建立：

```text
usr_qaadmin2_v4 / qaadmin2@demo.local
→ role=admin、group_id=grp_qa、is_demo=1、approval_status=approved

usr_pending_v4 / pending-v4@demo.local
→ role=member、group_id=grp_clinical、is_demo=1、approval_status=pending
```

### 3a. co_admin、通知與 audit

```text
qaadmin2 POST /api/auth/login → HTTP 200
GET /api/admin/transfer/candidates → HTTP 200
→ 含 clinical1、clinical2；不含 pending 樣本

qaadmin2 POST /api/admin/transfer
  {successor_id: clinical1, mode: co_admin, 正確目前密碼}
→ HTTP 200；clinical1 role=admin；qaadmin2 維持 admin
→ email_sent.successor=true、email_sent.current=true

qaadmin2 GET /api/notifications
→ 找到 type=admin_transfer、title=管理權已移轉
clinical1 GET /api/notifications
→ 找到 type=admin_transfer、title=你已成為管理員

GET /api/admin/audit-log
→ 找到 action=admin_transfer
→ summary 含 mode=co_admin、qaadmin2@demo.local、clinical1@demo.local
```

### 3b. 複數管理員降級與最後管理員防呆

```text
clinical1 PATCH /api/admin/users/usr_qaadmin2_v4 {role: member}
→ HTTP 200；qaadmin2 成為 member

GET /api/admin/users
→ active_admin_count=2（usr_admin + clinical1）
```

規格文字同時指出 `usr_admin` 必須保持 active admin 且不可碰觸，因此正式環境中 clinical1 此時並非系統唯一管理員；若實際送出「clinical1 自降」會依法放行，而不會回 422。為避免破壞後續 E2E，也不為了造假情境碰 `usr_admin`，本輪**沒有把 production 自降寫成已執行**，改依規格註記採以下兩項證據：

```text
cleanup 後 D1 唯讀：active_approved_admins=1

tests/admin-transfer.test.ts（直接呼叫 Hono adminRoutes）
→ PATCH 最後 admin 降級：HTTP 422「系統至少需要一名管理員」
→ DELETE 最後 admin 停用：HTTP 422「系統至少需要一名管理員」
```

另外，SQL UPDATE 本身也帶 active approved admin 計數條件；即使預先計數與寫入之間有其他請求，最後一名管理員仍不會被降級或停用。「清除示範資料」路徑同樣保留最後管理員。

### 3c. full_transfer

```text
clinical1 POST /api/admin/transfer
  {successor_id: clinical2, mode: full_transfer, 正確目前密碼}
→ HTTP 200
→ 同一 D1 batch 先把 clinical2 升為 admin，再把 clinical1 降為 member
→ clinical1 既有 session GET /api/auth/me 顯示 role=member
→ clinical2 登入成功，role=admin
→ email_sent.successor=true、email_sent.current=true

clinical1 / clinical2 GET /api/notifications
→ 雙方分別收到「管理權已移轉」／「你已成為管理員」

GET /api/admin/audit-log
→ 找到 action=admin_transfer
→ summary 含 mode=full_transfer、clinical1@demo.local、clinical2@demo.local
```

cleanup 後唯讀查詢仍保留兩筆正式 audit 軌跡：

```text
2026-07-21 05:09:29 UTC
→ mode=co_admin from=qaadmin2@demo.local to=clinical1@demo.local

2026-07-21 05:09:33 UTC
→ mode=full_transfer from=clinical1@demo.local to=clinical2@demo.local
```

### 3d. 負向案例

```text
qaadmin2 以錯誤目前密碼 POST /api/admin/transfer
→ HTTP 403「目前密碼不正確」；計入共用 failed_count

qaadmin2 指定 approval_status=pending 的 usr_pending_v4
→ HTTP 422；未升任
```

後續使用正確密碼完成 co_admin 時，qaadmin2 的 failed_count 與 locked_until 依成功流程歸零。

### 3e. Cleanup、角色還原與 usr_admin 唯讀確認

實際 cleanup：

```sql
DELETE FROM sessions
WHERE user_id IN ('usr_qaadmin2_v4','usr_pending_v4');

DELETE FROM sessions
WHERE user_id IN ('usr_clinical1','usr_clinical2')
  AND created_at >= <本輪開始時間>;

DELETE FROM notifications
WHERE type='admin_transfer'
  AND user_id IN ('usr_clinical1','usr_clinical2')
  AND created_at >= <本輪開始時間>;

UPDATE users
SET role='member',failed_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP
WHERE id IN ('usr_clinical1','usr_clinical2');

DELETE FROM users
WHERE id IN ('usr_qaadmin2_v4','usr_pending_v4');
```

命令以 `npx wrangler d1 execute project-brain-db --remote --command ...` 執行，exit 0。cleanup 後另做唯讀查核：

```text
clinical1.role=member、is_active=1、approval_status=approved
clinical2.role=member、is_active=1、approval_status=approved
temp_users=0
temp_sessions=0
remaining_e2e_sessions=0
remaining_v4_notifications=0
active_approved_admins=1
```

`usr_admin` 開工前與 cleanup 後皆為：

```text
role=admin
is_active=1
approval_status=approved
updated_at=2026-07-21 04:56:56 UTC
```

前後完全相同。本輪未登入、修改、重設、停用、刪除 `usr_admin`，也未撤銷其 session。

### 3f. 回歸與一次驗收工具失敗

最終結果：

```text
GET /api/health → HTTP 200
未登入 GET /api/projects → HTTP 401
GET / → HTTP 200
HTML title 含「艾爾水晶」→ true
正式 HelpPage asset 含「管理權移轉」→ true
正式 AdminPage asset 含「你將立即失去管理權」→ true
```

如實記錄一次驗收工具失敗：第一版 PowerShell smoke 指令把首頁回應變數命名為 `$home`；PowerShell 變數不分大小寫，因此撞到唯讀的系統 `$HOME`，首頁子項未執行並回 `Cannot overwrite variable HOME because it is read-only or constant.`。這不是產品錯誤；改用 `$smokeHomeResponse` 後重新執行，得到上述 200 與 title=true。教訓已依全域規則寫入 `C:\Users\BDAIPC\agent-rules\LESSONS.md`。

## 4. 文件與決策

狀態：**PASS**

- `/help` 已新增「管理權與帳號安全」，說明共同管理員、完全移轉、密碼驗證及最後管理員防呆。
- README 已補管理權移轉操作、二次確認與 active approved admin 安全規則。
- `DECISIONS.md` 已增量記錄 D1 batch／Email 失敗語意、清 demo 路徑防呆與 `usr_admin.updated_at` 唯讀基線。
- production build 與正式部署均包含上述 UI 與文件內容。

## 最終結論

SPEC-V4 §5 的指令、正式 E2E、負向案例、cleanup、角色還原、正式 D1 唯讀確認與回歸均已執行並如實記錄。唯一沒有在 production 實際執行的是會因 `usr_admin` 仍在而依法放行的「clinical1 自降並期待 422」矛盾步驟；依規格自己的註記改以 D1 唯讀唯一管理員計數與直接 Hono API 測試覆蓋，且未觸碰 `usr_admin`。
