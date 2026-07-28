# 🔷 艾爾水晶-專案進度

[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

> 如同卡拉，讓團隊在水晶中共同感知每個專案的脈動。

**正式站**：<https://projects.uic-ai.com>｜**版本**：v12.2｜**測試**：270/270 ✅｜**平台**：Cloudflare Workers

給台灣醫藥代理商（UIC）內部團隊的共享專案進度平台。取代原先分散在六份 Excel 的追蹤方式（BD／RA／QA／臨床各自為政、同一專案被多人重複記錄），把專案、進度、OKR、法規動態、證照效期、變更管制收進同一顆水晶：全員即時共感、權限分級、AI 輔助、自動提醒。

## ✨ 功能總覽

- **專案管理**：組別劃分（BD／臨床／QA／RA-PV）、可見性三級（全公司／同組／保密）、同組互相支援填寫、實習生受限視野、自動／手動進度、里程碑、階段模板
- **任務四視圖**：看板（拖拉）｜清單｜日曆｜甘特（依賴箭頭＋today 線）；任務抽屜把前置依賴排在日期之前，並以最晚到期日的隔天建議起始日，不覆蓋手動修改
- **OKR**：季度目標＋Key Results（負責人／狀態／排序），完成度計入自動進度
- **專屬模組**：臨床收案（目標 vs 累計、逐日登錄）｜BD 查驗登記（案件狀態機、歷程、費用）｜QA 證照效期（到期分級警示＋自動通知）與 CCR 變更管制（`CCR-YYYY-NNN` 狀態機＋歷程）
- **法規動態**：2018 年起 600+ 筆 TFDA 法規知識庫，依公告日期排序並支援產品線／類別／關鍵字篩選；每日自動抓取 TFDA RSS 成為待審草稿，核准後才對全員發布；亦可貼公告文字或合併上傳多檔做 AI 結構化匯入
- **AI 智慧**（Ollama Cloud，deepseek-v4-pro）：進度快寫、任務摘要、專案風險預測、排程建議、週報／月報自動生成
- **自動化**：規則引擎「當…就…」；每日 TFDA RSS 抓取＋提醒、AI 週報（週一）、AI 月報（每月 1 日）三條 cron
- **報表**：組別週報／月報一鍵產生＋列印、CSV 匯出、時間軸組別泳道
- **帳號**：自助註冊＋Email 驗證碼＋管理員核准；管理權移轉（共同管理員／完全移轉）＋最後管理員防呆
- **介面**：星海爭霸神族主題（金＝結構、藍＝能量、切角面板、護盾進度條）、暗色／亮色切換、繁中／English 切換、首次登入導覽與字級切換

## 🏗 系統架構

```mermaid
flowchart LR
  U[瀏覽器 SPA<br/>React + Protoss 主題] -->|HTTPS<br/>projects.uic-ai.com| W[Cloudflare Worker<br/>Hono API + 靜態資產]
  W --> D1[(D1 資料庫<br/>27 張表)]
  W --> R2[(R2 檔案<br/>附件/公告原始檔)]
  W -->|OpenAI 相容| LLM[Ollama Cloud<br/>deepseek-v4-pro]
  W -.->|無 key fallback| WAI[Workers AI<br/>Llama 3.3]
  CRON[Cron ×3<br/>每日/每週/每月] --> W
  W -->|提醒·報告·邀請| MAIL[AgentMail<br/>uic_ai@agentmail.to]
```

## 🧰 技術棧

| 層 | 技術 |
|---|---|
| 前端 | React 18 · Vite · TypeScript · Tailwind CSS · @dnd-kit（拖拉）· Recharts（圖表）· 自製日曆／甘特 SVG |
| 後端 | Cloudflare Workers · Hono · Workers Static Assets |
| 資料 | D1（SQLite，raw SQL migrations）· R2（檔案）· unpdf（PDF 文字層抽取） |
| AI | OpenAI 相容層（Ollama Cloud `deepseek-v4-pro`）＋ Workers AI fallback |
| 郵件 | AgentMail REST API |
| 認證 | PBKDF2-SHA256（WebCrypto）· httpOnly session cookie · Email OTP |
| 測試 | Vitest 270 tests（權限矩陣、狀態機、i18n key parity、theme 對比度、演算法、匯入冪等） |

## 📁 專案結構

```
worker/            # Hono API：routes、middleware、services（permissions/llm/mailer/crypto…）
src/               # React SPA：pages、components、Protoss design tokens
migrations/        # D1 migrations 0001–0011
tests/             # Vitest（＋fixtures）
scripts/           # 各版正式站 E2E 驗收腳本
SPEC*.md           # 各版規格書（開發都由規格驅動）
ACCEPTANCE*.md     # 各版驗收證據（指令與結果原文）
IMPORT.md          # 批次匯入 JSON 合約
BACKUP.md          # 備份與還原手冊
backup.ps1         # 每週自動備份（D1 dump + R2 → OneDrive）
DECISIONS.md       # 實作決策紀錄
```

## 🚀 本機開發

```powershell
npm install
npx wrangler types
npx wrangler d1 migrations apply project-brain-db --local
npm run dev
```

本機 Worker 整合測試：

```powershell
npm run build
npx wrangler dev --local
```

品質檢查：

```powershell
npm run typecheck
npm test
npm run build
```

`.dev.vars` 僅放 `LLM_API_KEY` 與 `AGENTMAIL_API_KEY`，已被 Git 忽略。不可把值放進 `wrangler.jsonc`、README、log 或 commit。

## ☁️ 部署

```powershell
npx wrangler d1 migrations apply project-brain-db --remote
npx wrangler deploy
```

Secrets 必須從 `.dev.vars` 讀取並透過 stdin 傳給 Wrangler，不要放在命令參數或輸出中。部署後可用 `npx wrangler secret list` 確認只有名稱。

**更換 LLM 模型**：改 `wrangler.jsonc` 的 `vars.LLM_MODEL`（換端點另改 `vars.LLM_BASE_URL`）→ `typecheck`＋`build`＋`deploy`。系統優先呼叫 OpenAI 相容端點；`LLM_API_KEY` 不存在時 fallback 到 Workers AI。

**補綁自訂網域**：目前 `projects.uic-ai.com` 已綁定。若未來重建 Worker 且 custom domain 失敗，先移除 `routes` 部署到 workers.dev，再到 Dashboard → Workers → project-brain → Settings → Domains & Routes 手動新增，最後把 `APP_BASE_URL` 改回並重新部署。

## ⏰ 排程（UTC cron ↔ 台北時間）

| Cron | 台北時間 | 工作 |
|---|---|---|
| `0 1 * * *` | 每日 09:00 | 先抓 TFDA RSS 建立待審草稿，再執行里程碑／待辦／BD 停滯／QA 證照效期／專案停滯／自動歸檔與 Email 彙整；抓取失敗不阻斷提醒 |
| `30 0 * * 1` | 每週一 08:30 | 上週全公司與各組 AI 週報 |
| `30 0 1 * *` | 每月 1 日 08:30 | 上月全公司與各組 AI 月報 |

LLM 失敗時報告仍保存純數據版；預生成報告一律排除保密專案並於文末註記。AgentMail 未設定時僅略過 Email，站內通知不受影響。

## 🔐 帳號與權限

### 註冊與核准

員工在登入頁「申請帳號」：姓名＋公司 Email＋密碼＋組別 → 6 位數 Email 驗證碼（15 分鐘）→ 進入待核准。管理員於「管理 → 註冊申請」核准（可調角色／組別）或拒絕，結果寄信通知；核准前無法登入。防濫用：同 Email 60 秒寄碼冷卻、驗證碼最多試 5 次、同 IP 每日上限。管理員也可直接建帳號（首登強制改密）。

### 管理權移轉

「管理 → 管理權移轉」：**共同管理員**（對方升 admin、自己不變）或**完全移轉**（原子先升後降）。兩種都須重輸自己的密碼；系統在 API 層阻止降級／停用最後一名 active admin。

### 權限速查

| 行為 | admin | owner | 同組 member | project member | intern |
|---|---|---|---|---|---|
| 檢視 `all` | 全部 | ✔ | ✔ | ✔ | 僅被加入的專案 |
| 檢視 `group` | 全部 | ✔ | ✔ | ✔ | 僅被加入的專案 |
| 檢視 `private` | 全部 | ✔ | ✘ | ✔ | 僅被加入的專案 |
| 填寫進度／任務／看板／收案／BD 事件 | 全部 | ✔ | ✔ | ✔ | 僅被加入的專案 |
| 編輯／刪除進度紀錄 | 全部 | 專案內全部 | 僅自己的紀錄 | 僅自己的紀錄 | 被加入專案中自己的紀錄 |
| 修改可見性／成員／歸檔／刪除 | 全部 | ✔ | ✘ | ✘ | ✘ |
| BD 費用檢視與填寫 | 全部 | ✔ | 同組正職 | 跨組不可 | ✘ |
| 法規 published 清單 | 全部 | ✔ | ✔ | ✔ | ✔ |
| TFDA 草稿檢視／核准 | 全部 | — | 僅 RA/PV 正職 | ✘ | ✘ |

後端 API 逐一覆核權限（集中於 `worker/services/permissions.ts`，27 組矩陣測試）；前端隱藏按鈕不是唯一防線。intern 的清單、儀表板、時間軸、報表只彙整其可見專案。

### 示範帳號（驗證權限用，密碼 `Brain-2026!`；正式上線後用「管理 → 清除示範資料」移除）

| 角色 | Email | 姓名 |
|---|---|---|
| 臨床組 member | `clinical1@demo.local` | 林曉臨 |
| 臨床組 member | `clinical2@demo.local` | 陳收案 |
| BD 組 member | `bd1@demo.local` | 王必達 |
| 臨床組 intern | `intern1@demo.local` | 李實習 |

## 📖 日常操作指南

### 語言與主題（English / Dark‧Light）

**怎麼切換**：導覽列右上有兩顆相鄰按鈕——

1. 「**中／EN**」：整個介面在繁體中文與 English 之間切換（導覽、按鈕、表單、說明頁、導覽教學、相對時間全部翻譯）。
2. 「**☀／🌙**」：暗色（神族深空，預設）與亮色（白晝神殿——暖象牙底、金結構、深 psi 藍）即時切換，圖表、甘特、時間軸、風險 badge、護盾進度條同步換色，切換無閃爍。

**記憶方式**：偏好存在各自瀏覽器的 localStorage（`AIUR_LANG`／`AIUR_THEME`），每位同事互不影響；換裝置或清快取後回到預設「繁中＋暗色」。

**翻譯範圍與界線**：

- 跟隨語言：介面文字、`/help` 全文、首次導覽、個人即時 AI 輸出（進度快寫、任務摘要、風險預測、排程理由）。
- 固定繁中：使用者輸入的資料（專案名、進度、留言、法規條目）、Email 通知、組織週報／月報、法規 AI 匯入解析結果。
- 列印一律白底，不受主題影響。

### 專案、任務與自動進度

1. 「專案 → 新增專案」設定組別、可見性、目標日與階段模板。
2. 「總覽」可切換手動／自動進度；自動模式＝任務＋里程碑＋關聯待辦＋KR 的完成比例（新專案預設自動）。歷程事件是過去日期的已發生事實，永遠不納入進度、逾期 KPI 或提醒。
3. 「任務」四視圖自由切換；看板支援階段與卡片拖拉；點任務開抽屜編輯內容、負責人、起訖日、依賴，並使用留言 `@提及`、附件與 AI 摘要。歷程事件在日曆以次要色圓點、在甘特與展開的全域時間軸以空心淡金菱形顯示。
4. 「進度紀錄」貼雜記後用「AI 快寫」整理成三段式草稿，確認後發布。
5. 作者本人、專案 owner 或管理員可從紀錄右上角就地編輯或刪除。編輯保留原進度快照並標示時間；刪除不可復原，但稽核紀錄仍保留。刪除自動產生的完成紀錄不會回復任務或里程碑狀態。
6. 進度保存成功後，AI 可能建議把明確完成的既有任務標為完成、建立後續任務或未來里程碑、把過去日期的已完成事實記為歷程事件，以及替既有未完成任務設定日期。建議本身絕不寫資料：所有 checkbox 預設空白，只有人工勾選再按「套用所選」才會呼叫既有任務／里程碑端點；建議的標題與日期都可先修改，歷程區也提供全選。過去日期的事實不會變成里程碑，也不會改變進度。可在個人設定關閉進度連動建議（`AIUR_PROGRESS_LINKS`，預設開）。

後端時間戳一律以 UTC 儲存，介面時間一律以 `Asia/Taipei` 顯示；專案與任務的 date-only 日期仍維持台北日曆日期。

### 檔案、自動化與 AI

- 檔案存 R2（單檔 25 MB），下載經權限檢查；上傳者／owner／admin 可刪。
- 「自動化」規則：任務完成／移入階段／里程碑完成／進度跨門檻 → 通知／改指派／建待辦／寫紀錄。
- 專案總覽「AI 風險預測」存等級＋建議並顯示於儀表板；「AI 排程建議」經後端驗證（日期在專案內、不違反依賴）才可套用。

### 法規動態 AI 匯入

貼上公告文字，或合併上傳最多 5 個 `.txt`／文字層 `.pdf`（單檔 10 MB、總量 25 MB）。**單則公告**（預設）：整包內容 → 1 筆；**多則彙整**：僅在不同公告日期或不同公告標題時拆分。

`entry_date` 一律取公告／發文日期，不取施行／生效日期；施行日會放在摘要後的第一個重點條列。若 AI 抽出的日期超過今日 90 天，預覽以警示色提醒但不阻擋編輯或匯入。含「對照表／修正條文／現行條文」的資料會另列「修正重點（前後對照）」與最多 10 條「舊規定→新規定」摘要。

預覽可逐格編輯／排除，確認時以 `(entry_date, title)` 判重；全部原始檔存 R2，列表顯示 `📎×N` 並可逐檔下載。刪除最後一筆引用時同步移除 D1 關聯與 R2 孤兒物件。掃描 PDF 無文字層者請改貼文字（刻意不做 OCR）。

### TFDA RSS 自動抓取與審核

每日 09:00 的前置工作讀取 TFDA 公告 RSS；RA/PV 正職成員與 admin 也可在法規動態點「立即抓取 TFDA」。系統以既有 TFDA news id、駁回墓碑及 `(公告日期, 標題)` 三重去重，將公告全文（含表格列）交給既有單則 AI 管線整理；AI 暫時失敗時仍以「其他」與原文前 500 字建立草稿，公告不會漏接。

新資料一律是 `TFDA 草稿`，站內通知審核者並併入每日 Email digest。具管理權者點「待審核 N」後可展開全文重點、編輯（仍維持草稿）、逐則核准／刪除、勾選多筆批次核准／刪除，或確認後全部核准；其他 member 與所有 intern 在核准前完全看不到。核准後才進入一般 published 清單。刪除 TFDA 草稿或已發布條目時會先保留 source ref 墓碑，避免後續 cron 將同一公告重新建立；手動條目不受影響。操作與驗收時不可代替業務人員核准或刪除真實 TFDA 草稿。

### 報表與時間軸

- 「報表 → 產生報告」：選組別＋（本週／上週／本月／上月）一鍵產生，支援列印；member 限本組，admin 可全公司或含保密版。
- 「時間軸」：組別泳道總覽全部可見專案，展開列可見任務時間條（負責人 tooltip）。

### 組別與階段模板（管理員）

「管理 → 組別」型別（`clinical`／`bd`／`qa`／`general`）決定專屬模組；被引用的組別不可刪。「階段模板」以 `→` 分隔階段，套用時複製、後續改模板不影響既有專案。

## 💾 備份與還原

| 層 | 機制 |
|---|---|
| 程式碼 | 本 GitHub 私有 repo（每次改版 push） |
| 資料庫＋檔案 | 每週一 07:30 排程「AiurCrystalBackup」跑 `backup.ps1` → D1 完整 dump＋R2 檔案 → OneDrive，保留 8 份 |
| 雲端內建 | D1 Time Travel：過去 30 天任一時間點可整庫回溯 |
| Secrets | `.dev.vars` 本機保存＋密碼管理器備份 |

誤刪資料、機器重建、帳號級災難的完整還原步驟見 **[BACKUP.md](BACKUP.md)**；建議每季演練一次。

## 🕰 版本歷程

| 版本 | 內容 | 規格 / 驗收 |
|---|---|---|
| v1 | 平台核心：認證、權限、專案、看板、臨床／BD 模組、儀表板、cron、AI 快寫／週報 | [SPEC](SPEC.md) / [驗收](ACCEPTANCE.md) |
| v2 | 改名艾爾水晶、自動進度、導覽、多視圖、甘特、時間軸、留言提及、R2 檔案、自動化、AI 三件套 | [SPEC](SPEC-V2.md) / [驗收](ACCEPTANCE-V2.md) |
| v3 | 自助註冊＋Email OTP＋管理員核准 | [SPEC](SPEC-V3.md) / [驗收](ACCEPTANCE-V3.md) |
| v4 | 管理權移轉＋最後管理員防呆 | [SPEC](SPEC-V4.md) / [驗收](ACCEPTANCE-V4.md) |
| v5 | Protoss 主題重塑（金結構／藍能量／切角面板／護盾進度條） | [SPEC](SPEC-V5.md) / [驗收](ACCEPTANCE-V5.md) |
| v6 | 團隊帳號、QA 證照效期、CCR 變更管制、OKR、法規動態、批次匯入 | [SPEC](SPEC-V6.md) / [驗收](ACCEPTANCE-V6.md) |
| — | 六份 Excel 真實資料搬遷（32 專案／110 進度／627 法規，跨檔重複合併） | [IMPORT.md](IMPORT.md) / [IMPORT-RUN.md](IMPORT-RUN.md) |
| v7 / v7.1 | 法規 AI 匯入（文字／PDF）＋拆分粒度修正（單則＝一筆） | [SPEC](SPEC-V7.md)·[7.1](SPEC-V7-1.md) / [驗收](ACCEPTANCE-V7.md)·[7.1](ACCEPTANCE-V7-1.md) |
| v8 | 組別週報月報＋月報 cron、時間軸泳道＋任務條、全站字級、加粗 | [SPEC](SPEC-V8.md) / [驗收](ACCEPTANCE-V8.md) |
| v9 | 繁中／English 雙語（含 AI 輸出跟隨）＋暗色／亮色主題切換（CSS 變數 token 化） | [SPEC](SPEC-V9.md) / [驗收](ACCEPTANCE-V9.md) |
| v9.1 | 登入／註冊水晶圖示改為共用直立六面 Protoss 水晶 | [SPEC](SPEC-V9-1.md) / [驗收](ACCEPTANCE-V9-1.md) |
| v10 | 法規公告日期防呆＋多檔 AI 合併分析＋前後對照摘要與多附件 | [SPEC](SPEC-V10.md) / [驗收](ACCEPTANCE-V10.md) |
| v11 | TFDA RSS 每日自動抓取＋AI 草稿 fallback＋人工審核發布 | [SPEC](SPEC-V11.md) / [驗收](ACCEPTANCE-V11.md) |
| v11.1 | TFDA 草稿勾選多筆批次核准／刪除＋孤兒附件清理 | [SPEC](SPEC-V11-1.md) / [驗收](ACCEPTANCE-V11-1.md) |
| v11.2 | TFDA 駁回墓碑，防止已刪公告被 cron 復活 | [SPEC](SPEC-V11-2.md) / [驗收](ACCEPTANCE-V11-2.md) |
| v12 | 進度紀錄產生 AI 任務連動建議，所有寫入皆須人工勾選確認 | [SPEC](SPEC-V12.md) / [驗收](ACCEPTANCE-V12.md) |
| v12.1 | 進度紀錄可由作者／owner／admin 編輯或刪除，保留歷史快照與稽核留痕 | [SPEC](SPEC-V12-1.md) / [驗收](ACCEPTANCE-V12-1.md) |
| v12.2 | 修正台北時區顯示、快速新增防重複，進度可建議里程碑與既有任務日期 | [SPEC](SPEC-V12-2.md) / [驗收](ACCEPTANCE-V12-2.md) |
| v12.4 | 過去已完成事實成為日曆／甘特歷程事件，且永遠排除於進度與提醒 | [SPEC](SPEC-V12-4.md) / [驗收](ACCEPTANCE-V12-4.md) |
| v12.5 | 任務抽屜依賴優先，起始日自動接續前置任務並保護手動修改 | [SPEC](SPEC-V12-5.md) / [驗收](ACCEPTANCE-V12-5.md) |

## 🧭 開發模式

本專案採**規格驅動＋雙 agent 流水線**：Claude（規格撰寫、派工、獨立驗收）＋ OpenAI Codex（實作、部署、E2E 自驗）。每一版都有書面規格（`SPEC*.md`）與如實記錄指令輸出的驗收檔（`ACCEPTANCE*.md`），失敗與未達成項一律留痕，不粉飾。實作決策集中在 [DECISIONS.md](DECISIONS.md)。
