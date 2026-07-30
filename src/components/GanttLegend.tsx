import { CHART } from "../chartTheme";
import { GANTT_ACTIVE_OPACITY, GANTT_DONE_OPACITY, buildGanttLegend, ganttLegendVisibility, getTaskGanttStyle, type GanttLegendMilestone, type GanttStage } from "../gantt";

interface LegendTask {
  stage_id: string;
  done: number;
  due_date?: string | null;
}

export function GanttLegend({ stages, tasks, milestones, milestoneLabel, milestonePeriodLabel, eventLabel, eventPeriodLabel, doneLabel, overdueLabel, currentDate }: {
  stages: GanttStage[];
  tasks: LegendTask[];
  milestones: GanttLegendMilestone[];
  milestoneLabel: string;
  milestonePeriodLabel: string;
  eventLabel: string;
  eventPeriodLabel: string;
  doneLabel: string;
  overdueLabel: string;
  currentDate: string;
}) {
  const entries = buildGanttLegend(stages, tasks);
  const visible = ganttLegendVisibility(tasks, milestones, currentDate);
  return <div className="gantt-legend flex w-[calc(100vw-4rem)] max-w-[900px] flex-wrap items-center gap-x-5 gap-y-2 px-2 pb-4 text-xs text-star-dim" data-gantt-legend>
    {entries.map((stage) => {
      const style = getTaskGanttStyle({ stage_id: stage.id, done: 0 }, [stage]);
      return <span className="inline-flex items-center gap-2 whitespace-nowrap" key={stage.id}>
        <span className="h-3.5 w-6 rounded-sm" style={{ backgroundColor: style.fill, opacity: GANTT_ACTIVE_OPACITY, border: style.strokeWidth ? `1px solid ${style.stroke}` : undefined }} />
        {stage.name}
      </span>;
    })}
    {visible.milestone && <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${milestoneLabel}／${milestonePeriodLabel}`} data-gantt-legend-milestone>
      <span className="relative inline-flex h-3.5 w-8 shrink-0 items-center">
        <span className="absolute inset-x-1.5 h-2" style={{ backgroundColor: CHART.gold, border: `1px solid ${CHART.goldDim}` }} />
        <span className="absolute left-0 h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CHART.gold }} />
        <span className="absolute right-0 h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CHART.gold }} />
      </span>
      {milestoneLabel}
    </span>}
    {visible.event && <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${eventLabel}／${eventPeriodLabel}`} data-gantt-legend-event>
      <span className="relative inline-flex h-3.5 w-8 shrink-0 items-center">
        <span className="absolute inset-x-1.5 h-2 border border-dashed" style={{ backgroundColor: CHART.goldDim, opacity: 0.5, borderColor: CHART.goldDim }} />
        <span className="absolute left-0 h-2.5 w-2.5 rotate-45 border-2" style={{ borderColor: CHART.goldDim }} />
        <span className="absolute right-0 h-2.5 w-2.5 rotate-45 border-2" style={{ borderColor: CHART.goldDim }} />
      </span>
      {eventLabel}
    </span>}
    {visible.done && <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-3.5 w-7 border" style={{ opacity: GANTT_DONE_OPACITY, background: `repeating-linear-gradient(45deg, ${CHART.starDim} 0 2px, transparent 2px 6px)` }} />{doneLabel}</span>}
    {visible.overdue && <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="relative h-3.5 w-7 border border-nexus-line"><span className="absolute inset-y-0 right-0 w-[3px]" style={{ backgroundColor: CHART.danger }} /></span>{overdueLabel}</span>}
  </div>;
}
