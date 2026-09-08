import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGanttModel } from "../src/components/TaskViews";
import { progressLinkDrafts } from "../src/progress-links";
import type { Milestone, Stage, Task } from "../src/types";
import {
  buildProgressLinksPrompt,
  progressLinksFallback,
  sanitizeProgressLinks,
  type ProgressLinkTask,
} from "../worker/services/progress-links";

const today = "2026-07-28";
const tasks: ProgressLinkTask[] = [
  { id: "task-review", title: "審查文件", stage_name: "進行中" },
];
const existingEvents = [{ title: "已完成既有會議", event_date: "2025-12-08" }];

describe("SPEC-V12-4 history event model and progress exclusions", () => {
  it("migration 0012 adds and backfills the milestone/event kind", () => {
    const migration = readFileSync(new URL("../migrations/0012_v12_4.sql", import.meta.url), "utf8");
    expect(migration).toMatch(/ADD COLUMN kind TEXT/);
    expect(migration).toContain("'milestone','event'");
    expect(migration).toMatch(/UPDATE milestones SET kind='milestone'/);
  });

  it("all progress and reminder milestone queries explicitly exclude events", () => {
    const files = [
      "../worker/services/auto-progress.ts",
      "../worker/services/cron.ts",
      "../worker/services/reports.ts",
      "../worker/routes/general.ts",
      "../worker/routes/reports.ts",
    ];
    for (const path of files) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).toMatch(/kind='milestone'/);
    }
  });
});

describe("SPEC-V12-4 progress-link history event routing", () => {
  it("routes a past completed fact to events and a future checkpoint to milestones", () => {
    const result = sanitizeProgressLinks({
      complete: [],
      create: [],
      milestones: [{ title: "提供文件", due_date: "2026-12-01" }],
      events: [{ title: "已完成會議", event_date: "2025-12-09" }],
      dates: [],
    }, tasks, ["進行中"], "2025/12/09 已完成會議；預計 2026/12/01 提供文件", today, existingEvents);

    expect(result.events).toEqual([{ title: "已完成會議", event_date: "2025-12-09" }]);
    expect(result.milestones).toEqual([{ title: "提供文件", due_date: "2026-12-01" }]);
  });

  it("extracts past completed dated clauses deterministically, de-duplicates, caps at 20, and trims to 60 characters", () => {
    const clauses = [
      "2025/12/08 已完成既有會議",
      `2025/12/09 已完成${"很".repeat(80)}`,
      ...Array.from({ length: 25 }, (_, index) => `2026/01/${String(index + 1).padStart(2, "0")} 已完成事件 ${index}`),
    ].join("；");
    const result = sanitizeProgressLinks({
      complete: [], create: [], milestones: [], events: [], dates: [],
    }, tasks, ["進行中"], clauses, today, existingEvents);

    expect(result.events).toHaveLength(20);
    expect(result.events.some((event) => event.title === "已完成既有會議" && event.event_date === "2025-12-08")).toBe(false);
    expect(Math.max(...result.events.map((event) => Array.from(event.title).length))).toBeLessThanOrEqual(60);
  });

  it("prompt and fallback expose the five-array contract", () => {
    expect(buildProgressLinksPrompt("zh")).toContain('"events"');
    expect(buildProgressLinksPrompt("zh")).toContain("past");
    expect(progressLinksFallback()).toEqual({
      complete: [], create: [], milestones: [], events: [], dates: [], fallback: true,
    });
  });
});

describe("SPEC-V12-4 calendar, Gantt, and confirmation drafts", () => {
  const stages = [{ id: "stage", project_id: "project", name: "進行中", color: "", position: 0 }] as Stage[];
  const uiTasks = [{ id: "task-review", stage_id: "stage", title: "審查文件", done: 0 }] as Task[];
  const historyEvent = {
    id: "event-1",
    title: "CDE 第一次諮詢",
    due_date: "2025-12-09",
    done: 1,
    position: 1,
    kind: "event",
  } as Milestone;

  it("history drafts start unchecked", () => {
    const drafts = progressLinkDrafts({
      complete: [], create: [], milestones: [],
      events: [{ title: "CDE 第一次諮詢", event_date: "2025-12-09" }],
      dates: [], fallback: false,
    }, stages, uiTasks);
    expect(drafts.events).toEqual([expect.objectContaining({
      title: "CDE 第一次諮詢", event_date: "2025-12-09", selected: false,
    })]);
  });

  it("Gantt model keeps events distinct from milestones", () => {
    const result = buildGanttModel({
      tasks: [],
      milestones: [historyEvent],
      projectStart: null,
      projectEnd: null,
      currentDate: today,
    });
    expect(result.dated).toMatchObject([{
      kind: "event", name: "CDE 第一次諮詢", start: "2025-12-09", end: "2025-12-09",
    }]);
  });

  it("built-source branches include event calendar labels and hollow Gantt diamonds", () => {
    const views = readFileSync(new URL("../src/components/TaskViews.tsx", import.meta.url), "utf8");
    const timeline = readFileSync(new URL("../src/pages/TimelinePage.tsx", import.meta.url), "utf8");
    expect(views).toContain('item.kind === "event"');
    expect(views).toContain('fill="none"');
    expect(views).toContain('"views.history"');
    // 全域時間軸的列型別在「里程碑也納入」之後改名為 marker（原本只畫得出歷程事件）。
    // 釘住的意圖不變：歷程事件是空心菱形，而里程碑是實心的，兩者一眼可分。
    expect(timeline).toContain('row.kind === "marker"');
    expect(timeline).toContain('milestone ? colour : "none"');
    expect(timeline).toContain('row.marker.kind === "milestone"');
  });
});
