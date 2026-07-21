export type ScheduledJob = "daily-reminders" | "weekly-reports" | "monthly-reports" | null;

export function scheduledJobForCron(cron: string): ScheduledJob {
  if (cron === "0 1 * * *") return "daily-reminders";
  if (cron === "30 0 * * 1") return "weekly-reports";
  if (cron === "30 0 1 * *") return "monthly-reports";
  return null;
}
