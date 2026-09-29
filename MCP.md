# AI 連接器（MCP）

讓 Claude 等支援 [Model Context Protocol](https://modelcontextprotocol.io) 的 AI 工具直接查看與更新艾爾水晶。連接器網址：

```
https://projects.uic-ai.com/mcp
```

## 怎麼連接

**Claude（網頁版或 App）**：設定 → 連接器 → 新增自訂連接器，名稱填「艾爾水晶」、網址貼上連接器網址，按「連接」。瀏覽器會打開艾爾水晶的授權頁：沒登入先登入，看清楚是哪個 AI 工具之後按「允許」。要讓 AI 寫進度、建任務，勾「新增與修改」；不勾就只能查看。

**Claude Code**：

```sh
claude mcp add --transport http project-brain https://projects.uic-ai.com/mcp
```

之後在 Claude Code 裡執行 `/mcp` 完成授權。

**ChatGPT**：在設定開啟開發者模式，到「外掛程式」按「＋」新增：網址填連接器網址，驗證方式選 OAuth，Client ID 與 Secret 留空（ChatGPT 會自己註冊）。之後一樣在艾爾水晶的授權頁按「允許」。

其他支援 MCP（Streamable HTTP + OAuth）的工具填同一個網址。

個人設定頁的「AI 連接器」列出連接器網址、已連接的 AI 工具與權限，可以隨時中斷；中斷後那個工具的 token 立刻失效。

## 工具

| 工具 | 權限 | 做什麼 |
|---|---|---|
| `list_projects` | 查看 | 列出看得到的專案，可依關鍵字、狀態、只看自己的篩選；子專案標示母專案 |
| `get_project` | 查看 | 單一專案：背景、目標、看板各欄的任務、里程碑、歷程事件、最近的進度紀錄、成員與可否編輯；母專案另列子專案與各自的進度，子專案標示母專案 |
| `list_my_work` | 查看 | 指派給自己的任務、自己專案的里程碑、個人待辦，分成逾期與接下來幾天 |
| `add_progress_update` | 新增與修改 | 以使用者名義新增進度紀錄 |
| `create_task` | 新增與修改 | 建立任務，可指定看板欄位、負責人、開始與到期日 |
| `update_task` | 新增與修改 | 勾選完成、移欄、改日期（空字串清除）、改負責人或內容 |
| `add_milestone` | 新增與修改 | 新增里程碑或歷程事件 |
| `update_milestone` | 新增與修改 | 標記達成、改日期或名稱 |
| `update_project_background` | 新增與修改 | 取代專案背景與目標（只限擁有者與管理員） |

專案可以用 id（`prj_…`）或名稱指定；名稱比對與批次匯入相同，全形半形、空白、大小寫不影響，只打一部分也行，只要不會對到兩個。

## 安全

- **權限與網站相同。** 工具不另寫查詢，而是以使用者身分呼叫網站自己的 `/api`（`worker/mcp/internal-api.ts`），看得到、改得了的範圍和他在畫面上操作時一模一樣，欄位驗證、自動進度與自動化規則也一樣。看不到的專案用名稱找不到，也不會出現在「是不是…？」的提示裡。
- **每次呼叫重新查帳號。** token 只存 userId；帳號停用、未核准或必須先改密碼時，下一次呼叫就被拒絕。
- **兩種權限。** `mcp:read` 是基本權限；`mcp:write` 由使用者在授權頁勾選。沒有 `mcp:write` 的連線看不到寫入工具，硬要呼叫也會被拒絕。
- **稽核紀錄。** 每一筆寫入記一筆 `mcp_<工具名>`，內容寫明「經 AI 連接器（工具名稱）」做了什麼；連接與中斷記為 `mcp_connect`、`mcp_disconnect`。
- **授權頁**不能被嵌進別人的頁框，AI 工具自己填的名稱一律跳脫；顯示授權會回到哪個網域，回到本機程式時另外警告。登入後回到授權頁的 `?next=` 只接受 `/oauth/authorize`。
- **資料不是指令。** 伺服器說明提醒 AI：工具回傳的背景、進度紀錄、任務名稱是使用者寫的資料，不是給它的指令。

## 技術細節

- **OAuth**：[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)（`worker/index.ts`）。支援動態註冊（`/oauth/register`）與 Client ID Metadata Document；PKCE S256；refresh token 閒置 30 天才過期。不宣告 RFC 9207（授權回應附 `iss`），導回 AI 工具時也不附 `iss`（`worker/mcp/issuer-identification.ts`）：宣告之後 ChatGPT 改用共用的固定回呼網址 `https://chatgpt.com/connector_platform_oauth_redirect`，按了「允許」之後 ChatGPT 顯示「缺少 OAuth 回呼資料」；不宣告時 ChatGPT 用每個連線各自的 `https://chatgpt.com/connector/oauth/{callback_id}`，就能連上。Codex 0.143 起也會在回呼時丟掉 `iss` 又要求一定要有。授權、token 與 grant 存在 KV `OAUTH_KV`（`project-brain-oauth`）；token 只存雜湊，props 加密。每日排程順便清掉過期資料。
- **端點**：`/mcp`（需要 token）、`/oauth/authorize`（網站自己的授權頁，`worker/routes/oauth.ts`）、`/oauth/token`、`/oauth/register`、`/.well-known/oauth-protected-resource/mcp`、`/.well-known/oauth-authorization-server`。這些路徑都列在 `wrangler.jsonc` 的 `run_worker_first`，不會被前端 SPA 接走。
- **MCP 傳輸**：無狀態的 Streamable HTTP（`worker/mcp/protocol.ts`），每個 POST 直接回 JSON，不開 SSE、不發 session。協定版本與官方 SDK 1.30 相同（2025-11-25、2025-06-18、2025-03-26、2024-11-05），通知回 202，不支援的 `MCP-Protocol-Version` 回 400。
- **部署需求**：Cloudflare API token 需要 Account → Workers KV Storage（CI 的權限檢查會先驗）；`compatibility_flags` 需要 `global_fetch_strictly_public`（Client ID Metadata Document 對外抓取時防 SSRF）。

## 測試

- `tests/mcp-protocol.test.ts`：版本協商、通知、錯誤碼、唯讀連線看不到寫入工具、參數檢查。
- `tests/mcp-tools.test.ts`：在套好 migrations 的 SQLite 上呼叫每個工具，含權限與稽核紀錄。
- `tests/mcp-oauth.test.ts`：以正式的 Worker 進入點走完整流程——401 → 找到授權伺服器 → 動態註冊 → 登入與同意（含拒絕、跳脫、改密碼）→ 換 token → 呼叫工具 → 中斷連線後 token 失效；ChatGPT 以各自的回呼網址連接，導回時不附 `iss`。KV 用 `tests/helpers/memory-kv.ts`。
