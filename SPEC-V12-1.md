# v12.1：進度紀錄可編輯／刪除（補 v1 遺漏，留痕設計）

> v1 規格只做了新增，未提供編輯與刪除；使用者實際需要修正打錯字、AI 快寫產出的修改與誤貼刪除。

## 1. 權限

- **編輯**：作者本人、專案 owner、admin。
- **刪除**：作者本人、專案 owner、admin。
- 同組成員可代填（既有規則）但**不可改刪他人的進度**——避免互相覆蓋。
- 後端以 canEditProgress ∩ (author_id = 使用者 or owner or admin) 判定，前端同步隱藏按鈕。

## 2. Schema（migration 0011）

- progress_updates 加欄：`edited_at` TEXT NULL、`edited_by` TEXT NULL。

## 3. 行為

- `PATCH /api/progress-updates/:id` {content}：更新內文、寫 `edited_at`/`edited_by`、更新 projects.last_activity_at；**不重算 progress_snapshot**（快照是當時的歷史值，不可篡改）。audit_log 記 `progress_edited`。
- `DELETE /api/progress-updates/:id`：刪除該筆；若該筆是 auto 進度模式下由「✔ 完成…」自動產生的紀錄，仍允許刪除（僅刪日誌，不回滾任務狀態，於 UI 說明一行）。audit_log 記 `progress_deleted`（summary 含前 40 字，供稽核回溯）。
- 兩者都不影響既有通知與已寄出的報告。

## 4. UI（專案「進度紀錄」timeline）

- 每筆進度右上角加小型「編輯」與「刪除」icon（沿用 v10.1 的刪除 icon 樣式與 confirm 模式；權限不符者不顯示）。
- 編輯採就地展開 textarea＋「儲存／取消」；儲存後該筆顯示灰色小字「已於 YYYY/MM/DD HH:mm 編輯」（i18n 雙語）。
- 刪除確認框文案提醒「刪除後無法復原，稽核紀錄仍會保留」。
- i18n 中英齊備，key-parity 測試須綠。

## 5. 測試（vitest ≥6）

權限矩陣（作者／owner／admin/他人／intern）、編輯不改 snapshot、audit summary 產生、刪除自動產生紀錄的行為、i18n parity。

## 6. 驗收（ACCEPTANCE-V12-1.md；demo 專案，不碰使用者真實資料）

1. typecheck／test／build 全綠；migration 0011 remote；deploy 成功。
2. E2E（新建 demo 專案）：作者編輯自己的進度 → 內文更新且 edited_at 非空、snapshot 不變；他人（同組 member）嘗試編輯 → 403；owner 刪除他人進度 → 成功且 audit_log 有 progress_deleted；清理 demo 專案。
3. 迴歸：401、published 631、真實草稿與 tombstone 不變、title。
4. README／help 補說明；DECISIONS 增量；結果如實寫入 ACCEPTANCE-V12-1.md。

## 7. 紀律

同 SPEC-V4 §6。不碰 usr_admin 與 secrets；小步 commit。
