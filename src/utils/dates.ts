const DAY = 86_400_000;

export function dateOnly(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return dateOnly(new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY));
}

export function daysBetween(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY);
}

export function startOfCalendarGrid(year: number, monthIndex: number): string {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const sundayOffset = first.getUTCDay();
  return dateOnly(new Date(first.getTime() - sundayOffset * DAY));
}

export function calendarGrid(year: number, monthIndex: number): string[] {
  const start = startOfCalendarGrid(year, monthIndex);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function ganttPosition(date: string, start: string, end: string, width: number): number {
  const span = Math.max(1, daysBetween(start, end));
  return Math.max(0, Math.min(width, daysBetween(start, date) / span * width));
}

