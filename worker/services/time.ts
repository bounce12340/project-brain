const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDate(date = new Date()): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
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
