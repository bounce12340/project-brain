import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/i18n/translations";
import { progressLinkDrafts } from "../src/progress-links";
import type { Stage, Task } from "../src/types";
import {
  buildProgressLinksPrompt,
  sanitizeProgressLinks,
  type ProgressLinkTask,
} from "../worker/services/progress-links";

const today = "2026-07-28";
const tasks: ProgressLinkTask[] = [
  { id: "task-review", title: "審查 CTD 文件", stage_name: "進行中" },
  { id: "task-meeting", title: "安排會議", stage_name: "待處理" },
];

function clean(value: unknown, content = "預計於 2026/12/01 提供 X 文件；2025/12/09 已完成會議") {
  return sanitizeProgressLinks(value, tasks, ["進行中", "待處理"], content, today);
}

describe("SPEC-V12-2 progress-links milestones and dates", () => {
  it("keeps future milestone dates and discards historical milestone objects", () => {
    const result = clean({
      complete: [],
      create: [],
      milestones: [
        { title: "收到 X 文件", due_date: "2026-12-01" },
        { title: "完成歷史會議", due_date: "2025-12-09" },
      ],
      dates: [],
    });
    expect(result.milestones).toEqual([{ title: "收到 X 文件", due_date: "2026-12-01" }]);
  });

  it("caps milestones at five, trims titles, removes duplicates and invalid dates", () => {
    const result = clean({
      complete: [],
      create: [],
      milestones: [
        { title: `😀${"里".repeat(100)}`, due_date: "2026-12-01" },
        { title: "重複", due_date: "2026-12-02" },
        { title: "重複", due_date: "2026-12-02" },
        { title: "不存在日期", due_date: "2026-02-30" },
        ...Array.from({ length: 8 }, (_, index) => ({ title: `節點 ${index}`, due_date: `2026-12-${String(index + 10).padStart(2, "0")}` })),
      ],
      dates: [],
    });
    expect(result.milestones).toHaveLength(5);
    expect(Array.from(result.milestones[0].title)).toHaveLength(80);
    expect(result.milestones.filter((item) => item.title === "重複")).toHaveLength(1);
    expect(result.milestones.some((item) => item.title === "不存在日期")).toBe(false);
  });

  it("keeps only future dates for supplied unfinished task ids", () => {
    const result = clean({
      complete: [],
      create: [],
      milestones: [],
      dates: [
        { task_id: "task-review", due_date: "2026-12-31", reason: "收到文件後審查一個月" },
        { task_id: "task-review", due_date: "2027-01-15", reason: "重複任務" },
        { task_id: "task-meeting", due_date: "2025-12-09", reason: "歷史日期" },
        { task_id: "other-project", due_date: "2026-12-31", reason: "非傳入任務" },
        { task_id: "task-meeting", due_date: "2026-12-20", reason: "" },
      ],
    });
    expect(result.dates).toEqual([{ task_id: "task-review", due_date: "2026-12-31", reason: "收到文件後審查一個月" }]);
  });

  it("keeps existing complete/create behavior while returning all four arrays", () => {
    const result = clean({
      complete: [{ task_id: "task-meeting", reason: "已完成安排會議" }],
      create: [{ title: "準備補件", stage_name: "待處理", due_date: "2026-12-15" }],
      milestones: [],
      dates: [],
    }, "已完成安排會議；預計準備補件");
    expect(result.complete).toEqual([{ task_id: "task-meeting", reason: "已完成安排會議" }]);
    expect(result.create).toEqual([{ title: "準備補件", stage_name: "待處理", due_date: "2026-12-15" }]);
    expect(result).toEqual(expect.objectContaining({ milestones: [], dates: [] }));
  });

  it("prompt requires four arrays and forbids past-date objects", () => {
    const prompt = buildProgressLinksPrompt("zh");
    expect(prompt).toContain('"milestones"');
    expect(prompt).toContain('"dates"');
    expect(prompt).toContain("Historical or past dates");
    expect(prompt).toContain("MUST NOT create");
  });
});

describe("SPEC-V12-2 progress-links UI contract", () => {
  const stages = [
    { id: "stage-doing", project_id: "project-demo", name: "進行中", color: "", position: 0 },
    { id: "stage-todo", project_id: "project-demo", name: "待處理", color: "", position: 1 },
  ] as Stage[];
  const uiTasks = [
    { id: "task-review", stage_id: "stage-doing", title: "審查 CTD 文件", done: 0 },
    { id: "task-done", stage_id: "stage-todo", title: "已完成任務", done: 1 },
  ] as Task[];

  it("milestone and date suggestions start unchecked and drop completed task ids", () => {
    const drafts = progressLinkDrafts({
      complete: [],
      create: [],
      milestones: [{ title: "收到 X 文件", due_date: "2026-12-01" }],
      dates: [
        { task_id: "task-review", due_date: "2026-12-31", reason: "審查一個月" },
        { task_id: "task-done", due_date: "2026-12-15", reason: "不應保留" },
      ],
      fallback: false,
    }, stages, uiTasks);
    expect(drafts.milestones).toEqual([expect.objectContaining({ title: "收到 X 文件", selected: false })]);
    expect(drafts.dates).toEqual([expect.objectContaining({ task_id: "task-review", selected: false })]);
  });

  it("dialog applies milestones and task dates through existing endpoints", () => {
    const dialog = readFileSync(new URL("../src/components/ProgressLinkDialog.tsx", import.meta.url), "utf8");
    expect(dialog).toContain("`/projects/${projectId}/milestones`");
    expect(dialog).toContain("patchBody({ due_date: item.due_date })");
    expect(dialog).toContain("setMilestones");
    expect(dialog).toContain("setDates");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
