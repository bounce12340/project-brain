import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { today } from "../api";
import { CHART } from "../chartTheme";
import { useT } from "../i18n/LangContext";
import { DUE_SOON_DAYS, WEEKS, projectDashboard } from "../project-dashboard";
import type { ProjectDetail } from "../types";
import { Empty, HealthBadge, RiskBadge } from "./UI";

const tooltipStyle = { backgroundColor: CHART.nexus, border: `1px solid ${CHART.line}`, color: CHART.star, fontSize: 12 };
const axis = { fill: CHART.starDim, fontSize: 12 };

function Tile({ label, value, sub, tone = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return <div className="panel !p-4"><p className="text-xs text-star-dim">{label}</p><p className={`mt-1 font-serif text-3xl font-bold ${tone}`}>{value}</p>{sub && <p className="mt-1 text-xs text-star-dim">{sub}</p>}</div>;
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="panel"><h3 className="font-bold">{title}</h3>{note && <p className="mt-1 text-xs text-star-dim">{note}</p>}<div className="mt-3">{children}</div></section>;
}

/**
 * 專案儀表板：一眼看出這個專案的工作量、卡在哪一欄、誰手上最多、最近完成的節奏與接下來要到期的事。
 * recharts 很大，這個元件以 lazy 載入，只有打開「儀表板」分頁才下載。
 */
export default function ProjectDashboard({ data, onOpenTask }: { data: ProjectDetail; onOpenTask(taskId: string): void }) {
  const t = useT();
  const now = today();
  const stats = useMemo(() => projectDashboard(data.tasks, data.stages, data.milestones, now, t("common.notAssigned")), [data.tasks, data.stages, data.milestones, now, t]);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Tile label={t("pdash.open")} value={stats.open} sub={stats.unassigned ? t("pdash.unassigned", { count: stats.unassigned }) : undefined} />
      <Tile label={t("pdash.done")} value={stats.done} sub={t("pdash.donePct", { pct, total: stats.total })} />
      <Tile label={t("pdash.overdue")} value={stats.overdue} tone={stats.overdue ? "text-danger" : ""} />
      <Tile label={t("pdash.dueSoon", { days: DUE_SOON_DAYS })} value={stats.dueSoon} />
      <Tile label={t("pdash.subtasks")} value={stats.subtaskTotal ? `${stats.subtaskDone}/${stats.subtaskTotal}` : "—"} />
    </div>

    <section className="panel flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
      <span className="flex items-center gap-2"><span className="text-star-dim">{t("health.pick")}</span>{data.project.health ? <HealthBadge health={data.project.health} at={data.project.health_at} /> : <span className="text-xs text-star-dim">{t("pdash.noHealth")}</span>}</span>
      <span className="flex items-center gap-2"><span className="text-star-dim">{t("project.aiRisk")}</span><RiskBadge level={data.project.risk_level} /></span>
      <span className="flex items-center gap-2"><span className="text-star-dim">{t("pdash.nextMilestone")}</span>{stats.nextMilestone ? <span className="font-semibold">◆ {stats.nextMilestone.title}<span className="ml-2 font-normal text-star-dim">{stats.nextMilestone.due_date}</span></span> : <span className="text-xs text-star-dim">{t("common.none")}</span>}</span>
      <span className="flex items-center gap-2"><span className="text-star-dim">{t("pdash.target")}</span><span className={data.project.target_date && data.project.target_date < now && data.project.status === "active" ? "font-semibold text-danger" : "font-semibold"}>{data.project.target_date ?? "—"}</span></span>
    </section>

    {stats.total === 0 ? <Empty>{t("pdash.empty")}</Empty> : <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title={t("pdash.byStage")}>
        <ResponsiveContainer width="100%" height={Math.max(180, stats.byStage.length * 44)}>
          <BarChart data={stats.byStage} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={axis} />
            <YAxis type="category" dataKey="stage" width={110} tick={axis} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: CHART.psiGlow }} />
            <Legend wrapperStyle={{ fontSize: 12, color: CHART.starDim }} />
            <Bar dataKey="open" name={t("pdash.openShort")} stackId="s" fill={CHART.psi} stroke={CHART.nexus} strokeWidth={2} maxBarSize={28} />
            <Bar dataKey="done" name={t("pdash.doneShort")} stackId="s" fill={CHART.ok} stroke={CHART.nexus} strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t("pdash.byAssignee")} note={stats.byAssignee.some((item) => item.overdue) ? t("pdash.byAssigneeNote") : undefined}>
        {stats.byAssignee.length ? <ResponsiveContainer width="100%" height={Math.max(180, stats.byAssignee.length * 40)}>
          <BarChart data={stats.byAssignee} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={axis} />
            <YAxis type="category" dataKey="name" width={110} tick={axis} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: CHART.psiGlow }} formatter={(value, _name, item) => { const overdue = Number((item.payload as { overdue?: number } | undefined)?.overdue ?? 0); return [`${String(value ?? "")}${overdue ? t("pdash.overdueSuffix", { count: overdue }) : ""}`, t("pdash.openShort")]; }} />
            <Bar dataKey="open" name={t("pdash.openShort")} fill={CHART.psi} radius={[0, 4, 4, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer> : <p className="text-sm text-star-dim">{t("pdash.allDone")}</p>}
      </ChartCard>

      <ChartCard title={t("pdash.completedByWeek", { weeks: WEEKS })}>
        {stats.completedByWeek.every((item) => !item.done) ? <p className="text-sm text-star-dim">{t("pdash.noneCompleted", { weeks: WEEKS })}</p> : <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stats.completedByWeek.map((item) => ({ ...item, label: item.week.slice(5) }))} margin={{ right: 8 }}>
            <CartesianGrid stroke={CHART.line} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={axis} />
            <YAxis allowDecimals={false} tick={axis} width={28} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: CHART.psiGlow }} labelFormatter={(label) => t("pdash.weekOf", { date: String(label) })} />
            <Bar dataKey="done" name={t("pdash.doneShort")} fill={CHART.ok} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>}
      </ChartCard>

      <ChartCard title={t("pdash.upcoming", { days: DUE_SOON_DAYS })}>
        {stats.upcoming.length ? <ul className="divide-y divide-nexus-line">{stats.upcoming.slice(0, 12).map((item) => <li key={`${item.kind}-${item.id}`} className="flex items-baseline gap-3 py-2 text-sm">
          <span className={`w-36 shrink-0 whitespace-nowrap font-mono text-xs ${item.overdue ? "font-semibold text-danger" : "text-star-dim"}`}>{item.date}{item.overdue ? ` ${t("pdash.late")}` : ""}</span>
          {item.kind === "task"
            ? <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-psi" onClick={() => onOpenTask(item.id)}>{item.title}</button>
            : <span className="min-w-0 flex-1 truncate text-warn">◆ {item.title}</span>}
          {item.kind === "task" && <span className="shrink-0 text-xs text-star-dim">{item.assignee || t("common.notAssigned")}</span>}
        </li>)}</ul> : <p className="text-sm text-star-dim">{t("pdash.nothingDue")}</p>}
      </ChartCard>
    </div>}
  </div>;
}
