# 實作決策

- 2026-07-21：D1 建於 APAC，database id 僅作公開資源識別並依 Wrangler 慣例寫入設定。
- 2026-07-21：所有資料庫時間存為 UTC ISO 8601；日期區間與畫面顯示以 `Asia/Taipei` 換算。
- 2026-07-21：API 驗證採小型手寫型別守衛，避免新增規格外的驗證框架。
- 2026-07-21：群組若仍被使用者、專案或模板引用則拒絕刪除；保留資料完整性。
- 2026-07-21：Markdown 以安全的 React text node 最小渲染器呈現標題、粗體與清單，不使用 `dangerouslySetInnerHTML`，也不新增大型套件。
- 2026-07-21：CSV 使用 UTF-8 BOM，讓台灣常用的 Excel 可直接正確顯示繁體中文。
- 2026-07-21：預先生成的公司／組別 AI 週報可能包含該範圍內的保密專案，因此僅 admin 可讀；member 與 intern 仍可使用依個人可見專案即時計算的報表摘要，避免跨權限洩漏。
- 2026-07-21（v2）：migration 為既有專案設定 `progress_mode=manual`；建立新專案時 API 明確寫入 `auto`，避免改變 v1 既有資料語意。
- 2026-07-21（v2）：風險建議以新增 `projects.risk_suggestions` JSON 文字欄保存，`risk_summary` 維持單純摘要，讓畫面可分開呈現且不需新增資料表。
- 2026-07-21（v2）：R2 經 `FileStore` 介面封裝；本次先使用 `FILES` binding，只有實際部署因 R2 權限失敗才依規格改用 KV fallback。
- 2026-07-21（v2）：`/api/ai/schedule-suggest` 同時支援預覽與 `apply=true`，套用時由後端再次驗證專案日期範圍與任務依賴。
- 2026-07-21（v2）：首次導覽跨頁尋找第一個可見專案與任務；若當下沒有可聚焦元素，仍顯示置中說明泡泡，使用者可完成或略過。
- 2026-07-21（v2）：AI 三功能若外部 LLM 與 Workers AI 都失敗，回傳相同 JSON shape 的規則式 fallback 並標記 `fallback=true`，避免 UI 中斷。
- 2026-07-21（v2）：驗收指定由 `bd1` 在 `prj_bd` 提及陳收案；因提及名單依法只含可見專案者，0003 將 demo 使用者 `usr_clinical2` 加入該 demo 專案成員，不調整任何權限函式或 admin 資料。
- 2026-07-21（v2）：正式唯讀驗收發現 `usr_admin.must_change_password=0` 且已有既存 active session（`updated_at=2026-07-21 02:42:40 UTC`）；依「不得碰 admin」限制不修正、不撤銷 session，於 ACCEPTANCE-V2 如實標 FAIL。
