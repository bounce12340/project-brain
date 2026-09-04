import { describe, expect, it } from "vitest";
import { buildProjectTimeline, timelineCounts, todayDividerIndex } from "../src/project-timeline";
import type { Milestone } from "../src/types";

const today = "2026-08-21";
const ms = (id: string, due: string | null, kind: Milestone["kind"] = "event", done = 0): Milestone =>
  ({ id, title: id, due_date: due, end_date: null, done, position: 0, kind });

const rows = [
  ms("past-old", "2026-07-31"),
  ms("future", "2026-09-30", "milestone"),
  ms("past-new", "2026-08-14"),
  ms("overdue", "2026-08-01", "milestone"),
  ms("nodate", null, "milestone"),
];

describe("buildProjectTimeline", () => {
  it("由未來排到過去，接下來要做的留在最上面", () => {
    expect(buildProjectTimeline(rows, today).map((row) => row.item.id))
      .toEqual(["future", "past-new", "overdue", "past-old", "nodate"]);
  });

  it("沒有日期的沉到最後但不會消失", () => {
    const built = buildProjectTimeline(rows, today);
    expect(built.at(-1)?.item.id).toBe("nodate");
    expect(built).toHaveLength(rows.length);
  });

  it("今天當天算已發生，不算未來", () => {
    expect(buildProjectTimeline([ms("t", today)], today)[0].isFuture).toBe(false);
  });

  it("只有未完成的里程碑會標成逾期", () => {
    const built = buildProjectTimeline([ms("m", "2026-08-01", "milestone"), ms("e", "2026-08-01", "event"),
      ms("d", "2026-08-01", "milestone", 1)], today);
    expect(built.filter((row) => row.isOverdue).map((row) => row.item.id)).toEqual(["m"]);
  });

  it("兩種 kind 混在同一條流裡", () => {
    const kinds = buildProjectTimeline(rows, today).map((row) => row.item.kind);
    expect(new Set(kinds)).toEqual(new Set(["milestone", "event"]));
  });

  it("空清單回空陣列", () => expect(buildProjectTimeline([], today)).toEqual([]));
});

describe("todayDividerIndex", () => {
  it("插在第一筆過去項目之前", () => {
    expect(todayDividerIndex(buildProjectTimeline(rows, today))).toBe(1);
  });

  it("全部都是未來時不顯示分隔線", () => {
    expect(todayDividerIndex(buildProjectTimeline([ms("f", "2026-09-30", "milestone")], today))).toBe(-1);
  });

  it("全部都是過去時不顯示分隔線", () => {
    expect(todayDividerIndex(buildProjectTimeline([ms("p", "2026-07-01")], today))).toBe(-1);
  });
});

describe("timelineCounts", () => {
  it("分別數未來、過去與逾期", () => {
    expect(timelineCounts(buildProjectTimeline(rows, today))).toEqual({ upcoming: 1, active: 0, past: 4, overdue: 1 });
  });
});

describe("有結束日的里程碑是一段期間", () => {
  // 使用者回報：8/27 執行到 9/28 的里程碑，在 8/31 就被標成逾期。
  const period = (id: string, due: string, end: string | null, done = 0): Milestone =>
    ({ id, title: id, due_date: due, end_date: end, done, position: 0, kind: "milestone" });

  it("期間還沒結束就不算逾期，即使開始日已過", () => {
    const [row] = buildProjectTimeline([period("ctd", "2026-08-27", "2026-09-28")], "2026-08-31");
    expect(row.isOverdue).toBe(false);
    expect(row.deadline).toBe("2026-09-28");
  });

  it("期間已開始未結束標成進行中", () => {
    const [row] = buildProjectTimeline([period("ctd", "2026-08-27", "2026-09-28")], "2026-08-31");
    expect(row.isActive).toBe(true);
    // 三者互斥：進行中的不會同時被算進「已發生」。
    expect(timelineCounts([row])).toEqual({ upcoming: 0, active: 1, past: 0, overdue: 0 });
  });

  it("結束日當天仍在期間內", () => {
    const [row] = buildProjectTimeline([period("ctd", "2026-08-27", "2026-09-28")], "2026-09-28");
    expect(row.isOverdue).toBe(false);
    expect(row.isActive).toBe(true);
  });

  it("過了結束日才算逾期", () => {
    const [row] = buildProjectTimeline([period("ctd", "2026-08-27", "2026-09-28")], "2026-09-29");
    expect(row.isOverdue).toBe(true);
    expect(row.isActive).toBe(false);
  });

  it("完成了就不算逾期也不算進行中", () => {
    const [row] = buildProjectTimeline([period("ctd", "2026-08-27", "2026-09-28", 1)], "2026-09-29");
    expect(row.isOverdue).toBe(false);
    expect(row.isActive).toBe(false);
  });

  it("沒有結束日時期限就是那一天，行為與先前相同", () => {
    const [row] = buildProjectTimeline([period("m", "2026-08-01", null)], "2026-08-31");
    expect(row.deadline).toBe("2026-08-01");
    expect(row.isOverdue).toBe(true);
    expect(row.isActive).toBe(false);
  });

  it("尚未開始的期間不算進行中", () => {
    const [row] = buildProjectTimeline([period("m", "2026-09-01", "2026-09-30")], "2026-08-31");
    expect(row.isActive).toBe(false);
    expect(row.isFuture).toBe(true);
  });
});
