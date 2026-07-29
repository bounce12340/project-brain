const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidMilestoneDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function milestoneDateRangeError(dueDate: string | null, endDate: string | null): string | null {
  if (!endDate) return null;
  if (!dueDate || !isValidMilestoneDate(dueDate) || !isValidMilestoneDate(endDate) || endDate < dueDate) {
    return "結束日不得早於起始日";
  }
  return null;
}
