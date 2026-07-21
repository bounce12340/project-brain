# SPEC-V5 驗收紀錄

驗收日期：2026-07-21（Asia/Taipei）
正式網址：`https://projects.uic-ai.com`
部署版本：`36fefe71-e62d-46d4-8f6b-09fcb45859e7`

## 結論

SPEC-V5 §5.1～§5.6 已實際執行並通過。§5.7 的派工者瀏覽器逐頁視覺回歸未由本執行環境完成：本機 preview 可回 HTTP 200，但 browser skill 回報可用瀏覽器清單為空；因此本檔不宣稱逐頁視覺 PASS，保留給派工者依規格抽查。程式碼改動僅含 Tailwind tokens、全域 CSS、className 與圖表色彩常數；沒有修改路由、文案、元件層級、worker 行為、Email HTML、`usr_admin` 或 secrets。

## 1. TypeScript、測試、建置與 chunk 差異

狀態：**PASS**

```text
npm run typecheck
→ exit 0；tsc --noEmit 無錯誤

npm test
→ exit 0；8 個 test files、94 個 tests 全數通過

npm run build
→ exit 0；Vite production build 成功，649 modules transformed
→ V4 最大 chunk：LineChart-CuU98ECv.js，377,202 bytes
→ V5 最大 chunk：LineChart-rpdlkBeA.js，377,202 bytes
→ 最大 chunk 差異：0 bytes（限制 ≤ +10,000 bytes）
→ CSS chunk：24,046 → 31,786 bytes，差異 +7,740 bytes
```

沒有新增 npm dependency；`package.json` 與 lockfile 未變。

## 2. 舊亮色 class grep

狀態：**PASS**

```text
rg -n --glob '*.{tsx,css,js}' --glob '!dist/**' --glob '!usr_admin/**' --glob '!**/secrets/**' '(slate-|indigo-|bg-white)' src tailwind.config.js
→ 0 matches
```

前端 source 無白名單外殘留。列印白底使用 `@media print` 的原生 `background: white !important`，不是舊亮色 class；Email HTML 位於 worker 且本輪沒有修改。

## 3. 正式部署、首頁與 title

狀態：**PASS**

```text
npx wrangler deploy
→ exit 0；19 個新或異動 static assets 上傳成功
→ Worker Startup Time 6 ms
→ custom domain projects.uic-ai.com
→ Current Version ID: 36fefe71-e62d-46d4-8f6b-09fcb45859e7

curl GET https://projects.uic-ai.com/
→ HTTP 200
→ <title>艾爾水晶-專案進度</title>（不變）
```

## 4. demo 帳號 curl 行為回歸

狀態：**PASS（含一次已診斷的命令錯誤）**

```text
未登入 GET /api/projects
→ HTTP 401；error=請先登入

GET /api/register/meta
→ HTTP 200；enabled=true；groups=4

intern1 POST /api/auth/login（含 Origin: https://projects.uic-ai.com）
→ HTTP 200；role=intern

intern1 GET /api/projects
→ HTTP 200；projects.count=1
```

第一次登入 curl 漏帶既有同源 `Origin` header，因此正確被 CSRF 防護回 403，後續專案請求因無 session 回 401。沒有把該次結果算成通過；唯讀 D1 診斷確認 `intern1` 仍為 active／approved、`failed_count=0`、未鎖定，再補上同源 Origin 重跑後得到上述 PASS。診斷與回歸全程未查詢 password hash，未登入或修改 `usr_admin`。

## 5. 對比度抽查

狀態：**PASS**

使用 WCAG 相對亮度公式計算：

| 抽查組合 | 前景／背景 | 對比值 | 門檻 |
|---|---|---:|---:|
| body 主文字 | `#E6EDF7` / `#070B14` | 16.70:1 | 7:1 |
| panel 主文字 | `#E6EDF7` / `#0D1526` | 15.46:1 | 7:1 |
| panel 次文字 | `#93A4C0` / `#0D1526` | 7.21:1 | 4.5:1 |
| 主按鈕 | `#E6EDF7` / `#1A6FA8` | 4.59:1 | 3:1 |
| 金色標題 | `#E8C878` / `#0D1526` | 11.25:1 | 4.5:1 |

五組皆達 SPEC-V5 §1 底線。

## 6. 決策、禁止範圍與變更紀律

狀態：**PASS**

- `DECISIONS.md` 已追加 v5 的單元素雙線 panel 與 SVG／Recharts token 集中策略。
- `git diff --name-only` 的 protected-path 檢查為 0；沒有觸及 `usr_admin`、`.dev.vars` 或 secrets 路徑。
- 沒有 worker／Email template diff，沒有 migration 或 schema 變更。
- 程式碼依序提交：`4f491d3`（tokens／panel 系統）、`13b1ef8`（共用元件）、`c0937b3`（逐頁 reskin）。

## 7. 視覺回歸

狀態：**派工者待驗證（本環境無法執行瀏覽器抽查）**

```text
本機 Vite preview /login
→ HTTP 200

browser skill 初始化
→ No browser is available

依 troubleshooting 查詢 agent.browsers.list()
→ []
```

因此沒有虛構登入頁、儀表板、專案、看板、日曆、甘特、報表、admin、tour／drawer 或 print preview 的目視結果。已完成可由本環境驗證的 build、source grep、正式 HTTP 行為與數學對比度；逐頁視覺回歸依 SPEC-V5 §5.7 留給派工者以瀏覽器完成。
