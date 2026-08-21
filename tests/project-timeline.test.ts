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
    expect(timelineCounts(buildProjectTimeline(rows, today))).toEqual({ upcoming: 1, past: 4, overdue: 1 });
  });
});
