# V12.3 驗收結果

日期：2026-07-28（Asia/Taipei）

範圍：SPEC-V12-3 section 3 全項。正式站只部署 code/assets 與執行唯讀查詢；沒有 migration、沒有登入或修改 `usr_admin`、沒有建立／修改／刪除真實專案或真實 TFDA 草稿。

## 1. typecheck／test／build／deploy

- PASS — `npm run typecheck`：exit 0，無 TypeScript 錯誤。
- PASS — `npm test`：26 test files passed、274 tests passed；其中 V12.3 新增 4 tests。
- PASS — `npm run build`：Vite 664 modules transformed，build 成功。
- PASS — `npx wrangler deploy`：20 個新／修改 assets 上傳成功，Worker startup 16 ms，production Version ID `de3d9b4f-9082-41fe-b2ab-ec89c7eebd44`。
- PASS — 無 migration：`git diff ba9f9bd..HEAD -- migrations/**` 無輸出；deploy 未執行任何 D1 migration。

## 2. built asset：sticky tabs

本機 build 與 production asset `/assets/index-O7DNDNbq.css` 均實際檢查：

- PASS — `.project-tabs` 含 `position:sticky`。
- PASS — tabs 含 `top:var(--nav-h)`；導覽列含 `height:var(--nav-h)`。
- PASS — `overflow-x:auto`、`white-space:nowrap`、`scrollbar-width:none` 均存在；WebKit scrollbar 同時設為 `display:none`。
- PASS — tabs 底色為 nexus 96% opacity＋backdrop blur，下緣為 1px gold。
- PASS — 實際層級：tabs `20` < nav `30` < drawer/modal `50` < tour `80`；tabs 不會蓋住 drawer、modal 或導覽遮罩。
- PASS — 沒有新增動畫；既有 `prefers-reduced-motion` 行為未被改動。

## 2b. 甘特未排程 Vitest

先執行 `npx vitest run tests/v12-3-task-views.test.ts` 觀察到預期紅燈（4 failed，`buildGanttModel is not a function`），完成實作後同一指令為 4 passed：

1. PASS — 起訖皆空：不進入 timeline `dated`，且計入 `unscheduled`。
2. PASS — 僅 `start_date`：start/end 同為該日，仍繪製時間點。
3. PASS — 僅 `due_date`：start/end 同為該日，仍繪製時間點。
4. PASS — 加入 `created_at=1999-01-01` 的未排程任務前後，圖表 start/end 完全相同。

另以 source read-back 確認 `TaskViews.tsx` 的甘特實作已沒有 `created_at` fallback。

## 3. production 迴歸與 fingerprints

- PASS — `GET https://projects.uic-ai.com/`：200。
- PASS — 未登入 `GET /api/projects`：401。
- PASS — title：`艾爾水晶-專案進度`。
- PASS — production JS 含中英未排程文案與提示；production CSS 含本版 sticky 規則。
- PASS — deploy 前後唯讀 COUNT 與完整列 SHA-256 均相同：

| 保護資料 | count | deploy 前／後 SHA-256 |
|---|---:|---|
| TFDA drafts | 16 | `b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e` |
| published reg entries | 631 | `ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db` |
| TFDA tombstones | 4 | `138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d` |
| real projects | 32 | `7d5ec7403debdd0e2495205c65b3861db97c4a7c16f3530fe3b8821aec4e4d32` |
| real project tasks | 10 | `99bd54ee96051319b267957fd58ffdd7099a30c3765844350ca8c271b84d17ac` |
| real project milestones | 5 | `a505fa9890f7b2b898a614afe31b1be6d4b42acaf6b3e628caaf326cad15abc9` |
| real project progress updates | 124 | `bac84cf8da41966538ce6dc943667c5fb1a3f4a267a57cff600c56e111d2df4a` |

## 4. 瀏覽器視覺與互動

使用本機 D1 的 `prj_e2e_v12_3_visual` demo project；沒有開啟 production 真實專案。

- PASS — 暗色主題、頁面捲動 700px：nav `top=0`、`bottom=101`，tabs `top=101`，computed `position=sticky`、`top=101px`、`z-index=20`；底色 `rgba(13, 21, 38, 0.96)`，金色下緣 `rgb(200, 162, 74)`，下方內容沒有透字。
- PASS — 亮色主題、同一捲動位置：tabs 仍為 `top=101`；底色 `rgba(251, 249, 244, 0.96)`，金色下緣維持清楚。
- PASS — viewport override 375×812（實際 content viewport 360px）：6 個 tabs 單列，`flex-wrap=nowrap`、`overflow-x=auto`；`scrollWidth=441 > clientWidth=326`，可水平捲動且 tabs scrollbar 未顯示。
- PASS — 手機寬度吸附：nav height/bottom 與 tabs top 均為 101px。
- PASS — 甘特 demo：14 筆全空日期任務未進時間軸，畫面顯示「未排程（14）」與「設定起訖日後會顯示於時間軸」；兩筆單一日期任務呈現 2 個點、沒有任務長條。
- PASS — 點「未排程任務 01」開啟既有任務抽屜，抽屜內可見起日／訖日欄位。
- PASS — 日曆頁尾顯示「未排程 14 項」。
- PASS — 本機 fixture 清理 read-back：users/projects/stages/tasks/sessions/audit_log 全為 0。

## 5. 結論

SPEC-V12-3 section 3 的 1、2、2b、3、4、5 均已實際執行並通過；沒有跳過或無法驗證項目。
