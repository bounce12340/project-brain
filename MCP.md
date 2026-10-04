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

**Codex CLI**（以下選項已對照本環境的 Codex 0.159 CLI）：

```sh
codex mcp add project-brain --url https://projects.uic-ai.com/mcp --oauth-client-registration dcr
codex mcp login project-brain --scopes mcp:read,mcp:write --oauth-client-registration dcr
codex mcp list
```

`add` 可能直接啟動授權；已成功登入就不必再次 `login`。無法自動開啟瀏覽器時，在 `login` 加上 `--no-browser`，依 CLI 顯示的流程操作。`dcr` 明確使用本伺服器支援的動態註冊；不必自行填入 Client ID／Secret。舊版若不認得這個選項，請更新 Codex。只需要查資料時使用 `--scopes mcp:read`，授權頁不要勾「新增與修改」。最終寫入權限取決於使用者在授權頁的選擇。

**Claude Desktop**：在支援遠端連接器的設定頁新增上述 HTTPS 網址，再完成瀏覽器 OAuth 授權。這是遠端 Streamable HTTP 服務，不是要放進 `claude_desktop_config.json` 的本機 stdio 程式。

其他支援 MCP（Streamable HTTP + OAuth）的工具填同一個網址。

表單要圖示時用 <https://projects.uic-ai.com/icon-512.png>（512×512 PNG）。連線時 `initialize` 回傳的 `serverInfo.icons` 也帶著這張圖與 `favicon.svg`，支援 MCP 2025-11-25 圖示欄位的工具會自己顯示。

個人設定頁的「AI 連接器」列出連接器網址、已連接的 AI 工具與權限，可以隨時中斷；中斷後那個工具的 token 立刻失效。

## 工具

| 工具 | 權限 | 做什麼 |
|---|---|---|
| `search` | 查看 | 搜尋可見專案的名稱與背景（含結案與歸檔），回傳 id、標題及可引用網址 |
| `fetch` | 查看 | 用搜尋結果的精確 id 取得專案內容與引用網址；包含背景、看板及最多 50 則近期進度，非完整歷史匯出 |
| `list_todos` | 查看 | 查自己的個人待辦，可包含已完成、無日期及較遠期限的項目 |
| `create_todo` | 新增與修改 | 建立自己的個人待辦，可關聯有編輯權限的專案 |
| `update_todo` | 新增與修改 | 完成、重新命名或修改自己待辦的期限；空日期表示清除 |
| `list_meetings` | 查看 | 查會議／外訓及摘要，依種類、專案、關鍵字與開始日期篩選 |
| `create_meeting` | 新增與修改 | 建立會議／外訓紀錄與摘要，可關聯專案；不寄送邀請、不自動建後續任務 |
| `search_contacts` | 查看 | 按姓名、公司／醫院、部門、Email 或備註搜尋聯絡人 |
| `list_regulations` | 查看 | 以關鍵字與年份分頁查詢已發布法規及來源；不回傳審核草稿 |
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

工具共 18 個。`search`／`fetch` 同時提供文字 JSON 與結構化結果，便於支援工具呼叫的客戶端搜尋與引用；是否顯示引用或啟用研究模式仍由客戶端決定。會議時間使用台北當地的 `YYYY-MM-DDTHH:MM`，例如 `2026-10-04T10:30`；待辦及專案日期使用 `YYYY-MM-DD`。

可試的指令：「找 GDP 專案並引用來源」、「列出我的未完成待辦」、「把聯絡 IT 設為 10 月 8 日的個人待辦」、「整理本週會議紀錄」、「查今年已發布的藥品公告」。

`list_todos`、`list_meetings`、`search_contacts` 預設最多回傳 50 筆，`limit` 可設為 1–100，並回報 `count` 和 `truncated`。會議 API 只取最近 2000 筆，聯絡人 API 最多 5000 筆，並非完整歷史搜尋。`list_regulations` 每頁 50 筆，使用 `page` 與 `total_pages` 翻頁。

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

## 本機驗證與連線排錯

先完成本機 migrations 與 `npm run build`，再啟動：

```sh
npx wrangler dev --local --ip 127.0.0.1 --port 8787 --local-upstream 127.0.0.1:8787 --upstream-protocol http --var APP_BASE_URL:http://127.0.0.1:8787
```

`--local-upstream` 必須和 `APP_BASE_URL` 的 origin 相同：repo 有正式站 custom route，只有覆寫變數會讓 Wrangler 仍把請求網域改為正式站，導致 metadata 找不到或 `Token audience does not match resource server`。正式部署使用 `wrangler.jsonc` 的 HTTPS origin。請用正確的 origin 修復，保留 token 的受眾檢查。

- `401` 且 `WWW-Authenticate` 含 `resource_metadata` 是未授權的正常回應。先完成 OAuth，再呼叫 MCP。
- 確認 `/.well-known/oauth-protected-resource/mcp` 和 `/.well-known/oauth-authorization-server` 的網址指向相同環境。
- 缺少寫入工具：中斷後重新連接，在授權頁勾「新增與修改」。
- 舊版 Codex 若遇到 `iss`／OAuth 回呼錯誤：更新客戶端並重新授權。本伺服器維持不宣告 RFC 9207 的既有相容處理。
- OAuth 需要 Cloudflare KV `OAUTH_KV`；本機由 Wrangler 模擬，正式環境需要既有 KV binding。

驗證範圍：三種客戶端回呼形式的 OAuth 流程測試，包含 PKCE、token 更新、唯讀限制、工具呼叫及撤銷；另以官方 MCP SDK 1.30 對本機 Wrangler 做真實 HTTP 連線。這些不代表已在使用者的 ChatGPT／Claude／Codex 帳號完成正式站授權。部署更新後，請各自登入一次並用 `search`／`fetch` 或 `list_projects` 確認。
