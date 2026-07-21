# 艾爾水晶-專案進度 每週備份腳本
# 內容：D1 完整 SQL dump ＋ R2 全部檔案 → OneDrive 時間戳資料夾，保留最近 8 份
# 手動執行：在本資料夾開 PowerShell 跑 .\backup.ps1；排程執行見 BACKUP.md

$ErrorActionPreference = "Stop"
$repo = "C:\Users\BDAIPC\project-brain"
$backupRoot = "C:\Users\BDAIPC\OneDrive - uicgroup.com.tw\專案管理系統製作\艾爾水晶備份"
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$dest = Join-Path $backupRoot $stamp

Set-Location $repo
New-Item -ItemType Directory -Force $dest | Out-Null
$log = Join-Path $dest "backup.log"
"備份開始 $(Get-Date)" | Tee-Object $log

# 1. D1 完整 SQL dump（含 schema 與所有資料）
npx wrangler d1 export project-brain-db --remote --output (Join-Path $dest "db.sql") 2>&1 | Tee-Object $log -Append
if (-not (Test-Path (Join-Path $dest "db.sql"))) { throw "D1 export 失敗" }
"D1 dump: $([math]::Round((Get-Item (Join-Path $dest 'db.sql')).Length/1KB)) KB" | Tee-Object $log -Append

# 2. R2 檔案（依 files 表的 storage_key 逐一下載）
$filesDir = Join-Path $dest "r2-files"
New-Item -ItemType Directory -Force $filesDir | Out-Null
$keysJson = npx wrangler d1 execute project-brain-db --remote --json --command "SELECT storage_key FROM files" | ConvertFrom-Json
$keys = @($keysJson[0].results | ForEach-Object { $_.storage_key })
"R2 檔案數: $($keys.Count)" | Tee-Object $log -Append
foreach ($k in $keys) {
    $safe = ($k -replace '[\\/:*?"<>|]', '_')
    try {
        npx wrangler r2 object get "project-brain-files/$k" --remote --file (Join-Path $filesDir $safe) 2>&1 | Out-Null
        "  OK $k" | Tee-Object $log -Append
    } catch { "  FAIL $k : $_" | Tee-Object $log -Append }
}

# 3. 保留最近 8 份，刪除更舊的
$old = Get-ChildItem $backupRoot -Directory | Sort-Object Name -Descending | Select-Object -Skip 8
foreach ($o in $old) { Remove-Item $o.FullName -Recurse -Force; "已清除舊備份 $($o.Name)" | Tee-Object $log -Append }

"備份完成 $(Get-Date) → $dest" | Tee-Object $log -Append
