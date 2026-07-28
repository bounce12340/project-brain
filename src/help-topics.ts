export type HelpLanguage = "zh" | "en";

export interface HelpContent {
  what: string;
  fill: string;
  difference?: string;
  href: string;
  linkLabel: string;
}

export interface ConceptDefinition {
  key: "task" | "milestone" | "historyEvent" | "progressUpdate" | "todo";
  label: string;
  meaning: string;
  dates: string;
  progress: string;
  example: string;
}

export const CONCEPT_DEFINITIONS: Record<HelpLanguage, readonly ConceptDefinition[]> = {
  zh: [
    { key: "task", label: "任務", meaning: "要做的工作，可指派、可排程", dates: "起訖日", progress: "✅ 計入", example: "收到 CTD 文件進行審查" },
    { key: "milestone", label: "里程碑", meaning: "未來要達成的關鍵節點", dates: "到期日", progress: "✅ 計入", example: "2026-08-14 收到 CTD 文件" },
    { key: "historyEvent", label: "歷程事件", meaning: "已經發生的事實紀錄", dates: "事件日", progress: "❌ 不計入", example: "2025-12-09 CDE 第一次諮詢" },
    { key: "progressUpdate", label: "進度紀錄", meaning: "敘事日誌，說明這段期間發生什麼", dates: "撰寫時間", progress: "❌ 不計入（可觸發連動建議）", example: "本週完成資料彙整，下週送件" },
    { key: "todo", label: "待辦", meaning: "個人層級的私人事項", dates: "到期日", progress: "✅ 計入（若關聯專案）", example: "提醒自己追 Hina 回信" },
  ],
  en: [
    { key: "task", label: "Task", meaning: "Assignable, schedulable work to be done", dates: "Start and due dates", progress: "✅ Included", example: "Review the received CTD dossier" },
    { key: "milestone", label: "Milestone", meaning: "A critical future checkpoint to reach", dates: "Due date", progress: "✅ Included", example: "Receive CTD dossier on 2026-08-14" },
    { key: "historyEvent", label: "History event", meaning: "A factual record of something that happened", dates: "Event date", progress: "❌ Excluded", example: "First CDE consultation on 2025-12-09" },
    { key: "progressUpdate", label: "Progress update", meaning: "A narrative of what happened during a period", dates: "Written time", progress: "❌ Excluded; may suggest linked actions", example: "Compiled data this week; submit next week" },
    { key: "todo", label: "To-do", meaning: "A private, personal action item", dates: "Due date", progress: "✅ Included when linked to a project", example: "Remind myself to chase Hina's reply" },
  ],
} as const;

const concept = (language: HelpLanguage, key: ConceptDefinition["key"]) =>
  CONCEPT_DEFINITIONS[language].find((item) => item.key === key) as ConceptDefinition;

const topic = (
  what: string,
  fill: string,
  href: string,
  linkLabel: string,
  difference?: string,
): HelpContent => ({ what, fill, difference, href, linkLabel });

const zhLink = "看完整教學 →";
const enLink = "Read the full guide →";

export const HELP_TOPICS = {
  projectGoal: {
    zh: topic("專案完成時要交付的成果", "例：2026 Q3 完成藥品查驗登記送件", "/help#quickstart-a", zhLink, "Objective 是單季聚焦方向；專案目標管整案"),
    en: topic("The outcome delivered when the project ends", "Example: submit the drug registration in Q3 2026", "/help#quickstart-a", enLink, "An Objective focuses one quarter; this covers the whole project"),
  },
  progressMode: {
    zh: topic("整案完成度及其計算方式", "手動填 35%；自動則由任務、里程碑、待辦與 KR 計算", "/help#concepts", zhLink, "歷程事件與進度紀錄不會直接改變百分比"),
    en: topic("Project completion and how it is calculated", "Enter 35% manually, or calculate from tasks, milestones, to-dos, and KRs", "/help#concepts", enLink, "History events and progress updates do not directly change it"),
  },
  milestones: {
    zh: topic(concept("zh", "milestone").meaning, `例：${concept("zh", "milestone").example}`, "/help#concepts", zhLink, `任務是工作；歷程事件是已發生且${concept("zh", "historyEvent").progress}`),
    en: topic(concept("en", "milestone").meaning, `Example: ${concept("en", "milestone").example}`, "/help#concepts", enLink, `A task is work; a history event already happened and is ${concept("en", "historyEvent").progress}`),
  },
  historyEvents: {
    zh: topic(concept("zh", "historyEvent").meaning, `例：${concept("zh", "historyEvent").example}`, "/help#concepts", zhLink, `里程碑是未來節點且${concept("zh", "milestone").progress}`),
    en: topic(concept("en", "historyEvent").meaning, `Example: ${concept("en", "historyEvent").example}`, "/help#concepts", enLink, `A milestone is a future checkpoint and is ${concept("en", "milestone").progress}`),
  },
  projectDates: {
    zh: topic("整個專案允許安排工作的日期邊界", "例：起始 2026-07-01、目標 2027-03-31", "/help#quickstart-a", zhLink, "任務日期應落在此範圍；里程碑只需到期日"),
    en: topic("The date boundaries for scheduling project work", "Example: 2026-07-01 through 2027-03-31", "/help#quickstart-a", enLink, "Task dates should fit this range; milestones need only a due date"),
  },
  members: {
    zh: topic("可共同存取此專案的人員", "例：加入 RA 專員 Hina 共同維護送件任務", "/help#feature-projects", zhLink, "Owner 負最終管理責任；成員依權限協作"),
    en: topic("People who can collaborate in this project", "Example: add RA specialist Hina to maintain submission tasks", "/help#feature-projects", enLink, "The owner has final control; members collaborate within permissions"),
  },
  visibility: {
    zh: topic("決定哪些使用者能看見專案", "例：機密授權案選「私人」，只開放 owner 與成員", "/help#feature-projects", zhLink),
    en: topic("Controls which users can see the project", "Example: make a confidential licensing project private for owner and members", "/help#feature-projects", enLink),
  },
  status: {
    zh: topic("專案目前所處的生命週期", "例：等待 CDE 回覆時設「暫停」，結案後設「完成」", "/help#feature-projects", zhLink, "進度是完成比例；狀態表示是否仍在執行"),
    en: topic("The project's current lifecycle state", "Example: pause while awaiting CDE, then mark done at closure", "/help#feature-projects", enLink, "Progress is a percentage; status says whether work is active"),
  },
  objective: {
    zh: topic("一季內團隊要聚焦的方向", "例：2026Q3 完成 CTD 缺件盤點並可送件", "/help#feature-okr", zhLink, "專案目標管整案；Objective 只管選定季度"),
    en: topic("The direction the team focuses on this quarter", "Example: make the CTD dossier submission-ready in 2026 Q3", "/help#feature-okr", enLink, "The project goal covers the whole project; an Objective covers one quarter"),
  },
  keyResults: {
    zh: topic("用來證明 Objective 達成的可檢查結果", "例：完成 12/12 個 CTD 模組缺件確認", "/help#feature-okr", zhLink, "Objective 說方向；KR 要能明確判定完成"),
    en: topic("Checkable results that prove an Objective was achieved", "Example: verify missing items for all 12 CTD modules", "/help#feature-okr", enLink, "An Objective states direction; a KR must be verifiably complete"),
  },
  aiRisk: {
    zh: topic("依逾期、時程與活動推估的專案風險", "例：三項任務逾期且 14 天無更新，判為高風險", "/help#feature-dashboard", zhLink, "是提醒，不是法規或品質決策；仍須人工判斷"),
    en: topic("A risk forecast from delays, schedule, and activity", "Example: three overdue tasks and 14 quiet days produce high risk", "/help#feature-dashboard", enLink, "It is an alert, not a regulatory or quality decision"),
  },
  stages: {
    zh: topic("任務在工作流程中的欄位", "例：待辦 → 文件審查 → 補件 → 完成", "/help#quickstart-a", zhLink, "階段表示流程位置；狀態表示整個專案生命週期"),
    en: topic("Columns representing a task's workflow position", "Example: To do → Dossier review → Deficiency reply → Done", "/help#quickstart-a", enLink, "A stage locates a task; status describes the whole project"),
  },
  taskCards: {
    zh: topic(concept("zh", "task").meaning, `例：${concept("zh", "task").example}`, "/help#concepts", zhLink, `里程碑是節點；任務有負責人與${concept("zh", "task").dates}`),
    en: topic(concept("en", "task").meaning, `Example: ${concept("en", "task").example}`, "/help#concepts", enLink, `A milestone is a checkpoint; a task has an assignee and ${concept("en", "task").dates}`),
  },
  taskDates: {
    zh: topic("單一任務預計執行的起訖區間", "例：CTD 審查 2026-07-06 至 2026-07-17", "/help#quickstart-a", zhLink, "到期日是完成期限；起始日是預計開工日"),
    en: topic("The planned working interval for one task", "Example: CTD review from 2026-07-06 to 2026-07-17", "/help#quickstart-a", enLink, "The due date is the deadline; the start date is planned kickoff"),
  },
  dependencies: {
    zh: topic("必須先完成才能開始本任務的工作", "例：「收到 CTD」完成後，「文件審查」隔日開始", "/help#quickstart-a", zhLink, "階段只分類流程；依賴會影響日期接龍"),
    en: topic("Work that must finish before this task can start", "Example: Dossier review starts the day after Receive CTD ends", "/help#quickstart-a", enLink, "Stages classify workflow; dependencies drive chained dates"),
  },
  viewKanban: {
    zh: topic("按階段拖曳任務的流程視圖", "例：把「CTD 審查」從待辦拖到進行中", "/help#feature-views", zhLink, "適合看流程；清單適合排序與篩選"),
    en: topic("A workflow view for dragging tasks across stages", "Example: drag CTD review from To do to In progress", "/help#feature-views", enLink, "Best for flow; List is better for sorting and filtering"),
  },
  viewList: {
    zh: topic("逐列比較與篩選任務的表格視圖", "例：篩出 Hina 負責且尚未完成的任務", "/help#feature-views", zhLink, "適合查欄位；日曆適合看每日到期量"),
    en: topic("A table view for comparing and filtering tasks", "Example: show Hina's incomplete tasks", "/help#feature-views", enLink, "Best for fields; Calendar shows daily deadline load"),
  },
  viewCalendar: {
    zh: topic("按月份查看到期工作與事件", "例：檢查 8 月 14 日是否同時有送件與里程碑", "/help#feature-views", zhLink, "適合單日負荷；甘特適合看跨日長度與依賴"),
    en: topic("A monthly view of due work and events", "Example: check submissions and milestones due on August 14", "/help#feature-views", enLink, "Best for daily load; Gantt shows duration and dependencies"),
  },
  viewGantt: {
    zh: topic("以時間條呈現任務長度與前後關係", "例：看文件審查延後是否推擠補件準備", "/help#feature-views", zhLink, "適合整體時程；看板適合每日流程推進"),
    en: topic("A timeline of task duration and sequence", "Example: see whether a review delay pushes deficiency preparation", "/help#feature-views", enLink, "Best for schedules; Kanban is better for daily flow"),
  },
  unscheduled: {
    zh: topic("尚未設定起始日與到期日的任務", "例：「確認標籤稿」已建立，但日期仍待供應商回覆", "/help#feature-views", zhLink, "仍計入任務清單；但不會形成甘特時間條"),
    en: topic("Tasks with neither a start date nor a due date", "Example: Confirm label proof awaits a supplier date", "/help#feature-views", enLink, "It remains a task but has no Gantt bar"),
  },
  progressUpdates: {
    zh: topic(concept("zh", "progressUpdate").meaning, `例：${concept("zh", "progressUpdate").example}`, "/help#concepts", zhLink, `任務是可執行工作；本紀錄${concept("zh", "progressUpdate").progress}`),
    en: topic(concept("en", "progressUpdate").meaning, `Example: ${concept("en", "progressUpdate").example}`, "/help#concepts", enLink, `A task is actionable work; this update is ${concept("en", "progressUpdate").progress}`),
  },
  aiQuickWrite: {
    zh: topic("把零散筆記整理成可編輯的進度稿", "例：輸入「CTD 收齊、週五審完」產生週報句子", "/help#quickstart-b", zhLink, "只產生草稿；確認內容後仍需手動發布"),
    en: topic("Turns rough notes into an editable progress draft", "Example: “CTD complete; review Friday” becomes a report sentence", "/help#quickstart-b", enLink, "It only drafts text; you review and publish it"),
  },
  aiLinkSuggestions: {
    zh: topic("從進度文字找出可同步的專案動作", "例：勾選「送件完成」後同步完成任務與新增事件", "/help#quickstart-b", zhLink, "建議預設不直接改資料，必須逐項勾選套用"),
    en: topic("Finds project actions implied by an update", "Example: apply “submitted” to complete a task and add an event", "/help#quickstart-b", enLink, "Suggestions do not change data until you select and apply them"),
  },
  clinicalEnrollment: {
    zh: topic("臨床案的收案目標與每日新增人數", "例：目標 120 人；2026-07-28 台大新增 3 人", "/help#feature-specialist", zhLink, "目標是總人數；逐日登錄填當日新增量"),
    en: topic("Clinical enrollment target and daily new subjects", "Example: target 120; NTUH adds 3 on 2026-07-28", "/help#feature-specialist", enLink, "Target is the total; daily entries record new subjects that day"),
  },
  bdCaseStatus: {
    zh: topic("BD 案件目前在送件流程的節點", "例：資料備妥後由「準備文件」改為「已送件」", "/help#feature-specialist", zhLink, "案件狀態是目前位置；歷程保留每次已發生變化"),
    en: topic("The BD case's current submission stage", "Example: change Preparing to Submitted after filing", "/help#feature-specialist", enLink, "Status shows now; history preserves past changes"),
  },
  bdHistory: {
    zh: topic("BD 案件已發生的送件或審查紀錄", "例：2026-09-03 收到 TFDA 第一次補件通知", "/help#feature-specialist", zhLink, "狀態只顯示現在；歷程保留日期與說明"),
    en: topic("Dated submission or review events for a BD case", "Example: first TFDA deficiency letter on 2026-09-03", "/help#feature-specialist", enLink, "Status shows the present; history preserves date and detail"),
  },
  bdFees: {
    zh: topic("BD 案件相關的可分類支出", "例：2026-08-14 TFDA 規費 TWD 50,000", "/help#feature-specialist", zhLink, "費用只對有權限者顯示，不等同專案預算"),
    en: topic("Categorized spending related to a BD case", "Example: TFDA fee of TWD 50,000 on 2026-08-14", "/help#feature-specialist", enLink, "Fees are permission-gated and are not a project budget"),
  },
  qaLicenseExpiry: {
    zh: topic("QA 證照或系統資格的失效日期", "例：GDP 許可證 2027-02-28 到期，提前 90 天追蹤", "/help#feature-specialist", zhLink, "填法定或系統截止日，不填預計開始換證日"),
    en: topic("Expiry date of a QA license or system qualification", "Example: GDP license expires 2027-02-28; track 90 days early", "/help#feature-specialist", enLink, "Enter the legal expiry, not the planned renewal start"),
  },
  ccr: {
    zh: topic("受控記錄產品、文件或製程變更的流程", "例：供應商變更先評估影響，再核准、執行與結案", "/help#feature-specialist", zhLink, "任務追工作；CCR 另保留分類、評估與狀態軌跡"),
    en: topic("A controlled workflow for product, document, or process changes", "Example: assess a supplier change before approval and closure", "/help#feature-specialist", enLink, "Tasks track work; CCR preserves classification, assessment, and states"),
  },
  files: {
    zh: topic("附在專案或任務上的工作檔案", "例：上傳 CTD 缺件清單.xlsx 並綁定審查任務", "/help#feature-collaboration", zhLink, "專案檔供整案共用；任務附件只跟該工作一起看"),
    en: topic("Working files attached to a project or task", "Example: attach CTD-gap-list.xlsx to the review task", "/help#feature-collaboration", enLink, "Project files are shared broadly; task files stay with that task"),
  },
  automationRules: {
    zh: topic("事件發生時自動執行指定動作", "例：里程碑完成後通知 Hina 並建立追蹤待辦", "/help#feature-collaboration", zhLink, "只在觸發條件成立後執行，不會回溯舊事件"),
    en: topic("Runs a chosen action when an event occurs", "Example: notify Hina and create a to-do when a milestone completes", "/help#feature-collaboration", enLink, "It runs on future triggers and does not replay old events"),
  },
  todos: {
    zh: topic(concept("zh", "todo").meaning, `例：${concept("zh", "todo").example}`, "/help#concepts", zhLink, `任務可由團隊指派；待辦預設只有自己看見`),
    en: topic(concept("en", "todo").meaning, `Example: ${concept("en", "todo").example}`, "/help#concepts", enLink, "Tasks can be assigned by the team; to-dos are private by default"),
  },
  notifications: {
    zh: topic("系統送給你的事件與提醒收件匣", "例：里程碑三天後到期、你被留言 @提及", "/help#feature-personal", zhLink, "待辦是要做的事；通知是告訴你發生了什麼"),
    en: topic("Your inbox for system events and reminders", "Example: a milestone is due in three days or a comment mentions you", "/help#feature-personal", enLink, "A to-do is work to do; a notification tells you what happened"),
  },
  announcementDate: {
    zh: topic("機關發布公告的日期", "例：TFDA 於 2026-07-15 公告新查驗基準", "/help#quickstart-c", zhLink, "施行日是規定開始生效日，可能晚於公告日"),
    en: topic("The date an authority publishes an announcement", "Example: TFDA publishes a new review standard on 2026-07-15", "/help#quickstart-c", enLink, "The effective date is when rules take effect and may be later"),
  },
  productLine: {
    zh: topic("公告主要影響的產品領域", "例：醫療器材 UDI 公告選「醫療器材」", "/help#quickstart-c", zhLink, "類別是較細的自由短標籤，如 UDI 或 GMP"),
    en: topic("The product domain primarily affected", "Example: classify a UDI notice under Medical devices", "/help#quickstart-c", enLink, "Category is a narrower free-text tag such as UDI or GMP"),
  },
  category: {
    zh: topic("用來細分公告主題的短標籤", "例：產品線「藥品」、類別填「PIC/S GMP」", "/help#quickstart-c", zhLink, "產品線用固定大類；類別可依團隊檢索習慣填寫"),
    en: topic("A short tag for a narrower regulatory subject", "Example: Product line Drug; category PIC/S GMP", "/help#quickstart-c", enLink, "Product line is fixed; category follows your team's search vocabulary"),
  },
  tfdaDrafts: {
    zh: topic("自動抓取但尚未對全員發布的 TFDA 項目", "例：先核對標題、日期與重點，再核准或駁回", "/help#quickstart-c", zhLink, "草稿只供管理者審核；核准後才進已發布清單"),
    en: topic("TFDA items fetched but not yet published to everyone", "Example: verify title, date, and key points before approval", "/help#quickstart-c", enLink, "Only reviewers see drafts; approval moves them to the published list"),
  },
  aiImportMode: {
    zh: topic("決定 AI 將來源整理成一筆或多筆公告", "例：一份含三個不同日期公告時選「多則彙整」", "/help#feature-regwatch", zhLink, "單則保留一筆；多則只依不同日期或標題拆分"),
    en: topic("Controls whether AI creates one or several entries", "Example: choose Multiple for a file containing three dated notices", "/help#feature-regwatch", enLink, "Single keeps one entry; Multiple splits only by date or title"),
  },
  regwatchAttachments: {
    zh: topic("公告的原始檔或佐證附件", "例：下載 TFDA 公告 PDF 核對完整條文與附表", "/help#feature-regwatch", zhLink, "重點是摘要；附件保留可回查的完整原文"),
    en: topic("Original source files or evidence for an announcement", "Example: download the TFDA PDF to verify clauses and appendices", "/help#feature-regwatch", enLink, "Key points summarize; attachments preserve the full source"),
  },
  reportScope: {
    zh: topic("週報或月報要彙整的群組與期間", "例：產生 RA 組 2026 年 7 月月報，不含私人專案", "/help#feature-reports", zhLink, "摘要篩選只改畫面；產生範圍會決定 AI 報表內容"),
    en: topic("The group and period included in a weekly or monthly report", "Example: July 2026 RA report excluding private projects", "/help#feature-reports", enLink, "Summary filters affect the screen; generation scope defines AI report content"),
  },
  timelineLanes: {
    zh: topic("按組別分泳道比較專案、任務與事件時程", "例：展開 RA 專案，看 CTD 審查與 CDE 諮詢的先後", "/help#feature-timeline", zhLink, "甘特看單一專案細節；此處跨專案比較"),
    en: topic("Group lanes comparing project, task, and event schedules", "Example: expand RA to compare CTD review with CDE consultation", "/help#feature-timeline", enLink, "Gantt details one project; this timeline compares projects"),
  },
} as const satisfies Record<string, Record<HelpLanguage, HelpContent>>;

export type TopicKey = keyof typeof HELP_TOPICS;

export const HELP_TOPIC_PLACEMENTS = [
  "projectGoal", "progressMode", "milestones", "historyEvents", "projectDates", "members", "visibility", "status", "objective", "keyResults", "aiRisk",
  "stages", "taskCards", "taskDates", "dependencies", "viewKanban", "viewList", "viewCalendar", "viewGantt", "unscheduled",
  "progressUpdates", "aiQuickWrite", "aiLinkSuggestions",
  "clinicalEnrollment", "bdCaseStatus", "bdHistory", "bdFees", "qaLicenseExpiry", "ccr",
  "files", "automationRules", "todos", "notifications",
  "announcementDate", "productLine", "category", "tfdaDrafts", "aiImportMode", "regwatchAttachments",
  "reportScope", "timelineLanes",
] as const satisfies readonly TopicKey[];
