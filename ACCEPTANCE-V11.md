# SPEC-V11 驗收紀錄

驗收日期：2026-07-25（Asia/Taipei）

正式站：<https://projects.uic-ai.com>

最終部署 Version ID：`40a35a07-059c-4ed3-ac02-b6474e032751`

## 結論

**PASS**。SPEC-V11 §6 的 6 項均已實際執行：typecheck、192 tests、build、migration 0009 remote/backfill、deploy、真實 TFDA feed 手動觸發、真實草稿保留、合成草稿核准與清除、二次觸發去重、401、published count、BD member 草稿隔離、title、README／Help／DECISIONS。

正式環境目前保留 **20 則真實 TFDA 草稿**供使用者審核；未核准、未刪除、未以合成資料替換。全部 20 則皆為 `source='tfda_rss'`、`status='draft'`、`created_by IS NULL`，並有唯一 `source_ref`、標題、來源連結與非空重點。

全程沒有以受保護帳號的 id／email 做定向查詢，沒有登入、更新、重設、停用或刪除其帳號列，也沒有讀取、修改或輸出 secret 值。產品依規格以角色條件選取 active approved admin／RA-PV member 並建立草稿通知；這不修改任何既有帳號列。正式 E2E 只使用隨機密碼的 V11 專用 RA／BD demo fixtures；密碼只存在程序記憶體，最後 read-back 兩個 demo users、sessions 與合成 entry 均為 0。

## 1. Typecheck／test／build／migration／deploy（§6.1）

| 項目 | 實際結果 |
|---|---|
| `npm run typecheck` | PASS；`tsc --noEmit` exit 0 |
| `npm test` | PASS；17 test files、192/192 tests |
| V11 專項 | PASS；15/15 tests，超過規格要求的 ≥8 |
| `npm run build` | PASS；Vite 7.3.6、660 modules |
| `npx wrangler deploy --dry-run` | PASS；2,576.89 KiB raw／621.89 KiB gzip |
| `npx wrangler types --check` | PASS；`worker-configuration.d.ts` up to date |
| `git diff --check` | PASS；無 whitespace error |

V11 專項實際覆蓋：

1. 真實擷取 fixture 解析 20 則 item。
2. entity 包裝 CDATA 與 HTML 解開。
3. named／decimal／hex entity 與非法 code point。
4. link news id 抽取。
5. `pubDate` 轉台北日期與跨日。
6. HTML table 逐列轉全形 `｜`。
7. 其餘 HTML 剝除、entity 解碼與 24k 上限。
8. `source_ref` 去重優先。
9. `(entry_date,title)` 第二層去重。
10. AI fallback 的「其他」與前 500 字。
11. AI 不得覆寫 RSS 日期／標題／連結。
12. migration 0009 schema／partial unique index。
13. admin／RA-PV member／BD member／intern 草稿權限矩陣。
14. cron 前置步驟拋錯後 reminders/digest 仍執行。
15. 審核 UI／Help／i18n key parity。

### Remote migration

Migration 前唯讀 aggregate：

- `reg_entries`：631。
- `created_by IS NULL`：0。
- pending migration：只有 `0009_v11.sql`。

`npx wrangler d1 migrations apply project-brain-db --remote`：

- PASS；`0009_v11.sql` 執行 10 commands，22.51 ms。
- backfill：631/631 為 `status='published'`，631/631 為 `source='manual'`。
- migration 後 `draft=0`、`tfda_rss=0`、`created_by IS NULL=0`，證明既有 creator 全部保留。
- schema read-back：`status`／`source` 為 NOT NULL 且有 default，`source_ref` nullable，`created_by` nullable。
- `idx_reg_entries_source_ref` read-back 為 `UNIQUE ... WHERE source_ref IS NOT NULL`。
- 最終 `d1 migrations list --remote`：`No migrations to apply`。

### Deploy

第一次功能部署：

- PASS；19 個新或修改 assets 上傳，Worker startup 16 ms。
- Version ID：`354ef7b8-8f63-4a8a-8d49-31ad59573d36`。

真實抓取暴露 latency 問題後修正並重新跑全套本機驗證，最終部署：

- PASS；Worker startup 18 ms。
- custom domain：`projects.uic-ai.com`。
- cron：`0 1 * * *`、`30 0 * * 1`、`30 0 1 * *` 全數保留。
- Version ID：`40a35a07-059c-4ed3-ac02-b6474e032751`。

## 2. 真實 TFDA feed 手動觸發與草稿保留（§6.2）

執行：`node scripts/v11-acceptance.mjs`，由專用 RA/PV demo member 呼叫正式 `POST /api/regwatch/tfda-fetch`。

第一次正式嘗試在逐則串行 AI 實作下約 5 分鐘後 client 回 `fetch failed`；finally cleanup 成功，當時唯讀看到 4 則、後續共留下 5 則真實草稿。這次沒有 API 統計可用，因此不虛構 fetched／fallback 數字。問題原因與修正已寫入 `DECISIONS.md`：TFDA AI 改為最多 4 則並行、每則 15 秒一次，逾時走規格 fallback；一般 AI 匯入維持原行為。

修正部署後重新執行成功：

```json
{
  "fetched": 20,
  "new_drafts": 15,
  "skipped_ref": 5,
  "skipped_dup": 0,
  "ai_fallback": 7,
  "errors": []
}
```

`ai_fallback=7` 是成功重跑新增 15 則中的精確值；第一次未回傳統計的 5 則無法誠實回推精確 fallback 數，因此不宣稱總 fallback 數。

最終 remote aggregate read-back：

| 斷言 | 結果 |
|---|---:|
| TFDA drafts | 20 |
| distinct `source_ref` | 20 |
| `created_by IS NULL` | 20 |
| title＋link＋key_points 完整 | 20 |
| `tfda_draft` notification rows | 3 |
| notified users | 3 |

### 保留給使用者審核的真實草稿

| source_ref | 公告日 | 標題 |
|---|---|---|
| 31671 | 2026-07-24 | 敬邀參加115年度「管制藥品徵求同品項同藥證之藥品」說明會 |
| 31670 | 2026-07-23 | 公告「含semaglutide及tirzepatide成分藥品風險評估及管控計畫」相關事宜 |
| 31655 | 2026-07-21 | 發布訂定「外送員之食品衛生安全教育訓練實施辦法」 |
| 31603 | 2026-07-17 | 修正食品安全衛生管理法第 35 條第 4 項解釋令FAQ問答集 |
| 31596 | 2026-07-08 | 預告廢止「食品中動物用藥殘留量檢驗方法－Benzimidazole類多重殘留分析」及「食品中動物用藥殘留量檢驗方法－Triclabendazole及其代謝物之檢驗」。 |
| 31595 | 2026-07-03 | 核釋「限制西藥批發、零售業將當事人個人資料國際傳輸至大陸地區、香港及澳門」公告附件第一點第八款標準合約條款如附件，並自一百十五年十月一日生效。 |
| 31589 | 2026-06-30 | 預告修正「醫療器材行政規費收費標準」草案。 |
| 31582 | 2026-06-29 | 預告修正「食品中污染物質及毒素衛生標準」第六條及第三條附表一草案 |
| 31584 | 2026-06-26 | 公告延長115年度「國家藥物科技研究發展獎」徵件期至115年7月31日止。 |
| 31586 | 2026-06-26 | 公告修正濫用藥物或其代謝物尿液初步檢驗及確認檢驗判定檢出濃度(115.6.26) |
| 31580 | 2026-06-25 | 預告修正「藥事法第六條之一應建立追溯或追蹤系統之藥品類別」草案。 |
| 31583 | 2026-06-24 | 公告修正管制藥品品項(增列Carboetomidate等3項管制藥品) |
| 31579 | 2026-06-24 | 訂定「以基因改造大腸桿菌(Escherichia coli) K-12 DH1 MDO MAP1001d菌株發酵生產之食品原料2ʹ-岩藻糖基乳糖(2ʹ-fucosyllactose)與雙岩藻糖基乳糖(Difucosyllactose)混合物之使用限制及標示規定」，並自即日生效。 |
| 31575 | 2026-06-22 | 預告訂定「必要藥品申報及通報辦法」及「藥品短缺登錄及專案核准製造輸入辦法」草案。 |
| 31576 | 2026-06-22 | 預告廢止「必要藥品短缺通報登錄及專案核准製造輸入辦法」。 |
| 31572 | 2026-06-22 | 公告「衛生主管機關認可衛生講習機關（構）暨辦理衛生講習注意要點」 |
| 31574 | 2026-06-22 | 公告類澱粉蛋白單株抗體(lecanemab及donanemab成分)藥品之臨床效益及風險再評估結果相關事宜 |
| 31571 | 2026-06-17 | 公告「經皮吸收貼劑療效相等性驗證指引」 |
| 31567 | 2026-06-12 | 預告訂定「食用橄欖油及橄欖粕油品名及標示規定」草案 |
| 31569 | 2026-06-12 | 函知制訂藥品臨床試驗IRB公版送審文件三份 |

## 3. 合成 fixture 核准流程（§6.3）

唯一合成資料：

- ID：`reg_e2e_v11_synthetic`。
- title：`V11-E2E 合成審核草稿`。
- `source='manual'`、`status='draft'`，與真實 TFDA source refs 完全分離。

| 斷言 | 結果 |
|---|---|
| RA/PV draft view 看得到合成筆 | PASS |
| BD member 即使要求 `view=drafts` 也看不到 | PASS；API 回 `view='published'` |
| `POST /api/regwatch/:id/approve` | PASS；draft → published |
| BD member 一般清單可見已核准合成筆 | PASS |
| 只刪除該合成 ID | PASS |
| 最終合成 ID read-back | 0 |

真實 TFDA drafts 在此流程中沒有被核准或刪除。

## 4. 二次觸發去重（§6.4）

同一支正式 acceptance 執行第二次 `POST /api/regwatch/tfda-fetch`：

```json
{
  "fetched": 20,
  "new_drafts": 0,
  "skipped_ref": 20,
  "skipped_dup": 0,
  "ai_fallback": 0,
  "errors": []
}
```

PASS；20/20 均由 `source_ref` 去重，沒有新增、核准或刪除任何真實草稿。

## 5. 迴歸與權限（§6.5）

| 斷言 | 結果 |
|---|---|
| 未登入 `GET /api/regwatch` | PASS；401 |
| 正式首頁 | PASS；HTTP 200 |
| title | PASS；含 `艾爾水晶-專案進度` |
| D1 published count | 631 |
| 一般清單 `total` | 631；與 published count 相等 |
| 一般清單 entries | 全部 `status='published'` |
| demo BD member 要求 draft view | PASS；仍回 `view='published'`、未見任何 draft |
| demo BD member立即抓取 TFDA | PASS；403 |
| 真實 drafts 最終保留 | 20 |

## 6. README／Help／DECISIONS 與 cleanup（§6.6）

- `README.md`：PASS；版本／測試數、功能總覽、daily cron、權限表、TFDA RSS 操作與真實草稿硬規則均已更新。
- `/help`：PASS；中英皆說明每日／立即抓取、待審通知、逐則與全部核准、編輯仍為草稿、非管理者不可見。
- `DECISIONS.md`：PASS；記錄 `created_by=NULL`、實測 CDATA、2 MB／24k、通知對象、cron 隔離、第一次 latency 失敗與修正，以及 20 則真實草稿待業務審核的 open decision。
- E2E cleanup：PASS；`users.id IN ('usr_e2e_v11_ra','usr_e2e_v11_bd')` 為 0，sessions 為 0，`reg_e2e_v11_synthetic` 為 0。
- 最終 migration list：PASS；`No migrations to apply`。

## Commits

1. `c54e574 feat: add regwatch draft source schema`
2. `633f876 feat: parse and ingest TFDA RSS drafts`
3. `7812e2b feat: add TFDA fetch review API and cron`
4. `2f0967a feat: add TFDA draft review UI and acceptance`
5. `b9aaf37 fix: bound TFDA enrichment latency`

本文件保留第一次正式 manual fetch 的真實失敗，不把它改寫成 PASS；最終結論 PASS 是在修正、重新跑完整本機驗證、重新部署，並讓 section 6 所有要求於正式環境通過之後才給出。
