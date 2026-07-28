export interface DependencyDateTask {
  id: string;
  due_date: string | null;
}

export type DependencyDateStatus = "none" | "missing-due-date" | "auto-applied" | "suggestion";

export interface DependencyDateResult {
  startDate: string | null;
  dueDate: string | null;
  suggestedStartDate: string | null;
  status: DependencyDateStatus;
}

const DAY_MS = 86_400_000;

function dateValue(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export function addCalendarDays(value: string, days: number): string {
  return new Date(dateValue(value) + days * DAY_MS).toISOString().slice(0, 10);
}

export function recommendedStartDate(dependencies: DependencyDateTask[]): string | null {
  if (dependencies.length === 0 || dependencies.some((task) => !task.due_date)) return null;
  const latestDueDate = dependencies.reduce((latest, task) => task.due_date! > latest ? task.due_date! : latest, "");
  return addCalendarDays(latestDueDate, 1);
}

export function applyDependencyDateChange({
  dependencies,
  startDate,
  dueDate,
  startDateTouched,
}: {
  dependencies: DependencyDateTask[];
  startDate: string | null;
  dueDate: string | null;
  startDateTouched: boolean;
}): DependencyDateResult {
  if (dependencies.length === 0) {
    return { startDate, dueDate, suggestedStartDate: null, status: "none" };
  }

  const suggestedStartDate = recommendedStartDate(dependencies);
  if (!suggestedStartDate) {
    return { startDate, dueDate, suggestedStartDate: null, status: "missing-due-date" };
  }
  if (startDateTouched) {
    return { startDate, dueDate, suggestedStartDate, status: "suggestion" };
  }

  const shiftedDueDate = startDate && dueDate
    ? addCalendarDays(dueDate, Math.round((dateValue(suggestedStartDate) - dateValue(startDate)) / DAY_MS))
    : dueDate;
  return {
    startDate: suggestedStartDate,
    dueDate: shiftedDueDate,
    suggestedStartDate,
    status: "auto-applied",
  };
}
