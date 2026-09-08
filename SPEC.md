# 專案進度大腦（Project Brain）建置規格 v1

## 0. 一句話目標

給台灣醫藥代理商內部團隊用的「共享專案進度大腦」：所有人登入後在同一個地方看見／更新全公司專案進度，支援組別權限、保密專案、實習生受限視野、看板拖拉、臨床收案追蹤、BD 查驗登記案件與費用管理、AI 摘要與自動提醒。介面全部繁體中文。

## 1. 環境事實（不要浪費時間重新探索）

- Windows 11、預設 shell 是 PowerShell、Node v24.14.0、npm 可用。
- wrangler **未全域安裝，一律用 `npx wrangler`**（npx 抓到 4.112.0 已驗證可用）。
- Cloudflare OAuth 已登入：bounceto12340@gmail.com、Account ID `a85ac222b1d8c791558116cf369139b6`。權限含 workers / d1 / ai / workers_routes / ssl_certs write、zone read。
- zone `uic-ai.com` 在同一帳號。目標網址 `projects.uic-ai.com`。
- 本目錄已 git init 並有初始 commit。`.dev.vars` 已存在（含機密，**已被 .gitignore 排除；絕不能 commit、絕不能把值寫進任何會被 commit 的檔案、絕不能印在 log/README**）。

## 2. 技術棧（固定，不要換）

- 單一 Cloudflare Worker + Workers Static Assets（**不要用 Pages**）。
- 後端：Hono ^4 + TypeScript，API 全掛 `/api/*`。
- DB：D1（SQLite），名稱 `project-brain-db`，用 `npx wrangler d1 migrations` 管理（raw SQL，不用 ORM）。
- 前端：React 18 + Vite + TypeScript + Tailwind CSS ^3.4（PostCSS 建置，不用 CDN）+ react-router-dom ^6。
- 拖拉：@dnd-kit/core + @dnd-kit/sortable。圖表：recharts。
- 測試：vitest（純函式單元測試）。
- 時區：介面顯示一律 Asia/Taipei。

### wrangler.jsonc 骨架（database_id 建好後填入）

```jsonc
{
  "name": "project-brain",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "project-brain-db", "database_id": "<待填>" }],
  "ai": { "binding": "AI" },
  "triggers": { "crons": ["0 1 * * *", "30 0 * * 1"] },
  "routes": [{ "pattern": "projects.uic-ai.com", "custom_domain": true }],
  "vars": {
    "APP_BASE_URL": "https://projects.uic-ai.com",
    "LLM_BASE_URL": "https://api.deepseek.com/v1",
    "LLM_MODEL": "deepseek-v4-pro",
    "AGENTMAIL_INBOX_ID": "uic_ai@agentmail.to",
    "MAIL_FROM_NAME": "專案進度大腦"
  },
  "observability": { "enabled": true }
}
```

- Secrets（部署後設定，值從 `.dev.vars` 取）：`LLM_API_KEY`、`AGENTMAIL_API_KEY`。用 PowerShell 讀取 `.dev.vars` 對應行、把值以 pipeline 傳給 `npx wrangler secret put <NAME>`，過程不得把值印出。
- 若 `custom_domain` 部署因權限失敗：最多重試 1 次，然後移除 routes 改部署到 workers.dev，並在 DECISIONS.md 記錄「網域待手動綁定」。不要為此卡住超過 10 分鐘。

## 3. 角色、組別、權限（整個系統的核心，先做對）

- 角色：`admin`（管理員）、`member`（正職成員）、`intern`（實習生）。
- 組別（groups）：admin 可增刪改。`type` 決定專案頁顯示哪個專屬模組：`clinical`（臨床收案模組）、`bd`（BD 查驗登記模組）、`general`（無專屬模組）。種子：臨床組(clinical)、BD組(bd)、RA/PV組(general)。
- 專案可見性 `visibility`：`all`（全公司登入者可見）、`group`（僅同組＋被加入的成員）、`private`＝保密（僅 owner＋project_members＋admin）。

**權限判斷必須集中在 `worker/services/permissions.ts` 的純函式**（`canViewProject` / `canEditProgress` / `canManageProject`），所有 API 都經同一套函式，並寫 vitest 全組合矩陣測試：

- admin：看全部、改全部。
- intern：**無論 visibility 為何，只看得到自己被加入 project_members 的專案**；在這些專案內可以填進度。列表、儀表板、報表對 intern 都只彙整他看得到的專案。
- member 檢視：`all` → 可看；`group` → 同組或為成員；`private` → 為成員或 owner。
- 填寫進度（新增進度紀錄／任務／看板拖拉／收案數／BD 事件）＝「同組支援」：admin、owner、project_members、以及**與專案同組的 member**。
- 專案設定（改可見性／成員／歸檔／刪除）：admin 或 owner。
- 費用金額（bd_fees）：僅 admin、專案 owner、與專案同組成員可見；其他人在任何 API 回應中都不得收到金額欄位。
- 未登入 → 一律 401。前端路由全部包在登入保護內。

## 4. 認證

- Email＋密碼。admin 在管理頁建立帳號（姓名／Email／組別／角色／初始密碼）；無自助註冊。
- 密碼雜湊：WebCrypto PBKDF2-SHA256、100000 iterations、16-byte random salt，格式 `pbkdf2$100000$<salt_b64>$<hash_b64>`。
- Session：登入產 32-byte random token，**DB 存 SHA-256(token)**，cookie 存原值：`sid`，HttpOnly、Secure、SameSite=Lax、Path=/、30 天滾動延長。登出刪 session。
- `must_change_password=1` 的帳號登入後強制導向改密碼頁，改完才能用其他功能。admin 重設密碼＝設臨時密碼＋該旗標。
- 防護：同帳號連續 5 次失敗 → 鎖 15 分鐘（DB 記 failed_count / locked_until）。所有寫入 API 檢查 Origin header 同源。密碼至少 8 碼。

## 5. 資料模型（migrations/0001_init.sql 起步；snake_case；id 用 nanoid 風格隨機字串）

- users(id pk, email unique, name, password_hash, role, group_id→groups, must_change_password int def 1, email_notifications int def 1, is_active int def 1, is_demo int def 0, failed_count int def 0, locked_until text null, created_at, updated_at)
- groups(id pk, name unique, type check in ('clinical','bd','general'))
- sessions(id pk /*sha256(token)*/, user_id→users, expires_at, created_at)
- projects(id pk, name, description, group_id→groups, owner_id→users, visibility check in ('all','group','private') def 'group', status check in ('active','paused','done','archived') def 'active', progress int def 0, goal_summary, start_date, target_date, auto_archive int def 1, archived_at, is_demo int def 0, last_activity_at, created_at, updated_at)
- project_members(project_id, user_id, added_by, created_at, unique(project_id,user_id))
- stages(id pk, project_id, name, color, position int)
- stage_templates(id pk, name, group_id null, stages_json)
- tasks(id pk, project_id, stage_id→stages, title, description, assignee_id null, due_date null, position int, created_at, updated_at)
- milestones(id pk, project_id, title, due_date, done int def 0, done_at, position int)
- progress_updates(id pk, project_id, author_id, content, progress_snapshot int null, created_at)
- clinical_settings(project_id pk, target_n int)
- clinical_enrollments(id pk, project_id, record_date, site null, count int /*當日新增*/, note, created_by, created_at)
- bd_cases(id pk, project_id, case_name, product_name, case_type, submission_no null, current_status check in ('準備文件','已送件','審查中','補件中','核准','結案') def '準備文件', submitted_at null, expected_approval null, note, created_at, updated_at)
- bd_case_events(id pk, case_id→bd_cases, event_date, event_type, description, created_by, created_at)
- bd_fees(id pk, project_id, case_id null, fee_date, category check in ('規費','顧問費','檢驗費','其他'), amount real, currency def 'TWD', note, created_by, created_at)
- todos(id pk, user_id, title, due_date null, done int def 0, done_at, project_id null, created_at)
- notifications(id pk, user_id, type, title, body, link, read int def 0, created_at)
- audit_log(id pk, user_id, action, entity_type, entity_id, summary, created_at)
- ai_reports(id pk, period_start, period_end, scope /*'all' 或 group_id*/, content_md, created_at)

每次寫入 projects 相關資料時更新 `projects.last_activity_at`。重要寫入（建／刪／改權限／歸檔／代填進度）記 audit_log。

## 6. 頁面與功能（前端全繁中）

- `/login`；強制改密頁。
- `/` 儀表板：KPI 卡（進行中專案數、逾期里程碑數、今日待辦、本週更新數）＋各組專案進度條總覽（點擊進專案）＋最近動態 feed（最新 progress_updates）＋圖表（recharts）：各組專案狀態堆疊長條、臨床收案累計 vs 目標折線、BD 費用月別長條。一切只彙整**當前使用者看得到**的專案。
- `/projects`：清單＋篩選（組別／狀態／關鍵字）；卡片顯示進度條、owner、目標日、保密鎖頭圖示；「新增專案」（member 以上；選組別／可見性／套用階段模板）。
- `/projects/:id` 分頁籤：
  - 總覽：goal_summary、progress% 滑桿（更新時自動寫一筆 progress_update 快照）、里程碑清單（新增／勾完成／逾期紅字）、成員管理與可見性設定（owner/admin）、歸檔／還原。
  - 看板：stages 直欄可**拖拉排序**、可新增／改名／刪除（刪除須先搬走卡片）；tasks 卡片可跨欄拖拉與欄內排序（@dnd-kit，樂觀更新，PATCH position）。
  - 進度紀錄：timeline（顯示填寫人與時間；author 非 owner 時標示「由某某支援填寫」）＋新增框＋「AI 快寫」鈕（§7）。
  - 臨床（僅 clinical 組專案顯示）：收案目標 target_n 設定、逐日收案數登錄（日期／中心／人數／備註）、累計 vs 目標折線圖、依中心小計表。
  - BD（僅 bd 組專案顯示）：查驗登記案件卡（案名／產品／類別／送件號／目前狀態下拉／送件日／預計核准日）＋案件歷程 timeline（送件、補件通知、補件送出、核准…）＋費用紀錄表（新增／列表／小計，含類別與幣別）。
- `/reports`：期間選擇（本週／上週／本月／自訂）＋組別篩選 → 彙整視圖（各專案進度變化、完成任務數、新增收案、BD 事件、費用小計）；AI 週報列表與內文（markdown 渲染）；「匯出 CSV」（費用、收案）；列印友善 CSS（@media print）。
- `/todos`：我的每日工作項目（新增／勾選／到期日，可關聯專案）；「今日」「逾期」「未排程」分組。
- `/notifications`：通知中心；導覽列鈴鐺含未讀數，點擊標記已讀並跳 link。
- `/admin`（admin only）：使用者管理（建帳號／停用／重設密碼／改組別角色）、組別管理、階段模板管理、audit log 檢視（分頁）、「清除示範資料」鈕（刪 is_demo=1 的 users / projects 及其關聯）。
- `/profile`：改密碼、Email 通知開關。
- 導覽列：儀表板／專案／報表／待辦／通知／管理(admin)／個人；顯示目前使用者名與組別；登出。
- 設計方向：乾淨專業的內部工具風，主色靛藍系，淺色主題即可；不引入元件庫（自寫 Tailwind 元件）；RWD 到平板即可。
- 階段模板種子：「BD 查驗登記流程」（準備文件→送件→審查中→補件→核准領證→結案）、「臨床試驗流程」（啟動準備→IRB 送審→收案中→結案→報告）、「一般專案」（待辦→進行中→完成）。

## 7. AI 功能（worker/services/llm.ts 統一入口）

- `llmChat(env, messages, {json?})`：若 `env.LLM_API_KEY` 存在 → POST `${LLM_BASE_URL}/chat/completions`（OpenAI 相容，model=`LLM_MODEL`，`Authorization: Bearer`）。否則 fallback `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', ...)`。逾時 60s、失敗重試 1 次。需要 JSON 時用寬鬆解析（剝 ```json fence、取第一個 `{` 到最後一個 `}`），解析失敗要優雅降級，不可 crash。 送 `json: true` 的提詞裡一律要出現「json」這個字——DeepSeek 的 JSON 模式硬性要求，缺了會偶爾回空內容，而空內容在這裡是拋例外不是降級。
- AI 快寫：POST `/api/ai/draft-update` {raw_text, project_id} → 以繁中整理成「本期進展／風險或阻礙／下一步」條列 markdown 回前端，使用者可編輯後才存成 progress_update。
- AI 週報：週一 cron（`30 0 * * 1` UTC＝台北週一 08:30）彙整上週（台北時間週一 00:00 至週日 24:00）：各專案進度變化、progress_updates 摘要、完成任務數、臨床新增收案、BD 案件事件與費用小計 → 產生全公司＋每組的繁中 markdown 週報 → 存 ai_reports → 通知全員。/reports 可讀。admin 有「立即重新產生」鈕。**LLM 失敗時存純數據版週報（無 AI 摘要文字），照樣通知。**
- 每日提醒文案用模板字串即可，不必每封過 LLM（省額度、避免延遲）。

## 8. 自動化（scheduled handler 依 event.cron 分流）

每日 cron（`0 1 * * *` UTC＝台北 09:00）：

1. 逾期與 3 日內到期的 milestones → 通知 owner＋project_members。
2. 今日到期／逾期 todos → 通知本人。
3. BD：expected_approval 7 日內 → 通知同組；current_status='補件中' 且最後 case_event 超過 14 天 → 停滯提醒。
4. 停滯專案：active 且 last_activity_at 超過 21 天 → 通知 owner＋同組「專案停滯」。
5. 自動歸檔：status='done' 且 last_activity_at 超過 14 天 且 auto_archive=1 → 設 archived＋archived_at＋通知 owner（專案頁可一鍵還原）。
6. **Email 彙整**：以上通知對 email_notifications=1 的使用者，彙整成**每人一封**「[專案進度大腦] 今日提醒」（條列＋APP_BASE_URL 連結）寄出。

Email 寄送 `worker/services/mailer.ts`：POST `https://api.agentmail.to/v0/inboxes/${AGENTMAIL_INBOX_ID}/messages/send`，headers `Authorization: Bearer ${AGENTMAIL_API_KEY}`、`Content-Type: application/json`，body `{to, subject, text, html?}`（回應含 message_id；inbox `uic_ai@agentmail.to` 已實測有效）。**AGENTMAIL_API_KEY 未設時：跳過寄信只留站內通知並 log 一行，不可拋錯。**站內通知永遠都建，Email 是加值。

- admin-only POST `/api/admin/test-email`：寄測試信給當前 admin 的 email，回傳 AgentMail 回應（驗收用）。

## 9. API 概要（Hono，全部 `/api` 前綴，JSON；未列者依 REST 慣例補齊）

- auth：POST /auth/login、POST /auth/logout、GET /auth/me、POST /auth/change-password
- projects：GET /projects（篩選＋只回可見）、POST /projects、GET/PATCH/DELETE /projects/:id、POST /projects/:id/archive|unarchive、GET/POST/DELETE /projects/:id/members
- stages/tasks：POST /projects/:id/stages、PATCH/DELETE /stages/:id（含 position）、POST /projects/:id/tasks、PATCH/DELETE /tasks/:id（含 stage_id＋position 拖拉）
- milestones、progress-updates、clinical（settings / enrollments）、bd（cases / events / fees）、todos、notifications（GET、POST /read、POST /read-all）
- reports：GET /reports/summary?from&to&group、GET /reports/ai、POST /reports/ai/regenerate（admin）
- ai：POST /ai/draft-update
- admin：users CRUD、groups CRUD、templates CRUD、audit-log、POST /admin/clear-demo、POST /admin/test-email
- GET /api/health
- 中介層：session 驗證、權限檢查（§3 純函式）、寫入時 Origin 檢查、統一錯誤格式 `{error: string}`（401/403/404/422）。

## 10. 種子資料（除 admin 與組別外一律 is_demo=1）

- 組別：臨床組(clinical)、BD組(bd)、RA/PV組(general)。
- admin：email `bounceto12340@gmail.com`、姓名「管理者」、RA/PV組、初始密碼 `Brain-2026!`、must_change_password=1。
- demo 帳號（must_change_password=0、is_demo=1、密碼同上）：臨床組 member「林曉臨」clinical1@demo.local、「陳收案」clinical2@demo.local；BD組 member「王必達」bd1@demo.local；實習生「李實習」intern1@demo.local（僅加入其中 1 個臨床專案）。
- 示範專案 4 個（is_demo=1）：臨床收案專案（target_n=60、數筆逐日收案、里程碑、看板）、BD 查驗登記案（案件＋2 筆歷程＋2 筆費用）、RA/PV 例行專案（visibility=all）、保密專案（visibility=private，僅 owner＋admin）→ 驗證權限用。
- 各 demo 專案要有幾筆 progress_updates（含一筆「同組代填」的例子）。

## 11. 驗收清單（全部跑過並把結果寫進 ACCEPTANCE.md 才算完成）

1. `npm run typecheck`、`npm test`（vitest ≥20 個：權限矩陣全組合、PBKDF2 hash/verify 往返、JSON 寬鬆解析、每日提醒彙整函式）、`npm run build` 全綠。
2. `npx wrangler d1 migrations apply project-brain-db --remote` 成功。
3. `npx wrangler deploy` 成功；記下實際網址（projects.uic-ai.com 或 fallback workers.dev）。
4. 部署後 secrets 設定完成（LLM_API_KEY、AGENTMAIL_API_KEY；從 .dev.vars 取值 pipe 進 `npx wrangler secret put`，不得把值印進 log 或 commit）。
5. curl 冒煙（對正式網址）：GET /api/health 200；未登入 GET /api/projects 401；admin 登入取 cookie → GET /api/projects 看得到全部示範專案；intern 登入 → 只看得到 1 個；admin GET 保密專案 200、BD member GET 保密專案 403。
6. POST /api/admin/test-email（admin cookie）→ 200 且回應含 message_id（真寄一封到 bounceto12340@gmail.com）。
7. POST /api/ai/draft-update 用一段中文雜記實測 → 回傳條列摘要（驗證 Ollama 直連可用）。
8. GET / 回 200 且是 SPA index.html。
9. 以上每項的指令與結果摘要寫入 ACCEPTANCE.md；未過項目如實記錄，不得宣稱完成。

## 12. 工作紀律

- 依序小步 commit：scaffold → migrations+seed → auth → permissions+tests → projects/stages/tasks API → 前端骨架與登入 → 各頁 → clinical/BD 模組 → cron+mailer+AI → deploy+驗收。commit 訊息用英文 conventional commits。
- 規格沒寫到的細節：選最簡單合理的方案，記錄在 DECISIONS.md（一行一條）。**不要中途停下來問問題**（本次為非互動執行）。
- 同一個錯誤連續修 3 次修不掉：換方案並記錄，不要無限重試。
- 禁止：把 .dev.vars 或任何 key 值寫進可 commit 的檔案；引入未列出的重型依賴（UI 元件庫／ORM／狀態管理庫）；用 Pages；改用其他雲。
- Windows / PowerShell 環境：指令用 PowerShell 語法；路徑用絕對路徑較穩。
- 最後在 README.md 寫操作說明：登入與帳號管理、權限規則速查表、如何建組別／模板、cron 排程說明、如何更換 LLM 模型（改 vars.LLM_MODEL redeploy）、如何補綁網域（若 fallback）。
