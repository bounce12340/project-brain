# SPEC §11 驗收紀錄

執行日期：2026-07-21（Asia/Taipei）  
正式網址：<https://projects.uic-ai.com>  
Cloudflare Worker：`project-brain`  
首次正式部署 Version ID：`fb803de0-b1e8-45a9-994c-e541a735a080`

> 本檔只記錄指令、狀態與非機密摘要。Cookie、密碼 hash、LLM key、AgentMail key 均未寫入。

## 1. TypeScript、單元測試與 production build

執行：

```powershell
npm run typecheck
npm test
npm run build
```

結果：**PASS**。

- `tsc --noEmit`：exit 0，無型別錯誤。
- Vitest：4 個 test files 全數通過，42 tests passed（涵蓋 27 個權限矩陣案例、PBKDF2 hash/verify、寬鬆 JSON 解析、每日 Email 提醒彙整）。
- Vite production build：exit 0，638 modules transformed；產出 `dist/index.html`、CSS 與 JS。最終 JS chunk 663.60 kB（gzip 200.18 kB），Vite 有 >500 kB 的效能警告，但不是 build failure。
- 第一次 build 曾因缺少自訂 Tailwind `brand-100/200/300` 色階失敗；補齊 theme token 後重跑成功，未隱藏該失敗。

## 2. 遠端 D1 migrations

執行：

```powershell
npx wrangler d1 migrations apply project-brain-db --remote
```

結果：**PASS**。遠端 D1 `project-brain-db`（APAC）成功執行 `0001_init.sql` 37 commands 與 `0002_seed.sql` 18 commands，兩個 migration 狀態均為成功。

## 3. 正式部署

執行：

```powershell
npx wrangler deploy --dry-run
npx wrangler check startup
npx wrangler deploy
```

結果：**PASS**。

- dry-run：讀取 4 個 static asset files，Worker bundle 148.29 KiB（gzip 32.72 KiB）。
- startup check：Worker built 並完成分析；此指令本身標示 alpha。
- deploy：3 個新／更新 assets 上傳成功，Worker startup 6 ms，D1／AI／ASSETS bindings 與兩個 cron 均註冊成功。
- custom domain 首次即成功，無需 fallback；實際網址為 `https://projects.uic-ai.com`。

## 4. 正式環境 secrets

執行方式：PowerShell 逐一從 `.dev.vars` 解析對應行，只把值經 pipeline 傳入下列命令，過程未輸出 secret 值：

```powershell
npx wrangler secret put LLM_API_KEY
npx wrangler secret put AGENTMAIL_API_KEY
npx wrangler secret list
```

結果：**PASS**。兩次 `secret put` 均顯示 `Success! Uploaded secret`；`secret list` read-back 確認兩個名稱存在（只查名稱）。

## 5. 正式網址 curl 權限冒煙

共同設定：寫入請求帶 `Origin: https://projects.uic-ai.com`，各角色 cookie 分開保存於 Git 忽略的 `.wrangler/acceptance/`。

| 實測 | 指令摘要 | 結果 |
|---|---|---|
| Health | `curl https://projects.uic-ai.com/api/health` | **200** |
| 未登入專案列表 | `curl .../api/projects` | **401** |
| admin 登入 | `POST /api/auth/login` | **200** |
| admin 首次強制改密 | `POST /api/auth/change-password`（使用相同合規密碼以清旗標） | **200** |
| admin 專案列表 | cookie → `GET /api/projects` | **200，4 個示範專案** |
| intern 登入 | `POST /api/auth/login` | **200** |
| intern 專案列表 | cookie → `GET /api/projects` | **200，恰好 1 個專案** |
| admin 保密案 | cookie → `GET /api/projects/prj_private` | **200** |
| BD member 登入 | `POST /api/auth/login` | **200** |
| BD member 保密案 | cookie → `GET /api/projects/prj_private` | **403** |

結果：**PASS**。

## 6. 真實 AgentMail 測試信

執行：

```text
POST https://projects.uic-ai.com/api/admin/test-email
```

使用 admin cookie 與同源 Origin。結果：**PASS**，HTTP 200、`sent=true`、回應含非空 `message_id`：

```text
<0100019f82832506-d358e831-0074-42a6-8339-201cd08db4b5-000000@email.amazonses.com>
```

測試信實際寄往目前 admin `bounceto12340@gmail.com`。

## 7. Ollama AI 快寫

執行：

```text
POST https://projects.uic-ai.com/api/ai/draft-update
{"project_id":"prj_clinical","raw_text":"台北中心本週新增三位受試者，但台中中心合約還沒完成，預計週五追蹤法務並安排下週啟動會議。"}
```

結果：**PASS**，HTTP 200、`fallback=false`。回應為繁中 Markdown，實際含：

- `## 本期進展`：台北中心本週新增三位受試者。
- `## 風險或阻礙`：台中中心合約尚未完成。
- `## 下一步`：週五追蹤法務、安排下週啟動會議。

此結果證明正式環境使用已設定的 Ollama-compatible 直連，而不是本地模板降級。

## 8. SPA 首頁

執行：

```powershell
curl.exe -sS -o spa.html -w '%{http_code}' https://projects.uic-ai.com/
```

結果：**PASS**，HTTP 200；response body 含 `<title>專案進度大腦</title>`，為 Vite SPA `index.html`。

## 9. 紀錄完整性

結果：**PASS**。本檔已逐項記錄 SPEC §11 的實際命令與結果摘要；包含首次 build 失敗及非阻斷 bundle warning，沒有把未執行項目寫成通過。
