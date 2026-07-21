# 艾爾水晶-專案進度

給台灣醫藥代理商內部團隊使用的共享專案管理工具。正式網址：<https://projects.uic-ai.com>。

## 登入與帳號管理

員工可在登入頁點「申請帳號」，填寫姓名、公司 Email、至少 8 碼的自訂密碼與組別。系統寄出 6 位數驗證碼（15 分鐘有效），驗證成功後申請進入待核准狀態；管理員核准前無法登入或讀取任何專案資料。核准或拒絕結果會寄到申請人的 Email。

管理員在「管理 → 註冊申請」可開關自助註冊、查看待核清單、調整申請人的角色（正職成員／實習生）與組別，再核准或拒絕。`pending` 與 `rejected` 帳號也會出現在「使用者」頁並可刪除。管理員仍可直接在「使用者」建立帳號；這類帳號預設已核准，初次登入須變更密碼。

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

管理員可停用已核准帳號、調整角色與組別、重設臨時密碼。重設密碼會撤銷該使用者既有 session。正式上線後，建議在完成示範與權限驗證後使用「清除示範資料」。

「管理 → 管理權移轉」可把啟用且已核准的 member／intern 升為共同管理員，或完全移轉後把自己降為 member。兩種模式都要重新輸入目前密碼；完全移轉另有二次確認。系統會在 API 與介面阻止降級或停用最後一名 active approved admin。

註冊防濫用包含同 Email 60 秒寄碼冷卻、每組驗證碼最多嘗試 5 次，以及同 IP 每日 send-code 10 次／submit 20 次。驗證碼只以 SHA-256 雜湊保存；寄信服務未設定或寄送失敗時不會建立帳號或略過驗證。

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

## 日常操作與 v2 協作

### 專案、任務多視圖與自動進度

1. 在「專案」選擇「新增專案」，設定組別、可見性、目標日與階段模板。
2. 專案「總覽」可切換手動／自動進度。自動模式依任務、里程碑、關聯待辦的完成比例計算；既有專案維持手動，新建專案預設自動。
3. 「任務」可切換看板、清單、日曆與甘特。看板保留拖拉與階段管理；清單支援排序篩選；日曆以到期日呈現；甘特顯示任務、里程碑與依賴箭頭。
4. 點任務開啟右側抽屜，可編輯內容、負責人、起訖日、完成狀態與依賴，並使用留言、`@提及`、附件及 AI 摘要。
5. 「進度紀錄」可貼入雜記，以「AI 快寫」整理成三段式草稿；草稿可編輯，按「發布進度」後才會存入資料庫。

### 檔案、自動化與 AI

- 專案「檔案」與任務抽屜附件都使用 R2 bucket `project-brain-files`。單檔上限 25 MB；下載一定經 Worker 檢查專案檢視權限，只有上傳者、owner 或 admin 可刪除。
- 專案「自動化」以「當…就…」建立規則，支援任務完成／移入階段、里程碑完成、進度跨越門檻，並通知、指派、建立待辦或寫入進度紀錄。
- 專案總覽的 AI 風險預測會保存風險等級、摘要與建議；任務頁可預覽 AI 排程建議，後端確認日期在專案範圍且不違反依賴後才可套用。
- 導覽列「時間軸」比較所有可見進行中專案；「？」開啟常駐說明頁並可重新播放首次登入導覽。

### 臨床與 BD

- `clinical` 組專案會顯示臨床分頁，可設定收案目標、登錄逐日／中心收案，並查看累計折線與中心小計。
- `bd` 組專案會顯示 BD 分頁，可管理查驗登記案件、狀態、案件歷程與費用。費用 API 會依權限移除整個金額資料集。

### 報表、待辦與通知

- 報表可選本週、上週、本月或自訂期間，並依組別篩選；支援摘要與費用 CSV、瀏覽器列印。
- 待辦分成今日、逾期、未排程、之後與已完成；只可關聯有進度編輯權限的專案，完成後會顯示自動進度回饋。
- 導覽列通知數來自站內通知。每日 Email 是加值功能，即使寄信服務未設定或失敗，站內通知仍會建立。

## 建立組別與階段模板

管理員前往「管理」：

- 「組別」新增名稱並選擇 `clinical`、`bd` 或 `general`。型別決定專案詳情顯示哪個專屬模組。仍被使用者、專案或模板引用的組別不能刪除。
- 「階段模板」輸入模板名稱、適用組別（可留空表示通用），階段以 `→` 分隔。新建專案時套用模板會複製階段，後續修改模板不會改動既有專案。

## 排程

Wrangler 設定使用 UTC cron，對應台北時間如下：

| Cron | 台北時間 | 工作 |
|---|---|---|
| `0 1 * * *` | 每日 09:00 | 里程碑、待辦、BD 核准／補件停滯、專案停滯、自動歸檔、提及與自動化通知、每人一封 Email 彙整 |
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
