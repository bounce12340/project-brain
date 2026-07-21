# SPEC-V9 驗收紀錄

驗收日期：2026-07-22（Asia/Taipei）

正式站：<https://projects.uic-ai.com>

最終部署 Version ID：`2d30ae91-b619-403e-bc77-db1a39ecf222`

## 結論

**PARTIAL PASS**。SPEC-V9 §4 的六項均已實際執行或啟動，結果沒有省略：typecheck／160 tests／build、bundle、無 migration 部署、正式站雙語 AI、regwatch 繁中、401、intern 視野、title、靜態 built-assets、README／help／決策都完成且有實測證據。

兩項不能標為 PASS：

1. 規格要求 627 筆法規資料，但正式站 E2E 前後皆為 628；本輪資料不變，沒有刪除來源不明資料迎合驗收。
2. §4.5 指定由派工者 Claude 執行逐頁視覺抽查。Codex 已依 Browser 技能啟動瀏覽器驗收，但環境回報沒有可用 browser backend；因此可自驗的四組 theme/lang 邏輯已完成，Claude 視覺簽核仍為外部待驗，未冒稱通過。

全程未登入、修改、重設、停用或刪除 `usr_admin`，未讀取或輸出任何 secret 值。正式 E2E 只使用隨機密碼的 V9 專用 demo fixtures，結束後 cleanup 成功。

## 1. Typecheck、test、build 與 bundle（§4.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test -- --reporter=verbose` | PASS；13 test files、160/160 tests |
| V9 專項 | PASS；key parity、英文非空且除語言按鈕外無漢字、lang storage、相對時間、27 句錯誤 mapping、theme storage／FOUC、light contrast、AI prompt 與 fallback |
| `npm run build` | PASS；Vite 7.3.6、659 modules、22 個 dist 檔案 |

Build 前（V8 dist）與 V9 build 後的 raw assets：

| 指標 | V8 dist | V9 dist | 差異 |
|---|---:|---:|---:|
| asset 數 | 20 | 20 | 0 |
| assets 總體積 | 792,658 B | 859,055 B | +66,397 B |
| 主 `index-*.js` | 179,017 B | 239,833 B | +60,816 B |
| 最大 chunk | 377,202 B | 377,202 B | 0 B |
| `translations.ts` source | — | 62,217 B | 如實列出 |

字典增加量與主 chunk 增量相近；最大 Recharts chunk 沒有增加。

Light palette 對比程式實算：主文字／nexus `14.76:1`、次文字／nexus `5.91:1`；互動色／白底分別為 deep gold `4.90:1`、psi `4.89:1`、ok `5.28:1`、warn `4.72:1`、danger `5.56:1`，均高於 SPEC-V5／V9 硬底線。

## 2. Deploy 與 migration（§4.2）

- `npx wrangler deploy`：PASS。
- Custom domain：`projects.uic-ai.com`。
- 最終 Worker startup：34 ms。
- 三個既有 cron 均保留：每日、每週、每月。
- 本版沒有新增 migration，也沒有執行 migration apply；schema／資料契約未因 V9 變更。

## 3. 正式站 E2E（§4.3）

執行：`node scripts/v9-e2e.mjs`。腳本建立三個 V9 專用 demo 使用者、兩個 private 專案與一個英文 task；intern 只加入其中一個專案。所有密碼都只存在程序記憶體，最後刪除 projects、sessions 與 users；輸出 `cleanup: true`。

| 驗收 | 結果 |
|---|---|
| 首頁／title | PASS；HTTP 200，`艾爾水晶-專案進度` |
| 未登入 API | PASS；`/api/projects` HTTP 401 |
| task-summary `lang:'en'` | PASS；HTTP 200、英文、`fallback:false`、摘要無漢字 |
| task-summary `lang:'zh'` | PASS；HTTP 200、繁中、`fallback:false`、摘要含繁中敘述 |
| regwatch ai-extract | PASS；HTTP 200，title 與 key_points 均含繁中；沒有寫入資料 |
| intern 視野 | PASS；只看得到已加入 fixture（1 個），看不到 private control fixture |
| 法規資料本輪不變 | PASS；E2E 前 628、後 628 |
| 規格字面 627 | **FAIL**；正式基線為 628 |

最終成功輸出的英文摘要樣本以 “The task … requires validation …” 開頭；繁中摘要以「此任務…要求驗證…」開頭。兩次都走 live AI，沒有使用 rule-based fallback。

## 4. Built-assets 靜態驗證（§4.4）

| 檢查 | 結果 |
|---|---|
| 英文字典樣本 | PASS；`Regulatory Watch` 存在於 `dist/assets/index-CuoiPL6W.js` |
| 預設 theme | PASS；`dist/index.html` 有 `data-theme="dark"` |
| 防 FOUC | PASS；inline script 在 React 前讀 `AIUR_THEME` 並設定 `documentElement.dataset.theme` |
| 動態 html lang | PASS；inline script 讀 `AIUR_LANG`，在 `en`／`zh-Hant-TW` 間切換；LangContext 於執行期同步更新 |
| CSS palette | PASS；built CSS 同時含 dark／light token，Tailwind 色彩使用 CSS variables |

## 5. 雙主題 × 雙語視覺抽查（§4.5）

已執行的可自驗部分：

- `[data-theme=dark|light]` 兩套完整 token、預設 dark、localStorage restore、pre-render guard 均由 test 與 built HTML 驗證。
- `zh`／`en` exact key parity 與所有英文值完整性由 Vitest 驗證；導覽、頁面、表單、空狀態、confirm／alert、tour、help 均使用字典 key。
- chartTheme、Recharts 與原生 SVG 使用 live CSS variables；login 星點只在 dark 顯示，light 使用淡金漸層；print 規則獨立白底。
- 嘗試透過 in-app Browser 開啟正式站執行四組逐頁視覺抽查，browser runtime 回傳 `No browser is available`，可用 browser list 為空。

因此以下派工者簽核矩陣不能由本執行環境代簽：

| 語言 | Dark | Light |
|---|---|---|
| 繁中 | Claude browser 待驗 | Claude browser 待驗 |
| English | Claude browser 待驗 | Claude browser 待驗 |

此處依 SPEC 原文保留 Claude 的責任邊界；不以 API、source grep 或虛構 screenshot 冒充逐頁視覺 PASS。

## 6. Help、README 與決策（§4.6）

- `/help`：PASS；繁中與英文均包含「語言與主題」、切換、持久化、個人 AI 與組織產物語言說明。
- `README.md`：PASS；版本／測試更新為 V9／160，介面總覽與「語言與主題」操作段落已補齊。
- `DECISIONS.md`：PASS；記錄 Email 與組織報告／regwatch 固定繁中、中文 enum 僅翻譯 label、CSS-variable token、無 migration、628 open issue 與 Claude 視覺待驗。
- 本文件已如實記錄 PASS／FAIL／外部待驗，沒有把未執行成功的視覺簽核寫成完成。
