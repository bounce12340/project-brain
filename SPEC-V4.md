# 艾爾水晶-專案進度 v4：管理權移轉與最後管理員防呆

> 增量規格，疊在 SPEC.md／SPEC-V2.md／SPEC-V3.md 之上；未提及行為不變。規模小，聚焦做對。

## 0. 目標

1. `/admin` 新增「**管理權移轉**」卡：現任 admin 指定接班人，可選「升為共同管理員」或「完全移轉（對方升 admin、自己降為 member）」。
2. **最後管理員防呆**：系統在任何路徑下都不可能變成 0 個 active approved admin。

## 1. 規則

- 接班人條件：is_active=1、approval_status='approved'、非 admin 的任何使用者（member 或 intern 皆可，升任後 role 直接成 admin）。
- 兩種模式：
  - `co_admin`：接班人升 admin，自己不變（預設，建議日常做備援）。
  - `full_transfer`：**同一批次原子執行**——先升接班人，再把自己降為 member。順序保證絕不出現零管理員瞬間。
- **執行任一模式都必須重新輸入自己目前的密碼**（防止離開座位被人代按）；密碼錯 → 403，並計入既有登入失敗鎖定計數。
- 完成後：雙方都收到站內＋Email 通知（「你已成為管理員」／「管理權已移轉」）；audit_log 記 `admin_transfer`（含模式與雙方 email）。
- 防呆（後端為準，前端同步擋）：
  - 新端點與**既有** PATCH /api/admin/users/:id 都要加：若目標是 admin 且要降級／停用／刪除，先數 active approved admin 數，=1 → 422「系統至少需要一名管理員」。
  - full_transfer 中自降不受上述限制（因為接班人已先升，數量 ≥1 成立）。
  - 不得對 usr_admin 以外帳號有任何特殊硬編碼——規則對所有 admin 一視同仁。

## 2. API

- GET `/api/admin/transfer/candidates`（admin）：回可選接班人清單（id/name/email/group_name/role）。
- POST `/api/admin/transfer` {successor_id, mode: 'co_admin'|'full_transfer', password}（admin）。
- 既有使用者更新端點補防呆（§1）。

## 3. UI

- /admin 新卡「管理權移轉」：接班人下拉、模式單選（附一句說明）、密碼欄、確認按鈕（full_transfer 要二次確認 modal，寫明後果「你將立即失去管理權」）。
- full_transfer 成功後前端把當前使用者導回儀表板並刷新身分（nav 的「管理」消失）。
- 使用者管理表格：對「最後一名 admin」的降級／停用控制項 disable 並顯示原因 tooltip。
- /help 補「管理權移轉」段。

## 4. 測試（vitest 新增 ≥8）

最後 admin 降級/停用被擋（API 層）、co_admin 升任、full_transfer 原子順序與結果、密碼錯 403、接班人資格（pending/停用/已是 admin → 422）、多 admin 情境下降級放行。

## 5. 驗收（寫入 ACCEPTANCE-V4.md）

1. typecheck、test、build 全綠；`npx wrangler d1 migrations list` 無新 migration（本版無 schema 變更）。
2. `npx wrangler deploy` 成功。
3. 正式網址 E2E（**不碰 usr_admin**；用 D1 臨時建 demo admin `qaadmin2@demo.local` is_demo=1 操作，結束清除）：
   a. qaadmin2 對 clinical1 執行 co_admin → clinical1 成為 admin、收到通知；audit 有 admin_transfer。
   b. 以 clinical1（現為 admin）嘗試把 qaadmin2 降級 → 成功（因仍有 ≥1 admin）；再嘗試把**自己**降級 → 422（此時他是唯一 demo 情境 admin？注意：usr_admin 恆為 active admin，故計數含 usr_admin 永遠 ≥1——測試防呆須在 D1 中以唯讀方式驗證計數邏輯＋單元測試覆蓋「僅剩一名」情境，不得為了測試停用 usr_admin）。
   c. full_transfer：clinical1 對 clinical2 執行完全移轉（輸入密碼）→ clinical2 成 admin、clinical1 降回 member、雙方通知、audit 記錄。
   d. 密碼錯誤 → 403；接班人選 pending 帳號 → 422。
   e. 清理：把 clinical1/clinical2 角色還原為 member、刪 qaadmin2 及其 sessions；唯讀確認還原完成、usr_admin updated_at 未變。
   f. 迴歸：未登入 401、GET / title 含「艾爾水晶」。
4. 結果如實寫入 ACCEPTANCE-V4.md；DECISIONS.md 增量。

## 6. 紀律

同 SPEC-V3 §8。不碰 secrets 與 usr_admin；小步 commit；不問問題。
