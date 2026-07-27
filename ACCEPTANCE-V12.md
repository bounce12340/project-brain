# SPEC-V12 驗收紀錄

日期：2026-07-27

環境：production（`https://projects.uic-ai.com`、Cloudflare Workers／D1）＋本機 Vitest／TypeScript／Vite

範圍：`SPEC-V12.md` section 5 全部項目

## 結論

**PASS**。Section 5 的 typecheck、test、build、無 migration 確認、production deploy、全新 demo project E2E、模糊語氣、403、401、published 631、title、真實法規資料與真實專案資料 fingerprint 保護、demo cleanup、README／help／DECISIONS 均已實際執行。

最高原則有兩層實證：

1. `POST /api/ai/progress-links` 前後，demo project 的完整 task read-back 與 project progress 完全相同，證明建議端點沒有在人工確認前寫入。
2. 只有驗收器明確標記 `human_confirmed_selection:true` 後，才逐項呼叫既有 task PATCH／POST；之後才讀到既有卡 done=1 與新卡存在。

Production E2E 結束後，唯一新建的 project、stages、tasks、progress updates、members、milestones、files、automation rules、key results、demo users、sessions 與相關 audit 均 read-back **0**。沒有修改任何既有真實專案；其 projects／tasks／progress 完整 fingerprints 前後相同。沒有查詢、登入、修改、重設、停用或刪除 `usr_admin`，沒有讀取或修改 secrets，也沒有建立、核准、刪除或修改真實 TFDA drafts／published entries／tombstones。

## 1. Typecheck／test／build／deploy（§5.1）

| 驗收 | 結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；21 test files、235/235 tests |
| V12 專項 | PASS；23/23 tests，超過規格要求的 ≥8 |
| `npm run build` | PASS；Vite 7.3.6、662 modules |
| `node --check scripts/v12-acceptance.mjs` | PASS |
| `git diff --check` | PASS |
| `wrangler deploy --dry-run` | PASS；24 assets、2,587.09 KiB raw／624.62 KiB gzip |
| remote migrations | PASS；`No migrations to apply!` |

Production deploy：

- PASS；21 個新或修改 assets 上傳、2 個既有 assets 沿用。
- Worker startup：15 ms。
- custom domain 與三條既有 cron triggers 均部署成功。
- Current Version ID：`385c938a-51f2-44d8-905b-6c95b49465ff`。
- 本版沒有 schema 變更或 migration。

## 2. Production E2E（§5.2）

執行 `node scripts/v12-acceptance.mjs`。驗收器建立兩個 V12 專用 demo users/session，透過正式 `POST /api/projects` 建立全新的 private project，隨即以 owner＋project id 雙條件標為 `is_demo=1`。沒有重用或改動既有專案。

### 2.1 明確完成＋後續待辦（§5.2a）

Demo project 起始資料：

- 2 張未完成任務卡：「安定性數據收集」、「包材確認」。
- 階段：「進行中」、「待處理」。
- auto progress：0。

發布進度「已完成安定性數據收集，下週送補件資料」後，正式 `progress-links` 回應：

```json
{
  "complete": [
    {
      "task_id": "<demo stability task id>",
      "reason": "已完成安定性數據收集"
    }
  ],
  "create": [
    {
      "title": "送補件資料",
      "stage_name": "待處理"
    }
  ],
  "fallback": false
}
```

結果：PASS；恰為 1 筆 complete、1 筆 create，complete 精確對應 demo 安定性卡，並已記錄 `fallback:false`。

在取得建議後、套用前，D1 的 demo tasks 全欄位選定 read-back 與 project progress 都與呼叫前相同。結果：PASS；AI 建議沒有自行寫資料。

### 2.2 人工選取後套用（§5.2b）

驗收器只對上述選定項目呼叫既有 endpoints：

- `PATCH /api/tasks/:id`，`done:true`。
- `POST /api/projects/:id/tasks`，標題「送補件資料」、階段採 AI 建議的「待處理」。

Read-back：

| 項目 | 結果 |
|---|---|
| 安定性卡 done | PASS；1 |
| 新任務存在 | PASS；由 POST 回傳 id 並在 project detail 找到 |
| 新任務階段 | PASS；「待處理」對應 stage id |
| auto progress | PASS；0 → 33 |

UI contract 另由 V12 專項測試驗證 complete／create 全部 `selected:false`、未選取時 apply disabled、逐項既有 endpoint、partial failure 不回滾、成功項防重送、dialog aria、焦點移入／還原與 Esc handler。Production built assets 也實際抓回 entry script 與 20 chunks，確認含 `AIUR_PROGRESS_LINKS` 與確認 dialog 標題。

### 2.3 模糊語氣（§5.2c）

正式呼叫內容：「預計下週完成包材確認」。

- `complete: []`：PASS；沒有誤標完成。
- `fallback:false`：PASS；結果不是因 AI fallback 空陣列而僥倖通過。
- AI 另建議 create「跟進包材確認進度」；規格只禁止模糊語氣進入 complete，此 create 沒有被套用。

### 2.4 無編輯權（§5.2d）

以同組但未加入 private demo project 的 intern demo account 呼叫：

- `POST /api/ai/progress-links`：PASS；HTTP 403。

### 2.5 清理（§5.2e）

Project 先透過正式 `DELETE /api/projects/:id` 成功刪除，再以 V12 demo owner 精確條件執行補償清理與 read-back。

| Read-back | 數量 |
|---|---:|
| projects | 0 |
| stages | 0 |
| tasks | 0 |
| progress_updates | 0 |
| project_members | 0 |
| milestones | 0 |
| files | 0 |
| automation_rules | 0 |
| key_results | 0 |
| demo users | 0 |
| sessions | 0 |
| related audit_log | 0 |

結果：PASS；demo project 與所有檢查到的子資料均為 0。

第一次啟動 E2E 時，外層 shell timeout 誤設太短，行程在 5.3 秒被終止，不能算產品測試結果，也不能假設 `finally` 已執行。第二次以正確 timeout 重跑；驗收器開頭先依 V12 demo owner 清理前次可能殘留，再完成全流程與最終 read-back 0。此操作失誤保留在紀錄中，不冒充一次通過。

## 3. 迴歸與資料鐵則（§5.3）

| 驗收 | 結果 |
|---|---|
| 未登入 `GET /api/projects` | PASS；401 |
| D1 published | PASS；前後皆 631 |
| production homepage | PASS；HTTP 200 |
| title | PASS；`艾爾水晶-專案進度` |
| 真實 drafts | PASS；前後皆 16，完整 fingerprint 相同 |
| tombstones | PASS；前後皆 4，完整 fingerprint 相同 |
| 真實 projects | PASS；前後皆 33，完整 fingerprint 相同 |
| 真實 tasks | PASS；前後皆 5，完整 fingerprint 相同 |
| 真實 progress updates | PASS；前後皆 117，完整 fingerprint 相同 |

完整 fingerprints：

- drafts：`b5241742c0ae71025d811993d2664d3105d257b9ddd61ee473a02540dc06025e`
- published：`ab3685a77b927179bcd1411922a6fd1a3f01b2c76da92cbd39fb91c91001db`
- tombstones：`138e2ed53eaf7ae06a0b64b975c13b83d3aa850baffb8127ccd4ec292abe4a8d`
- real projects：`ff9894f1d6499cfa4a2634cfd219d4b47f6387a5ac81561b9ec0e9953d34b0e2`
- real tasks：`53fc99feca837c45c3b17ec0e69ba00f45121d72aa1767816b689ac1a2cea11a`
- real progress：`162b85a29c591251511370d01405fe7a9f4c1ad488b4eac5ed4726d0dd55980d`

## 4. 文件、決策與測試覆蓋（§5.4）

- `README.md`／`README.zh-TW.md`：補上發布進度後的 AI 建議、所有項目預設不勾選、只有「Apply selected／套用所選」才寫入，以及設定開關與 localStorage key。
- `/help`：中英皆補「進度連動任務建議」操作說明。
- `DECISIONS.md`：增量記錄純建議 endpoint、complete 保守驗證、階段 fallback 解讀、`AIUR_PROGRESS_LINKS` 預設、逐項 partial-success 行為與無 migration。
- i18n：zh／en keys 完全 parity。
- V12 專項共 23 tests，覆蓋不存在 task id、重複 task、create 上限、Unicode 80 字、非法／不存在／今日／過去日期、合法未來日期、階段白名單、混合明確／未來語氣、AI 理由 30 字、prompt 契約、fallback、route 403、route fallback 200、預設不勾選、預設階段、設定預設值、設定接線、dialog／Esc／既有 endpoint 與 i18n parity。
- V12 相關檔案 `TODO|FIXME` scan：0 matches。

## Commits

1. `b7474f8 feat: add progress task link suggestions API`
2. `81134c6 test: cover progress link sanitization`
3. `4839dad feat: add human-confirmed progress task dialog`
4. `5f6ec48 feat: add progress suggestion preference`
5. `33bbf42 fix: accept evidence-based progress link reasons`
6. `8001c4f test: add v12 production acceptance`

本文件只把實際執行並看到成功輸出的項目標為 PASS；第一次 E2E timeout、API 層模擬人工選取而非瀏覽器滑鼠操作，以及當下 production 的 16 drafts／4 tombstones 都如實保留。
