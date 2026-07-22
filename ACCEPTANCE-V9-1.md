# SPEC-V9-1 驗收紀錄

驗收日期：2026-07-22（Asia/Taipei）

正式站：<https://projects.uic-ai.com>

部署 Version ID：`0692a145-6305-409f-a5c7-528ae6d0bbca`

## 結論

**PARTIAL PASS**。V9.1 水晶改版、共用 auth 版面、測試、build、built-asset 靜態檢查、正式站 deploy 與 HTTP 迴歸均已實際執行並通過。唯一未冒稱 PASS 的項目是 SPEC-V9-1 §3.5 的雙主題瀏覽器視覺簽核：已依 Browser 流程啟動 runtime、嘗試開啟正式站並執行 browser list，但本環境回傳 `No browser is available` 且可用清單為空，因此無法實際看見 dark／light 畫面。規格指定由派工者做此視覺確認；本檔只記錄可自驗結果與實際阻礙。

全程未登入、修改、重設、停用或刪除 `usr_admin`，未讀取、修改或輸出任何 secret 值；本版沒有 schema 或 migration 變更。

## 1. Typecheck、test、build 與 deploy（§3.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test -- --reporter=verbose` | PASS；14 test files、163/163 tests；含 3 個 V9.1 專項測試 |
| `npm run build` | PASS；Vite 7.3.6、660 modules；產生獨立 `AuthCrystal-BHx0nnXm.js` chunk |
| `npx wrangler --version` | PASS；4.112.0 |
| `npx wrangler deploy` | PASS；20 個新或修改 asset 上傳成功、Worker startup 19 ms、三個既有 cron 保留 |
| 正式版本 | `0692a145-6305-409f-a5c7-528ae6d0bbca` |

## 2. Built-assets 靜態驗證（§3.2）

對 `dist/assets/AuthCrystal-BHx0nnXm.js` 與 built CSS 實際掃描：

| 斷言 | 結果 |
|---|---|
| `viewBox="0 0 100 180"` | PASS |
| `polygon` token 數 | PASS；8（6 個 facet＋1 個高光＋1 個金框） |
| 金框 `#C8A24A` | PASS |
| 舊 `.login-panel` 方形疊加／7rem 補位樣式 | PASS；0 筆 |

外框頂點為 `(50,4) (78,42) (70,130) (50,176) (30,130) (22,42)`；外框包圍盒寬高比為 `56 / 172 = 0.326`，低於規格上限 0.6。六個 facet 分別使用規格指定的六組 psi 藍色與 opacity，另有右上白色高光三角、金色 1.5px 外框與 SVG 內徑向光暈。

## 3. 正式站迴歸（§3.3）

| 驗收 | 結果 |
|---|---|
| `GET /` | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度`，未變更 |
| 未登入 `GET /api/projects` | PASS；HTTP 401 |
| `GET /login` | PASS；HTTP 200 |

## 4. DOM 與文流斷言（§3.4）

V9.1 專項 Vitest 與獨立 PowerShell source assertion 均已實際執行：

- PASS：`LoginPage` 與 `RegisterPage` 都直接使用同一個 `AuthCrystal` 元件。
- PASS：兩頁的 `<AuthCrystal />` 都在 `UIC INTERNAL` 眉標之前。
- PASS：`.auth-crystal` 規則沒有 `position: absolute`，因此外層水晶是正常文流元素。
- PASS：SVG 高度固定 80px，符合 72–88px；`.auth-crystal` 下方 `margin-bottom: 16px`。
- PASS：舊 `.login-panel::before`／`.login-panel::after` absolute 旋轉方形已移除。
- PASS：登入與註冊外層統一使用 `.auth-stage`，panel 統一使用 `.auth-panel`；375px 起使用既有 `px-4` 與 `w-full`，沒有水晶 absolute 疊壓路徑。
- PASS：dark／light 使用不同 halo 強度；`prefers-reduced-motion: reduce` 時 halo 與星點動畫停止。

## 5. 雙主題瀏覽器視覺確認（§3.5）

已實際執行 Browser 初始化、以 `https://projects.uic-ai.com/login` 選擇瀏覽器、讀取連線 troubleshooting，並依指示只執行一次可用瀏覽器清單檢查。結果：

- Browser selection：**UNAVAILABLE**；`No browser is available`。
- Browser list：`[]`。
- Dark 登入／註冊畫面：**派工者瀏覽器待驗**。
- Light 登入／註冊畫面：**派工者瀏覽器待驗**。
- 375px 實際 screenshot／bounding-box 檢查：**派工者瀏覽器待驗**。

此處沒有以 source grep、HTTP 200 或推測取代視覺確認，也沒有把未看見的畫面標為 PASS。可自驗的雙主題 CSS、DOM 文流、80px 高度與 16px 間距已在前述項目通過。
