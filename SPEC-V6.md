# 艾爾水晶-專案進度 v6：團隊帳號開通＋QA 模組＋CCR 變更管制＋OKR＋法規動態＋批次匯入

> 增量規格，疊在 SPEC.md～SPEC-V5.md 之上；未提及行為不變。本版依據對六份實際追蹤表（QA OKR／BD Allan／Josh 法規資檔／RA tracking／BD&MA Dennis／BD 總表）的結構分析設計，欄位對應以本檔為準。

## 0. 前置任務：建立四位同事帳號並寄邀請信（最先做）

| id | 姓名 | Email | role | group | 職稱 |
|---|---|---|---|---|---|
| usr_michael | Michael | michael@uicgroup.com.tw | admin | grp_general | 總經理 |
| usr_dennis | Dennis | dennis@uicgroup.com.tw | member | grp_general | 處長 |
| usr_allan | Allan | allan@uicgroup.com.tw | member | grp_clinical | 醫藥學術副理 |
| usr_elvia | Elvia | elvis@uicgroup.com.tw | member | grp_qa | 品保經理 |

- 每人產生獨立臨時密碼（格式 `Aiur-` ＋ 10 位隨機英數，排除易混字元），以產品同款 PBKDF2 雜湊直接 INSERT OR IGNORE 進正式 D1：must_change_password=1、approval_status='approved'、is_active=1、is_demo=0、onboarding_done=0。
- 逐一以 AgentMail 寄邀請信（主旨 `[艾爾水晶] 邀請你加入專案進度平台`；內文繁中：邀請語、網址 https://projects.uic-ai.com、帳號、臨時密碼、「首次登入須改密碼，之後有功能導覽」、身分職稱）。
- **臨時密碼只允許存在於寄出的信件中**：不得寫入任何檔案、log、commit、ACCEPTANCE。驗收證據＝D1 read-back 四筆帳號欄位（不含 hash）＋四個 AgentMail message_id。
- Email 依上表原樣使用（elvis@ 拼法是使用者提供的既有信箱）。

## 1. Schema（migrations/0005_v6.sql）

- groups.type CHECK 加入 `'qa'`（SQLite 需 table rebuild：新表→搬資料→改名，保留外鍵行為）；`UPDATE groups SET type='qa' WHERE id='grp_qa'`。
- projects 加欄：`external_key` TEXT NULL UNIQUE（匯入冪等用）。
- 新表 `licenses`(id pk, project_id→projects, name, subject /*標的：公司/廠/產品*/, authority DEFAULT 'TFDA', license_no NULL, issued_at NULL, expires_at, status CHECK IN ('有效','換證中','已過期','已停用') DEFAULT '有效', note, created_by, created_at, updated_at)。
- 新表 `ccr_records`(id pk, project_id, ccr_no UNIQUE /*CCR-YYYY-NNN 自動遞增*/, title, target_type CHECK IN ('產品','文件','供應商','製程','設備','其他'), description, reason, classification CHECK IN ('重大','次要'), impact_assessment NULL, status CHECK IN ('申請','評估中','已核准','執行中','效期確認','已結案','駁回') DEFAULT '申請', requested_by, approved_by NULL, requested_at, approved_at NULL, closed_at NULL, note, created_at, updated_at)。
- 新表 `ccr_events`(id pk, ccr_id→ccr_records, event_type /*狀態變更/備註*/, from_status NULL, to_status NULL, description, created_by, created_at)。
- 新表 `key_results`(id pk, project_id, title, owner_id NULL, quarter /*'2026Q1'格式*/, status CHECK IN ('未開始','進行中','完成','暫停') DEFAULT '未開始', note, position INT, created_at, updated_at)。
- 新表 `project_quarter_goals`(id pk, project_id, quarter, objective, UNIQUE(project_id, quarter))。
- 新表 `reg_entries`(id pk, entry_date, entry_type CHECK IN ('announcement','meeting') DEFAULT 'announcement', product_line CHECK IN ('藥品','醫療器材','化粧品','健康食品','食品','再生醫療','包裝容器','寵物食品','其他'), category NULL, title, key_points NULL, link NULL, created_by, created_at, updated_at)。

## 2. QA 專屬模組（group type='qa' 的專案頁顯示「QA」籤）

### 2a. 證照與系統效期登記簿
- 表格：名稱／標的／主管機關／證號／效期迄日／狀態／備註；新增、編輯、刪除（canEditProgress 集合）。
- 效期倒數 badge：>180 天綠、≤180 黃、≤90 橘、≤30 紅、逾期深紅「已過期」。列表依效期近→遠排序。
- 每日 cron 併入既有 digest：距到期 90／60／30／7 天與逾期當日 → 通知專案 owner＋QA 組全員（站內＋Email）。同一證照同一里程碑只通知一次（記 last_notified_stage 或以天數精確比對）。
- 儀表板（QA 組成員與 admin 可見區塊）：「證照效期警示」卡列出 ≤90 天者。

### 2b. CCR 變更管制登記簿
- 新增 CCR 表單：標題／標的類型／變更說明／原因／分級／影響評估。`ccr_no` 由系統依年度自動編號（CCR-2026-001…，取當年度最大號+1，用 D1 交易避免重號）。
- 狀態流轉按鈕依當前狀態顯示合法下一步：申請→評估中→(已核准|駁回)；已核准→執行中→效期確認→已結案。每次流轉寫 ccr_events（含操作者），核准時記 approved_by/approved_at，結案記 closed_at。
- 駁回與已結案為終態（不可再流轉）；admin 可例外重開（記事件）。
- 清單：狀態／分級／標的類型篩選＋關鍵字；CSV 匯出（沿用既有匯出模式）。
- 里程碑連動：CCR 進入「效期確認」→ 自動為 requested_by 建一筆 todo「CCR 效期確認：{title}」（due 30 天後）。

## 3. OKR 層（所有組別通用，專案總覽新增「OKR」區塊）

- 季度目標：每季一句 objective（project_quarter_goals），區塊頂部季度切換（預設當季，Asia/Taipei 判定）。
- Key Results 清單：標題／負責人／季度／狀態下拉／備註；可拖拉排序；完成打勾。
- auto 進度模式的分母分子**納入 KR**（tasks+milestones+關聯 todos+key_results，其中 KR 完成=status '完成'）。
- 儀表板加「本季 KR」小卡：目前季度 KR 完成/總數（僅統計使用者可見專案）。

## 4. 法規動態（全域頁 /regwatch，導覽列「法規動態」）

- 全員（含 intern）可讀；**RA/PV 組成員與 admin 可新增／編輯／刪除**（RA/PV 組＝group id `grp_general`）。
- 欄位：日期／類型（法規公告|外部會議）／產品線／類別（自由短標籤）／標題／重點（多行，支援換行顯示）／連結。
- 篩選列：產品線下拉、類型、年份、關鍵字（title＋key_points LIKE）；預設日期倒序，分頁每頁 50。
- 列表列可展開看完整重點；新增／編輯用 drawer。
- /help 與導覽補一步。

## 5. 批次匯入（admin）

- POST `/api/admin/import`（admin only，body 上限 5 MB）。JSON schema 完整文件寫到 repo 根 `IMPORT.md`：
  - `projects[]`：external_key(冪等鍵，必填)、name、group(組名或id)、owner_email、visibility、status、progress、goal_summary、start_date、target_date、quarter_goals[]、key_results[]（title/owner_email/quarter/status）、stages[]（字串陣列，省略用組別預設模板）、tasks[]（title/stage/assignee_email/due_date/done）、progress_updates[]（date/content/author_email）、clinical{target_n, enrollments[]}、licenses[]、ccrs[]（含 status 直接落點與歷程略）。
  - `reg_entries[]`：entry_date/entry_type/product_line/category/title/key_points/link，冪等鍵＝(entry_date,title) 相同即 skip。
- 行為：external_key 已存在 → 更新專案欄位、子項以「不存在才建」處理（progress_updates 以 (date, content 前 40 字) 判重）；owner/assignee/author 的 email 對不到使用者 → 改掛執行的 admin 並在該筆 content/note 前加「【原負責人：{email}】」。日期一律 YYYY-MM-DD。
- 回應統計：{projects: {created, updated}, tasks: {...}, progress_updates: {...}, reg_entries: {created, skipped}, warnings[]}。
- `/admin` 新增「批次匯入」卡：貼上 JSON → 前端先本地 parse 顯示統計預覽 → 確認執行 → 顯示回應報告。匯入寫 audit_log（summary 含統計）。

## 6. 驗收（ACCEPTANCE-V6.md；全用 demo 或本規格新建帳號，不碰 usr_admin）

1. §0 四帳號 D1 read-back（不含 hash 欄）＋四封邀請信 message_id；重跑 INSERT 確認 OR IGNORE 冪等。
2. typecheck／test（新增 vitest ≥20：CCR 編號遞增與狀態機、license 到期通知天數判定、KR 納入 auto 進度、import 冪等與 email 對應 fallback、regwatch 權限）／build 全綠。
3. migration 0005 remote 套用；groups.type='qa' 生效且既有 QA 模板不受影響。
4. deploy 成功；迴歸（未登入 401、intern 視野、title）。
5. E2E（正式站）：QA 專案建 license（到期 25 天）→ 儀表板警示卡出現＋cron handler 單測覆蓋通知天數；CCR 完整流轉申請→…→已結案（歷程逐筆落 ccr_events、編號 CCR-2026-001 起）；OKR：建季度目標＋2 筆 KR→完成 1 筆→auto 進度分母含 KR 且數字正確；regwatch：RA/PV member 建 1 筆、intern 讀 200 寫 403；import：迷你 JSON（1 專案+2 更新+2 reg_entries）→ created 統計正確 → 重跑 → skipped/updated 正確。
6. E2E 測試資料清理（帳號§0 四筆為正式資料**保留**）；DECISIONS.md、README、/help 更新；結果如實記錄。

## 7. 紀律

同 SPEC-V4 §6。加：臨時密碼與任何憑證不得出現在檔案／log／commit；elvis@ 拼法照表；不碰 usr_admin 與 secrets。commit 順序建議：帳號開通 → migration → QA 模組 → CCR → OKR → regwatch → import → 驗收。
