# 艾爾水晶-專案進度 v5：Protoss 主題重塑（星海爭霸神族介面）

> 增量規格，疊在 SPEC.md～SPEC-V4.md 之上。**純視覺重塑（reskin）**：所有版面結構、路由、元件層級、功能、文案一律不動，只改樣式層。這是每天要用的工作工具——「像星海」與「好用」衝突時，**好用永遠贏**。

## 0. 設計論述（照此執行，不要自由發揮）

神族介面的本質是「**金色是結構，藍色是能量**」。本主題的全站鐵律：

- **Khaydarin 金 ＝ 靜態結構**：面板邊框、分隔線、標題、品牌、非互動的 chrome。
- **Psi 藍 ＝ 能量與互動**：連結、按鈕、焦點、進度條、圖表主色、hover 光暈、選取狀態。
- 兩色不得混用職責（例如按鈕不得用金色當主色；邊框不得用藍色，除非表示 focus/active）。

## 1. Design Tokens（Tailwind theme extend，全站唯一色彩來源）

```js
colors: {
  void:   "#070B14",   // 頁面最底層背景（深空）
  nexus:  { DEFAULT: "#0D1526", raised: "#131E36", line: "#1C2A47" }, // 面板/懸浮面/格線
  gold:   { DEFAULT: "#C8A24A", bright: "#E8C878", dim: "#8A7133" },  // 結構金三階
  psi:    { DEFAULT: "#35C8FF", deep: "#1A6FA8", glow: "rgba(53,200,255,.35)" },
  star:   { DEFAULT: "#E6EDF7", dim: "#93A4C0" },  // 主文字/次文字
  ok:     "#46E0A0", warn: "#F0B44C", danger: "#FF5A6A",
}
```

- 字體：中文與內文維持系統 Noto Sans TC 堆疊**不變**；拉丁字母標籤與數字用 `uppercase + tracking-[0.14em] + tabular-nums + font-semibold` 營造指揮艦橋感。**不得引入外部字體**（效能與離線考量）。
- 對比底線：內文 star/nexus ≥ 7:1、次要文字 star-dim/nexus ≥ 4.5:1、任何可點元素 ≥ 3:1。交付前抽查主要頁面。

## 2. 招牌元素（全站識別，做精不做多）

1. **Protoss 切角面板**：所有卡片／面板統一「非對稱切角」（左上與右下各切 10–12px，clip-path polygon），1px 金色外框＋內側 1px nexus-line 細線（雙線工法：外層 div 填金色漸層 `linear-gradient(135deg, gold, gold-dim)`，內層同形 clip-path 內縮 1px 填 nexus）。做成單一 `.panel` 元件/工具類，全站重用；小元素（badge、輸入框）只用 4px 單切角或直角，避免瑣碎。
2. **護盾進度條**：progress bar 重塑為能量條——nexus 底、psi 漸層填充（deep→DEFAULT）、填充前緣 2px 亮邊＋微光暈（box-shadow psi-glow）；完成 100% 時轉為金色（結構化＝落成）。儀表板、專案卡、專案頁、/timeline 全部套用。
3. **登入頁儀式感**（唯一的舞台化頁面）：深空背景＋CSS 星點（多重 box-shadow，兩層視差密度）、置中切角面板、頂上一顆緩慢呼吸的 Khaydarin 水晶（兩個旋轉 45° 的方形疊出菱形，金框藍芯，4s opacity 脈動）、副標維持既有卡拉文案。`prefers-reduced-motion: reduce` 時停用脈動與星點動畫。

## 3. 全站套用規則

- 背景層級：body=void；面板=nexus；hover/斑馬紋/下拉=nexus-raised；格線與分隔=nexus-line。
- 導覽列：void 底、下緣 1px 金線；品牌「艾爾水晶」gold-bright；當前頁 psi 底線指示；通知鈴鐺未讀數 psi 圓點。
- 按鈕：主按鈕 psi-deep 底、star 文字、hover 加 psi 光暈；次按鈕透明底金色 1px 框；危險按鈕 danger。所有 focus-visible：2px psi outline。
- 表單：nexus-raised 底、nexus-line 框、focus 轉 psi 框；錯誤訊息 danger；placeholder star-dim。
- 表格／清單視圖：表頭金色小標籤風（uppercase tracking）、列 hover nexus-raised、斑馬紋極淡。
- 看板：欄＝切角面板；卡片 hover 升起＋psi 微光；拖曳中金框。
- 甘特／日曆／圖表（Recharts）：格線 nexus-line、軸文字 star-dim、系列色序 [psi, gold, ok, warn, danger]、tooltip 用 nexus-raised 面板樣式；today 線改 psi。
- 風險 badge：低=ok、中=warn、高=danger，一律深底淺字加 1px 同色框（不再用淺色底）。
- 導覽 tour 與 modal／drawer：遮罩 void/80、聚焦框與泡泡改切角面板樣式。
- **@media print（報表列印）維持白底黑字現狀，不得套深色**。
- **Email HTML 模板維持淺色不動**（郵件客戶端相容性優先）。
- 空狀態文案位置加一枚小型金色菱形圖示（CSS 畫，不引入 icon 庫）。

## 4. 實作與範圍紀律

- 只動：`tailwind.config.js`（tokens）、全域 CSS（@layer components：.panel、能量條、星點、水晶）、各元件 className 置換、Recharts 顏色常數。**不動**：DOM 結構、元件拆分、路由、任何 .ts 邏輯（顏色常數檔除外）、文案。
- 逐頁掃過置換 slate/indigo 類名，不得留下舊亮色殘渣（交付前 grep 檢查 `slate-|indigo-|bg-white`，白名單：print 樣式與 email 模板）。
- 效能：不新增依賴、不新增圖片資產；星點與水晶純 CSS；chunk 大小不得因此成長超過 +10 kB。

## 5. 驗收（寫入 ACCEPTANCE-V5.md）

1. `npm run typecheck`、`npm test`、`npm run build` 全綠；記錄最大 chunk 尺寸與 v4 相比差異（≤ +10 kB）。
2. grep 檢查無殘留亮色類名（白名單除外），結果附清單。
3. `npx wrangler deploy` 成功；GET / 200 且 title 不變。
4. demo 帳號 curl 迴歸：未登入 401、intern 視野、register meta 200——確認 reskin 未動任何行為。
5. 對比度抽查：列出 body/panel、主文字、次文字、主按鈕、金標題五組實測對比值，全部達 §1 底線。
6. DECISIONS.md 增量；如實記錄任何未達成項。
7. 視覺回歸由派工者（Claude）以瀏覽器逐頁抽查，本檔記錄你自己能驗的部分即可。

## 6. 紀律

同 SPEC-V4 §6：不碰 secrets 與 usr_admin、小步 commit（tokens→panel 系統→逐頁→圖表→登入頁→驗收）、不問問題、同錯 3 次換方案記錄。
