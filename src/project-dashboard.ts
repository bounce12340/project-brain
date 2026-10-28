import type { Milestone, Stage, Task } from "./types";

/**
 * 專案儀表板（像 Asana 的專案 Dashboard）用的數字，全部由專案內頁已載入的資料算出，不另外打 API。
 * 日期一律是台北的 YYYY-MM-DD 字串，直接比字串大小即可。
 */
export interface ProjectDashboardData {
  total: number; done: number; open: number; overdue: number; dueSoon: number; unassigned: number;
  subtaskTotal: number; subtaskDone: number;
  byStage: Array<{ stage: string; open: number; done: number }>;
  byAssignee: Array<{ name: string; open: number; overdue: number }>;
  completedByWeek: Array<{ week: string; done: number }>;
  upcoming: Array<{ kind: "task" | "milestone"; id: string; title: string; date: string; overdue: boolean; assignee?: string | null }>;
  nextMilestone: Milestone | null;
}

export const DUE_SOON_DAYS = 14;
export const WEEKS = 8;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 那一週的星期一（台北日期）。 */
export const weekStart = (date: string) => { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, -((day + 6) % 7)); };

export function projectDashboard(tasks: Task[], stages: Stage[], milestones: Milestone[], today: string, unassignedLabel: string): ProjectDashboardData {
  const soon = addDays(today, DUE_SOON_DAYS);
  const open = tasks.filter((task) => !task.done);
  const isOverdue = (task: Task) => !task.done && !!task.due_date && task.due_date < today;
  const byStage = [...stages].sort((a, b) => a.position - b.position).map((stage) => {
    const inStage = tasks.filter((task) => task.stage_id === stage.id);
    return { stage: stage.name, open: inStage.filter((task) => !task.done).length, done: inStage.filter((task) => task.done).length };
  });
  const assignees = new Map<string, { name: string; open: number; overdue: number }>();
  for (const task of open) {
    const key = task.assignee_id ?? "";
    const entry = assignees.get(key) ?? { name: task.assignee_name || unassignedLabel, open: 0, overdue: 0 };
    entry.open += 1;
    if (isOverdue(task)) entry.overdue += 1;
    assignees.set(key, entry);
  }
  const firstWeek = addDays(weekStart(today), -7 * (WEEKS - 1));
  const completedByWeek = Array.from({ length: WEEKS }, (_, index) => ({ week: addDays(firstWeek, index * 7), done: 0 }));
  for (const task of tasks) {
    if (!task.done || !task.done_at) continue;
    // done_at 是 UTC ISO；換成台北日期再歸週。
    const local = new Date(Date.parse(task.done_at) + 8 * 3_600_000).toISOString().slice(0, 10);
    const bucket = completedByWeek.find((item) => item.week === weekStart(local));
    if (bucket) bucket.done += 1;
  }
  const openMilestones = milestones.filter((item) => item.kind === "milestone" && !item.done && item.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  const upcoming = [
    ...open.filter((task) => task.due_date && task.due_date <= soon).map((task) => ({ kind: "task" as const, id: task.id, title: task.title, date: task.due_date!, overdue: task.due_date! < today, assignee: task.assignee_name ?? null })),
    ...openMilestones.filter((item) => item.due_date! <= soon).map((item) => ({ kind: "milestone" as const, id: item.id, title: item.title, date: item.due_date!, overdue: item.due_date! < today })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return {
    total: tasks.length, done: tasks.length - open.length, open: open.length,
    overdue: open.filter(isOverdue).length,
    dueSoon: open.filter((task) => task.due_date && task.due_date >= today && task.due_date <= soon).length,
    unassigned: open.filter((task) => !task.assignee_id).length,
    subtaskTotal: tasks.reduce((sum, task) => sum + (task.subtask_total ?? 0), 0),
    subtaskDone: tasks.reduce((sum, task) => sum + (task.subtask_done ?? 0), 0),
    byStage,
    byAssignee: [...assignees.values()].sort((a, b) => b.open - a.open),
    completedByWeek,
    upcoming,
    nextMilestone: openMilestones.find((item) => item.due_date! >= today) ?? null,
  };
}
