import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART } from "../src/chartTheme";
import {
  GANTT_ROW_HEIGHT,
  GANTT_TASK_HEIGHT,
  buildGanttLegend,
  getTaskGanttStyle,
} from "../src/gantt";
import type { Stage, Task } from "../src/types";

const stages: Stage[] = [
  { id: "stage-review", project_id: "project-1", name: "審查", color: "#fef3c7", position: 2 },
  { id: "stage-submit", project_id: "project-1", name: "送件", color: "#4f46e5", position: 1 },
  { id: "stage-empty", project_id: "project-1", name: "無任務", color: "#15803d", position: 0 },
];

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  project_id: "project-1",
  stage_id: "stage-review",
  title: "測試任務",
  description: "",
  assignee_id: null,
  start_date: "2026-08-01",
  due_date: "2026-08-05",
  position: 0,
  done: 0,
  done_at: null,
  created_at: "2026-07-28T00:00:00Z",
  dependency_ids: [],
  comment_count: 0,
  attachment_count: 0,
  ...overrides,
});

describe("SPEC-V13-1 stage-colored Gantt", () => {
  it("maps each task to its stage color and protects very light colors with a darker outline", () => {
    const style = getTaskGanttStyle(task(), stages);

    expect(style.fill).toBe("#fef3c7");
    expect(style.stroke).toMatch(/^#[0-9a-f]{6}$/);
    expect(style.stroke).not.toBe(style.fill);
    expect(style.strokeWidth).toBe(1);
  });

  it("falls back to psi when the task has no matching stage or the stage has no color", () => {
    const noColor = [{ ...stages[0], color: "" }];

    expect(getTaskGanttStyle(task(), noColor).fill).toBe(CHART.psi);
    expect(getTaskGanttStyle(task({ stage_id: "missing" }), stages).fill).toBe(CHART.psi);
  });

  it("uses 0.85 opacity for active tasks and 0.45 for completed tasks", () => {
    expect(getTaskGanttStyle(task(), stages).fillOpacity).toBe(0.85);
    expect(getTaskGanttStyle(task({ done: 1 }), stages).fillOpacity).toBe(0.3);
  });

  it("includes only stages that have tasks and sorts the legend by stage position", () => {
    const legend = buildGanttLegend(stages, [
      task(),
      task({ id: "task-2", stage_id: "stage-submit" }),
      task({ id: "task-3", stage_id: "stage-review" }),
    ]);

    expect(legend.map((item) => item.id)).toEqual(["stage-submit", "stage-review"]);
    expect(legend.map((item) => item.name)).toEqual(["送件", "審查"]);
  });

  it("exports the specified 18px task bars and 52px project rows", () => {
    expect(GANTT_TASK_HEIGHT).toBe(18);
    expect(GANTT_ROW_HEIGHT).toBe(52);
  });

  it("returns stage metadata for the expanded tasks on the global timeline", () => {
    const route = readFileSync(new URL("../worker/routes/v2.ts", import.meta.url), "utf8");
    const timeline = readFileSync(new URL("../src/pages/TimelinePage.tsx", import.meta.url), "utf8");

    expect(route).toContain("s.color AS stage_color");
    expect(route).toContain("s.position AS stage_position");
    expect(timeline).toContain("getTaskGanttStyle(row.task, legendStages)");
    expect(timeline).toContain("<GanttLegend");
  });
});
