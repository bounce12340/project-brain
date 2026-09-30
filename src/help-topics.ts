export type HelpLanguage = "zh" | "en";

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
