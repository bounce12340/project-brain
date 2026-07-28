import { CHART } from "../chartTheme";
import { GANTT_ACTIVE_OPACITY, buildGanttLegend, getTaskGanttStyle, type GanttStage } from "../gantt";

interface LegendTask {
  stage_id: string;
  done: number;
}

export function GanttLegend({ stages, tasks, milestoneLabel, eventLabel }: {
  stages: GanttStage[];
  tasks: LegendTask[];
  milestoneLabel: string;
  eventLabel: string;
}) {
  const entries = buildGanttLegend(stages, tasks);
  return <div className="gantt-legend flex w-[calc(100vw-4rem)] max-w-[900px] flex-wrap items-center gap-x-5 gap-y-2 px-2 pb-4 text-xs text-star-dim" data-gantt-legend>
    {entries.map((stage) => {
      const style = getTaskGanttStyle({ stage_id: stage.id, done: 0 }, [stage]);
      return <span className="inline-flex items-center gap-2 whitespace-nowrap" key={stage.id}>
        <span className="h-3.5 w-6 rounded-sm" style={{ backgroundColor: style.fill, opacity: GANTT_ACTIVE_OPACITY, border: style.strokeWidth ? `1px solid ${style.stroke}` : undefined }} />
        {stage.name}
      </span>;
    })}
    <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-3 w-3 rotate-45" style={{ backgroundColor: CHART.gold }} />{milestoneLabel}</span>
    <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-3 w-3 rotate-45 border-2" style={{ borderColor: CHART.goldDim }} />{eventLabel}</span>
  </div>;
}
