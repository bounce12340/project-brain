# README 多語言化（zh-TW 主檔＋en／zh-CN／ja／ko 切換）

> 純文件任務，不動任何程式碼與部署。比照使用者另一 repo（pv-signal-monitor）的多 README 模式。

## 1. 檔案結構

- `README.md`：維持繁體中文為正本（內容不改動，只在標題下方加語言切換列）。
- 新增 `README.en.md`（English）、`README.zh-CN.md`（简体中文）、`README.ja.md`（日本語）、`README.ko.md`（한국어）——各為 README.md 的**完整全文翻譯**，結構、章節、表格、mermaid 圖一一對應。
- 五個檔案頂部（主標題下）皆放同一條切換列，當前語言不帶連結、其餘四個為相對連結：
  `**繁體中文** | [English](README.en.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)`（各檔粗體位置對應自身語言）。

## 2. 翻譯規則（硬性）

- 專業母語水準，禁止機翻腔；語氣與正本一致（工程文件、精確、不浮誇）。
- **不翻譯**：程式碼區塊、指令、檔名、路徑、環境變數、API 端點、cron 表達式、表格內的英文技術值（`clinical`/`bd` 等 enum）、產品專名「艾爾水晶」保留原文並於首次出現附音譯（en: "Aiur Crystal"；ja: アイウル・クリスタル；ko: 아이우르 크리스털；zh-CN: 艾尔水晶）。
- mermaid 圖節點文字翻譯、語法不動；Markdown 錨點連結全部維持相對路徑有效。
- zh-CN 不是純簡繁轉換：用語在地化（「文件→文件」「資料庫→数据库」「介面→界面」「專案→项目」等）。
- ja 用です・ます調；ko 用합니다體。
- 版本號、測試數、URL、Email 等事實五檔一致。

## 3. 驗收（ACCEPTANCE-README-I18N.md）

1. 五檔存在且皆含正確切換列；相對連結檔名互相有效（腳本檢查）。
2. 逐檔驗證：章節數與正本一致、程式碼區塊數一致、表格數一致（結構完整性腳本比對）。
3. 每檔抽 3 段（功能總覽、權限速查表頭、備份表）人工複讀確認語言正確非亂碼。
4. `git diff --check` 乾淨；commit 並 push origin main、以 ls-remote 驗證遠端 hash。
5. 結果如實寫入 ACCEPTANCE-README-I18N.md。

## 4. 紀律

不碰程式碼、不部署、不動 usr_admin 與 secrets；一個 commit 完成五檔＋驗收檔。
