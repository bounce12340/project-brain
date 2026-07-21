# 艾爾水晶-專案進度 v2 建置規格

> 本檔是 v1（SPEC.md，已全數上線）之上的增量規格。v1 未被本檔修改的行為一律保持不變。開工前先讀 SPEC.md 掌握既有架構。

## 0. 本次十項目標

1. 新增「QA組」組別。
2. 待辦與專案連動：完成關聯待辦，專案進度自動前進（自動進度模式）。
3. 首次登入互動導覽（可略過）＋常駐功能說明頁，讓新人快速理解每個按鈕與操作流程。
4. 全站改名「**艾爾水晶-專案進度**」（致敬星海爭霸神族：在水晶中共同感知）。
5. 任務多視圖切換：看板（Kanban）／清單（List）／日曆（Calendar）。
6. 甘特圖／時間軸：呈現專案起訖、任務起訖與任務依賴關係。
7. 任務留言與 @提及：集中討論、提及即通知。
8. 檔案共享：專案／任務層級附件（R2）。
9. 流程自動化規則引擎：「當…就…」。
10. AI 智慧功能：任務摘要、專案風險預測、自動排程建議。

## 1. 環境事實（已為你準備好，不要重做）

- v1 已部署於 https://projects.uic-ai.com，一切綠燈（見 ACCEPTANCE.md）。repo 乾淨、遠端 D1 已套用 0001/0002。
- **R2 bucket `project-brain-files` 已建立完成**，wrangler token 具 R2 權限。請在 wrangler.jsonc 加：
  `"r2_buckets": [{ "binding": "FILES", "bucket_name": "project-brain-files" }]`
- secrets／.dev.vars／cron／domain／worker name 一律不動。
- **本次冒煙驗收全程使用 demo 帳號（bd1／clinical1／clinical2／intern1@demo.local，密碼 Brain-2026!）。不得登入或重設 admin（bounceto12340@gmail.com）；其 must_change_password=1 狀態必須原封不動。**

## 2. 改名規範（目標 4）

- 導覽列品牌字：**艾爾水晶**；瀏覽器 title 與登入頁主標：**艾爾水晶-專案進度**；登入頁副標：「如同卡拉，讓團隊在水晶中共同感知每個專案的脈動」。
- `vars.MAIL_FROM_NAME` 改為 `艾爾水晶-專案進度`；所有 Email 主旨前綴 `[艾爾水晶]`。
- README、/help、導覽文案同步改名。**不改** worker name、網域、repo 目錄名、D1/R2 資源名。

## 3. Schema v2（migrations/0003_v2.sql，一個 migration 完成）

- `INSERT INTO groups` 新增 **QA組**（type `general`，固定 id `grp_qa`，INSERT OR IGNORE）。
- projects 加欄：`progress_mode` TEXT CHECK IN ('manual','auto') DEFAULT 'manual'、`risk_level` TEXT NULL、`risk_summary` TEXT NULL、`risk_updated_at` TEXT NULL。
- tasks 加欄：`done` INTEGER DEFAULT 0、`done_at` TEXT NULL、`start_date` TEXT NULL。
- 新表 `task_dependencies`(task_id, depends_on_task_id, created_at, UNIQUE(task_id, depends_on_task_id))。
- 新表 `task_comments`(id pk, task_id, author_id, content, created_at)。
- 新表 `files`(id pk, project_id, task_id NULL, filename, size INTEGER, content_type, storage_key, uploaded_by, created_at)。
- 新表 `automation_rules`(id pk, project_id, name, trigger_type CHECK IN ('task_done','task_moved_to_stage','milestone_done','progress_reached'), trigger_param TEXT NULL, action_type CHECK IN ('notify_user','assign_task_to','create_todo_for','log_update'), action_param_user TEXT NULL, action_param_text TEXT NULL, enabled INTEGER DEFAULT 1, created_by, created_at)。
- users 加欄：`onboarding_done` INTEGER DEFAULT 0。

## 4. 專案頁資訊架構重構

分頁籤改為：**總覽｜任務｜進度紀錄｜（臨床／BD 專屬模組，維持 v1）｜檔案｜自動化**。

「任務」籤內含視圖切換 pills：**看板｜清單｜日曆｜甘特**（偏好記在 localStorage，預設看板）。v1 看板功能原樣搬入，不得退化（拖拉、階段管理都要保留）。

### 任務抽屜（Drawer）

看板卡片與清單列點擊 → 右側抽屜：標題／描述編輯、負責人、start_date／due_date、完成勾選、依賴設定（多選其他任務，**偵測並拒絕循環依賴**）、留言串、附件清單＋上傳、「AI 摘要」鈕。

## 5. 十項功能詳規

### 5.1 QA組
migration 種子即可；/admin 組別管理原本就能維護。

### 5.2 待辦連動專案進度（自動進度模式）
- 專案總覽的進度區塊加「進度模式」切換：手動（v1 滑桿）／自動。**新建專案預設 auto**；既有專案維持 manual。
- auto 演算法：`progress = round(100 × 已完成數 ÷ 總數)`，母數 = 該專案全部 tasks + milestones + 關聯 todos（project_id 指向該專案者）；母數為 0 → 維持現值。變動觸發點：task done 切換、milestone done 切換、關聯 todo done 切換、以上物件之新增刪除。
- auto 模式下完成任一項目：更新 progress 與 last_activity，並寫一筆 progress_update（author 為操作者，內容如 `✔ 完成待辦「追蹤台中合約」（進度 62%）`），儀表板動態與通知照 v1 邏輯流動。
- 待辦頁（/todos）新增顯示所屬專案名與完成後的進度回饋 toast。

### 5.3 首次導覽＋功能說明（目標 3）
- 自製 spotlight tour 元件（遮罩＋聚焦框＋文字泡泡＋「下一步／略過」），無第三方套件。
- 首次登入（onboarding_done=0）自動啟動，8～12 步：導覽列各項 → 儀表板 KPI → 專案卡 → 專案頁分頁籤 → 任務視圖切換 → 抽屜 → 自動化 → 通知鈴鐺。步驟文案繁中、每步 ≤ 40 字。完成或略過 → PATCH onboarding_done=1。
- 導覽列加「？」→ `/help` 功能說明頁：依頁面分節，每個按鈕／功能一行「是什麼」＋不超過三步的「怎麼用」；頁頂有「重新播放導覽」鈕。內容需與實際 UI 相符（改名後名稱一致）。

### 5.4 多視圖（目標 5）
- **清單**：表格（標題／階段／負責人／起日／訖日／完成勾選），可依欄位排序、依階段與負責人與完成狀態篩選；列點擊開抽屜；完成勾選就地可按。
- **日曆**：自製月曆格線（週一起始），顯示任務（依 due_date）與里程碑；點某日列出該日項目；上下月切換；今日高亮。無 due_date 的任務不出現（清單可查）。
- 兩視圖與看板共用同一資料層，任何一處修改即時反映。

### 5.5 甘特圖（目標 6）
- 「甘特」視圖：自製 SVG。列＝任務；橫條範圍 start_date（缺省用建立日）→ due_date（兩者皆缺 → 以菱形點畫在建立日）；完成任務條色變淡＋勾記。
- 里程碑畫菱形；頂部畫專案起訖範圍條（start_date→target_date）；紅色 today 直線；週刻度、橫向捲動；hover 顯示 tooltip（名稱＋日期）。
- 依賴關係：從前置任務條尾到後繼任務條頭的折線箭頭。
- 另新增全域頁 `/timeline`（導覽列「時間軸」）：當前使用者可見的所有進行中專案各一條橫條（start→target，顯示進度%與風險 badge），同一套 SVG 工具。

### 5.6 留言與 @提及（目標 7）
- 抽屜留言串：時間序、作者名、繁中相對時間；輸入框輸入 `@` 跳出可提及名單（限：能看見該專案的 active 使用者），選取後以 `@姓名` 進入內文。
- 送出後：被提及者收到站內通知（type `mention`，link 直達該任務抽屜；用 query 參數如 `/projects/:id?task=:taskId` 開啟）＋計入每日 Email 彙整。
- 後端以正規化方式儲存提及（解析 @姓名 對照名單，找不到就當純文字），單元測試涵蓋解析。

### 5.7 檔案共享（目標 8）
- 專案「檔案」籤：上傳（拖放或選檔）、列表（檔名／大小／上傳者／時間／所屬任務）、下載、刪除（上傳者本人、owner、admin 可刪）。任務抽屜附件區同功能、自動帶 task_id。
- 上限 25 MB／檔；上傳走 `request.formData()` 存 R2（storage_key = `p/{project_id}/{file_id}/{filename}`）；下載經 Worker 驗 canViewProject 後 stream 回傳（Content-Disposition attachment）；刪除同時刪 R2 物件與資料列。
- 權限沿用專案可見性；audit_log 記上傳與刪除。

### 5.8 自動化規則（目標 9）
- 專案「自動化」籤（owner／admin／同組 member 可管理）：規則清單＋新增表單，句型「當〔任務完成｜任務移入階段 X｜里程碑完成｜進度達 N%〕就〔通知成員 U｜將該任務指派給 U｜為 U 建立待辦（文字）｜寫一筆進度紀錄（文字）〕」，每規則可停用／啟用／刪除。
- 引擎：在 task PATCH（done、stage_id 變更）、milestone PATCH、progress 變更後同步評估該專案 enabled 規則；動作**單層執行**（動作造成的變化不再觸發規則，防迴圈）；`progress_reached` 每條規則只在「跨越門檻向上」時觸發一次（記 last_fired 判斷或以前後值比較）。
- 觸發即寫 audit_log（`automation_fired`，含規則名）；通知類動作照 v1 通知＋Email 彙整管線。
- 「將該任務指派給 U」只對任務類觸發器有效；表單要擋無效組合。

### 5.9 AI 智慧（目標 10；全部走既有 worker/services/llm.ts，失敗優雅降級）
- **任務摘要**：POST `/api/ai/task-summary` {task_id} → 彙整標題／描述／狀態／留言 → 繁中 3 句內摘要＋未決事項條列，顯示於抽屜（不落庫）。
- **風險預測**：POST `/api/ai/project-risk` {project_id} → 輸入：進度 vs 時程消耗比、逾期任務／里程碑數、停滯天數、最近 5 筆進度紀錄摘要 → 回 JSON `{level: 'low'|'medium'|'high', summary, suggestions[]}`（寬鬆解析）→ 存 projects.risk_* 欄。總覽顯示風險 badge（綠／黃／紅）＋摘要＋建議＋「重新分析」鈕；儀表板專案列與 /timeline 顯示 badge。
- **排程建議**：POST `/api/ai/schedule-suggest` {project_id} → 輸入：專案起訖、階段順序、任務清單（含既有日期與依賴） → 為缺日期任務回建議 start/due（JSON 陣列）→ 前端預覽表（任務｜建議起訖｜理由）＋「套用全部」一鍵 PATCH。建議必須落在專案起訖內且不違反依賴先後（後端驗證後才套用）。

## 6. API 增補（沿用 v1 中介層與權限函式；未列細節依 REST 慣例）

- tasks：PATCH 支援 done/start_date；GET 專案任務回傳含依賴、留言數、附件數。
- `/api/tasks/:id/dependencies` POST/DELETE（循環偵測 422）。
- `/api/tasks/:id/comments` GET/POST；`/api/projects/:id/mentionables` GET。
- `/api/projects/:id/files` GET/POST(multipart)；`/api/files/:id/download` GET；`/api/files/:id` DELETE。
- `/api/projects/:id/rules` GET/POST；`/api/rules/:id` PATCH/DELETE。
- `/api/ai/task-summary`、`/api/ai/project-risk`、`/api/ai/schedule-suggest` POST。
- `/api/auth/onboarding-done` POST。
- `/api/timeline` GET（可見進行中專案的 id/name/start/target/progress/risk_level/group）。
- 編輯權限：留言／附件／依賴／完成勾選 = v1 的 canEditProgress 集合；自動化規則管理 = owner/admin/同組 member。

## 7. 效能

- 前端路由改 React.lazy + Suspense 分包，目標最大 JS chunk < 500 kB（gzip 前）；做不到就如實記錄實際數字與原因。

## 8. 驗收清單（全部執行並寫入 ACCEPTANCE-V2.md 才算完成）

1. `npm run typecheck`、`npm test`、`npm run build` 全綠；新增 vitest ≥ 15：自動進度演算、@提及解析、自動化引擎分派與防迴圈、依賴循環偵測、progress_reached 跨越判定、甘特／日曆日期工具。
2. `npx wrangler d1 migrations apply project-brain-db --remote` 成功。
3. `npx wrangler deploy` 成功（含 R2 binding）；若 R2 binding 意外因權限失敗 → fallback KV binding `FILES_KV`（儲存層抽象成 filestore 介面）並如實記錄。
4. 對正式網址 curl 冒煙（**全用 demo 帳號**）：
   a. GET /api/health 200；GET / 的 HTML title 含「艾爾水晶」。
   b. GET /api/groups（登入）含 QA組。
   c. auto 進度：把 prj_bd 切 auto（owner bd1）→ 建一筆關聯待辦 → 完成它 → GET 專案 progress 上升，且 progress_updates 出現 ✔ 紀錄。
   d. 留言 @提及：bd1 在 prj_bd 任務留言 `@管理者`… 改為 `@陳收案`（不得動 admin）→ 陳收案 notifications 出現 mention。
   e. 檔案：上傳一個小檔 → 下載 bytes 與原檔一致 → 刪除成功、R2 物件消失。
   f. 自動化：建規則「任務完成→通知 林曉臨」→ 完成一個任務 → 林曉臨 notifications 出現、audit_log 有 automation_fired。
   g. AI 三端點各實測一次 200 且 JSON shape 正確，記錄 fallback 與否。
   h. v1 迴歸：未登入 /api/projects 401；intern1 列表恰 1 個；bd1 GET prj_private 403。
5. 全程未觸碰 admin 帳號；`SELECT must_change_password FROM users WHERE id='usr_admin'` 仍為 1（只讀確認）。
6. README 與 /help 內容更新為新名稱與新功能；DECISIONS.md 增量記錄。
7. 以上每項指令與結果摘要如實寫入 ACCEPTANCE-V2.md（含失敗與未達成項）。

## 9. 工作紀律（沿用 v1 §12，另加）

- 小步 commit（schema → 任務抽屜與 done → 多視圖 → 甘特/時間軸 → 留言提及 → 檔案 → 自動化 → AI → 導覽/改名/help → 效能分包 → 驗收）。
- 不引入新的重型依賴（日曆、甘特、tour 一律自製；現有 @dnd-kit/recharts 可續用）。
- 不得放寬任何 v1 權限規則；既有資料表欄位語意不變；demo 資料可增添作測試素材。
- 卡住同錯 3 次換方案並記錄 DECISIONS.md；全程不提問。
