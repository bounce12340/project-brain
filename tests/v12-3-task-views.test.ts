import { describe, expect, it } from "vitest";
import type { Task } from "../src/types";
import { buildGanttModel } from "../src/components/TaskViews";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  project_id: "project-1",
  stage_id: "stage-1",
  title: "測試任務",
  description: "",
  assignee_id: null,
  start_date: null,
  due_date: null,
  position: 0,
  done: 0,
  done_at: null,
  created_at: "1999-01-01T00:00:00Z",
  dependency_ids: [],
  comment_count: 0,
  attachment_count: 0,
  ...overrides,
});

const model = (tasks: Task[]) => buildGanttModel({
  tasks,
  milestones: [],
  projectStart: null,
  projectEnd: null,
  currentDate: "2026-07-28",
});

describe("SPEC-V12-3 unscheduled Gantt tasks", () => {
  it("excludes tasks with no dates from the timeline and counts them as unscheduled", () => {
    const result = model([task()]);

    expect(result.dated).toHaveLength(0);
    expect(result.unscheduled.map((item) => item.id)).toEqual(["task-1"]);
  });

  it("renders a task with only a start date as a point on that date", () => {
    const result = model([task({ start_date: "2026-08-03" })]);

    expect(result.dated).toMatchObject([{ kind: "task", start: "2026-08-03", end: "2026-08-03" }]);
    expect(result.unscheduled).toHaveLength(0);
  });

  it("renders a task with only a due date as a point on that date", () => {
    const result = model([task({ due_date: "2026-08-09" })]);

    expect(result.dated).toMatchObject([{ kind: "task", start: "2026-08-09", end: "2026-08-09" }]);
    expect(result.unscheduled).toHaveLength(0);
  });

  it("does not let an unscheduled task created_at change the chart range", () => {
    const scheduled = task({ id: "scheduled", start_date: "2026-08-03", due_date: "2026-08-06" });
    const baseline = model([scheduled]);
    const withUnscheduled = model([scheduled, task({ id: "unscheduled", created_at: "1999-01-01T00:00:00Z" })]);

    expect({ start: withUnscheduled.start, end: withUnscheduled.end }).toEqual({ start: baseline.start, end: baseline.end });
  });
});
