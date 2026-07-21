# 一次性清理：刪除 AI 匯入測試產生的 26 筆碎片條目（使用者已核准）

## 目標

使用者於 2026-07-21 09:07／09:12 UTC 用 v7 舊版 AI 匯入產生 26 筆被過度拆分的 reg_entries，已核准刪除；刪後使用者將以 v7.1 單則模式重新匯入。

## 範圍（雙重條件鎖定，缺一不可）

- 第一批 17 筆：`created_at` 於 `2026-07-21 09:07:00`～`09:08:00` 之間，且 `title LIKE '食品安全衛生管理法第35條第4項解釋令問答集 Q%'`，且 `entry_date='2026-07-15'`。
- 第二批 9 筆：`created_at` 於 `2026-07-21 09:12:00`～`09:13:00` 之間，且 `entry_date='2027-03-01'`，且 `product_line='醫療器材'`。

## 程序

1. 唯讀前置：確認總數 653；分別 COUNT 兩批（17／9）；列出 26 筆的 id 與 `file_id`（僅記 id，不記內文）。
2. 若任一 COUNT 與預期不符 → **停止不刪**，將實際清單寫入報告等待使用者確認。
3. 相符 → DELETE（各批用上述完整條件）；記下 changes。
4. 孤兒檔案：對步驟 1 蒐集的非空 `file_id`，檢查是否仍被任何 reg_entries 引用；無引用者刪除 files 資料列與對應 R2 物件（`npx wrangler r2 object delete`）。
5. 讀回：reg_entries 總數 = 627；兩批條件 COUNT = 0；孤兒 file/R2 = 0。
6. 全程指令與結果寫入本檔下方「執行紀錄」章節後 commit；不碰 usr_admin 與 secrets。

## 執行紀錄

執行時間：2026-07-21 17:36（Asia/Taipei，UTC+08:00）

目標資源：remote D1 `project-brain-db`、remote R2 `project-brain-files`

Wrangler：`npx wrangler --version` → `4.112.0`。

安全範圍：未查詢、修改或刪除 `usr_admin`；未讀取、列出或修改 secrets。

### 0. D1 `LIKE` 相容性與無寫入嘗試

文件指定的固定 pattern `title LIKE '食品安全衛生管理法第35條第4項解釋令問答集 Q%'` 在 remote D1 以 `--command` 及 `--file` 執行時都回覆 `LIKE or GLOB pattern too complex: SQLITE_ERROR [code: 7500]`。多句 `--command` 的首次嘗試只回傳第一句 `total=653`、`changes=0`、`rows_written=0`；另一次並行參數嘗試回覆 `incomplete input` 並 exit 1。這些失敗嘗試沒有執行任何 DELETE 或其他寫入。

後續將該 pattern 換成下列語義等價的前綴判斷；它保留 SQLite `LIKE` 對 ASCII 大小寫不敏感的行為，且不放寬時間與 `entry_date` 條件：

```sql
lower(substr(title,1,length('食品安全衛生管理法第35條第4項解釋令問答集 Q')))
  = lower('食品安全衛生管理法第35條第4項解釋令問答集 Q')
```

曾以暫存 `.cleanup-fragments-precheck.sql` 執行兩句唯讀 SELECT；Wrangler bulk API 回覆 `Total queries executed=2`、`Rows written=0`，但不回傳 SELECT rows，故未拿它作 stop-condition 判定。暫存檔已移除。

### 1. 唯讀前置與 stop condition

所有 D1 指令均使用：

```powershell
npx wrangler d1 execute project-brain-db --remote --json --command "$sql"
```

計數 SQL：

```sql
SELECT
  (SELECT COUNT(*) FROM reg_entries) AS total,
  (SELECT COUNT(*) FROM reg_entries
   WHERE created_at BETWEEN '2026-07-21 09:07:00' AND '2026-07-21 09:08:00'
     AND lower(substr(title,1,length('食品安全衛生管理法第35條第4項解釋令問答集 Q')))=lower('食品安全衛生管理法第35條第4項解釋令問答集 Q')
     AND entry_date='2026-07-15') AS batch_1,
  (SELECT COUNT(*) FROM reg_entries
   WHERE created_at BETWEEN '2026-07-21 09:12:00' AND '2026-07-21 09:13:00'
     AND entry_date='2027-03-01'
     AND product_line='醫療器材') AS batch_2;
```

結果：`total=653`、`batch_1=17`、`batch_2=9`、`changes=0`、`rows_written=0`。三個數字均符合預期，stop condition 未觸發，准予繼續。

清單 SQL 使用相同完整條件，以 `UNION ALL` 列出 `batch,id,file_id` 並依 `batch,id` 排序；結果如下（未查詢或記錄內文）：

| batch | id | file_id |
|---|---|---|
| batch_1 | `reg_0640306dba83473ba9` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_079738adda3344ec83` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_155744ba266b4753b2` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_52c29e9439964e688a` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_53918c61b8a342ef9a` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_6b8eb79fe18d448cbd` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_73514f11ea674aa8b2` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_7368242ac89e484189` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_87713c0724f940f3a9` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_9ce4da5cee164541b9` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_c50590fa7988469da5` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_d2f93cf6ffb94683a3` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_ecf3620e180a491b89` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_ee7abd21fbef463e98` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_f016a8fa73c24cbebf` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_f62635c8e76447e0b6` | `file_ac66cf38c7894ebc86` |
| batch_1 | `reg_f7fcd1b5b4df44e185` | `file_ac66cf38c7894ebc86` |
| batch_2 | `reg_2152a180e1fd4c0296` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_2664cb14264240ceac` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_2d24fff77d0a4ad3b4` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_3c4d28fd3a75407296` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_550a41fa35bc4697b5` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_a5c7988e31ed4d12bc` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_c539c6f3a7ba4e128e` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_e0120d2338e5476ebb` | `file_b5d3fd2bb8834912b5` |
| batch_2 | `reg_f3e022a5c7b24890ba` | `file_b5d3fd2bb8834912b5` |

### 2. 刪除兩批 `reg_entries`

第一批指令 SQL：

```sql
DELETE FROM reg_entries
WHERE created_at BETWEEN '2026-07-21 09:07:00' AND '2026-07-21 09:08:00'
  AND lower(substr(title,1,length('食品安全衛生管理法第35條第4項解釋令問答集 Q')))=lower('食品安全衛生管理法第35條第4項解釋令問答集 Q')
  AND entry_date='2026-07-15'
RETURNING id;
```

結果：exit 0、`changes=17`、`rows_written=17`；RETURNING 的 17 個 id 與前置清單一致。

第二批指令 SQL：

```sql
DELETE FROM reg_entries
WHERE created_at BETWEEN '2026-07-21 09:12:00' AND '2026-07-21 09:13:00'
  AND entry_date='2027-03-01'
  AND product_line='醫療器材'
RETURNING id;
```

結果：exit 0、`changes=9`、`rows_written=9`；RETURNING 的 9 個 id 與前置清單一致。

### 3. 孤兒檔案與 R2

引用檢查指令 SQL：

```sql
SELECT f.id,f.storage_key,f.project_id,
       (SELECT COUNT(*) FROM reg_entries r WHERE r.file_id=f.id) AS reg_entry_references
FROM files f
WHERE f.id IN ('file_ac66cf38c7894ebc86','file_b5d3fd2bb8834912b5')
ORDER BY f.id;
```

結果：兩筆 `project_id` 均為 NULL，`reg_entry_references` 均為 0，因此兩者均為本程序要清理的孤兒。

R2 刪除指令與結果：

```powershell
npx wrangler r2 object delete "project-brain-files/regwatch/file_ac66cf38c7894ebc86/食品安全衛生管理法第35條第4項解釋令問答集(1150715修)_.pdf" --remote --force
npx wrangler r2 object delete "project-brain-files/regwatch/file_b5d3fd2bb8834912b5/總說明及條文對照表.pdf" --remote --force
```

兩句均 exit 0 並回覆 `Delete complete.`。

`files` 刪除指令 SQL：

```sql
DELETE FROM files
WHERE id IN ('file_ac66cf38c7894ebc86','file_b5d3fd2bb8834912b5')
  AND NOT EXISTS (SELECT 1 FROM reg_entries WHERE file_id=files.id)
RETURNING id;
```

結果：exit 0、`changes=2`、`rows_written=2`，RETURNING 為上述兩個 `file_id`。

### 4. 最終讀回

D1 讀回沿用兩批完整條件，另檢查指定兩個 `file_id`：

```sql
SELECT
  (SELECT COUNT(*) FROM reg_entries) AS total,
  (SELECT COUNT(*) FROM reg_entries
   WHERE created_at BETWEEN '2026-07-21 09:07:00' AND '2026-07-21 09:08:00'
     AND lower(substr(title,1,length('食品安全衛生管理法第35條第4項解釋令問答集 Q')))=lower('食品安全衛生管理法第35條第4項解釋令問答集 Q')
     AND entry_date='2026-07-15') AS batch_1,
  (SELECT COUNT(*) FROM reg_entries
   WHERE created_at BETWEEN '2026-07-21 09:12:00' AND '2026-07-21 09:13:00'
     AND entry_date='2027-03-01'
     AND product_line='醫療器材') AS batch_2,
  (SELECT COUNT(*) FROM files
   WHERE id IN ('file_ac66cf38c7894ebc86','file_b5d3fd2bb8834912b5')) AS orphan_file_rows;
```

結果：exit 0、`total=627`、`batch_1=0`、`batch_2=0`、`orphan_file_rows=0`、`changes=0`、`rows_written=0`。

R2 讀回指令將 object body 導向 null，未讀取或記錄檔案內容：

```powershell
npx wrangler r2 object get "project-brain-files/regwatch/file_ac66cf38c7894ebc86/食品安全衛生管理法第35條第4項解釋令問答集(1150715修)_.pdf" --remote --pipe 1>$null
npx wrangler r2 object get "project-brain-files/regwatch/file_b5d3fd2bb8834912b5/總說明及條文對照表.pdf" --remote --pipe 1>$null
```

兩句均以預期的 exit 1 回覆 `The specified key does not exist.`，故孤兒 R2 object 數為 0。

### 5. 提交

```powershell
git commit -m "chore: execute fragment cleanup"
```

首次提交結果：exit 0，建立 `[main 8b224d7] chore: execute fragment cleanup`，`1 file changed, 174 insertions(+), 1 deletion(-)`。

補入上述實際結果後執行：

```powershell
git commit --amend --no-edit
```

結果：exit 0；執行紀錄已納入同一個最終 commit，最終 commit 為本 repo 的 current `HEAD`。
