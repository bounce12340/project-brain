import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, today } from "../api";
import { CHART } from "../chartTheme";
import { PageHeader, RiskBadge } from "../components/UI";
import { addDays, daysBetween, ganttPosition } from "../utils/dates";
import { useT } from "../i18n/LangContext";
import { HelpTip } from "../components/HelpTip";
import { GanttLegend } from "../components/GanttLegend";
import { GANTT_TASK_HEIGHT, ganttDonePatternId, ganttYearMarkers, getTaskGanttStyle, isGanttOverdue } from "../gantt";
import { projectSpan } from "../timeline-span";

interface TimelineTask { id: string; title: string; start_date: string | null; due_date: string | null; created_at: string; done: number; assignee_name: string | null; stage_id: string; stage_name: string; stage_color: string; stage_position: number }
interface TimelineMarker { id: string; title: string; due_date: string; end_date: string | null; kind: "milestone" | "event"; done: number }
interface TimelineProject { id: string; name: string; start_date: string | null; target_date: string | null; progress: number; risk_level: string | null; group_id: string; group_name: string; tasks: TimelineTask[]; markers: TimelineMarker[] }
interface TimelineGroup { id: string; name: string; projects: TimelineProject[] }
type TimelineRow = { kind: "group"; group: TimelineGroup; y: number } | { kind: "project"; project: TimelineProject; y: number } | { kind: "task"; project: TimelineProject; task: TimelineTask; y: number } | { kind: "marker"; project: TimelineProject; marker: TimelineMarker; y: number };

const STORAGE_KEY = "timeline-expanded-projects";
const HEADER_HEIGHT = 58;
const GROUP_HEIGHT = 42;
const PROJECT_HEIGHT = 50;
const TASK_HEIGHT = 40;

function initialExpanded(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch { return []; }
}

export function TimelinePage() {
  const t = useT();
  const currentDate = today();
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  useEffect(() => { void api<{ groups: TimelineGroup[] }>("/timeline").then((result) => setGroups(result.groups)); }, []);
  const visibleGroups = groupFilter ? groups.filter((group) => group.id === groupFilter) : groups;
  const projects = visibleGroups.flatMap((group) => group.projects);
  const dates = [currentDate, ...projects.flatMap((project) => [project.start_date, project.target_date, ...project.tasks.flatMap((task) => [task.start_date ?? task.created_at.slice(0, 10), task.due_date]), ...project.markers.flatMap((marker) => [marker.due_date, marker.end_date])])].filter((value): value is string => !!value).sort();
  const start = dates[0] ?? currentDate;
  const end = dates.at(-1) ?? addDays(start, 90);
  const width = Math.max(820, (daysBetween(start, end) + 2) * 8);
  const label = 260;
  const rows = useMemo(() => {
    const result: TimelineRow[] = [];
    let y = HEADER_HEIGHT;
    for (const group of visibleGroups) {
      result.push({ kind: "group", group, y }); y += GROUP_HEIGHT;
      for (const project of group.projects) {
        result.push({ kind: "project", project, y }); y += PROJECT_HEIGHT;
        if (expanded.includes(project.id)) {
          for (const task of project.tasks) { result.push({ kind: "task", project, task, y }); y += TASK_HEIGHT; }
          for (const marker of project.markers) { result.push({ kind: "marker", project, marker, y }); y += TASK_HEIGHT; }
        }
      }
    }
    return result;
  }, [visibleGroups, expanded]);
  const height = Math.max(170, (rows.at(-1)?.y ?? HEADER_HEIGHT) + (["task", "marker"].includes(rows.at(-1)?.kind ?? "") ? TASK_HEIGHT : PROJECT_HEIGHT));
  const weeks = useMemo(() => Array.from({ length: Math.ceil((daysBetween(start, end) + 1) / 7) + 1 }, (_, index) => addDays(start, index * 7)), [start, end]);
  const years = ganttYearMarkers(weeks, start, end);
  const timeShift = years.length ? 14 : 0;
  const pos = (date: string) => ganttPosition(date, start, end, width);
  const toggle = (projectId: string) => {
    const next = expanded.includes(projectId) ? expanded.filter((id) => id !== projectId) : [...expanded, projectId];
    setExpanded(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };
  const legendTasks = projects.flatMap((project) => project.tasks);
  const legendStages = legendTasks.map((task) => ({ id: task.stage_id, name: task.stage_name, color: task.stage_color, position: task.stage_position }));

  return <>
    <PageHeader title={<span data-tour="timeline-lanes">{t("timeline.title")}<HelpTip topic="timelineLanes" /></span>} description={t("timeline.description")} />
    <section className="panel mb-4 no-print"><label className="flex max-w-sm items-center gap-3"><span className="label mb-0 whitespace-nowrap">{t("timeline.groupFilter")}</span><select className="w-full" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">{t("timeline.allGroups")}</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></section>
    <section className="panel overflow-x-auto !px-0"><div style={{ width: label + width }}>
      <div className="pl-5"><GanttLegend stages={legendStages} tasks={legendTasks} milestones={projects.flatMap((project) => project.markers).map((marker) => ({ kind: marker.kind, due_date: marker.due_date, end_date: marker.end_date, done: marker.done }))} milestoneLabel={t("project.milestones")} milestonePeriodLabel={t("gantt.legend.milestonePeriod")} eventLabel={t("project.historyEvents")} eventPeriodLabel={t("gantt.legend.eventPeriod")} doneLabel={t("gantt.legend.done")} overdueLabel={t("gantt.legend.overdue")} currentDate={currentDate} /></div>
      <div className="flex">
        <svg className="chart-surface gantt-sticky-labels" width={label} height={height} data-gantt-label-font-size="14" data-gantt-label-width={label}>
          <rect width="100%" height="100%" fill={CHART.nexus} />
          {rows.map((row) => {
            if (row.kind === "group") return <g key={`group-label-${row.group.id}`}><rect x="0" y={row.y} width={label} height={GROUP_HEIGHT} fill={CHART.raised} opacity="0.92" /><text x="12" y={row.y + 27} fontSize="15" fontWeight="700" fill={CHART.goldBright}>{row.group.name}</text></g>;
            if (row.kind === "project") return <foreignObject key={`project-label-${row.project.id}`} x="4" y={row.y + 4} width={label - 12} height={PROJECT_HEIGHT - 4}><div className="flex items-start gap-2"><button className="no-print mt-0.5 text-sm text-psi" aria-label={t("timeline.expandTasks", { action: t(expanded.includes(row.project.id) ? "common.collapse" : "common.expand"), project: row.project.name })} onClick={() => toggle(row.project.id)}>{expanded.includes(row.project.id) ? "▼" : "▶"}</button><Link to={`/projects/${row.project.id}`} className="block min-w-0 text-sm font-semibold text-star hover:text-psi">{row.project.name}<span className="mt-0.5 block text-xs font-normal text-star-dim">{t("timeline.taskCount", { risk: riskLabel(row.project.risk_level, t), count: row.project.tasks.length })}</span></Link></div></foreignObject>;
            if (row.kind === "marker") return <text key={`marker-label-${row.marker.id}`} x="38" y={row.y + 25} fontSize="14" fontWeight="500" fill={CHART.starDim}>{t(row.marker.kind === "milestone" ? "timeline.kindMilestone" : "timeline.kindEvent")} · {row.marker.title.slice(0, 24)}</text>;
            return <text key={`task-label-${row.task.id}`} x="38" y={row.y + 25} fontSize="14" fontWeight="500" fill={CHART.starDim}>{row.task.done ? "✓ " : ""}{row.task.title.slice(0, 28)}</text>;
          })}
          <line x1={label - 0.5} x2={label - 0.5} y1="0" y2={height} stroke={CHART.line} />
        </svg>
        <svg className="chart-surface shrink-0" width={width} height={height} role="img" aria-label={t("timeline.aria")} data-gantt-task-height={GANTT_TASK_HEIGHT} data-gantt-time-font-size="14" data-gantt-time-font-weight="600"><rect width="100%" height="100%" fill={CHART.nexus} />
          {years.map((marker) => <text className="gantt-year-label" data-gantt-year-label key={marker.year} x={pos(marker.date) + 3} y="16" fontSize="13" fontWeight="700">{marker.year}</text>)}
          {weeks.map((date, index) => { const x = pos(date); const monthTick = index === 0 || weeks[index - 1].slice(0, 7) !== date.slice(0, 7); return <g key={date}><line x1={x} x2={x} y1={30 + timeShift} y2={height} stroke={CHART.line} /><text className={monthTick ? "gantt-month-label" : "gantt-week-label"} data-gantt-time-label x={x + 3} y={20 + timeShift} fontSize="14" fontWeight="600">{date.slice(5)}</text></g>; })}
          {rows.map((row) => {
            if (row.kind === "group") return <rect key={`group-${row.group.id}`} x="0" y={row.y} width={width} height={GROUP_HEIGHT} fill={CHART.raised} opacity="0.92" />;
            if (row.kind === "project") {
              // 沒填專案起訖時，區間由裡面的任務與里程碑推出來。原本是退回 `start`——
              // 整條軸線的最左端——所以每個沒填日期的專案都變成釘在最左邊的一個小點。
              const span = projectSpan(row.project);
              if (!span) return null;
              const derived = !row.project.start_date || !row.project.target_date;
              const x = pos(span.start); const barWidth = Math.max(8, pos(span.end) - pos(span.start)); const y = row.y + 16;
              return <Link key={`project-${row.project.id}`} to={`/projects/${row.project.id}`}><rect x={x} y={y} width={barWidth} height="16" rx="8" fill={CHART.raised}><title>{row.project.name}：{span.start} ～ {span.end}{derived ? `（${t("timeline.spanFromContent")}）` : ""}</title></rect><rect x={x} y={y} width={barWidth * row.project.progress / 100} height="16" rx="8" fill={row.project.progress >= 100 ? CHART.gold : CHART.psi} style={{ filter: `drop-shadow(0 0 6px ${CHART.psiGlow})` }} /><text x={x + 6} y={y + 12} fill={CHART.star} fontSize="11">{row.project.progress}%</text></Link>;
            }
            if (row.kind === "marker") {
              // 里程碑畫實線、歷程事件畫虛線——與專案內頁甘特的視覺語言一致。
              const milestone = row.marker.kind === "milestone";
              const colour = milestone ? CHART.gold : CHART.goldDim;
              const x = pos(row.marker.due_date); const y = row.y + 10; const x2 = pos(row.marker.end_date ?? row.marker.due_date); const period = !!row.marker.end_date; const barWidth = Math.max(8, x2 - x); const periodEnd = x + barWidth;
              const endpoint = (point: number) => `${point},${y + 4} ${point + 6},${y + 10} ${point},${y + 16} ${point - 6},${y + 10}`;
              const label = t(milestone ? "timeline.kindMilestone" : "timeline.kindEvent");
              return <g key={`marker-${row.marker.id}`}>{period
                ? <><rect data-gantt-event-period x={x} y={y + 1} width={barWidth} height={GANTT_TASK_HEIGHT} fill={colour} fillOpacity="0.5" stroke={colour} strokeWidth="2" strokeDasharray={milestone ? undefined : "6 4"}><title>{label}：{row.marker.title}（{row.marker.due_date} ～ {row.marker.end_date}）</title></rect><polygon points={endpoint(x)} fill={colour} fillOpacity="0.5" stroke={colour} /><polygon points={endpoint(periodEnd)} fill={colour} fillOpacity="0.5" stroke={colour} /></>
                : <polygon points={`${x},${y} ${x + 10},${y + 10} ${x},${y + 20} ${x - 10},${y + 10}`} fill={milestone ? colour : "none"} fillOpacity={milestone ? 0.5 : 1} stroke={colour} strokeWidth="2"><title>{label}：{row.marker.title}（{row.marker.due_date}）</title></polygon>}</g>;
            }
            const taskStart = row.task.start_date ?? row.task.created_at.slice(0, 10); const taskEnd = row.task.due_date ?? taskStart;
            const x = pos(taskStart); const barWidth = Math.max(8, pos(taskEnd) - pos(taskStart)); const y = row.y + 11;
            const taskStyle = getTaskGanttStyle(row.task, legendStages);
            const patternId = ganttDonePatternId(`timeline-${row.task.id}`);
            return <g key={`task-${row.task.id}`}>{row.task.done && <defs><pattern id={patternId} data-gantt-done-pattern patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke={taskStyle.hatchColor} strokeWidth="2" /></pattern></defs>}<rect data-stage-colored-task x={x} y={y} width={barWidth} height={GANTT_TASK_HEIGHT} rx={GANTT_TASK_HEIGHT / 2} fill={taskStyle.fill} fillOpacity={taskStyle.fillOpacity} stroke={taskStyle.stroke} strokeWidth={taskStyle.strokeWidth}><title>{row.task.title}｜{taskStart} ～ {taskEnd}｜{t("timeline.assignee", { name: row.task.assignee_name || t("common.notAssigned") })}</title></rect>{row.task.done && <><rect x={x} y={y} width={barWidth} height={GANTT_TASK_HEIGHT} rx={GANTT_TASK_HEIGHT / 2} fill={`url(#${patternId})`} /><text x={x + 3} y={y + 13} fill={taskStyle.textColor} fontSize="11">✓</text></>}{isGanttOverdue(row.task, currentDate) && <line data-gantt-overdue-end x1={x + barWidth} x2={x + barWidth} y1={y - 1} y2={y + GANTT_TASK_HEIGHT + 1} stroke={CHART.danger} strokeWidth="3" />}</g>;
          })}
          <line x1={pos(currentDate)} x2={pos(currentDate)} y1={30 + timeShift} y2={height} stroke={CHART.psi} strokeWidth="3" />
        </svg>
      </div>
    </div></section>
    <div className="mt-4 flex gap-3 text-sm"><RiskBadge level="low" /><RiskBadge level="medium" /><RiskBadge level="high" /></div>
  </>;
}

function riskLabel(level: string | null, t: ReturnType<typeof useT>): string { return level === "high" ? t("risk.high") : level === "medium" ? t("risk.medium") : level === "low" ? t("risk.low") : t("risk.unanalyzed"); }
