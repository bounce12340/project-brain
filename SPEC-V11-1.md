# v11.1：TFDA 草稿批次選取（核准所選／刪除所選）

> 使用者回饋：草稿審核要能批量刪除，不要一筆一筆點。

## 1. UI（/regwatch 草稿檢視，can_manage 限定）

- 每列草稿左側加 checkbox；工具列加「全選／取消全選」與已選計數。
- 選取 ≥1 筆時浮出批次動作列：「**核准所選 (N)**」與「**刪除所選 (N)**」（danger 樣式）；兩者皆先跳確認框（顯示筆數；刪除確認框強調不可復原）。
- 既有逐列動作與「全部核准」保留；批次操作後清空選取並刷新清單與「待審核 N」計數。
- checkbox 點擊不觸發列展開（stopPropagation）；鍵盤可操作、focus-visible 正常；雙主題樣式。
- i18n 中英齊備，key-parity 測試須綠。

## 2. API

- POST `/api/regwatch/drafts/batch` {action: 'approve'|'delete', ids: string[]}（can_manage；ids 上限 100）。
- **只對 status='draft' 的列生效**：非草稿或不存在的 id 一律跳過並計入 skipped（防呆：批次端點永遠動不到 published 資料）。
- delete 路徑逐筆沿用既有孤兒附件清理；approve＝status→published。
- 回應 {processed, skipped}；寫一筆 audit_log（`regwatch_draft_batch`，含 action 與筆數）。

## 3. 測試（vitest ≥5）

批次端點權限、僅草稿生效（混入 published id → skipped）、ids 上限、approve／delete 各自結果、audit 摘要。

## 4. 驗收（ACCEPTANCE-V11-1.md）

1. typecheck／test／build 全綠；deploy 成功（無 migration）。
2. E2E：建 3 筆合成草稿 → 勾 2 筆批次刪除（含 1 筆掛合成附件→孤兒清理驗證）→ 剩 1 筆批次核准 → published 可見 → 清除合成資料。
3. **真實 TFDA 草稿（現有 20 則）不得核准、不得刪除**，前後計數不變並記錄。
4. 迴歸：未登入 401、published 631、title。
5. 結果如實寫入 ACCEPTANCE-V11-1.md；DECISIONS 增量。

## 5. 紀律

同 SPEC-V4 §6。小步 commit；不碰 usr_admin 與 secrets。
