# v11.2：TFDA 草稿駁回墓碑（修復「刪除後被 cron 復活」缺陷）

> 實證：使用者 07-25 刪除 11 筆草稿後，07-26 09:00 cron 將同樣 11 則重新建立（D1 查證：9 筆 created 07-25、11 筆 created 07-26 01:xx UTC）。根因：刪除連同 source_ref 一併消失，抓取端失憶。

## 1. Schema（migration 0010）

- 新表 `tfda_rejected`(source_ref TEXT PRIMARY KEY, title TEXT, rejected_by TEXT, rejected_at TEXT DEFAULT CURRENT_TIMESTAMP)。

## 2. 行為

- 刪除 `source='tfda_rss'` 的條目時（單筆刪除、批次刪除皆同）：先把其 source_ref＋title 寫入 `tfda_rejected`（INSERT OR IGNORE），再走既有刪除與孤兒附件清理。手動條目刪除行為不變。
- 抓取去重改為三重：source_ref 存在於 reg_entries（任一 status）→ skip；source_ref 存在於 tfda_rejected → skip（統計欄位加 `skipped_rejected`）；(entry_date,title) 相同 → skip。
- 「核准後又刪除」的 published TFDA 條目同樣寫墓碑（規則一致：刪過的 TFDA 公告永不自動回來）。
- /admin 不需要墓碑管理 UI（極少需要反悔）；但 DECISIONS 記載反悔手段＝D1 刪該筆 tombstone。

## 3. 測試（vitest ≥4）

刪除草稿寫墓碑、批次刪除逐筆寫墓碑、fetch 對 tombstone skip（統計正確）、手動條目刪除不寫墓碑。

## 4. 驗收（ACCEPTANCE-V11-2.md）

1. typecheck／test／build 全綠；migration 0010 remote；deploy 成功。
2. E2E（合成資料）：建合成 TFDA 草稿 → 刪除 → tombstone 存在 → 以含同 source_ref 的合成 feed 打 fetch 邏輯（單元或 staging 層）→ skipped_rejected 計入、未重建 → 清理合成資料與合成墓碑。
3. **真實資料鐵則**：現有 20 筆真實草稿與 631 筆 published 不動；真實墓碑不預先代寫（使用者將以批次刪除自行觸發）。
4. 迴歸：401、published 631、title。
5. 結果如實寫入 ACCEPTANCE-V11-2.md；DECISIONS 記載根因與反悔手段。

## 5. 紀律

同 SPEC-V4 §6。小步 commit；不碰 usr_admin 與 secrets。
