# 艾爾水晶-專案進度 v9：英文版（i18n）＋明暗主題切換

> 增量規格，疊在既有全部規格之上；未提及行為不變。兩個功能都是純前端為主的橫切改造，**不得改動任何權限、資料或 API 行為**（除本檔明列的 lang 參數）。

## 1. i18n 雙語（zh-TW ⇄ EN）

### 1a. 基礎建設（比照使用者既有 PV-Link 的自製字典模式，不引入 i18n 套件）

- `src/i18n/translations.ts`：`zh` 與 `en` 兩本字典；`en` 型別 `Record<TransKey, string>` 保證 key 齊全，另加 vitest key-parity 測試雙保險。
- `src/i18n/LangContext.tsx`：`useT()`／`useLang()`；localStorage key `AIUR_LANG`，預設 `zh`；`<html lang>` 同步切換 `zh-Hant-TW`／`en`。
- 導覽列加「中／EN」切換鈕（與主題鈕相鄰）。

### 1b. 翻譯範圍

- **全部 UI 字串 key 化**：導覽、所有頁面、按鈕、表單 label 與 placeholder、空狀態、confirm／alert、toast、tour 全部步驟、/help 全文、相對時間（「3 天前」→"3 days ago"）、日期顯示格式（en 用 `MMM D, YYYY`）。
- **不翻譯**：使用者資料（專案名、進度內容、法規條目、留言等）；後端 Email 一律維持繁中（組織語言，記入 DECISIONS）。
- **後端錯誤訊息**：後端維持現有繁中字串不動；前端建立「常見錯誤字串 → key」對照表（至少涵蓋 401/403/422 常見 20 句），對不到的原样顯示。
- 英譯品質要求：專業、簡潔、術語一致（Kanban／Gantt／OKR／CCR／License 等）；禁止機翻腔。

### 1c. AI 輸出語言

- 個人即時性 AI 端點加選填 `lang`（`zh`｜`en`，預設 zh）：`/api/ai/draft-update`、`/api/ai/task-summary`、`/api/ai/project-risk`、`/api/ai/schedule-suggest`（建議理由）。前端帶當前介面語言；prompt 依 lang 產出對應語言。
- **維持繁中不變**：週報／月報（組織產物）、regwatch AI 匯入的解析結果（法規知識庫資料一致性）、所有 Email。

## 2. 明暗主題切換

### 2a. Token 基礎改造

- 把 v5 的色彩 token 從 Tailwind 靜態色改為 **CSS custom properties**：`:root[data-theme="dark"]` 與 `:root[data-theme="light"]` 兩組變數，Tailwind colors 改引用 `rgb(var(--...) / <alpha-value>)`。既有 className 全部不用改。
- localStorage key `AIUR_THEME`，**預設 dark**（神族本色）；導覽列 ☀／🌙 切換鈕；切換即時生效無閃爍（`<html>` 預先以 inline script 設 data-theme 防 FOUC）。
- Recharts 與甘特／日曆 SVG 的顏色常數改為讀取 CSS 變數（或依 theme context 取值），切換主題時圖表即時換色。

### 2b. 亮色系設計（神族白晝神殿：金仍是結構、藍仍是能量）

| Token | Dark（現行） | Light |
|---|---|---|
| void（頁底） | #070B14 | #F1EDE3（暖象牙石） |
| nexus（面板） | #0D1526 | #FBF9F4 |
| nexus-raised | #131E36 | #FFFFFF |
| nexus-line | #1C2A47 | #D8D0BC |
| gold 結構線 | #C8A24A | #C8A24A（沿用，象牙底上更亮眼） |
| gold 標題字 | #E8C878 | #8A6D1F（深金，對比達標） |
| psi 互動 | #35C8FF | #0B76B8（深 psi） |
| 主文字 | #E6EDF7 | #1B2436 |
| 次文字 | #93A4C0 | #55617A |
| ok / warn / danger | 現行 | #1F7A56 / #9A6A14 / #C22F40（深化達標） |

- 切角面板、雙線工法、護盾進度條（psi 漸層、滿格轉金）、風險 badge 樣式在兩主題下都必須成立。
- 登入頁亮色版：星點動畫僅暗色顯示；亮色改極淡金色幾何紋理或純淨漸層，水晶（金框藍芯）兩色通用。
- 對比度硬底線同 SPEC-V5 §1（主文字 ≥7:1、次文字 ≥4.5:1、互動元素 ≥3:1），亮色系交付前逐組實算並記錄。
- @media print 維持既有白底樣式，不受主題影響。

## 3. 測試（vitest ≥8）

zh/en key parity、缺 key 偵測、lang 預設與 localStorage 邏輯、相對時間雙語、theme 預設 dark 與持久化、light token 對比度計算（程式驗證上表全組）、AI lang 參數 prompt 分流、後端錯誤對照 fallback。

## 4. 驗收（ACCEPTANCE-V9.md；demo 帳號；不碰 usr_admin 與 secrets）

1. typecheck／test／build 全綠；bundle 差異記錄（字典體積如實列出）。
2. deploy 成功；無 migration（本版不動 schema——若發現需要，停下記入 DECISIONS 再評估）。
3. 正式站 E2E：`/api/ai/task-summary` 帶 `lang:'en'` 回英文摘要（記錄 fallback 與否）；帶 `lang:'zh'` 回繁中；regwatch ai-extract 確認輸出仍為繁中；迴歸（401、intern 視野、627 筆、title）。
4. 靜態驗證：built assets 內含 en 字典樣本字串與 `data-theme` 切換邏輯；`<html lang>` 動態切換程式存在。
5. 視覺雙主題×雙語言的逐頁抽查由派工者（Claude）以瀏覽器執行，本檔記錄可自驗部分。
6. /help 與 README 補充語言與主題說明；DECISIONS.md 記錄「Email 與組織報告維持繁中」等決策；結果如實寫入 ACCEPTANCE-V9.md。

## 5. 紀律

同 SPEC-V4 §6。commit 順序：i18n 基礎→字典與逐頁 key 化→AI lang→theme token 改造→light palette→切換鈕與 FOUC 防護→驗收。字典檔案很大沒關係，但禁止漏 key（parity 測試會抓）。
