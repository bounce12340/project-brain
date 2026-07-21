import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, today } from "../api";
import { CHART } from "../chartTheme";
import { PageHeader, RiskBadge } from "../components/UI";
import { addDays, daysBetween, ganttPosition } from "../utils/dates";

interface TimelineTask { id: string; title: string; start_date: string | null; due_date: string | null; created_at: string; done: number; assignee_name: string | null }
interface TimelineProject { id: string; name: string; start_date: string | null; target_date: string | null; progress: number; risk_level: string | null; group_id: string; group_name: string; tasks: TimelineTask[] }
interface TimelineGroup { id: string; name: string; projects: TimelineProject[] }
type TimelineRow = { kind: "group"; group: TimelineGroup; y: number } | { kind: "project"; project: TimelineProject; y: number } | { kind: "task"; project: TimelineProject; task: TimelineTask; y: number };

const STORAGE_KEY = "timeline-expanded-projects";
const HEADER_HEIGHT = 58;
const GROUP_HEIGHT = 42;
const PROJECT_HEIGHT = 50;
const TASK_HEIGHT = 34;

function initialExpanded(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch { return []; }
}

export function TimelinePage() {
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  useEffect(() => { void api<{ groups: TimelineGroup[] }>("/timeline").then((result) => setGroups(result.groups)); }, []);
  const visibleGroups = groupFilter ? groups.filter((group) => group.id === groupFilter) : groups;
  const projects = visibleGroups.flatMap((group) => group.projects);
  const dates = [today(), ...projects.flatMap((project) => [project.start_date, project.target_date, ...project.tasks.flatMap((task) => [task.start_date ?? task.created_at.slice(0, 10), task.due_date])])].filter((value): value is string => !!value).sort();
  const start = dates[0] ?? today();
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
        if (expanded.includes(project.id)) for (const task of project.tasks) { result.push({ kind: "task", project, task, y }); y += TASK_HEIGHT; }
      }
    }
    return result;
  }, [visibleGroups, expanded]);
  const height = Math.max(170, (rows.at(-1)?.y ?? HEADER_HEIGHT) + (rows.at(-1)?.kind === "task" ? TASK_HEIGHT : PROJECT_HEIGHT));
  const weeks = useMemo(() => Array.from({ length: Math.ceil((daysBetween(start, end) + 1) / 7) + 1 }, (_, index) => addDays(start, index * 7)), [start, end]);
  const toggle = (projectId: string) => {
    const next = expanded.includes(projectId) ? expanded.filter((id) => id !== projectId) : [...expanded, projectId];
    setExpanded(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return <>
    <PageHeader title="全域時間軸" description="依組別泳道比較可見專案，展開專案可查看任務起訖與負責人。" />
    <section className="panel mb-4 no-print"><label className="flex max-w-sm items-center gap-3"><span className="label mb-0 whitespace-nowrap">組別篩選</span><select className="w-full" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">全部組別</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></section>
    <section className="panel overflow-x-auto"><svg className="chart-surface" width={label + width} height={height} role="img" aria-label="依組別分區的進行中專案與任務時間軸"><rect width="100%" height="100%" fill={CHART.nexus} />
      {weeks.map((date) => { const x = label + ganttPosition(date, start, end, width); return <g key={date}><line x1={x} x2={x} y1="30" y2={height} stroke={CHART.line} /><text x={x + 3} y="20" fontSize="11" fill={CHART.starDim}>{date.slice(5)}</text></g>; })}
      {rows.map((row) => {
        if (row.kind === "group") return <g key={`group-${row.group.id}`}><rect x="0" y={row.y} width={label + width} height={GROUP_HEIGHT} fill={CHART.raised} opacity="0.92" /><text x="12" y={row.y + 27} fontSize="15" fontWeight="700" fill={CHART.goldBright}>{row.group.name}</text></g>;
        if (row.kind === "project") {
          const projectStart = row.project.start_date ?? start; const projectEnd = row.project.target_date ?? projectStart;
          const x = label + ganttPosition(projectStart, start, end, width); const barWidth = Math.max(8, ganttPosition(projectEnd, start, end, width) - ganttPosition(projectStart, start, end, width)); const y = row.y + 16;
          return <g key={`project-${row.project.id}`}><foreignObject x="4" y={row.y + 4} width={label - 12} height={PROJECT_HEIGHT - 4}><div className="flex items-start gap-2"><button className="no-print mt-0.5 text-sm text-psi" aria-label={`${expanded.includes(row.project.id) ? "收合" : "展開"}${row.project.name}任務`} onClick={() => toggle(row.project.id)}>{expanded.includes(row.project.id) ? "▼" : "▶"}</button><Link to={`/projects/${row.project.id}`} className="block min-w-0 text-sm font-semibold text-star hover:text-psi">{row.project.name}<span className="mt-0.5 block text-xs font-normal text-star-dim">{riskLabel(row.project.risk_level)} · {row.project.tasks.length} 項任務</span></Link></div></foreignObject><Link to={`/projects/${row.project.id}`}><rect x={x} y={y} width={barWidth} height="16" rx="8" fill={CHART.raised}><title>{row.project.name}：{projectStart} ～ {projectEnd}</title></rect><rect x={x} y={y} width={barWidth * row.project.progress / 100} height="16" rx="8" fill={row.project.progress >= 100 ? CHART.gold : CHART.psi} style={{ filter: `drop-shadow(0 0 6px ${CHART.psiGlow})` }} /><text x={x + 6} y={y + 12} fill={CHART.star} fontSize="11">{row.project.progress}%</text></Link></g>;
        }
        const taskStart = row.task.start_date ?? row.task.created_at.slice(0, 10); const taskEnd = row.task.due_date ?? taskStart;
        const x = label + ganttPosition(taskStart, start, end, width); const barWidth = Math.max(8, ganttPosition(taskEnd, start, end, width) - ganttPosition(taskStart, start, end, width)); const y = row.y + 9;
        return <g key={`task-${row.task.id}`} opacity={row.task.done ? 0.55 : 1}><text x="38" y={row.y + 21} fontSize="12" fill={CHART.starDim}>{row.task.done ? "✓ " : ""}{row.task.title.slice(0, 28)}</text><rect x={x} y={y} width={barWidth} height="14" rx="7" fill={row.task.done ? CHART.gold : CHART.psi}><title>{row.task.title}｜{taskStart} ～ {taskEnd}｜負責人：{row.task.assignee_name || "未指派"}</title></rect>{row.task.done && <text x={x + 3} y={y + 11} fill={CHART.void} fontSize="11">✓</text>}</g>;
      })}
      <line x1={label + ganttPosition(today(), start, end, width)} x2={label + ganttPosition(today(), start, end, width)} y1="30" y2={height} stroke={CHART.psi} strokeWidth="3" />
    </svg></section>
    <div className="mt-4 flex gap-3 text-sm"><RiskBadge level="low" /><RiskBadge level="medium" /><RiskBadge level="high" /></div>
  </>;
}

function riskLabel(level: string | null): string { return level === "high" ? "高風險" : level === "medium" ? "中風險" : level === "low" ? "低風險" : "未分析"; }
