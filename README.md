# 專案進度大腦

給台灣醫藥代理商內部團隊使用的共享專案管理工具。正式網址：<https://projects.uic-ai.com>。

## 登入與帳號管理

系統不提供自助註冊。管理員登入後，前往「管理 → 使用者」建立帳號，填寫姓名、Email、組別、角色與至少 8 碼的初始密碼。新帳號及管理員重設密碼後，使用者下次登入會被強制導向改密碼頁。

初始管理員：

- Email：`bounceto12340@gmail.com`
- 初始密碼：`Brain-2026!`
- 首次登入必須變更密碼。

示範帳號的初始密碼同為 `Brain-2026!`：

| 角色 | Email | 姓名 |
|---|---|---|
| 臨床組 member | `clinical1@demo.local` | 林曉臨 |
| 臨床組 member | `clinical2@demo.local` | 陳收案 |
| BD 組 member | `bd1@demo.local` | 王必達 |
| 臨床組 intern | `intern1@demo.local` | 李實習 |

管理員可停用帳號、調整角色與組別、重設臨時密碼。重設密碼會撤銷該使用者既有 session。正式上線後，建議在完成示範與權限驗證後使用「清除示範資料」。

## 權限規則速查

| 行為 | admin | owner | 同組 member | project member | intern |
|---|---|---|---|---|---|
| 檢視 `all` | 全部 | 是 | 是 | 是 | 僅被加入的專案 |
| 檢視 `group` | 全部 | 是 | 是 | 是 | 僅被加入的專案 |
| 檢視 `private` | 全部 | 是 | 否 | 是 | 僅被加入的專案 |
| 填寫進度、任務、看板、收案、BD 事件 | 全部 | 是 | 是 | 是 | 僅被加入的專案 |
| 修改可見性、成員、歸檔、刪除 | 全部 | 是 | 否 | 否 | 否 |
| 檢視與填寫 BD 費用 | 全部 | 是 | 同組正職可 | 跨組不可 | 不可 |

intern 的清單、儀表板與報表只彙整他被加入的專案。後端 API 會再次檢查權限；前端隱藏按鈕不是唯一防線。預先生成的全公司／組別 AI 週報可能含保密專案，因此只有 admin 可讀；其他角色仍可讀依個人可見範圍即時計算的報表摘要。

## 日常操作

### 專案與看板

1. 在「專案」選擇「新增專案」，設定組別、可見性、目標日與階段模板。
2. 專案「總覽」可更新進度、里程碑、成員與專案設定。進度滑桿每次變更會自動留下快照。
3. 「看板」可拖拉階段排序，也可跨欄或欄內拖拉工作卡。要刪除階段，需先搬走其中所有卡片。
4. 「進度紀錄」可貼入雜記，以「AI 快寫」整理成三段式草稿；草稿可編輯，按「發布進度」後才會存入資料庫。

### 臨床與 BD

- `clinical` 組專案會顯示臨床分頁，可設定收案目標、登錄逐日／中心收案，並查看累計折線與中心小計。
- `bd` 組專案會顯示 BD 分頁，可管理查驗登記案件、狀態、案件歷程與費用。費用 API 會依權限移除整個金額資料集。

### 報表、待辦與通知

- 報表可選本週、上週、本月或自訂期間，並依組別篩選；支援摘要與費用 CSV、瀏覽器列印。
- 待辦分成今日、逾期、未排程、之後與已完成，可關聯目前使用者看得到的專案。
- 導覽列通知數來自站內通知。每日 Email 是加值功能，即使寄信服務未設定或失敗，站內通知仍會建立。

## 建立組別與階段模板

管理員前往「管理」：

- 「組別」新增名稱並選擇 `clinical`、`bd` 或 `general`。型別決定專案詳情顯示哪個專屬模組。仍被使用者、專案或模板引用的組別不能刪除。
- 「階段模板」輸入模板名稱、適用組別（可留空表示通用），階段以 `→` 分隔。新建專案時套用模板會複製階段，後續修改模板不會改動既有專案。

## 排程

Wrangler 設定使用 UTC cron，對應台北時間如下：

| Cron | 台北時間 | 工作 |
|---|---|---|
| `0 1 * * *` | 每日 09:00 | 里程碑、待辦、BD 核准／補件停滯、專案停滯、自動歸檔、每人一封 Email 彙整 |
| `30 0 * * 1` | 每週一 08:30 | 產生上週全公司與各組 AI 週報、建立全員站內通知 |

LLM 失敗時，週報仍會保存純數據版並通知使用者。AgentMail secret 未設定時只略過 Email，不影響站內通知。

## 本機開發

```powershell
npm install
npx wrangler types
npx wrangler d1 migrations apply project-brain-db --local
npm run dev
```

本機 Worker 整合測試可用：

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

## 部署與設定

```powershell
npx wrangler d1 migrations apply project-brain-db --remote
npx wrangler deploy
```

Secrets 必須從 `.dev.vars` 讀取並透過 stdin 傳給 Wrangler，不要放在命令參數或輸出中。部署後可用 `npx wrangler secret list` 確認只有名稱。

### 更換 LLM 模型

編輯 `wrangler.jsonc` 的 `vars.LLM_MODEL`，如需更換相容端點也調整 `vars.LLM_BASE_URL`，再執行：

```powershell
npm run typecheck
npm run build
npx wrangler deploy
```

系統優先呼叫 OpenAI-compatible 端點；`LLM_API_KEY` 不存在時才使用 Workers AI binding 的 Llama fallback。

### 補綁自訂網域

目前 `projects.uic-ai.com` 已成功綁定。如未來重建 Worker 且 custom domain 失敗，可先移除 `wrangler.jsonc` 的 `routes` 部署至 workers.dev，之後在 Cloudflare Dashboard 的 Workers & Pages → project-brain → Settings → Domains & Routes 新增 Custom Domain `projects.uic-ai.com`，並把 `APP_BASE_URL` 改回正式網址後重新部署。
