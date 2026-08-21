import type { Milestone } from "./types";

/**
 * 里程碑與歷程事件本來就存在同一張表（`milestones`，只差 kind 欄位），
 * 卻被拆成兩個面板各自新增，同一件事常被記兩次。這裡把它們併成一條時間流。
 */
export interface TimelineItem {
  item: Milestone;
  /** 沒有日期的排在最後，仍然看得到。 */
  date: string;
  isFuture: boolean;
  isOverdue: boolean;
}

/**
 * 由未來排到過去：最上面是還沒到的里程碑，往下越過今天就是已發生的事。
 * 這個方向讓「接下來要做什麼」留在視線最先到的位置。
 */
export function buildProjectTimeline(milestones: Milestone[], today: string): TimelineItem[] {
  return [...milestones]
    .map((item) => {
      const date = item.due_date ?? "";
      return {
        item,
        date,
        isFuture: !!date && date > today,
        isOverdue: item.kind === "milestone" && !item.done && !!date && date < today,
      };
    })
    .sort((left, right) => {
      // 沒有日期的一律沉到最後，不跟有日期的搶位置。
      if (!left.date !== !right.date) return left.date ? -1 : 1;
      return right.date.localeCompare(left.date) || left.item.title.localeCompare(right.item.title, "zh-TW", { numeric: true });
    });
}

/** 今天的分隔線要插在第幾筆之前；沒有未來項目時回 -1，代表不顯示。 */
export function todayDividerIndex(items: TimelineItem[]): number {
  const firstPast = items.findIndex((row) => !row.isFuture);
  return items.some((row) => row.isFuture) && firstPast > 0 ? firstPast : -1;
}

export function timelineCounts(items: TimelineItem[]): { upcoming: number; past: number; overdue: number } {
  return {
    upcoming: items.filter((row) => row.isFuture).length,
    past: items.filter((row) => !row.isFuture).length,
    overdue: items.filter((row) => row.isOverdue).length,
  };
}
