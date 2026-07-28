# V13 驗收紀錄

驗收日期：2026-07-28（Asia/Taipei）

本文件逐項對應 `SPEC-V13.md` §6。只有實際執行並看到成功輸出的項目標為 PASS。Production 驗收只建立固定 `is_demo=1` 的 V13 demo user 與短效 session，沒有建立任何 project；結束後已清除並回讀為 0。全程未登入、查詢、修改、重設、停用或刪除 `usr_admin`，未讀取或變更 secret 值，未建立、核准、修改或刪除任何 TFDA draft／published／tombstone，也未寫入使用者真實專案。

## 1. Typecheck／test／build／deploy（§6.1）

實際執行：

```text
npm run typecheck
npm test -- --run
npm run build
git diff --check
node --check scripts/v13-acceptance.mjs
npx wrangler d1 migrations list project-brain-db --remote
npx wrangler deploy
```

結果：

- `tsc --noEmit`：PASS，exit 0。
- Vitest：PASS，29 test files、314 tests 全部通過；新增 `tests/v13-help.test.ts` 19 tests，超過規格要求的 10 tests。
- Vite：PASS，667 modules transformed，production assets 成功產出。
- `git diff --check`：PASS。
- Migration：PASS；Wrangler 明確回報 `No migrations to apply!`，本版未執行 migration。
- Deploy：PASS；custom domain `projects.uic-ai.com`，Worker startup 16 ms，Version ID `fa5fbe7b-6cc4-456c-b4a8-28ddeed6da69`。
- 測試 stderr 的 `TFDA cron pre-step failed / offline` 是 V11 既有錯誤隔離測試的預期訊息；該測試 PASS。

## 2. Built asset 驗證（§6.2）

`node scripts/v13-acceptance.mjs --verify` 實際檢查最終 `dist`：

| 項目 | 結果 |
|---|---|
| HelpTip built markers | PASS；`help-tip-bubble`、`What it is` 與 tooltip CSS 存在 |
| §2 topic keys | PASS；41/41 全數出現在 built assets |
| `/help` 三段結構 | PASS；快速上手、概念比較、功能索引皆存在 |
| 深連結 | PASS；`quickstart`、A/B/C、`concepts`、`feature-index` 共 6 個主要錨點存在 |
| 專案導覽 | PASS；14 steps，代表性 built selector `project-overview` 存在 |
| 法規導覽 | PASS；9 steps，`regwatch-ai-mode`、`regwatch-attachments` 存在 |

內容品質另由 19 個 V13 測試檢查：

- 每個中英文 topic 都有 `what`、具體 `fill` 實例、有效 `/help#...` 連結；需要釐清者含 `difference`。
- 五個概念的 tooltip 與比較表共用同一份 `CONCEPT_DEFINITIONS`，避免兩處說法漂移。
- 中文定義／指引／差異與英文句長有上限；禁用「用於管理 X」「X 是 X」等同義反覆文案。
- 41 個 topic 的實際 JSX placement、所有 literal topic key、雙語 parity、錨點與導覽 selector 均有自動測試。

Bundle 與開工基線比較：

| Chunk | 開工 raw / gzip | 最終 raw / gzip | 差異 |
|---|---:|---:|---:|
| CSS | 38.18 / 7.41 kB | 40.71 / 7.76 kB | +2.53 / +0.35 kB |
| HelpPage | 2.20 / 0.83 kB | 10.83 / 4.62 kB | +8.63 / +3.79 kB |
| ProjectDetailPage | 130.69 / 35.33 kB | 132.55 / 35.77 kB | +1.86 / +0.44 kB |
| entry index | 255.12 / 84.69 kB | 261.72 / 87.65 kB | +6.60 / +2.96 kB |
| 新 HelpTip chunk | — | 2.56 / 1.10 kB | lazy-loaded |
| 新 help-topics chunk | — | 18.32 / 8.01 kB | lazy-loaded |

結果：PASS。內容資料主要在 route lazy chunks，不把完整手冊塞進首頁同步載入。

## 3. 正式站 E2E（§6.3）

正式站使用固定 demo user `usr_e2e_v13_help`，以短效 demo session 驗證；完成後 user、sessions、audit rows 均清為 0。

| 驗收 | 結果 |
|---|---|
| Demo session `/api/auth/me` | PASS；HTTP 200 |
| `GET /help` | PASS；HTTP 200 |
| production asset graph | PASS；抓取 45 個實際部署 JS assets |
| 繁中概念 | PASS；任務／里程碑／歷程事件／進度紀錄／待辦 5/5 |
| English 概念 | PASS；Task／Milestone／History event／Progress update／To-do 5/5 |
| HelpTip／manual／tour markers | PASS；production chunks 皆存在 |

實際 EN 切換另以瀏覽器登入本機固定 demo 帳號操作同一份最終 `dist`：切換後 `/help` 顯示 `Quick start`、`How these concepts differ` 與五個英文概念；里程碑 tooltip 顯示 `What it is`、`What to enter`、`How it differs`，且保留 `2026-08-14` 實例。正式站部分以 demo-authenticated HTTP 與部署後 asset graph 驗證，沒有接管或覆寫 Chrome 中既有的正式站真實使用者 session。

結果：PASS。

## 4. 迴歸與資料保護（§6.4）

| 驗收 | 結果 |
|---|---|
| 未登入 API | PASS；`GET /api/projects` 為 401 |
| published | PASS；前後皆 631 |
| TFDA drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| TFDA tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| 真實 projects | PASS；前後皆 32，完整 fingerprint 相同 |
| 真實 tasks | PASS；前後皆 10，完整 fingerprint 相同 |
| 真實 milestones | PASS；前後皆 5，完整 fingerprint 相同 |
| 真實 progress | PASS；前後皆 124，完整 fingerprint 相同 |
| title | PASS；`艾爾水晶-專案進度` |

Fingerprints（before = after）：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77dcb927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`7d5ec7403debdd0e2495205c65b3861db97c4a7c16f3530fe3b8821aec4e4d32`
- real tasks：`99bd54ee96051319b267957fd58ffdd7099a30c3765844350ca8c271b84d17ac`
- real milestones：`e60dc5e94766cd2ea0c2dbfea22ed9fb30f43d12a2f474f43bda12ac0199cdac`
- real progress：`3e8ec700486db8f379961ff0fea8110fbd06f89e3b2a376d547ef5614218ca03`

Demo cleanup read-back：

| Demo scope | count |
|---|---:|
| users | 0 |
| sessions | 0 |
| audit_log | 0 |

結果：PASS。

## 5. 視覺／互動瀏覽器驗收（§6.5）

執行者以 Chrome 操作 `http://127.0.0.1:8787`，資料只來自本機固定 `is_demo=1` project `prj_demo_v13_local`：

| 項目 | 實際操作與結果 |
|---|---|
| 首次選擇 | PASS；可選「專案系統」「法規系統」「略過」 |
| 專案導覽 | PASS；從 1/14 跨 Dashboard、Projects、demo project、Reports、Timeline 到 Help 14/14 |
| 法規導覽 | PASS；1/9 到 8/9 均定位成功；第 9 步因本機已發布清單無刪除列，依設計自動略過並正常結束 |
| 重播 | PASS；`/help` 兩顆具名按鈕可各自重播 |
| hover | PASS；移入 `?` 顯示，移出 120 ms 後關閉 |
| 鍵盤 | PASS；focus 顯示，`Escape` 關閉，焦點回到同一 `help-tip-trigger` |
| 行動裝置 | PASS；390 × 844，點擊顯示 340 px 寬泡泡，左右各保留至少 16 px |
| 暗色主題 | PASS；背景 `rgb(13, 21, 38)`、文字 `rgb(230, 237, 247)`，內容完整 |
| 亮色主題 | PASS；背景 `rgb(251, 249, 244)`、文字 `rgb(27, 36, 54)`，內容完整 |
| 中英文 | PASS；實際切換後 manual 與 tooltip 全部換成英文 |
| 裁切／遮擋 | PASS；泡泡以 portal 掛到 `body`，不再被切角 panel 的 overflow 裁切 |

實際瀏覽器驗收曾找出並修正三個問題，沒有把失敗嘗試冒充 PASS：

1. 導覽狀態原本在 route-level `Layout` remount 後消失；改以目前分頁的 `sessionStorage` 保存 active tour/index，完成或略過即清除。
2. pointer enter 先開啟後，click 曾立刻 toggle 關閉；click 改為明確開啟，點外、移出與 Escape 負責關閉。
3. fixed bubble 曾被里程碑 panel 裁切；改用 React portal，並把 bubble 納入 focus／outside-click 邊界。

結果：PASS。

## 6. README／DECISIONS／結果文件（§6.6）

- `README.md`：PASS；Interface 段補上 concrete inline help tips、兩套 replayable tours 與 scenario-based manual。
- `README.zh-TW.md`：PASS；介面段補上具體欄位提示、兩套可重播導覽與情境式手冊。
- `DECISIONS.md`：PASS；增量記錄單一內容來源、demo-only 專案導覽、缺目標自動略過，以及無 API／schema／migration 的資料保護決策。
- `ACCEPTANCE-V13.md`：PASS；本文件已逐項記錄 §6 的實際輸出、視覺操作、失敗修正、指紋與 cleanup。
- Open decisions：無。正式資料基線符合 SPEC，前後完整 fingerprints 相同。

## Commits

1. `f86c5e3 feat: define concrete bilingual help topics`
2. `bb3d09a feat: add accessible inline help tips`
3. `bc22a71 feat: place help tips across workflows`
4. `4052fa7 feat: restructure bilingual help manual`
5. `99349bc feat: add guided project and regulatory tours`

