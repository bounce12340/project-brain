# V6 批次匯入 JSON

管理員可在「管理 → 批次匯入」貼上 JSON，或以 `POST /api/admin/import` 匯入。Request body 上限 5 MB，`Content-Type` 為 `application/json`。所有日期必須是有效的 `YYYY-MM-DD`；季度必須是 `YYYYQ1`～`YYYYQ4`。

## 最外層

```json
{
  "projects": [],
  "reg_entries": []
}
```

兩個陣列都可省略。回應格式：

```json
{
  "projects": { "created": 0, "updated": 0 },
  "tasks": { "created": 0, "skipped": 0 },
  "progress_updates": { "created": 0, "skipped": 0 },
  "reg_entries": { "created": 0, "skipped": 0 },
  "warnings": []
}
```

## `projects[]`

| 欄位 | 必填 | 型別／允許值 | 說明 |
|---|---:|---|---|
| `external_key` | 是 | string | 專案冪等鍵；已存在時更新專案基本欄位 |
| `name` | 是 | string | 專案名稱 |
| `group` | 是 | string | 組別 `id` 或完整名稱 |
| `owner_email` | 否 | string | 找不到時改掛執行匯入的 admin |
| `visibility` | 否 | `all`、`group`、`private` | 預設 `group` |
| `status` | 否 | `active`、`paused`、`done`、`archived` | 預設 `active` |
| `progress` | 否 | 0～100 | 無效或省略時，新專案為 0、既有專案保留原值 |
| `goal_summary` | 否 | string | 專案目標 |
| `start_date`、`target_date` | 否 | `YYYY-MM-DD` | 專案日期 |
| `stages` | 否 | string[] | 省略時套組別模板；找不到模板時用「待辦／進行中／完成」 |
| `quarter_goals` | 否 | object[] | 季度目標 |
| `key_results` | 否 | object[] | KR |
| `tasks` | 否 | object[] | 任務 |
| `milestones` | 否 | object[] | 里程碑；可用 `end_date` 表示期間 |
| `events` | 否 | object[] | 歷程事件；可用 `end_date` 表示期間 |
| `progress_updates` | 否 | object[] | 進度紀錄 |
| `clinical` | 否 | object | 臨床目標與收案 |
| `licenses` | 否 | object[] | QA 效期紀錄 |
| `ccrs` | 否 | object[] | CCR，可直接指定落點狀態 |

### 子項格式

- `quarter_goals[]`: `{ "quarter": "2026Q3", "objective": "本季目標" }`
- `key_results[]`: `{ "title": "完成送件", "owner_email": "user@example.com", "quarter": "2026Q3", "status": "未開始|進行中|完成|暫停" }`
- `tasks[]`: `{ "title": "工作", "stage": "進行中", "assignee_email": "user@example.com", "due_date": "2026-08-31", "done": false }`
- `milestones[]`: `{ "title": "審查期", "due_date": "2026-09-01", "end_date": "2026-09-30", "done": false }`
- `events[]`: `{ "title": "CDE 收案至審查回覆", "due_date": "2026-02-06", "end_date": "2026-03-23" }`
- `progress_updates[]`: `{ "date": "2026-07-21", "content": "進度文字", "author_email": "user@example.com" }`
- `clinical`: `{ "target_n": 50, "enrollments": [{ "record_date": "2026-07-21", "site": "台大", "count": 2, "note": "", "author_email": "user@example.com" }] }`
- `licenses[]`: `{ "name": "GDP 許可", "subject": "公司", "authority": "TFDA", "license_no": "A-001", "issued_at": "2025-01-01", "expires_at": "2027-01-01", "status": "有效|換證中|已過期|已停用", "note": "" }`
- `ccrs[]`: `{ "title": "包材變更", "target_type": "產品|文件|供應商|製程|設備|其他", "description": "變更說明", "reason": "原因", "classification": "重大|次要", "impact_assessment": "影響", "status": "申請|評估中|已核准|執行中|效期確認|已結案|駁回", "requested_at": "2026-07-21", "note": "" }`

`milestones[]` 的 `due_date` 可省略；`events[]` 的 `due_date` 必填並代表事件起始日。兩者的 `end_date` 都可省略；有值時必須是合法 `YYYY-MM-DD` 且不得早於 `due_date`。省略 `end_date` 會在甘特顯示單點節點，填入則顯示起訖橫條。

子項採「不存在才建立」：任務以同專案、階段、標題判重；里程碑／歷程以同專案、類型、標題、起始日期判重；KR 以同專案、季度、標題判重；進度紀錄以日期與最終 content 前 40 字判重；license 以專案、名稱、效期判重；CCR 以專案、標題、原因判重。

## `reg_entries[]`

```json
{
  "entry_date": "2026-07-21",
  "entry_type": "announcement",
  "product_line": "藥品",
  "category": "查驗登記",
  "title": "公告標題",
  "key_points": "多行重點",
  "link": "https://example.com"
}
```

- `entry_type`: `announcement`（法規公告）或 `meeting`（外部會議），省略時為 `announcement`。
- `product_line`: `藥品`、`醫療器材`、`化粧品`、`健康食品`、`食品`、`再生醫療`、`包裝容器`、`寵物食品`、`其他`。
- 冪等鍵為 `(entry_date, title)`；相同資料會計入 `skipped`。

## Email fallback

`owner_email`、`assignee_email`、`author_email` 或 `owner_email`（KR）找不到 active approved 使用者時，資料改掛執行匯入的 admin；相應的專案目標／任務描述／進度 content／KR note／收案 note 會加上 `【原負責人：email】`，回應同時列出 warning。Email 比對不分大小寫。

## 完整範例

```json
{
  "projects": [{
    "external_key": "qa-2026-001",
    "name": "QA 年度計畫",
    "group": "grp_qa",
    "owner_email": "qa@example.com",
    "visibility": "group",
    "status": "active",
    "progress": 20,
    "goal_summary": "完成年度品質目標",
    "start_date": "2026-01-01",
    "target_date": "2026-12-31",
    "stages": ["待辦", "進行中", "完成"],
    "quarter_goals": [{ "quarter": "2026Q3", "objective": "完成稽核改善" }],
    "key_results": [{ "title": "完成 5 項 CAPA", "quarter": "2026Q3", "status": "進行中", "owner_email": "qa@example.com" }],
    "tasks": [{ "title": "盤點證照", "stage": "待辦", "assignee_email": "qa@example.com", "due_date": "2026-08-15", "done": false }],
    "milestones": [{ "title": "年度審查", "due_date": "2026-09-01", "end_date": "2026-09-30" }],
    "events": [{ "title": "前次稽核期間", "due_date": "2026-02-06", "end_date": "2026-03-23" }],
    "progress_updates": [{ "date": "2026-07-21", "content": "已完成資料盤點", "author_email": "qa@example.com" }],
    "licenses": [{ "name": "GDP 許可", "subject": "公司", "expires_at": "2027-01-31", "status": "有效" }]
  }],
  "reg_entries": [{
    "entry_date": "2026-07-21",
    "entry_type": "announcement",
    "product_line": "藥品",
    "title": "示例公告",
    "key_points": "第一點\n第二點"
  }]
}
```

## 從 CI 匯入正式站

管理員手上沒有 Cloudflare 憑證、或不想在瀏覽器裡貼大段 JSON 時，可以改用 GitHub Actions 匯入：

1. 把審閱過的 payload 放進 `imports/`（這個目錄會進 Git，`migration/*.json` 則維持不進版控）。
2. Actions → **Import to production** → Run workflow，填入檔名與執行者 Email，`confirm` 輸入 `import-to-production`。
3. workflow 會依序：驗確認字串 → 驗 secret 與檔案存在 → 跑 `tests/import-payload.test.ts`（在記憶體資料庫上套真實 migrations 完整匯入一次並重送驗冪等）→ typecheck → bundle → 匯入正式 D1。

`scripts/import-remote.ts` 走 D1 REST API，跑的是 `/api/admin/import` 端點同一支 `runAdminImport`，所以匯入規則、冪等鍵與 Email fallback 行為完全一致，並在寫入後補一筆 `audit_log`。

兩道匯入前的把關：

- **執行者**必須是 active、approved 且 `role='admin'` 的帳號，否則中止。
- **payload 內所有 Email**都必須在正式站存在且已核准，否則中止並列出缺哪些。真的要讓資料改掛管理員（會在專案目標與任務描述加上「【原負責人：…】」）時，才勾選 `allow_owner_fallback`。

失敗可以直接重跑：匯入合約冪等，重送只會累計 `skipped`。
