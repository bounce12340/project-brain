import type { Milestone } from "./types";

/**
 * 里程碑與歷程事件本來就存在同一張表（`milestones`，只差 kind 欄位），
 * 卻被拆成兩個面板各自新增，同一件事常被記兩次。這裡把它們併成一條時間流。
 */
export interface TimelineItem {
  item: Milestone;
  /** 排序用的日期，也就是期間的開始。沒有日期的排在最後，仍然看得到。 */
  date: string;
  /** 真正的期限：有結束日就是結束日，否則就是那一天。逾期一律以此判斷。 */
  deadline: string;
  isFuture: boolean;
  /** 期間已經開始、還沒結束。這種項目不是逾期，也不是已發生，而是進行中。 */
  isActive: boolean;
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
      // 有結束日的里程碑是一段期間，期限在結束日。先前拿開始日跟今天比，
      // 於是「8/27 執行到 9/28」在 8/31 就被判逾期——期間才剛過四天。
      const deadline = item.end_date ?? date;
      return {
        item,
        date,
        deadline,
        isFuture: !!date && date > today,
        isActive: !!item.end_date && !item.done && !!date && date <= today && today <= item.end_date,
        isOverdue: item.kind === "milestone" && !item.done && !!deadline && deadline < today,
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

export function timelineCounts(items: TimelineItem[]): { upcoming: number; past: number; overdue: number; active: number } {
  return {
    // 三者互斥：尚未開始、期間內、已結束。進行中的若也算進「已發生」，
    // 摘要會說一件還在跑的事已經發生了。
    upcoming: items.filter((row) => row.isFuture).length,
    active: items.filter((row) => row.isActive).length,
    past: items.filter((row) => !row.isFuture && !row.isActive).length,
    overdue: items.filter((row) => row.isOverdue).length,
  };
}
