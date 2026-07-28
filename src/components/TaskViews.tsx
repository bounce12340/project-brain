import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, patchBody, today } from "../api";
import { CHART } from "../chartTheme";
import type { Metadata, Milestone, ProjectDetail, Stage, Task } from "../types";
import { addDays, calendarGrid, daysBetween, ganttPosition } from "../utils/dates";
import { Kanban } from "./Kanban";
import { Empty, ErrorBox } from "./UI";
import { TaskDrawer } from "./TaskDrawer";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { HelpTip } from "./HelpTip";
import { GanttLegend } from "./GanttLegend";
import { GANTT_ROW_HEIGHT, GANTT_TASK_HEIGHT, getTaskGanttStyle } from "../gantt";

type View = "kanban" | "list" | "calendar" | "gantt";
interface Suggestion { task_id: string; start_date: string; due_date: string; reason: string }
type GanttDatedItem =
  | { kind: "task"; task: Task; name: string; start: string; end: string }
  | { kind: "milestone"; item: Milestone; name: string; start: string; end: string }
  | { kind: "event"; item: Milestone; name: string; start: string; end: string };

export function buildGanttModel({ tasks, milestones, projectStart, projectEnd, currentDate }: {
  tasks: Task[];
  milestones: Milestone[];
  projectStart: string | null;
  projectEnd: string | null;
  currentDate: string;
}) {
  const unscheduled = tasks.filter((task) => !task.start_date && !task.due_date);
  const dated: GanttDatedItem[] = [
    ...tasks.filter((task) => task.start_date || task.due_date).map((task) => {
      const date = task.start_date ?? task.due_date as string;
      return { kind: "task" as const, task, name: task.title, start: date, end: task.due_date ?? task.start_date as string };
    }),
    ...milestones.filter((item) => item.due_date).map((item): GanttDatedItem => item.kind === "event"
      ? { kind: "event", item, name: item.title, start: item.due_date as string, end: item.due_date as string }
      : { kind: "milestone", item, name: item.title, start: item.due_date as string, end: item.due_date as string }),
  ];
  const allDates = [projectStart, projectEnd, currentDate, ...dated.flatMap((item) => [item.start, item.end])].filter((value): value is string => !!value).sort();
  const start = allDates[0] ?? currentDate;
  const end = allDates.at(-1) ?? addDays(start, 28);
  return { dated, unscheduled, start, end };
}

export function TaskWorkspace({ data, metadata, reload }: { data: ProjectDetail; metadata: Metadata | null; reload(): void }) {
  const [view, setView] = useState<View>(() => (localStorage.getItem("task-view") as View | null) ?? "kanban"); const [params, setParams] = useSearchParams(); const [suggestions, setSuggestions] = useState<Suggestion[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const { lang } = useLang();
  const t = useT();
  const selected = data.tasks.find((task) => task.id === params.get("task")) ?? null;
  const chooseView = (next: View) => { setView(next); localStorage.setItem("task-view", next); };
  const openTask = (task: Task) => { const next = new URLSearchParams(params); next.set("task", task.id); setParams(next); };
  const closeTask = () => { const next = new URLSearchParams(params); next.delete("task"); setParams(next); };
  const suggest = async () => { setBusy(true); setError(""); try { const result = await api<{ suggestions: Suggestion[] }>("/ai/schedule-suggest", { method: "POST", body: JSON.stringify({ project_id: data.project.id, lang }) }); setSuggestions(result.suggestions); } catch (cause) { setError(cause instanceof Error ? cause.message : t("views.scheduleFailed")); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); setError(""); try { await api("/ai/schedule-suggest", { method: "POST", body: JSON.stringify({ project_id: data.project.id, apply: true, suggestions, lang }) }); setSuggestions([]); reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("views.applyFailed")); } finally { setBusy(false); } };
  const viewTips: Record<View, "viewKanban" | "viewList" | "viewCalendar" | "viewGantt"> = { kanban: "viewKanban", list: "viewList", calendar: "viewCalendar", gantt: "viewGantt" };
  return <div><div className="mb-2 flex flex-wrap gap-4 text-xs text-star-dim"><span>{t("automation.stage")}<HelpTip topic="stages" /></span><span>{t("views.task")}<HelpTip topic="taskCards" /></span></div><div data-tour="task-views" className="mb-4 flex flex-wrap items-center gap-2"><div className="inline-flex flex-wrap bg-nexus-raised p-1">{(["kanban", "list", "calendar", "gantt"] as View[]).map((item) => <span className="inline-flex items-center" key={item}><button className={`px-3 py-1.5 text-sm ${view === item ? "border-b-2 border-psi bg-nexus font-semibold text-psi shadow-sm" : "text-star-dim"}`} onClick={() => chooseView(item)}>{t(viewKeys[item])}</button><HelpTip topic={viewTips[item]} /></span>)}</div>{data.permissions.can_edit && <button className="btn-secondary ml-auto" disabled={busy} onClick={() => void suggest()}>{t(busy ? "views.analyzing" : "views.scheduleSuggest")}</button>}</div>{error && <ErrorBox message={error} />}
    {suggestions.length > 0 && <section className="panel mb-5"><div className="mb-3 flex items-center justify-between"><h3 className="font-bold">{t("views.preview")}</h3><button className="btn" disabled={busy} onClick={() => void apply()}>{t("views.applyAll")}</button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("views.task")}</th><th>{t("views.dates")}</th><th>{t("views.reason")}</th></tr></thead><tbody>{suggestions.map((item) => <tr className="border-b border-nexus-line" key={item.task_id}><td className="py-2">{data.tasks.find((task) => task.id === item.task_id)?.title}</td><td>{item.start_date} ～ {item.due_date}</td><td>{item.reason}</td></tr>)}</tbody></table></div></section>}
    {view === "kanban" && <Kanban projectId={data.project.id} initialStages={data.stages} initialTasks={data.tasks} canEdit={data.permissions.can_edit} onReload={reload} onTaskOpen={openTask} />}
    {view === "list" && <TaskList tasks={data.tasks} stages={data.stages} metadata={metadata} canEdit={data.permissions.can_edit} openTask={openTask} reload={reload} />}
    {view === "calendar" && <TaskCalendar tasks={data.tasks} milestones={data.milestones} openTask={openTask} />}
    {view === "gantt" && <ProjectGantt data={data} openTask={openTask} />}
    {selected && <TaskDrawer task={selected} data={data} metadata={metadata} onClose={closeTask} reload={reload} />}
  </div>;
}

const viewKeys: Record<View, TransKey> = { kanban: "views.kanban", list: "views.list", calendar: "views.calendar", gantt: "views.gantt" };

function TaskList({ tasks, stages, metadata, canEdit, openTask, reload }: { tasks: Task[]; stages: Stage[]; metadata: Metadata | null; canEdit: boolean; openTask(task: Task): void; reload(): void }) {
  const t = useT();
  const [sort, setSort] = useState<keyof Task>("position"); const [stage, setStage] = useState(""); const [assignee, setAssignee] = useState(""); const [done, setDone] = useState("");
  const rows = [...tasks].filter((task) => (!stage || task.stage_id === stage) && (!assignee || task.assignee_id === assignee) && (!done || String(task.done) === done)).sort((a, b) => String(a[sort] ?? "").localeCompare(String(b[sort] ?? ""), "zh-TW", { numeric: true }));
  const toggle = async (task: Task, checked: boolean) => { await api(`/tasks/${task.id}`, patchBody({ done: checked })); reload(); };
  const headers: Array<[keyof Task, TransKey]> = [["title", "common.title"], ["stage_id", "automation.stage"], ["assignee_name", "task.assignee"], ["start_date", "task.start"], ["due_date", "task.end"]];
  return <section className="panel"><div className="mb-4 grid gap-2 sm:grid-cols-3"><select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">{t("views.allStages")}</option>{stages.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">{t("views.allAssignees")}</option>{metadata?.users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select><select value={done} onChange={(e) => setDone(e.target.value)}><option value="">{t("views.allStatuses")}</option><option value="0">{t("views.incomplete")}</option><option value="1">{t("status.done")}</option></select></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright">{headers.map(([key, label]) => <th className="cursor-pointer py-2" key={key} onClick={() => setSort(key)}>{t(label)} {sort === key && "↕"}</th>)}<th>{t("status.done")}</th></tr></thead><tbody>{rows.map((task) => <tr className="cursor-pointer border-b border-nexus-line hover:bg-nexus-raised" key={task.id} onClick={() => openTask(task)}><td className={`py-3 font-medium ${task.done ? "text-star-dim line-through" : ""}`}>{task.title}</td><td>{stages.find((item) => item.id === task.stage_id)?.name}</td><td>{task.assignee_name || t("common.none")}</td><td>{task.start_date || t("common.none")}</td><td>{task.due_date || t("common.none")}</td><td><input type="checkbox" checked={!!task.done} disabled={!canEdit} onClick={(e) => e.stopPropagation()} onChange={(e) => void toggle(task, e.target.checked)} /></td></tr>)}</tbody></table></div>{rows.length === 0 && <Empty>{t("views.noFiltered")}</Empty>}</section>;
}

function TaskCalendar({ tasks, milestones, openTask }: { tasks: Task[]; milestones: Milestone[]; openTask(task: Task): void }) {
  const t = useT();
  const now = new Date(); const [month, setMonth] = useState(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))); const [selected, setSelected] = useState(today()); const days = calendarGrid(month.getUTCFullYear(), month.getUTCMonth());
  const move = (delta: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));
  const unscheduledCount = tasks.filter((task) => !task.start_date && !task.due_date).length;
  const selectedTasks = tasks.filter((task) => task.due_date === selected); const selectedMilestones = milestones.filter((item) => item.kind === "milestone" && item.due_date === selected); const selectedEvents = milestones.filter((item) => item.kind === "event" && item.due_date === selected);
  const weekdays: TransKey[] = ["views.week.mon", "views.week.tue", "views.week.wed", "views.week.thu", "views.week.fri", "views.week.sat", "views.week.sun"];
  return <div className="space-y-3"><div className="grid gap-5 lg:grid-cols-4"><section className="panel overflow-x-auto lg:col-span-3"><header className="mb-4 flex items-center justify-between"><button className="btn-secondary !px-3" onClick={() => move(-1)}>{t("views.previousMonth")}</button><h3 className="font-bold">{t("views.monthTitle", { year: month.getUTCFullYear(), month: month.getUTCMonth() + 1 })}</h3><button className="btn-secondary !px-3" onClick={() => move(1)}>{t("views.nextMonth")}</button></header><div className="grid min-w-[700px] grid-cols-7 text-center text-xs font-semibold text-star-dim">{weekdays.map((key) => <div className="py-2" key={key}>{t(key)}</div>)}</div><div className="grid min-w-[700px] grid-cols-7">{days.map((day) => { const dayTasks = tasks.filter((task) => task.due_date === day); const dayMilestones = milestones.filter((item) => item.kind === "milestone" && item.due_date === day); const dayEvents = milestones.filter((item) => item.kind === "event" && item.due_date === day); return <button className={`min-h-28 border border-nexus-line p-2 text-left align-top ${day.slice(0, 7) !== month.toISOString().slice(0, 7) ? "bg-nexus-raised text-star-dim/60" : ""} ${day === today() ? "ring-2 ring-inset ring-psi" : ""}`} key={day} onClick={() => setSelected(day)}><span className="text-xs">{Number(day.slice(-2))}</span>{dayTasks.slice(0, 2).map((task) => <span className="mt-1 block truncate border border-psi-deep bg-psi-deep/30 px-1.5 py-1 text-xs text-psi" key={task.id}>{task.title}</span>)}{dayMilestones.slice(0, 1).map((item) => <span className="mt-1 block truncate text-xs text-warn" key={item.id}>◆ {item.title}</span>)}{dayEvents.slice(0, 2).map((item) => <span className="mt-1 flex items-center gap-1 truncate text-xs text-star-dim" key={item.id}><span className="inline-block h-2 w-2 shrink-0 rounded-full bg-star-dim" />{item.title}</span>)}</button>; })}</div></section><aside className="panel"><h3 className="mb-3 font-bold">{selected}</h3>{selectedTasks.map((task) => <button className="mb-2 block w-full border border-psi-deep bg-psi-deep/30 p-3 text-left text-sm text-star hover:shadow-[0_0_12px_rgb(var(--color-psi)/.25)]" key={task.id} onClick={() => openTask(task)}>{task.title}</button>)}{selectedMilestones.map((item) => <div className="mb-2 rounded-lg border border-warn bg-void p-3 text-sm text-warn" key={item.id}>◆ {item.title}</div>)}{selectedEvents.map((item) => <div className="mb-2 flex items-center gap-2 border border-nexus-line bg-nexus-raised p-3 text-sm text-star-dim" key={item.id}><span className="inline-block h-2 w-2 shrink-0 rounded-full bg-star-dim" /><span>{t("views.history")} · {item.title}</span></div>)}{selectedTasks.length + selectedMilestones.length + selectedEvents.length === 0 && <p className="empty-inline text-sm text-star-dim">{t("views.noDayItems")}</p>}</aside></div><p className="text-sm text-star-dim">{t("views.unscheduledCount", { count: unscheduledCount })}</p></div>;
}

function ProjectGantt({ data, openTask }: { data: ProjectDetail; openTask(task: Task): void }) {
  const t = useT();
  const currentDate = today();
  const { dated, unscheduled, start, end } = buildGanttModel({ tasks: data.tasks, milestones: data.milestones, projectStart: data.project.start_date, projectEnd: data.project.target_date, currentDate });
  const dayWidth = 24; const chartWidth = Math.max(700, (daysBetween(start, end) + 2) * dayWidth); const rowHeight = GANTT_ROW_HEIGHT; const labelWidth = 190; const header = 70; const height = header + (dated.length + 1) * rowHeight;
  const taskMap = new Map(dated.flatMap((item, index) => item.kind === "task" ? [[item.task.id, { task: item.task, index }] as const] : []));
  return <div className="space-y-4">
    <section className="panel overflow-x-auto">
      <div style={{ width: labelWidth + chartWidth }}>
        <GanttLegend stages={data.stages} tasks={data.tasks} milestoneLabel={t("project.milestones")} eventLabel={t("project.historyEvents")} />
        <svg className="chart-surface" width={labelWidth + chartWidth} height={height} role="img" aria-label={t("views.ganttAria")} data-gantt-task-height={GANTT_TASK_HEIGHT} data-gantt-row-height={GANTT_ROW_HEIGHT}>
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={CHART.starDim} /></marker></defs>
          <rect width="100%" height="100%" fill={CHART.nexus} />
          <text x="8" y="25" fontSize="13" fontWeight="700" fill={CHART.goldBright}>{t("views.projectTask")}</text>
          {Array.from({ length: Math.ceil((daysBetween(start, end) + 1) / 7) + 1 }, (_, index) => addDays(start, index * 7)).map((date) => {
            const x = labelWidth + ganttPosition(date, start, end, chartWidth);
            return <g key={date}><line x1={x} x2={x} y1={header - 18} y2={height} stroke={CHART.line} /><text x={x + 3} y={header - 25} fontSize="10" fill={CHART.starDim}>{date.slice(5)}</text></g>;
          })}
          {data.project.start_date && data.project.target_date && <g><text x="8" y={header + 24} fontSize="12" fontWeight="600" fill={CHART.star}>{t("views.projectRange")}</text><rect x={labelWidth + ganttPosition(data.project.start_date, start, end, chartWidth)} y={header + 10} width={Math.max(5, ganttPosition(data.project.target_date, start, end, chartWidth) - ganttPosition(data.project.start_date, start, end, chartWidth))} height="16" rx="8" fill={CHART.gold}><title>{data.project.name}：{data.project.start_date} ～ {data.project.target_date}</title></rect></g>}
          {dated.map((item, index) => {
            const y = header + (index + 1) * rowHeight + 15;
            const x1 = labelWidth + ganttPosition(item.start, start, end, chartWidth);
            const x2 = labelWidth + ganttPosition(item.end, start, end, chartWidth);
            const taskStyle = item.kind === "task" ? getTaskGanttStyle(item.task, data.stages) : null;
            const diamond = `${x1},${y - 4} ${x1 + 13},${y + 9} ${x1},${y + 22} ${x1 - 13},${y + 9}`;
            return <g key={`${item.kind}-${item.kind === "task" ? item.task.id : item.item.id}`} className={item.kind === "task" ? "cursor-pointer" : ""} onClick={() => item.kind === "task" && openTask(item.task)}>
              <text x="8" y={y + 13} fontSize="12" fill={CHART.star}>{item.name.slice(0, 24)}</text>
              {item.kind === "event"
                ? <polygon points={diamond} fill="none" stroke={CHART.goldDim} strokeWidth="2"><title>{t("views.history")}：{item.name}（{item.start}）</title></polygon>
                : item.kind === "milestone"
                  ? <polygon points={diamond} fill={CHART.gold}><title>{item.name}：{item.start}</title></polygon>
                  : x1 === x2
                    ? <polygon points={diamond} fill={taskStyle?.fill} fillOpacity={taskStyle?.fillOpacity} stroke={taskStyle?.stroke} strokeWidth={taskStyle?.strokeWidth}><title>{item.name}：{item.start}</title></polygon>
                    : <rect data-stage-colored-task x={x1} y={y} width={Math.max(8, x2 - x1)} height={GANTT_TASK_HEIGHT} rx={GANTT_TASK_HEIGHT / 2} fill={taskStyle?.fill} fillOpacity={taskStyle?.fillOpacity} stroke={taskStyle?.stroke} strokeWidth={taskStyle?.strokeWidth}><title>{item.name}：{item.start} ～ {item.end}</title></rect>}
              {item.kind === "task" && item.task.done && <text x={x1 + 3} y={y + 13} fill={taskStyle?.textColor} fontSize="11">✓</text>}
            </g>;
          })}
          {dated.flatMap((item) => item.kind === "task" ? item.task.dependency_ids.map((dependsOn) => {
            const from = taskMap.get(dependsOn); const to = taskMap.get(item.task.id);
            if (!from || !to) return null;
            const fromEnd = from.task.due_date ?? from.task.start_date; const toStart = to.task.start_date ?? to.task.due_date;
            if (!fromEnd || !toStart) return null;
            const x1 = labelWidth + ganttPosition(fromEnd, start, end, chartWidth); const x2 = labelWidth + ganttPosition(toStart, start, end, chartWidth);
            const y1 = header + (from.index + 1) * rowHeight + 24; const y2 = header + (to.index + 1) * rowHeight + 24; const mid = Math.max(x1 + 10, (x1 + x2) / 2);
            return <polyline key={`${item.task.id}-${dependsOn}`} points={`${x1},${y1} ${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={CHART.starDim} strokeWidth="1.5" markerEnd="url(#arrow)" />;
          }) : [])}
          <line x1={labelWidth + ganttPosition(currentDate, start, end, chartWidth)} x2={labelWidth + ganttPosition(currentDate, start, end, chartWidth)} y1={header - 18} y2={height} stroke={CHART.psi} strokeWidth="3" />
        </svg>
      </div>
      {dated.length === 0 && <Empty>{t("views.noGantt")}</Empty>}
    </section>
    {unscheduled.length > 0 && <section className="panel"><h3 className="font-bold">{t("views.unscheduled", { count: unscheduled.length })}<HelpTip topic="unscheduled" /></h3><p className="mt-1 text-sm text-star-dim">{t("views.unscheduledHint")}</p><div className="mt-3 divide-y divide-nexus-line">{unscheduled.map((task) => <button className="block w-full py-2 text-left text-sm text-star-dim hover:text-star" key={task.id} onClick={() => openTask(task)}>{task.title}</button>)}</div></section>}
  </div>;
}
