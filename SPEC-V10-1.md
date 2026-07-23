# v10.1：法規動態列表刪除 icon（使用者已核准的微調）

## 1. 需求

- /regwatch 列表每列右側（展開／收合指示旁）新增**小型刪除 icon 按鈕**（垃圾桶造型，CSS/SVG 自繪，不引入 icon 庫），僅 `can_manage`（RA/PV 組成員與 admin）可見。
- 點擊：**不展開條目**、不觸發列展開事件（stopPropagation），直接跳既有確認視窗（沿用 `regwatch.deleteConfirm` 文案含條目標題）；確認後走既有 DELETE 流程（含孤兒附件清理）。
- 展開內容底部既有的「編輯／刪除」按鈕保留不動。
- icon 樣式：star-dim 色、hover 轉 danger 色＋微光暈；兩主題（dark/light）皆需成立；焦點環（focus-visible）正常。
- i18n：icon 的 `aria-label`／tooltip 用既有 `common.delete`（中英 parity 不變）。

## 2. 驗收（ACCEPTANCE-V10-1.md）

1. typecheck／test／build 全綠（如有新增測試列出）；deploy 成功。
2. built asset 驗證：列層級刪除按鈕存在且帶 stopPropagation。
3. 迴歸：GET / 200、未登入 401、法規列表 API 正常。
4. 視覺與行為（點 icon 不展開、直接出確認框）由派工者瀏覽器確認；本檔記錄可自驗部分。
5. 結果如實寫入 ACCEPTANCE-V10-1.md。

## 3. 紀律

同前：不碰 usr_admin 與 secrets、小步 commit、不問問題。
