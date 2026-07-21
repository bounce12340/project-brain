# 艾爾水晶-專案進度 備份與還原手冊

## 備份架構（三層）

| 層 | 內容 | 位置 | 頻率 |
|---|---|---|---|
| 程式碼 | 完整 git 歷史 | GitHub 私有 repo `bounce12340/project-brain` | 每次改版 `git push` |
| 資料庫 | D1 完整 SQL dump（schema＋所有資料） | `OneDrive - uicgroup.com.tw\專案管理系統製作\艾爾水晶備份\<日期>\db.sql` | 每週（backup.ps1）＋保留 8 份 |
| 檔案 | R2 全部附件 | 同上 `\r2-files\` | 每週（backup.ps1） |
| 內建保險 | Cloudflare D1 Time Travel | 雲端自動 | 隨時可回溯過去 30 天任一時間點 |
| Secrets | LLM_API_KEY、AGENTMAIL_API_KEY | 本機 `.dev.vars`（勿入 git）；建議另存密碼管理器 | 變更時 |

## 例行備份

- 自動：Windows 工作排程器每週一 07:30 執行 `pwsh -ExecutionPolicy Bypass -File C:\Users\BDAIPC\project-brain\backup.ps1`（**必須用 pwsh**；backup.ps1 為 UTF-8 with BOM，勿用其他編輯器另存破壞編碼）
- 手動：任何時候在 repo 資料夾執行 `.\backup.ps1`
- 前提：本機 wrangler 已登入（`npx wrangler whoami` 確認；失效就 `npx wrangler login`）

## 緊急還原：30 天內誤刪／改壞資料（最常見）

```powershell
# 查詢可回溯的時間點資訊
npx wrangler d1 time-travel info project-brain-db
# 回溯到指定時間（UTC）
npx wrangler d1 time-travel restore project-brain-db --timestamp "2026-07-21T08:00:00Z"
```

注意：回溯是整庫回到該時間點，之後的所有變更都會消失，先通知全員停用再操作。

## 完整重建（機器全滅／帳號災難時，從零救回）

1. 新機器裝 Node LTS → `git clone https://github.com/bounce12340/project-brain`
2. `npm install`；`npx wrangler login`（Cloudflare 帳號 bounceto12340@gmail.com）
3. 若 D1／R2 資源還在：直接 `npx wrangler deploy` 即恢復。資源全滅時：
   - `npx wrangler d1 create project-brain-db` → 把新 database_id 填回 wrangler.jsonc
   - `npx wrangler d1 execute project-brain-db --remote --file <最新備份>\db.sql`（匯入 dump，免跑 migrations）
   - `npx wrangler r2 bucket create project-brain-files` → 依 db 的 files 表 storage_key，把 `r2-files\` 逐一 `npx wrangler r2 object put` 回去
4. 重設 secrets：`npx wrangler secret put LLM_API_KEY`、`npx wrangler secret put AGENTMAIL_API_KEY`（值在 .dev.vars 備份或原廠重發）
5. `npx wrangler deploy` → 綁定網域 projects.uic-ai.com（zone 在同帳號會自動接回）
6. 驗證：登入、專案數、法規庫筆數與最新備份 log 對照

## 責任與週期

- 備份負責人：Josh（系統管理者）
- 每季演練一次：抽最新 db.sql 在本機 `--local` 匯入驗證可讀（`npx wrangler d1 execute project-brain-db --local --file db.sql`）
