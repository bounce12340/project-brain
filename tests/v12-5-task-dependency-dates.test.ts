import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  applyDependencyDateChange,
  recommendedStartDate,
  type DependencyDateTask,
} from "../src/task-dependency-dates";

const dependency = (id: string, due_date: string | null): DependencyDateTask => ({ id, due_date });

describe("SPEC-V12-5 dependency date recommendation", () => {
  it("uses the latest due date across all prerequisites", () => {
    expect(recommendedStartDate([
      dependency("early", "2026-09-02"),
      dependency("latest", "2026-09-10"),
      dependency("middle", "2026-09-05"),
    ])).toBe("2026-09-11");
  });

  it("adds one Taipei calendar day across a month boundary", () => {
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("adds one Taipei calendar day across a year boundary", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("returns null when any selected prerequisite has no due date", () => {
    expect(recommendedStartDate([
      dependency("dated", "2026-09-10"),
      dependency("undated", null),
    ])).toBeNull();
  });

  it("fills an empty start date without inventing a due date", () => {
    expect(applyDependencyDateChange({
      dependencies: [dependency("a", "2026-09-10")],
      startDate: null,
      dueDate: null,
      startDateTouched: false,
    })).toEqual({
      startDate: "2026-09-11",
      dueDate: null,
      suggestedStartDate: "2026-09-11",
      status: "auto-applied",
    });
  });

  it("shifts both dates by the same number of days to preserve duration", () => {
    expect(applyDependencyDateChange({
      dependencies: [dependency("a", "2026-09-14")],
      startDate: "2026-09-11",
      dueDate: "2026-09-18",
      startDateTouched: false,
    })).toMatchObject({
      startDate: "2026-09-15",
      dueDate: "2026-09-22",
      status: "auto-applied",
    });
  });

  it("does not overwrite either date after the start date was manually touched", () => {
    expect(applyDependencyDateChange({
      dependencies: [dependency("a", "2026-09-10")],
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      startDateTouched: true,
    })).toEqual({
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      suggestedStartDate: "2026-09-11",
      status: "suggestion",
    });
  });

  it("removing every prerequisite keeps existing dates and removes the hint", () => {
    expect(applyDependencyDateChange({
      dependencies: [],
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      startDateTouched: true,
    })).toEqual({
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      suggestedStartDate: null,
      status: "none",
    });
  });

  it("reports an undated prerequisite without changing dates", () => {
    expect(applyDependencyDateChange({
      dependencies: [dependency("a", null)],
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      startDateTouched: false,
    })).toEqual({
      startDate: "2026-09-20",
      dueDate: "2026-09-27",
      suggestedStartDate: null,
      status: "missing-due-date",
    });
  });
});

describe("SPEC-V12-5 task drawer integration", () => {
  const drawer = readFileSync(new URL("../src/components/TaskDrawer.tsx", import.meta.url), "utf8");
  const resources = readFileSync(new URL("../worker/routes/resources.ts", import.meta.url), "utf8");

  it("renders the dependency section before the date fields", () => {
    expect(drawer.indexOf('data-task-drawer-section="dependencies"')).toBeGreaterThan(-1);
    expect(drawer.indexOf('data-task-drawer-section="dependencies"'))
      .toBeLessThan(drawer.indexOf('data-task-drawer-section="dates"'));
  });

  it("shows each prerequisite title with its due date or an unset label", () => {
    expect(drawer).toContain("item.title} ({item.due_date ?? t(\"task.dueUnset\")})");
  });

  it("submits dependencies and dates only through the task save payload", () => {
    const toggleBody = drawer.slice(drawer.indexOf("const toggleDependency"), drawer.indexOf("const changeStartDate"));
    expect(toggleBody).not.toContain("api(");
    expect(drawer).toMatch(/patchBody\(\{[\s\S]*dependency_ids: form\.dependency_ids[\s\S]*start_date: form\.start_date/);
  });

  it("updates task fields and the complete dependency set in one D1 batch", () => {
    expect(resources).toContain('if ("dependency_ids" in body)');
    expect(resources).toContain("wouldCreateDependencyCycle(id, dependencyId, edges)");
    expect(resources).toContain("await c.env.DB.batch(statements)");
  });
});
