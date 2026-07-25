# v11：TFDA 公告自動抓取（RSS → AI 草稿 → 人工核准）

> 依實測 feed 設計：`https://www.fda.gov.tw/TC/rssAnnouncement.ashx`——RSS 2.0／UTF-8／約 20 則滾動；每則含 `title`、`link`（`newsContent.aspx?cid=3&id=NNNNN`，id 為穩定識別）、`pubDate`（＝公告日）、`description`（**CDATA 內嵌公告全文 HTML**，含表格）。無 guid。

## 1. Schema（migration 0009）

- reg_entries 加欄：`status` TEXT CHECK IN ('published','draft') DEFAULT 'published'；`source` TEXT CHECK IN ('manual','tfda_rss') DEFAULT 'manual'；`source_ref` TEXT NULL（TFDA news id，建立部分唯一索引 `WHERE source_ref IS NOT NULL`）。
- 既有資料 backfill：status='published'、source='manual'。

## 2. 抓取服務（worker/services/tfda.ts）

1. fetch RSS（帶合理 UA；逾時 20s；失敗僅記 log 不拋出）。
2. 輕量解析（自寫，不引入 XML 套件）：逐 `<item>` 取 title／link／pubDate／description；CDATA 與 HTML entity 正確處理。
3. 每則：從 link 抽 `id=NNNNN` 作 `source_ref`；**去重**——(a) `source_ref` 已存在（任一 status）→ skip；(b) `(entry_date, title)` 與既有資料相同 → skip（涵蓋先前手動匯入的同則公告）。
4. description HTML → 純文字（`<table>` 逐列轉「｜」分隔行；其餘標籤剝除；entity 解碼；上限 24k 字元）。
5. AI 加值（走既有單則抽取管線）：產 product_line／category／key_points（含施行日規則與對照表規則沿用 v10）；**entry_date 一律以 RSS pubDate（轉台北日期）為準，AI 不得覆寫**。LLM 失敗 fallback：product_line='其他'、key_points=前 500 字純文字——公告絕不因 AI 掛掉而漏接。
6. 建立條目：status='draft'、source='tfda_rss'、link=公告連結、created_by 系統帳號語意（沿用現行 created_by 欄位放 NULL 或 'system'——擇一並記 DECISIONS，列表顯示「TFDA 自動抓取」）。
7. 回傳統計 {fetched, new_drafts, skipped_ref, skipped_dup, ai_fallback, errors[]}。

## 3. 排程與手動觸發

- 併入每日 cron `0 1 * * *` 的**前置步驟**（獨立 try/catch，失敗寫 log、不影響提醒與 digest）。
- POST `/api/regwatch/tfda-fetch`（can_manage）：手動立即抓取，回傳統計（首次導入與測試用）。
- 抓到 new_drafts>0 → 站內通知 RA/PV 組成員與 admin：「TFDA 新公告 N 則待審核」（Email 併入既有每日 digest 管線）。

## 4. 審核 UI（/regwatch）

- 一般清單（所有讀者）**只顯示 published**；draft 對 member（非 RA/PV）與 intern 完全不可見。
- can_manage 者：工具列顯示「待審核 N」chip（N=0 隱藏），點擊切換到草稿檢視——列以 warn 色邊框＋「TFDA 草稿」badge 標示，展開可看全文重點。
- 草稿列動作：**核准**（status→published）｜**編輯**（既有 drawer；儲存後仍為 draft）｜**刪除**（既有流程）；另提供「全部核准」（confirm 後批次）。
- 工具列加「立即抓取 TFDA」鈕（can_manage；顯示回傳統計 toast）。
- i18n：全部新字串中英齊備，key-parity 測試須綠。

## 5. 測試（vitest ≥8，RSS 用本次實測存檔的 fixture）

RSS 解析（含 CDATA／entity／表格轉行）、link id 抽取、pubDate→台北日期、雙重去重（source_ref 與 (date,title)）、AI fallback 草稿、draft 可見性權限矩陣、cron 前置步驟失敗隔離、i18n parity。

## 6. 驗收（ACCEPTANCE-V11.md；不碰 usr_admin 與 secrets）

1. typecheck／test／build 全綠；migration 0009 remote（backfill 筆數）；deploy 成功。
2. **對真實 TFDA feed** 手動觸發：統計如實記錄；產生的草稿為**真實業務資料，一律保留不得刪除**、不得代使用者核准。
3. 核准流程以**合成 fixture 草稿**驗證（核准→published→一般清單可見），驗畢清除該合成筆。
4. 二次觸發 → new_drafts=0（去重生效）。
5. 迴歸：未登入 401、一般清單筆數＝published 數、demo member（BD 組）看不到草稿、title。
6. README／help 更新；DECISIONS 增量；結果如實寫入 ACCEPTANCE-V11.md。

## 7. 紀律

同 SPEC-V4 §6。commit：migration→解析服務→cron/手動觸發→審核 UI→驗收。真實草稿保留給使用者審核是硬規則。
