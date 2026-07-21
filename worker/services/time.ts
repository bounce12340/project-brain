const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDate(date = new Date()): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function currentTaipeiQuarter(date = new Date()): string {
  const local = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return `${local.getUTCFullYear()}Q${Math.floor(local.getUTCMonth() / 3) + 1}`;
}

export function taipeiDayBounds(date = new Date()): { start: string; end: string } {
  const localDate = taipeiDate(date);
  return { start: `${localDate}T00:00:00+08:00`, end: `${localDate}T23:59:59+08:00` };
}

export function previousTaipeiWeek(date = new Date()): { start: string; end: string } {
  const local = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const day = local.getUTCDay() || 7;
  const thisMonday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day + 1));
  const previousMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const previousSunday = new Date(thisMonday.getTime() - 1);
  return { start: previousMonday.toISOString().slice(0, 10), end: previousSunday.toISOString().slice(0, 10) };
}

export type ReportPeriodPreset = "this-week" | "last-week" | "this-month" | "last-month";

export function reportPeriod(preset: ReportPeriodPreset, date = new Date()): { periodType: "week" | "month"; start: string; end: string } {
  const local = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const dayOfMonth = local.getUTCDate();
  if (preset === "this-month" || preset === "last-month") {
    const targetMonth = month - (preset === "last-month" ? 1 : 0);
    const start = new Date(Date.UTC(year, targetMonth, 1));
    const end = new Date(Date.UTC(year, targetMonth + 1, 0));
    return { periodType: "month", start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const weekday = local.getUTCDay() || 7;
  const offset = preset === "last-week" ? -7 : 0;
  const monday = new Date(Date.UTC(year, month, dayOfMonth - weekday + 1 + offset));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { periodType: "week", start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export function previousTaipeiMonth(date = new Date()): { start: string; end: string } {
  const { start, end } = reportPeriod("last-month", date);
  return { start, end };
}
