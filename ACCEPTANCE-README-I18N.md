# README 多語言化驗收紀錄

**規格**：[SPEC-README-I18N.md](SPEC-README-I18N.md)

**驗收日期**：2026-07-27

**範圍**：`README.md`、`README.en.md`、`README.zh-CN.md`、`README.ja.md`、`README.ko.md`

## 結論

PASS。`SPEC-README-I18N.md` §3 的五項驗收均已實際執行。五份 README 結構完整，切換列與相對連結有效，抽樣複讀無亂碼或語言錯置；變更只包含 README 文件與本驗收紀錄，未改程式碼、未部署、未操作 `usr_admin` 或 secrets。

## 1. 檔案、切換列與連結

以 PowerShell 逐檔檢查：

- 五個指定檔案皆存在。
- 主標題下第三行為該檔預期的切換列，且只有目前語言不帶連結並以粗體顯示。
- 解析各檔所有 Markdown 相對連結並以 `Test-Path -LiteralPath` 檢查目標。
- 檢查 UTF-8 讀取結果不含 U+FFFD replacement character 或 NUL。

結果：

| 檔案 | 切換列 | 相對連結 | UTF-8 |
|---|---|---|---|
| `README.md` | PASS | PASS | PASS |
| `README.en.md` | PASS | PASS | PASS |
| `README.zh-CN.md` | PASS | PASS | PASS |
| `README.ja.md` | PASS | PASS | PASS |
| `README.ko.md` | PASS | PASS | PASS |

## 2. 結構完整性

PowerShell 結構比對以 `README.md` 為基準，逐檔統計標題層級、fenced code blocks 與連續 Markdown 表格；另逐字比對所有非 mermaid code block，並檢查 mermaid 的 graph direction、node id、edge operator 與連線順序不變。

| 檔案 | 標題 | fenced code blocks | 表格 | 非 mermaid code 原文 | mermaid 語法骨架 |
|---|---:|---:|---:|---|---|
| `README.md` | 24 | 6 | 6 | PASS | PASS |
| `README.en.md` | 24 | 6 | 6 | PASS | PASS |
| `README.zh-CN.md` | 24 | 6 | 6 | PASS | PASS |
| `README.ja.md` | 24 | 6 | 6 | PASS | PASS |
| `README.ko.md` | 24 | 6 | 6 | PASS | PASS |

標題層級細分均為 H1 = 1、H2 = 12、H3 = 11。額外的一對一結構簽章比對也一致：blockquote = 1、項目符號 = 18、編號項目 = 6、表格列 = 53、Markdown links = 38、code block 外一般段落 = 24。

事實一致性另以 24 個必要值（版本、測試數、年份、數量、模型、cron、容量、示範帳號等）及完整 URL／Email 多重集合逐檔比對，五檔皆 PASS。

## 3. 人工複讀

依規格逐檔複讀「功能總覽首段」、「權限速查表頭」與「備份表」：

| 檔案 | 功能總覽 | 權限表頭 | 備份表 | 判定 |
|---|---|---|---|---|
| `README.md` | 繁體中文，原文未改 | 繁體中文＋英文角色值 | 繁體中文＋保留技術值 | PASS |
| `README.en.md` | 自然工程英文 | 英文＋原 enum／角色值 | 自然英文＋保留檔名／產品值 | PASS |
| `README.zh-CN.md` | 简体中文在地用语 | 简体中文＋原 enum／角色值 | 简体中文＋保留文件名／技术值 | PASS |
| `README.ja.md` | 自然な日本語、です・ます調 | 日本語＋元の enum／ロール値 | 自然な日本語＋ファイル名／技術値を維持 | PASS |
| `README.ko.md` | 자연스러운 한국어, 합니다체 | 한국어＋원래 enum／역할 값 | 자연스러운 한국어＋파일명／기술 값 유지 | PASS |

五組樣段皆無亂碼、語言錯置或未翻譯的敘述性表頭。產品名首次出現分別附有規定的 `"Aiur Crystal"`、`艾尔水晶`、`アイウル・クリスタル`、`아이우르 크리스털`，後續仍保留「艾爾水晶」原名。

## 4. Diff、commit、push 與遠端 hash

執行：

```powershell
git diff --check
git commit -m "docs: add complete README translations"
git push origin main
$localHash = git rev-parse HEAD
$remoteHash = (git ls-remote origin refs/heads/main).Split()[0]
if ($localHash -ne $remoteHash) { throw "remote hash mismatch" }
git status --short --branch
```

結果：

- `git diff --check`：PASS，exit code 0，無 whitespace error。
- `git commit`：PASS；本次規格要求的五份 README 與本驗收檔由單一 commit 完成。
- `git push origin main`：PASS。
- `git ls-remote origin refs/heads/main`：PASS；遠端 `main` hash 與本機 `HEAD` 完全一致。
- 最終 `git status --short --branch`：PASS；`main` 與 `origin/main` 同步，工作樹乾淨。

本驗收檔本身位於被驗證的 commit 中，因此不在檔內硬編碼該 commit 自身的十六進位 hash（內容會參與 hash 計算，無法自我引用）；驗收以以上兩個 Git 指令的實際相等比較為準，精確 hash 同步回報於任務交付訊息。

## 5. 執行過程備註

- 環境中的 `python` 指向未安裝的 Microsoft Store alias；首次結構腳本因此未執行，隨即改用不需新增依賴的 PowerShell 完成相同檢查。
- 三次 PowerShell 輔助檢查曾出現 parser error：兩次是壓成單行後 `foreach` 關鍵字缺少必要空白，一次是字串中的 `$f:` 未用 `${f}` 劃定變數邊界；修正為明確的多行腳本後重跑，最終結構簽章與事實一致性檢查皆 exit code 0。
- 首次 staged `git diff --cached --check` 找到本檔兩處 Markdown hard-break 尾端空白；移除後重新 stage 並重跑，最終 diff checks 皆為 exit code 0。
- Git 顯示既有 `core.autocrlf` 的 LF→CRLF 提示；`git diff --check` 仍為 exit code 0，沒有 trailing whitespace 或 whitespace error。
