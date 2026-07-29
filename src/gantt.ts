import { CHART } from "./chartTheme";

export const GANTT_TASK_HEIGHT = 18;
export const GANTT_ROW_HEIGHT = 52;
export const GANTT_ACTIVE_OPACITY = 0.85;
export const GANTT_DONE_OPACITY = 0.3;

export interface GanttStage {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface GanttTask {
  stage_id: string;
  done: number;
  due_date?: string | null;
}

export interface GanttLegendMilestone {
  kind: "milestone" | "event";
  end_date: string | null;
  due_date: string | null;
  done: number;
}

function parseHexColor(value: string | null | undefined): [number, number, number] | null {
  const match = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((part) => part + part).join("") : match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function luminance(rgb: [number, number, number]): number {
  const [red, green, blue] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hexColor(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

export function getTaskGanttStyle(task: GanttTask, stages: GanttStage[]) {
  const stage = stages.find((item) => item.id === task.stage_id);
  const rgb = parseHexColor(stage?.color);
  const fill = rgb ? hexColor(rgb) : CHART.psi;
  const needsOutline = !!rgb && luminance(rgb) >= 0.72;
  const stroke = needsOutline ? hexColor(rgb.map((value) => value * 0.62) as [number, number, number]) : "none";
  const textColor = rgb ? (luminance(rgb) >= 0.48 ? "#111827" : "#ffffff") : CHART.void;
  const hatchColor = rgb ? hexColor(rgb.map((value) => value * 0.55) as [number, number, number]) : CHART.psiDeep;
  return {
    fill,
    fillOpacity: task.done ? GANTT_DONE_OPACITY : GANTT_ACTIVE_OPACITY,
    donePattern: !!task.done,
    hatchColor,
    stroke,
    strokeWidth: needsOutline ? 1 : 0,
    textColor,
  };
}

export function isGanttOverdue(item: Pick<GanttTask, "done" | "due_date">, currentDate: string): boolean {
  return !item.done && !!item.due_date && item.due_date < currentDate;
}

export function ganttDonePatternId(key: string): string {
  return `gantt-done-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function ganttLegendVisibility(tasks: GanttTask[], milestones: GanttLegendMilestone[], currentDate: string) {
  return {
    milestonePoint: milestones.some((item) => item.kind === "milestone" && !item.end_date),
    milestonePeriod: milestones.some((item) => item.kind === "milestone" && !!item.end_date),
    eventPoint: milestones.some((item) => item.kind === "event" && !item.end_date),
    eventPeriod: milestones.some((item) => item.kind === "event" && !!item.end_date),
    done: tasks.some((task) => !!task.done),
    overdue: tasks.some((task) => isGanttOverdue(task, currentDate))
      || milestones.some((item) => item.kind === "milestone" && isGanttOverdue(item, currentDate)),
  };
}

export function buildGanttLegend<T extends Pick<GanttTask, "stage_id">>(stages: GanttStage[], tasks: T[]): GanttStage[] {
  const used = new Set(tasks.map((task) => task.stage_id));
  const unique = new Map<string, GanttStage>();
  for (const stage of stages) if (used.has(stage.id) && !unique.has(stage.id)) unique.set(stage.id, stage);
  return [...unique.values()]
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, "zh-TW") || left.id.localeCompare(right.id));
}
