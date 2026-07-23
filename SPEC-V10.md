# v10：法規動態——公告日期為準＋多檔 AI 分析（含前後對照表摘要）

> 增量規格。使用者實例：重匯的醫材規費公告 entry_date 被抓成施行日 2027-03-01（未來日期），應為公告日；且衛福部修正案常為「公告主文＋總說明＋條文對照表」多檔包，需一起分析並特別摘要對照表。

## 1. 日期規則：公告日期為唯一基準

- LLM prompt 明定：`entry_date` **一律取「公告／發文日期」**（含民國年換算）；**絕不可**取「施行／生效／實施日期」。兩者並存時：entry_date=公告日，並在 key_points **第一條**加「•施行日：YYYY-MM-DD」（無明確施行日則不加）。
- 防呆：抽取結果的 entry_date 若晚於今天 90 天以上 → 後端標記 `date_suspect: true`，預覽列以警示色提示使用者確認（不阻擋，僅提醒）。
- few-shot 加一組「公告日與施行日並存」範例。
- 列表排序確認：公告日期（entry_date）DESC 為主、created_at DESC 為輔；列表欄位標題「日期」改為「公告日期」（en: "Announced"），中英字典同步、key-parity 測試須綠。

## 2. 多檔上傳分析

- UI：AI 匯入 drawer 的檔案輸入改 `multiple`（最多 **5 檔**，單檔 10MB、總量 25MB；.txt／文字層 .pdf），顯示已選檔案清單可逐一移除；與貼上文字互斥擇一。
- 後端：multipart 收多檔 → 逐檔抽文字 → 以「【檔案：<檔名>】」分隔串接為單一分析輸入（總字元上限與切塊邏輯沿用 v7）；**預設單則模式**：整包視為同一則公告。
- **對照表特別處理**：輸入含「對照表」「修正條文」「現行條文」等訊號時，key_points 必須包含獨立段落「**修正重點（前後對照）**」——逐項條列「第X條：舊規定→新規定」式摘要（最多 10 條，超過則挑重要者並註明「其餘略」）；prompt 附一組對照表 few-shot。
- 總說明／主文的立法目的歸入一般摘要行，不與對照重點混雜。

## 3. 多檔附件儲存（migration 0008）

- 新表 `reg_entry_files`(entry_id→reg_entries, file_id→files, position, UNIQUE(entry_id,file_id))；migration 內把既有 `reg_entries.file_id` 非空者 backfill 進 junction（file_id 欄位保留相容、讀取時合併去重）。
- 匯入確認時：全部上傳檔存 R2 並建立關聯；列表列顯示 📎×N，展開可逐檔下載（權限同現行：登入者可讀）。
- 刪除條目時：解除關聯；無任何條目引用的檔案連同 R2 物件清除（沿用孤兒清理邏輯）。

## 4. 測試（vitest ≥8）

公告日 vs 施行日抽取分流、民國年、date_suspect 判定（含邊界 90 天）、多檔串接與分隔標頭、對照表訊號偵測、junction backfill 邏輯、刪除條目的孤兒檔清理、i18n parity（新增字串）。

## 5. 驗收（ACCEPTANCE-V10.md；demo 帳號；不碰 usr_admin 與 secrets）

1. typecheck／test／build 全綠；migration 0008 remote 套用（backfill 筆數記錄）；deploy 成功。
2. 正式站 E2E：
   a. 自擬「公告日 115/7/20＋施行日 116/3/1」單檔文字 → entry_date=2026-07-20、key_points 首條為施行日、date_suspect=false。
   b. 自擬多檔包（主文 .txt＋對照表 .txt，各含 2 條修正）→ 單則 1 筆、key_points 含「修正重點（前後對照）」段與逐條舊→新、2 個檔案關聯且可下載（bytes 一致）。
   c. 刪除該測試條目 → 關聯與孤兒檔（D1＋R2）歸零。
   d. 迴歸：401、628 筆不變、列表以公告日期排序、title。
3. E2E 清理；/help 與 README 更新（多檔與公告日期說明）；DECISIONS.md 增量；結果如實寫入 ACCEPTANCE-V10.md。

## 6. 紀律

同 SPEC-V4 §6。commit：migration→日期規則→多檔後端→UI→對照表 prompt→驗收。
