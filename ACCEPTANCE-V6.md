# SPEC-V6 驗收紀錄

執行日期：2026-07-21（Asia/Taipei）
正式站：<https://projects.uic-ai.com>
最終部署 Version ID：`e5919786-d1cd-4598-9620-6f7af1e06963`

## 結論

**PARTIAL PASS**。SPEC-V6 §1～§5 與 §6.2～§6.6 均已實作並實際執行驗收；唯一未達成項目是 §0／§6.1 的 Elvia 帳號與第 4 封邀請信。正式 D1 在執行前已存在同 Email `elvis@uicgroup.com.tw`、但屬於不同 id／姓名的 active approved 正式帳號；`UNIQUE COLLATE NOCASE` 與 `INSERT OR IGNORE` 阻止建立 `usr_elvia`。依「不覆寫既有人員」原則未改密碼、未改主鍵、未寄出不可登入的臨時密碼。決策與待確認事項已記錄於 `DECISIONS.md`。

驗收過程沒有登入、修改、重設、停用或刪除 `usr_admin`，也沒有輸出或保存任何臨時密碼、password hash 或 secret。

## 1. §0 帳號與邀請信

### 正式 D1 read-back（不含 hash）

| 規格帳號 | 結果 | 實際欄位 |
|---|---|---|
| `usr_michael` | PASS | `michael@uicgroup.com.tw`；Michael；admin；`grp_general`；`must_change_password=1`；approved；active；`is_demo=0`；`onboarding_done=0` |
| `usr_dennis` | PASS | `dennis@uicgroup.com.tw`；Dennis；member；`grp_general`；`must_change_password=1`；approved；active；`is_demo=0`；`onboarding_done=0` |
| `usr_allan` | PASS | `allan@uicgroup.com.tw`；Allan；member；`grp_clinical`；`must_change_password=1`；approved；active；`is_demo=0`；`onboarding_done=0` |
| `usr_elvia` | **FAIL** | 未建立。相同 Email 已由 `usr_b3386e34a2c945309c`／陳冠宇使用；該既有帳號為 member、`grp_qa`、active、approved、`is_demo=0`、`must_change_password=0`、`onboarding_done=1` |

目前 `users` schema 沒有職稱欄位；三位成功帳號的職稱只放在邀請信內，沒有臆增 schema 欄位。

### AgentMail message_id

| 收件者 | 結果 | message_id |
|---|---|---|
| Michael | PASS | `<0100019f835f2ac9-706689ec-bb75-4ff2-9834-99f851686bee-000000@email.amazonses.com>` |
| Dennis | PASS | `<0100019f835f35de-acefc5d2-448c-4545-b5f6-03138fd49886-000000@email.amazonses.com>` |
| Allan | PASS | `<0100019f835f3f1d-862355df-d484-4511-8758-bb9ad18c13a6-000000@email.amazonses.com>` |
| Elvia | **FAIL／未寄送** | 無；避免寄出無法登入的臨時密碼 |

四個相同目標的 `INSERT OR IGNORE` 已再次執行；Michael、Dennis、Allan、Elvia 各自的 `changes()` 均為 `0`，確認重跑不覆寫既有資料。Elvia 的 `0` 來自 Email unique conflict。

## 2. 本地品質檢查

最終修正後實際執行：

| 指令 | 結果 |
|---|---|
| `npm run typecheck` | PASS（`tsc --noEmit` exit 0） |
| `npm test` | PASS（9 files、124 tests） |
| `npm run build` | PASS（Vite 652 modules，22 個 dist 檔案） |
| `wrangler types --check` | PASS（`worker-configuration.d.ts` up to date） |
| `git diff --check` | PASS |

V6 新增 `tests/v6-core.test.ts` 共 30 tests，涵蓋：

- CCR 年度編號、補零、合法／非法狀態機、admin 終態重開。
- license 90／60／30／7 天、首次逾期、相同 stage 不重複、badge 分級。
- KR 納入 auto progress 分母／分子。
- import 日期、Email fallback、前 40 字冪等鍵與 create／skip 判定。
- regwatch admin、RA/PV member、intern 與其他組 member 權限。

## 3. Migration 0005

- `wrangler d1 migrations apply project-brain-db --remote`：PASS；19 statements，`0005_v6.sql` 狀態為成功。
- `grp_qa`：由 `type='general'` 變為 `type='qa'`。
- `sqlite_master` read-back：`groups.type` CHECK 包含 `clinical`、`bd`、`general`、`qa`。
- 既有 6 筆 QA 模板在 migration 前後的 id、名稱、group 與 `stages_json` 逐筆一致：CAPA、客訴、偏差、文件管制、內部稽核、供應商評鑑。
- `PRAGMA foreign_key_check`：0 rows。
- 因 D1 對被引用 parent table 的 drop/recreate 會在 commit 失敗，migration 採欄位 rename→新增新 CHECK 欄→搬值→drop 舊欄，最終 schema 與資料結果符合規格；原因見 `DECISIONS.md`。

## 4. Deploy 與迴歸

- 最終 deploy：PASS；custom domain 與兩個 cron trigger 均部署成功。
- 首頁 `GET /`：200，HTML title 為 `艾爾水晶-專案進度`。
- 未登入 `GET /api/projects`：401。
- 未被加入的 intern 對 QA group 專案：清單不出現，detail 回 403。
- 首輪 E2E 曾發現 D1 將 number 年度 bind 成 `2026.0`，造成錯誤編號 `CCR-2026.0-001`；一般 CCR 與 import CCR 兩路均改用 4 碼 string、重新 typecheck／test／build／deploy。首輪資料已清理，第二輪從頭執行全綠。

## 5. 正式站 E2E

E2E 使用四個一次性 `is_demo=1` 帳號（admin、QA member、RA/PV member、intern）；密碼在程序記憶體隨機產生，未輸出或落檔。可重跑腳本為 `scripts/v6-e2e.mjs`。

### QA license

- 建立 QA 專案與到期日為 25 天後的 license：201。
- license list read-back：找到相同 id 與效期。
- admin dashboard `v6.license_alerts`：找到該 license。
- cron 通知日判定由上述 9 個 license tests 覆蓋；正式驗收沒有手動觸發每日 cron，避免向正式人員發送測試通知。

### OKR 與 auto progress

- 建立 `2026Q3` objective：PASS。
- 建立 2 筆 KR、完成 1 筆：PASS。
- 專案沒有其他 task／milestone／todo 時，auto progress read-back 為 `50`，證明 KR 納入分母與分子。

### CCR

- 第一筆編號：`CCR-2026-001`。
- 完整流轉：申請→評估中→已核准→執行中→效期確認→已結案。
- `ccr_events`：6 筆（建立 1＋流轉 5），`to_status` 順序逐筆正確。
- 核准與結案時間均已寫入。
- 進入效期確認後，自動建立 `CCR 效期確認：V6 E2E 包材變更` todo。

### Regwatch

- `grp_general` RA/PV member 建立 1 筆：201。
- intern 讀取並找到該筆：200。
- intern 嘗試新增：403。

### Import

迷你 JSON 含 1 project、2 progress updates、2 reg entries：

| 次數 | projects | progress_updates | reg_entries | warnings |
|---|---|---|---|---|
| 首跑 | created 1 / updated 0 | created 2 / skipped 0 | created 2 / skipped 0 | 0 |
| 重跑 | created 0 / updated 1 | created 0 / skipped 2 | created 0 / skipped 2 | 0 |

## 6. 清理與文件

- E2E `finally` cleanup：PASS。
- 正式 D1 殘留 read-back：E2E users `0`、projects `0`、reg entries `0`、兩種測試 CCR 編號 `0`。
- §0 成功建立的三筆正式帳號保留；既有 `elvis@uicgroup.com.tw` 帳號未改動。
- 已更新 `DECISIONS.md`、`README.md`、`IMPORT.md`、`/help` 與 onboarding tour。
- `IMPORT.md` 記錄完整 JSON 欄位、允許值、冪等規則、Email fallback、回應統計與範例。
