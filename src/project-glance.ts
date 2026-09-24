import type { Milestone, ProgressUpdate, Project, Stage, Task } from "./types";
import { daysBetween } from "./utils/dates";
import { parseServerDate } from "./utils/server-date";

/**
 * 專案快覽：把一個專案散在任務、里程碑、歷程事件、進度紀錄裡的資料，整理成
 * 「現在做到哪、接下來要做什麼、過去發生了什麼」三塊，讓人不必切分頁就看得懂。
 *
 * 歷程只取第一手紀錄。系統自動寫的「✔ 完成任務「X」」進度紀錄與任務本身的完成時間
 * 是同一件事，兩者都列的話每件完成的事都會出現兩次。
 */

export type GlanceKind = "note" | "progress" | "task" | "milestone" | "event";

export interface GlanceItem {
  id: string;
  kind: GlanceKind;
  /** 台北時間的日期（YYYY-MM-DD）；排不出日期的項目為 null。 */
  date: string | null;
  endDate?: string | null;
  title: string;
  /** 任務所在階段、進度紀錄作者等附帶說明。 */
  detail?: string;
}

export interface UpcomingItem extends GlanceItem {
  /** 距今天數：負數為逾期，0 為今天，null 為未排日期。 */
  days: number | null;
}

export interface HistoryMonth {
  /** YYYY-MM */
  month: string;
  items: GlanceItem[];
}

export interface Glance {
  latest: ProgressUpdate | null;
  upcoming: UpcomingItem[];
  history: HistoryMonth[];
  historyCount: number;
  counts: { tasksDone: number; tasks: number; milestonesDone: number; milestones: number };
  /** 距最後一次動靜的天數；沒有紀錄時為 null。 */
  idleDays: number | null;
}

export interface GlanceSource {
  project: Pick<Project, "last_activity_at">;
  stages: Stage[];
  tasks: Task[];
  milestones: Array<Milestone & { done_at?: string | null }>;
  progress_updates?: ProgressUpdate[];
}

const PROGRESS_CHANGE = /^專案進度更新為 \d+%$/;

/** 完成任務／里程碑時系統自動寫的那一種。 */
export function isCompletionEcho(content: string): boolean {
  return content.startsWith("✔ 完成");
}

/** 有人寫下的文字進度，而不是系統記下的數字變化。 */
export function isNarrative(content: string): boolean {
  const text = content.trim();
  return !!text && !isCompletionEcho(text) && !PROGRESS_CHANGE.test(text);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const taipei = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * 任何伺服器時間換成台北日期。完成時間存的是 UTC（`2026-08-31T20:10:00Z`），
 * 直接截前 10 碼會把台北 9/1 清晨完成的事算成 8/31。
 */
export function localDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) return value;
  const date = parseServerDate(value);
  return Number.isNaN(date.getTime()) ? null : taipei.format(date);
}

const byDateAsc = (a: UpcomingItem, b: UpcomingItem) => {
  if (a.date === b.date) return a.kind === b.kind ? 0 : a.kind === "milestone" ? -1 : 1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date < b.date ? -1 : 1;
};

export function buildGlance(source: GlanceSource, today: string): Glance {
  const stageName = new Map(source.stages.map((stage) => [stage.id, stage.name]));
  const upcoming: UpcomingItem[] = [];
  const past: Array<GlanceItem & { at: string }> = [];
  const due = (date: string | null) => (date ? daysBetween(today, date) : null);

  for (const task of source.tasks) {
    if (!task.done) {
      const detail = [stageName.get(task.stage_id), task.assignee_name].filter(Boolean).join(" · ") || undefined;
      upcoming.push({ id: task.id, kind: "task", date: task.due_date, title: task.title, detail, days: due(task.due_date) });
      continue;
    }
    // 完成的任務不帶階段：勾完成不會把卡片移出「待辦」欄，寫成「完成任務 · 待辦」只會讓人困惑。
    const date = localDay(task.done_at) ?? task.due_date;
    if (date) past.push({ id: task.id, kind: "task", date, title: task.title, detail: task.assignee_name || undefined, at: task.done_at ?? date });
  }

  for (const item of source.milestones) {
    const start = item.due_date;
    const end = item.end_date ?? item.due_date;
    if (item.kind === "event") {
      // 歷程事件是「發生過的事」；日期還沒到的是排定好的，放在接下來。
      if (start && start > today) upcoming.push({ id: item.id, kind: "event", date: start, endDate: item.end_date, title: item.title, days: due(start) });
      else if (start) past.push({ id: item.id, kind: "event", date: start, endDate: item.end_date, title: item.title, at: start });
      continue;
    }
    if (!item.done) {
      upcoming.push({ id: item.id, kind: "milestone", date: end, title: item.title, days: due(end) });
      continue;
    }
    // 提早完成的里程碑日期還在未來，放在歷程最上面會像是預言。改用實際勾選完成的那天。
    const date = end && end <= today ? end : localDay(item.done_at) ?? end;
    if (date) past.push({ id: item.id, kind: "milestone", date, title: item.title, at: date });
  }

  const updates = source.progress_updates ?? [];
  for (const update of updates) {
    if (isCompletionEcho(update.content)) continue;
    const date = localDay(update.created_at);
    if (!date) continue;
    const kind: GlanceKind = PROGRESS_CHANGE.test(update.content.trim()) ? "progress" : "note";
    past.push({ id: update.id, kind, date, title: update.content, detail: update.author_name, at: update.created_at });
  }

  // 同一天內再依實際時間排，讓當天先發生的在下面。
  const stamp = (value: string) => { const time = parseServerDate(value).getTime(); return Number.isNaN(time) ? 0 : time; };
  past.sort((a, b) => (a.date === b.date ? stamp(b.at) - stamp(a.at) : (a.date as string) < (b.date as string) ? 1 : -1));
  const history: HistoryMonth[] = [];
  for (const { at: _at, ...item } of past) {
    const month = (item.date as string).slice(0, 7);
    const last = history.at(-1);
    if (last?.month === month) last.items.push(item);
    else history.push({ month, items: [item] });
  }

  const milestones = source.milestones.filter((item) => item.kind === "milestone");
  const latest = updates.filter((update) => isNarrative(update.content))
    .sort((a, b) => stamp(b.created_at) - stamp(a.created_at))[0] ?? null;
  const lastActivity = localDay(source.project.last_activity_at);

  return {
    latest,
    upcoming: upcoming.sort(byDateAsc),
    history,
    historyCount: past.length,
    counts: {
      tasksDone: source.tasks.filter((task) => task.done).length, tasks: source.tasks.length,
      milestonesDone: milestones.filter((item) => item.done).length, milestones: milestones.length,
    },
    idleDays: lastActivity ? Math.max(0, daysBetween(lastActivity, today)) : null,
  };
}

/** 歷程只先顯示最近幾筆；按「顯示全部」才展開。保留月份分組。 */
export function limitHistory(history: HistoryMonth[], limit: number): HistoryMonth[] {
  const result: HistoryMonth[] = [];
  let left = limit;
  for (const month of history) {
    if (left <= 0) break;
    const items = month.items.slice(0, left);
    result.push({ month: month.month, items });
    left -= items.length;
  }
  return result;
}
