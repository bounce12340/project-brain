# V10.1 驗收紀錄

日期：2026-07-23（Asia/Taipei）

結論：列層級刪除 icon 已實作並部署；typecheck、177 tests、build、built/production asset 與正式 API smoke 均通過。SPEC-V10-1 §2.4 的實際瀏覽器視覺／點擊簽核因本環境沒有任何 browser backend，結果為「無法驗證」，因此本次驗收不是全綠。

## 1. typecheck／test／build／deploy（§2.1）

| 項目 | 實際指令 | 結果 |
|---|---|---|
| typecheck | `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| test | `npm test` | PASS；16 test files、177 tests 全數通過 |
| 新增測試 | `tests/v10-1-core.test.ts` | PASS；4 tests，涵蓋 `can_manage` gate、`common.delete` aria/tooltip、`stopPropagation`＋既有 remove、SVG、展開區既有按鈕、主題 token 與 i18n parity |
| build | `npm run build` | PASS；Vite 660 modules transformed，23 個 dist files；`RegwatchPage-evJqtA1f.js` 15.39 kB、`index-BURH6aIR.css` 36.27 kB |
| deploy | `npx wrangler deploy` | PASS；20 個新／變更 assets 上傳、2 個沿用，Worker startup 19 ms |

部署保留 custom domain `projects.uic-ai.com` 與三個既有 cron。Version ID：`cdf1c7dd-6e73-4701-a0ea-6c1507dad2a7`。

## 2. built asset（§2.2）

本機 `dist` 對 `RegwatchPage-evJqtA1f.js` 與 `index-BURH6aIR.css` 做 read-back：

| 斷言 | 結果 |
|---|---|
| `data-regwatch-row-delete` | PASS |
| 按鈕受 `can_manage` gate 控制 | PASS |
| marker 鄰近 click handler 含 `.stopPropagation()` | PASS |
| chunk 仍含既有 `method:"DELETE"` 流程 | PASS |
| `aria-label` 與 trash SVG `viewBox="0 0 24 24"` | PASS |
| `.regwatch-row-delete` 使用 star-dim | PASS |
| hover danger 色與 `12px` danger glow | PASS |
| 全域 `focus-visible` 規則存在 | PASS |

正式站 read-back：

- `GET /assets/RegwatchPage-evJqtA1f.js`：200；marker、`can_manage`、`stopPropagation`、aria-label、SVG 全部 PASS。
- `GET /assets/index-BURH6aIR.css`：200；row delete selector、star-dim、danger hover/glow、focus-visible 全部 PASS。

第一次 built verifier 使用過度精確的 minified 字串比對，把函式別名與 CSS 空白差異誤判成兩個 false；read-back 實際 minified 片段後改成語意相同的斷言，最終全部通過。這是 verifier pattern 問題，不是重新 build 後才消失的產品問題。

## 3. 正式站迴歸（§2.3）

執行：`node scripts/v10-1-smoke.mjs`。

腳本只建立 V10.1 專用、非 admin 的 RA/PV demo member 與一小時 session；只執行 GET，`finally` 精確刪除 session/user 並 read-back。

| 斷言 | 結果 |
|---|---|
| `GET /` | PASS；200 |
| 未登入 `GET /api/regwatch` | PASS；401 |
| 已登入 RA/PV `GET /api/regwatch` | PASS；200 |
| response `can_manage` | PASS；`true` |
| response `entries`／`total` shape | PASS；array／integer |
| 正式法規筆數 | 631（與既有 V10 open decision 一致，本輪未新增或刪除法規） |
| fixture cleanup | PASS；專用 user/session read-back 皆為 0 |

## 4. 視覺與行為（§2.4）

結果：**無法驗證**。

實際執行過的 Browser 流程：

1. 初始化 in-app Browser runtime。
2. 以 `/regwatch` 目標 URL 選擇 browser，結果為 `No browser is available`。
3. 依 Browser skill 讀取 bootstrap troubleshooting。
4. 執行 browser discovery，結果為 `[]`。

因此未取得 dark/light screenshot，也沒有用真正瀏覽器點擊 icon；「點 icon 不展開、直接顯示含標題的確認框」不可標 PASS。可自驗部分已確認：

- 刪除按鈕與展開按鈕是並列 sibling，沒有巢狀 button。
- click handler 先 `event.stopPropagation()`，再呼叫既有 `remove(item)`。
- `remove(item)` 仍先呼叫既有 `regwatch.deleteConfirm`（含 title），確認後走既有 DELETE。
- 正式 JS/CSS asset 已包含上述 handler 與雙主題 custom-property 樣式。

待有可用瀏覽器的派工環境補做 dark/light、focus ring、hover 與實際點擊簽核；此 open decision 已寫入 `DECISIONS.md`。

## 5. 需求與限制 read-back（§2.5）

- 列底部既有「編輯／刪除」按鈕保留；新增測試 read-back 通過。
- icon 為內嵌 SVG，未新增 icon library 或其他 dependency。
- aria-label 與 tooltip 都使用既有 `common.delete`；繁中 `刪除`、英文 `Delete`，key parity 通過。
- 沒有對 `usr_admin` 做登入、SQL/API 讀寫、重設、停用或刪除；正式 smoke 使用獨立 non-admin fixture。
- 沒有執行 secrets CLI/API、沒有讀寫 secret store 或變更任何 secrets。
- 但在查 schema 時曾使用範圍過大的唯讀 `rg`，工具輸出意外包含既有 seed migration 的 `usr_admin` password hash 行；該值未被使用、複製或修改。若「never touch secrets」包含不得讓既有 seed hash 出現在工具輸出，這一點不符合限制，於此如實揭露。

實作 commit：`a7e567d feat: add regwatch row delete icon`。
