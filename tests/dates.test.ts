import { describe, expect, it } from "vitest";
import { addDays, calendarGrid, daysBetween, ganttPosition, startOfCalendarGrid } from "../src/utils/dates";

describe("calendar and gantt date helpers", () => {
  it("starts calendar grids on Monday", () => expect(startOfCalendarGrid(2026, 6)).toBe("2026-06-29"));
  it("builds six calendar weeks", () => expect(calendarGrid(2026, 6)).toHaveLength(42));
  it("adds days across months", () => expect(addDays("2026-07-31", 1)).toBe("2026-08-01"));
  it("measures day spans", () => expect(daysBetween("2026-07-01", "2026-07-11")).toBe(10));
  it("maps dates into gantt width", () => expect(ganttPosition("2026-07-06", "2026-07-01", "2026-07-11", 100)).toBe(50));
  it("clamps gantt dates outside range", () => expect(ganttPosition("2026-08-01", "2026-07-01", "2026-07-11", 100)).toBe(100));
});
