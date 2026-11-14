# 送審 Claude 連接器目錄：艾爾水晶 MCP

在 [claude.ai/directory/manage](https://claude.ai/directory/manage) 選 **Submit new → MCP connector**，依下列各步驟填寫。依據的規格：
[Publish to the directory](https://claude.com/docs/directory/publish.md)、
[Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria.md)、
[Submit a connector](https://claude.com/docs/connectors/building/submission.md)、
[Authentication for connectors](https://claude.com/docs/connectors/building/authentication.md)。

## 送審前要先完成

- [ ] 在 `wrangler.jsonc` 設定 `SUPPORT_EMAIL`（公開說明頁與隱私權政策會列出它），合併部署。
- [ ] 確認 <https://projects.uic-ai.com/connector> 與 <https://projects.uic-ai.com/privacy> 不用登入就打得開。
- [ ] 用 [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) 與 Claude 自訂連接器各把 30 個工具跑過一次（**Test & launch** 步驟要確認）。
- [ ] 準備一個 Verified review 用的測試帳號（審查人員會用 email 索取；不要填進入口網站）。
- [ ] 以要長期持有這個列表的組織／帳號送審（Pro、Max、Team 或 Enterprise）。

## 1. Connection

- Server URL：`https://projects.uic-ai.com/mcp`
- Users connect to：**Universal URL**（所有人用同一個網址）

## 2. Tools

工具會從伺服器自動同步：唯讀 9 個、寫入 21 個。每個工具都有 `title`、`readOnlyHint`、`destructiveHint`（修改或刪除既有資料的寫入工具為 `true`，只新增資料的為 `false`），名稱都在 64 字以內。`tests/mcp-directory.test.ts` 會檢查這些規則。

## 3. Listing

| 欄位 | 內容 |
|---|---|
| Server name | 艾爾水晶 Project Brain |
| One-liner（≤200） | Track regulatory, clinical, QA and BD projects at UIC: read boards and risks, and post progress, tasks and meeting notes from Claude. |
| Categories | Project management；Productivity |
| Documentation URL | https://projects.uic-ai.com/connector |
| Privacy policy URL | https://projects.uic-ai.com/privacy |
| Support contact | （`SUPPORT_EMAIL` 的值） |
| Icon | `public/icon-512.png`（512×512 PNG） |
| Slug | `project-brain`（發布後不能改） |

Description（≤2000）：

> 艾爾水晶 (Project Brain) is the project tracker UIC's regulatory (RA/PV), clinical, QA and BD teams use for drug registrations, label changes, renewals and partner deals. The connector lets Claude work with the same data, under each user's own permissions:
>
> - List projects with their status light and AI risk level, and open a project's background, kanban board, milestones, history and recent progress.
> - See what is overdue or due soon across your tasks, milestones and personal to-dos.
> - Post progress updates, create and update tasks and subtasks, add milestones and history events, and manage kanban columns.
> - Record meetings and training sessions, look up contacts, and search published regulatory updates or add new ones as drafts for RA/PV review.
>
> Every change is made as the signed-in user and recorded in the audit log. Users can grant read-only access, and tools that change or delete existing data are marked destructive so Claude asks before each call.

## 4. Use cases

- Primary use cases：每週專案進度彙整與風險檢視；開會後把結論寫成進度紀錄、任務與里程碑；整理個人到期與逾期工作；記錄會議與法規動態。
- What users need：經公司管理員核准的艾爾水晶帳號（僅限 UIC 成員）。
- Reads / writes：**Both**。

## 5. Company

- Company name：UIC
- Website：https://projects.uic-ai.com
- Primary contact：（負責送審的人）

## 6. Authentication

- Authentication requirement：**Always required**
- Authentication method：**OAuth sign-in**，OAuth client 選 Claude 自行註冊（DCR／CIMD），**不需要**輸入 client ID／secret。
- 伺服器端已具備：未授權回 `401` 並帶 `WWW-Authenticate: Bearer resource_metadata=…`；RFC 9728 protected resource metadata（`resource` = `https://projects.uic-ai.com/mcp`）；RFC 8414 authorization server metadata；S256 PKCE；動態註冊與 Client ID Metadata Document；接受 `https://claude.ai/api/mcp/auth_callback` 與 Claude Code 的 loopback 回呼（不限 port）；token 端點接受 form-urlencoded；refresh token 輪替、失效回 `invalid_grant`；scope `mcp:read`（必要）與 `mcp:write`（授權頁勾選）。

## 7. Data handling

- Underlying API：**Our own（first-party）**。連接器只呼叫艾爾水晶自己的 API；需要第三方網路搜尋的 `web_search`／`web_fetch` 只留給站內 AI 小幫手，不提供給連接器。
- Personal health data：**No**（處理的是藥品法規專案資料，不含病患個資或健康資料）。
- Sponsored content：**No**。

## 8. Test & launch

確認已用 MCP Inspector 或 Claude 自訂連接器逐一呼叫每個工具。不要在入口網站填任何帳密。

## 9. Compliance

七項聲明都要勾選。對應的設計：

| 聲明 | 對應 |
|---|---|
| Directory guidelines | 本文件與 `tests/mcp-directory.test.ts` |
| First-party API usage | 只呼叫艾爾水晶自己的 API |
| Financial transactions | 不涉及金流 |
| AI media generation | 不產生圖片、影片或音訊 |
| Prompt injection | 工具描述只說明工具做什麼，不指揮 AI；回傳的使用者文字在 server instructions 標明是資料 |
| Conversation data collection | 只接收工具參數，不讀取對話、記憶或檔案 |
| Public documentation | https://projects.uic-ai.com/connector |

## 要注意的地方

- 艾爾水晶只開放 UIC 成員；列在公開目錄後，其他人也看得到並可嘗試連接，但沒有核准的帳號就無法登入，也看不到任何資料。
- 只想讓公司同仁使用的話，不必送審公開目錄：Team／Enterprise 的 Owner 可以直接把 `https://projects.uic-ai.com/mcp` 加成組織的自訂連接器。
