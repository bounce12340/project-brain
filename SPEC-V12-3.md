# v12.3：專案分頁籤吸附（sticky tabs）

> 使用者回饋：專案頁往下捲之後，要切換「總覽／任務／進度紀錄／（臨床｜BD｜QA）／檔案／自動化」必須捲回最上面，很麻煩——同一個專案內切換應該隨時可用。

## 1. 行為

- 專案詳情頁的分頁籤列改為 **sticky**：捲動時吸附在導覽列正下方（導覽列若本身 sticky，tabs 的 `top` 須等於導覽列實際高度，用 CSS 變數 `--nav-h` 統一定義並在兩處引用，避免硬編碼數字不同步）。
- 吸附狀態下：底色不透明（或 `backdrop-blur` ＋ 半透明 nexus 底），確保下方內容捲過時不透字；下緣 1px 金線（沿用 v5 結構色規則）作為與內容的分界。
- z-index：低於既有 drawer／modal／tour 遮罩（避免蓋住抽屜與導覽教學），高於一般內容。
- 分頁籤過多時（含臨床／BD／QA 專屬籤最多 6 個）在窄螢幕水平捲動：`overflow-x:auto` ＋ 隱藏捲軸樣式，**不換行**。
- 手機（≤640px）同樣吸附；若導覽列在手機為非 sticky，則 tabs `top:0`。
- 尊重 `prefers-reduced-motion`（不加額外動畫；純吸附即可）。

## 2. 範圍

- 只改專案詳情頁的分頁籤與必要 CSS（`src/pages/ProjectDetailPage.tsx`、`src/styles.css`）。
- **不改**分頁籤的既有邏輯、順序、權限顯示條件與任何資料行為。
- 其他頁面（法規動態篩選列、報表控制列）本次不動。

## 3. 驗收（ACCEPTANCE-V12-3.md）

1. typecheck／test／build 全綠；deploy 成功（無 migration）。
2. built asset 驗證：分頁籤容器含 sticky 定位與 `--nav-h` 變數引用；z-index 低於 drawer/modal 常數（列出實際數值比較）。
3. 迴歸：GET / 200、未登入 401、真實資料 fingerprints 不變、title。
4. 視覺（吸附位置、暗亮兩主題、窄螢幕水平捲動）由派工者以瀏覽器確認；本檔記錄可自驗部分。
5. 結果如實寫入 ACCEPTANCE-V12-3.md。

## 4. 紀律

同 SPEC-V4 §6。單一小步 commit；不碰 usr_admin、secrets 與真實資料。
