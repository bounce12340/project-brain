import { describe, expect, it } from "vitest";
import { buildGanttLegend, ganttLegendKey, type GanttStage } from "../src/gantt";

/**
 * 全域時間軸把每個任務攤平成一筆 legend stage，而每個專案都有自己的 stages 表。
 * 這裡重現正式站的情形：6 個專案共用同一組階段名稱與顏色，但 stage id 各不相同。
 */
const PALETTE: Array<[string, string, number]> = [
  ["待辦", "#4f46e5", 0],
  ["進行中", "#4f46e5", 1],
  ["完成", "#4f46e5", 2],
];

function timelineStages(projectCount: number): GanttStage[] {
  return Array.from({ length: projectCount }, (_, p) =>
    PALETTE.map(([name, color, position]) => ({ id: `prj${p}_${name}`, name, color, position }))).flat();
}

const tasksFor = (stages: GanttStage[]) => stages.map((stage) => ({ stage_id: stage.id }));

describe("global timeline legend", () => {
  it("introduces each colour once instead of once per project", () => {
    const stages = timelineStages(6);
    expect(stages).toHaveLength(18);

    const legend = buildGanttLegend(stages, tasksFor(stages));

    expect(legend.map((item) => item.name)).toEqual(["待辦", "進行中", "完成"]);
  });

  it("does not grow as more projects appear", () => {
    const counts = [1, 6, 24].map((n) => {
      const stages = timelineStages(n);
      return buildGanttLegend(stages, tasksFor(stages)).length;
    });

    expect(counts).toEqual([3, 3, 3]);
  });

  it("keeps stages apart when the same name carries a different colour", () => {
    const stages: GanttStage[] = [
      { id: "a_done", name: "完成", color: "#4f46e5", position: 2 },
      { id: "b_done", name: "完成", color: "#15803d", position: 2 },
      { id: "c_done", name: "完成", color: "#4f46e5", position: 2 },
    ];

    const legend = buildGanttLegend(stages, tasksFor(stages));

    expect(legend).toHaveLength(2);
    expect(legend.map((item) => item.color).sort()).toEqual(["#15803d", "#4f46e5"]);
  });

  it("treats colour casing and padding as the same colour", () => {
    const stages: GanttStage[] = [
      { id: "a", name: "審查中", color: "#B45309", position: 1 },
      { id: "b", name: "審查中", color: " #b45309 ", position: 1 },
    ];

    expect(buildGanttLegend(stages, tasksFor(stages))).toHaveLength(1);
  });

  it("still drops stages that no task uses", () => {
    const stages = timelineStages(2);
    const usedByOneStageOnly = [{ stage_id: stages[0].id }];

    expect(buildGanttLegend(stages, usedByOneStageOnly).map((item) => item.name)).toEqual(["待辦"]);
  });

  it("leaves a single project's legend unchanged, since its names are already unique", () => {
    const stages: GanttStage[] = [
      { id: "s2", name: "審查", color: "#fef3c7", position: 2 },
      { id: "s1", name: "送件", color: "#4f46e5", position: 1 },
    ];

    const legend = buildGanttLegend(stages, tasksFor(stages));

    expect(legend.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  it("builds its key from name and colour, not the project-scoped id", () => {
    const left = { id: "prj1_done", name: "完成", color: "#4f46e5", position: 2 };
    const right = { id: "prj2_done", name: "完成", color: "#4f46e5", position: 2 };

    expect(ganttLegendKey(left)).toBe(ganttLegendKey(right));
    expect(ganttLegendKey({ ...right, color: "#000000" })).not.toBe(ganttLegendKey(left));
  });
});
