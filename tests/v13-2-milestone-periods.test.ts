import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { progressLinkDrafts } from "../src/progress-links";
import { buildGanttModel, milestoneOccursOnDate } from "../src/components/TaskViews";
import { ganttLegendVisibility, getTaskGanttStyle, isGanttOverdue } from "../src/gantt";
import { CHART } from "../src/chartTheme";
import type { Milestone, Stage, Task } from "../src/types";
import { milestoneDateRangeError } from "../worker/services/milestone-dates";
import { buildProgressLinksPrompt, sanitizeProgressLinks } from "../worker/services/progress-links";
import { taipeiDate } from "../worker/services/time";

describe("SPEC-V13-2 milestone period schema and validation", () => {
  it("adds end_date in a new 0013 migration", () => {
    const migration = readFileSync(new URL("../migrations/0013_v13_2.sql", import.meta.url), "utf8");
    expect(migration.trim()).toBe("ALTER TABLE milestones ADD COLUMN end_date TEXT;");
  });

  it.each([
    ["same day", "2026-09-01", "2026-09-01"],
    ["later day", "2026-09-01", "2026-09-30"],
  ])("accepts an end date on or after due_date: %s", (_label, dueDate, endDate) => {
    expect(milestoneDateRangeError(dueDate, endDate)).toBeNull();
  });

  it.each([
    ["earlier", "2026-09-01", "2026-08-31"],
    ["missing due date", null, "2026-09-30"],
    ["invalid date", "2026-09-01", "2026-09-31"],
  ])("rejects an invalid period: %s", (_label, dueDate, endDate) => {
    expect(milestoneDateRangeError(dueDate, endDate)).toBe("結束日不得早於起始日");
  });

  it("allows end_date to be cleared", () => {
    expect(milestoneDateRangeError("2026-09-01", null)).toBeNull();
  });
});

describe("SPEC-V13-2 period and task-state Gantt data", () => {
  const period = {
    id: "period",
    title: "審查期",
    due_date: "2026-09-01",
    end_date: "2026-09-30",
    done: 0,
    position: 0,
    kind: "milestone",
  } as Milestone;
  const point = { ...period, id: "point", title: "單點", end_date: null } as Milestone;

  it("keeps period and point rendering branches distinct", () => {
    const result = buildGanttModel({
      tasks: [],
      milestones: [period, point],
      projectStart: null,
      projectEnd: null,
      currentDate: "2026-07-29",
    });
    expect(result.dated).toMatchObject([
      { kind: "milestone", start: "2026-09-01", end: "2026-09-30" },
      { kind: "milestone", start: "2026-09-01", end: "2026-09-01" },
    ]);
  });

  it("marks every calendar day inside a milestone period", () => {
    expect(milestoneOccursOnDate(period, "2026-09-01")).toBe(true);
    expect(milestoneOccursOnDate(period, "2026-09-15")).toBe(true);
    expect(milestoneOccursOnDate(period, "2026-09-30")).toBe(true);
    expect(milestoneOccursOnDate(period, "2026-10-01")).toBe(false);
  });

  it("uses 30% task fill and a hatch flag for completed work", () => {
    const style = getTaskGanttStyle({ stage_id: "missing", done: 1 }, []);
    expect(style).toMatchObject({ fill: CHART.psi, fillOpacity: 0.3, donePattern: true });
  });

  it("uses the Taipei date boundary for overdue decisions", () => {
    const currentDate = taipeiDate(new Date("2026-07-29T16:30:00Z"));
    expect(currentDate).toBe("2026-07-30");
    expect(isGanttOverdue({ done: 0, due_date: "2026-07-29" }, currentDate)).toBe(true);
    expect(isGanttOverdue({ done: 0, due_date: "2026-07-30" }, currentDate)).toBe(false);
    expect(isGanttOverdue({ done: 1, due_date: "2026-07-29" }, currentDate)).toBe(false);
  });

  it("generates legend branches only for content that exists", () => {
    expect(ganttLegendVisibility(
      [{ stage_id: "stage", done: 1, due_date: "2026-09-30" }],
      [period],
      "2026-07-29",
    )).toEqual({
      milestonePoint: false,
      milestonePeriod: true,
      eventPoint: false,
      eventPeriod: false,
      done: true,
      overdue: false,
    });
  });
});

describe("SPEC-V13-2 AI period suggestions", () => {
  const tasks = [{ id: "task", title: "整理資料", stage_name: "進行中" }];

  it("keeps valid milestone and event end dates", () => {
    const result = sanitizeProgressLinks({
      complete: [],
      create: [],
      milestones: [{ title: "審查期", due_date: "2026-09-01", end_date: "2026-09-30" }],
      events: [{ title: "CDE 審查", event_date: "2026-02-06", end_date: "2026-03-23" }],
      dates: [],
    }, tasks, ["進行中"], "CDE 審查 2026/2/6 至 2026/3/23；審查期為 9/1 至 9/30", "2026-07-29");

    expect(result.milestones).toEqual([{ title: "審查期", due_date: "2026-09-01", end_date: "2026-09-30" }]);
    expect(result.events).toEqual([{ title: "CDE 審查", event_date: "2026-02-06", end_date: "2026-03-23" }]);
  });

  it("drops invalid end dates but keeps the single-point suggestion", () => {
    const result = sanitizeProgressLinks({
      complete: [],
      create: [],
      milestones: [{ title: "審查期", due_date: "2026-09-30", end_date: "2026-09-01" }],
      events: [],
      dates: [],
    }, tasks, ["進行中"], "預計 2026/9/30 審查", "2026-07-29");

    expect(result.milestones).toEqual([{ title: "審查期", due_date: "2026-09-30" }]);
  });

  it("asks the model for end_date only for explicit periods", () => {
    const prompt = buildProgressLinksPrompt("zh");
    expect(prompt).toContain('"end_date":"YYYY-MM-DD"');
    expect(prompt).toContain("clear period or duration");
  });

  it("keeps AI period drafts unchecked and editable", () => {
    const stages = [{ id: "stage", project_id: "project", name: "進行中", color: "", position: 0 }] as Stage[];
    const uiTasks = [{ id: "task", stage_id: "stage", title: "審查", done: 0 }] as Task[];
    const drafts = progressLinkDrafts({
      complete: [],
      create: [],
      milestones: [{ title: "審查期", due_date: "2026-09-01", end_date: "2026-09-30" }],
      events: [{ title: "CDE 審查", event_date: "2026-02-06", end_date: "2026-03-23" }],
      dates: [],
      fallback: false,
    }, stages, uiTasks);

    expect(drafts.milestones[0]).toMatchObject({ end_date: "2026-09-30", selected: false });
    expect(drafts.events[0]).toMatchObject({ end_date: "2026-03-23", selected: false });
  });
});
