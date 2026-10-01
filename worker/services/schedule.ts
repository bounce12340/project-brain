export type ScheduledJob = "daily-reminders" | "weekly-reports" | "monthly-reports" | "project-risk" | null;

export function scheduledJobForCron(cron: string): ScheduledJob {
  if (cron === "0 1 * * *") return "daily-reminders";
  if (cron === "30 0 * * 1") return "weekly-reports";
  if (cron === "30 0 1 * *") return "monthly-reports";
  // 每 10 分鐘補做幾個專案的 AI 風險分析（沒分析過或超過 7 天的）。
  if (cron === "*/10 * * * *") return "project-risk";
  return null;
}
