/**
 * 「我的任務」的分組：逾期、今天、本週（到這週日）、之後、未排日期。日期是台北的 YYYY-MM-DD。
 * 只看到期日；沒有到期日但有開始日的任務也算「未排日期」，因為不知道何時要交。
 */
export interface MyTaskItem {
  kind: "task" | "subtask";
  id: string; title: string; due_date: string | null; project_id: string; project_name: string;
  start_date?: string | null; stage?: string; subtask_total?: number; subtask_done?: number;
  task_id?: string; task_title?: string;
}
export const MY_TASK_GROUPS = ["overdue", "today", "week", "later", "undated"] as const;
export type MyTaskGroup = typeof MY_TASK_GROUPS[number];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 這週的星期日（週一開始的一週）。 */
export const endOfWeek = (date: string) => { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, (7 - day) % 7); };

export function myTaskGroup(item: Pick<MyTaskItem, "due_date">, today: string): MyTaskGroup {
  if (!item.due_date) return "undated";
  if (item.due_date < today) return "overdue";
  if (item.due_date === today) return "today";
  return item.due_date <= endOfWeek(today) ? "week" : "later";
}

export function groupMyTasks<T extends MyTaskItem>(items: T[], today: string): Record<MyTaskGroup, T[]> {
  const groups = Object.fromEntries(MY_TASK_GROUPS.map((key) => [key, [] as T[]])) as Record<MyTaskGroup, T[]>;
  for (const item of items) groups[myTaskGroup(item, today)].push(item);
  for (const key of MY_TASK_GROUPS) groups[key].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.project_name.localeCompare(b.project_name) || a.title.localeCompare(b.title));
  return groups;
}
