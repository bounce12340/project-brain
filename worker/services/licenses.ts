const DAY_MS = 86_400_000;

export type LicenseNotificationStage = "90" | "60" | "30" | "7" | "expired";
export type LicenseBadgeLevel = "green" | "yellow" | "orange" | "red" | "expired";

function utcDate(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}
export function daysUntilDate(expiresAt: string, today: string): number {
  return Math.round((utcDate(expiresAt) - utcDate(today)) / DAY_MS);
}

export function licenseNotificationStage(expiresAt: string, today: string, lastStage: string | null = null): LicenseNotificationStage | null {
  const days = daysUntilDate(expiresAt, today);
  const stage: LicenseNotificationStage | null = days < 0 ? "expired" : ([90, 60, 30, 7].includes(days) ? String(days) as LicenseNotificationStage : null);
  return stage && stage !== lastStage ? stage : null;
}

export function licenseBadgeLevel(expiresAt: string, today: string): LicenseBadgeLevel {
  const days = daysUntilDate(expiresAt, today);
  if (days < 0) return "expired";
  if (days <= 30) return "red";
  if (days <= 90) return "orange";
  if (days <= 180) return "yellow";
  return "green";
}
