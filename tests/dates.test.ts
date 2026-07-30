import { describe, expect, it } from "vitest";
import { addDays, calendarGrid, daysBetween, ganttPosition, startOfCalendarGrid } from "../src/utils/dates";

describe("calendar and gantt date helpers", () => {
  it("starts calendar grids on Sunday", () => expect(startOfCalendarGrid(2026, 6)).toBe("2026-06-28"));
  it("keeps the first of the month when it is already Sunday", () => expect(startOfCalendarGrid(2026, 2)).toBe("2026-03-01"));
  it("builds six calendar weeks", () => expect(calendarGrid(2026, 6)).toHaveLength(42));
  it("aligns every grid row to Sunday", () => {
    const grid = calendarGrid(2026, 7);
    expect(grid.filter((_, index) => index % 7 === 0).every((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0)).toBe(true);
  });
  it("covers the whole month when it starts on Saturday", () => {
    const grid = calendarGrid(2026, 7);
    expect(grid).toContain("2026-08-01");
    expect(grid).toContain("2026-08-31");
  });
  it("adds days across months", () => expect(addDays("2026-07-31", 1)).toBe("2026-08-01"));
  it("measures day spans", () => expect(daysBetween("2026-07-01", "2026-07-11")).toBe(10));
  it("maps dates into gantt width", () => expect(ganttPosition("2026-07-06", "2026-07-01", "2026-07-11", 100)).toBe(50));
  it("clamps gantt dates outside range", () => expect(ganttPosition("2026-08-01", "2026-07-01", "2026-07-11", 100)).toBe(100));
});
