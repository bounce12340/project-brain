# V13.1 驗收紀錄

驗收日期：2026-07-28（Asia/Taipei）

本文件逐項對應 `SPEC-V13-1.md` §5。只有實際執行並看到成功輸出的項目標為 PASS。瀏覽器驗收只在本機建立固定 `is_demo=1` 專案 `prj_demo_v13_1_local`，沒有在 production 建立任何 demo 或專案；完成後本機 project、stages、tasks、milestones 均刪除並回讀為 0。Production D1 僅執行 SELECT fingerprints，全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未檢視或變更任何 secret 值，未建立、核准、修改或刪除任何真實 TFDA draft／published／tombstone，也未寫入使用者真實專案。

## 1. Typecheck／test／build／deploy（§5.1）

實際執行：

```text
npm run typecheck
npm test -- --run
npm run build
git diff --check
node --check scripts/v13-1-acceptance.mjs
node scripts/v13-1-acceptance.mjs --verify-built
npx wrangler d1 migrations list project-brain-db --remote
npx wrangler deploy
```

結果：

- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，30 test files、320 tests 全部通過。
- V13.1 新增 `tests/v13-1-gantt.test.ts`：PASS，6 tests，覆蓋任務→階段→色、無階段／無色 fallback、完成透明度、圖例過濾與 position 排序、18/52 尺寸、全域 timeline 階段 metadata；超過規格要求的 4 tests。
- Vite：PASS，669 modules transformed，production assets 成功產出。
- `git diff --check`：PASS；只有既有 Windows LF→CRLF 提示，沒有 whitespace error。
- Acceptance script syntax：PASS。
- Migration：PASS；Wrangler 明確回報 `No migrations to apply!`，本版沒有 migration。
- Deploy：PASS；22 個新／修改 assets 上傳，Worker startup 18 ms，custom domain `projects.uic-ai.com`，Version ID `e8bf9222-099d-479e-9a58-3eef80809c74`。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

結果：PASS。

## 2. Built asset 驗證（§5.2）

`node scripts/v13-1-acceptance.mjs --verify-built` 實際掃描最終 `dist`：

| 項目 | 結果 |
|---|---|
| 任務橫條高度 | PASS；`data-gantt-task-height=18` |
| 專案甘特列高 | PASS；`data-gantt-row-height=52` |
| 階段色任務 branch | PASS；`data-stage-colored-task` 與 fill-opacity 邏輯存在 |
| 圖例渲染 | PASS；`data-gantt-legend` 存在 |
| `/timeline` 階段 mapping | PASS；built asset 含 `stage_color`／`stage_position` |
| Built files | PASS；驗收腳本讀取 25 個 index/assets 檔案 |

Deploy 後另以 HTTP 實際抓回以下 production assets：

```text
/assets/GanttLegend-CMXAgjYp.js
/assets/ProjectDetailPage-B52gkDjx.js
/assets/TimelinePage-DBbKgRdV.js
```

三個 production assets 合併檢查：

| Marker | 結果 |
|---|---|
| `data-gantt-task-height` | PASS |
| `data-gantt-row-height` | PASS |
| `data-stage-colored-task` | PASS |
| `data-gantt-legend` | PASS |
| `stage_color` | PASS |

結果：PASS。

## 3. 瀏覽器視覺確認（§5.3）

執行者以 Chrome 操作最終 build 的 `http://127.0.0.1:8787`。資料只來自本機固定 `is_demo=1` 專案 `prj_demo_v13_1_local`：

- 階段：規劃 `#fef3c7`（position 0）、審查 `#8b5cf6`（position 1）、上線 `#0f766e`（position 2）、無任務階段 `#dc2626`（position 3）。
- 任務：三個已排程任務，其中規劃任務已完成。
- 非階段項目：一個 milestone、一個 history event。

### 3.1 專案甘特

| 項目 | 實際結果 |
|---|---|
| 亮色桌面 1440×900 | PASS；theme `light`、nexus `251 249 244`，三個階段色清楚不同 |
| 暗色桌面 1440×900 | PASS；theme `dark`、nexus `13 21 38`，三個任務標籤均可讀 |
| 窄螢幕 390×844 | PASS；圖表容器水平捲動，任務條仍為 18px |
| 任務條顏色 | PASS；實測 `#0f766e`、`#fef3c7`、`#8b5cf6` |
| 未完成透明度 | PASS；2/2 為 `0.85` |
| 完成透明度／勾記 | PASS；完成列 `0.45` 且勾記保留 |
| 淺色描邊 | PASS；`#fef3c7` 任務條描邊 `#9d977b`、1px |
| 圖例內容 | PASS；依 position 顯示規劃、審查、上線；沒有任務的 `無任務階段` 未顯示；另含 Milestones 與 History events |
| 圖例換行 | PASS；390px viewport 時圖例寬 322px、高度由桌面 35px 墈為 61.5px，兩行完整顯示 |
| 里程碑 | PASS；放大後維持實心金菱形，不受階段色影響 |
| 歷程事件 | PASS；放大後維持空心淡金菱形，不受階段色影響 |
| 列高 | PASS；DOM `data-gantt-row-height=52`，列間無擁擠 |

第一輪瀏覽器驗收實際找到並修正兩個問題，沒有把失敗嘗試冒充 PASS：

1. 圖例原本繼承整張寬圖表的寬度，390px 時不會在 viewport 內換行；改為 viewport 扣除 4rem 且上限 900px，仍位於相同水平捲動容器且不 sticky。
2. 既有「Project range」SVG 標籤沒有指定 fill，在暗色主題呈現黑字；改為 `CHART.star`，暗色複驗回讀 `rgb(var(--color-star))` 且畫面可讀。

### 3.2 全域 `/timeline`

展開 `V13.1 多階段甘特 Demo` 後實際 DOM 與畫面：

- 三個展開任務條高度全為 18。
- 階段色依序為 `#fef3c7`、`#8b5cf6`、`#0f766e`。
- 完成／未完成透明度分別為 0.45／0.85；淺色列保留深階描邊。
- 全域圖例可見，含實際有任務的階段與 milestone/history event 符號。
- History event 維持空心淡金菱形並同步放大。

### 3.3 Cleanup

瀏覽器驗收後登出本機 demo session，停止本機 server，刪除固定 demo 專案並 read-back：

| 本機 demo scope | count |
|---|---:|
| projects | 0 |
| stages | 0 |
| tasks | 0 |
| milestones | 0 |

結果：PASS。

## 4. 迴歸與資料保護（§5.4）

Deploy 前後各執行一次 `node scripts/v13-1-acceptance.mjs --snapshot`；兩次結果逐字相同：

| 驗收 | Before | After | 結果 |
|---|---:|---:|---|
| 未登入 API | — | 401 | PASS |
| homepage／title | — | 200／`艾爾水晶-專案進度` | PASS |
| published | 631 | 631 | PASS |
| 真實 TFDA drafts | 16 | 16 | PASS |
| TFDA tombstones | 4 | 4 | PASS |
| 使用者真實 projects | 32 | 32 | PASS |
| 使用者真實 tasks | 10 | 10 | PASS |
| 使用者真實 milestones/events | 13 | 13 | PASS |
| 使用者真實 progress updates | 125 | 125 | PASS |

Fingerprints（before = after）：

- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`a1e60f6af9b49b288cd1a7bb70d718f2278d65e18a4a062e1b5f2c7444d1325a`
- real tasks：`99bd54ee96051319b267957fd58ffdd7099a30c3765844350ca8c271b84d17ac`
- real milestones/events：`34235b100b2f392ac9831c24046edde0317f810e661a540d3ff0e64edc02ad23`
- real progress：`80d7a6afa721078018377d6b6c577767edffabea5a59f946b6246cbe4c85f0c3`

Production 驗收沒有建立 session、user、project 或其他資料列；除 Worker／assets deploy 外，remote D1 全部是唯讀 SELECT。

結果：PASS。

## 5. 結果文件與 DECISIONS（§5.5）

- `ACCEPTANCE-V13-1.md`：PASS；本文件已記錄 §5 所有實際指令、數字、browser 操作、第一輪問題、修正、deploy 與 fingerprints。
- `DECISIONS.md`：PASS；增量記錄共用階段色規則、fallback／亮色描邊門檻、全域 timeline metadata、圖例去重排序與窄螢幕換行。
- Open decisions：無。本版沒有 migration，也沒有需要資料擁有者裁決的正式資料差異。

## Commits

1. `d0c3b3b feat: color gantt tasks by stage`
