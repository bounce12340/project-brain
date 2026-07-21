import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, formatDate } from "../api";
import { CHART } from "../chartTheme";
import { Empty, Loading, PageHeader, ProgressBar, RiskBadge } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import type { Project } from "../types";

interface DashboardData {
  kpis: { active_projects: number; overdue_milestones: number; today_todos: number; week_updates: number };
  projects: Project[]; recent_updates: Array<{ id: string; project_id: string; project_name: string; author_name: string; content: string; created_at: string }>;
  charts: { group_status: Array<Record<string, string | number>>; clinical_enrollments: Array<{ record_date: string; count: number; project_name: string; target_n: number }>; bd_fees: Array<{ month: string; currency: string; total: number }> };
  v6: { quarter: string; key_results: { completed: number; total: number }; license_alerts: Array<{ id: string; name: string; subject: string; expires_at: string; status: string; project_id: string; project_name: string }> };
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null); const t = useT(); const { lang } = useLang();
  useEffect(() => { api<DashboardData>("/dashboard").then(setData); }, []);
  const clinical = useMemo(() => { let total = 0; return (data?.charts.clinical_enrollments ?? []).map((item) => ({ ...item, enrollment: total += Number(item.count), target: item.target_n })); }, [data]);
  if (!data) return <Loading />;
  const cards = [[t("dashboard.activeProjects"), data.kpis.active_projects, "text-psi"], [t("dashboard.overdueMilestones"), data.kpis.overdue_milestones, "text-danger"], [t("dashboard.todayTodos"), data.kpis.today_todos, "text-warn"], [t("dashboard.weekUpdates"), data.kpis.week_updates, "text-ok"], [`${data.v6.quarter} KR`, `${data.v6.key_results.completed}/${data.v6.key_results.total}`, "text-gold-bright"]] as const;
  return <><PageHeader title={t("nav.dashboard")} description={t("dashboard.description")} />
    <div data-tour="kpi" className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label, value, color]) => <div className="panel" key={label}><p className="text-sm text-star-dim">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p></div>)}</div>
    {data.v6.license_alerts.length > 0 && <section className="panel mb-6 border-danger"><h2 className="font-bold text-danger">{t("dashboard.licenseAlerts")}</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.v6.license_alerts.map((item) => <Link className="border border-nexus-line p-3 hover:border-danger" to={`/projects/${item.project_id}`} key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.project_name} · {item.subject}</p></div><span className="badge text-danger">{item.expires_at}</span></div></Link>)}</div></section>}
    <div className="grid gap-6 lg:grid-cols-3"><section className="panel lg:col-span-2"><h2 className="mb-4 font-bold">{t("dashboard.groupProgress")}</h2><div className="space-y-4">{data.projects.length ? data.projects.map((project) => <Link to={`/projects/${project.id}`} className="block border border-nexus-line p-3 transition hover:shadow-[0_0_14px_rgb(var(--color-psi)/.25)]" key={project.id}><div className="mb-2 flex justify-between gap-3"><span className="font-medium">{project.visibility === "private" && "🔒 "}{project.name}</span><span className="flex items-center gap-2 text-xs text-star-dim">{project.group_name}<RiskBadge level={project.risk_level} /></span></div><ProgressBar value={project.progress} /></Link>) : <Empty>{t("dashboard.noProjects")}</Empty>}</div></section>
      <section className="panel"><h2 className="mb-4 font-bold">{t("dashboard.recentActivity")}</h2><div className="space-y-4">{data.recent_updates.map((item) => <Link to={`/projects/${item.project_id}`} className="block border-l-2 border-gold-dim pl-3 hover:text-psi" key={item.id}><p className="text-sm font-medium">{item.project_name}</p><p className="mt-1 line-clamp-2 text-sm text-star-dim">{item.content}</p><p className="mt-1 text-xs text-star-dim">{item.author_name} · {formatDate(item.created_at, true, lang)}</p></Link>)}</div></section>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-3"><ChartCard title={t("dashboard.groupStatus")}><ResponsiveContainer width="100%" height={250}><BarChart data={data.charts.group_status}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="group" tick={{ fill: CHART.starDim }} /><YAxis allowDecimals={false} tick={{ fill: CHART.starDim }} /><Tooltip /><Legend /><Bar dataKey="active" name={t("status.active")} stackId="a" fill={CHART.psi} /><Bar dataKey="paused" name={t("status.paused")} stackId="a" fill={CHART.gold} /><Bar dataKey="done" name={t("status.done")} stackId="a" fill={CHART.ok} /><Bar dataKey="archived" name={t("status.archived")} stackId="a" fill={CHART.warn} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title={t("dashboard.clinicalChart")}><ResponsiveContainer width="100%" height={250}><LineChart data={clinical}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="record_date" tick={{ fill: CHART.starDim }} /><YAxis tick={{ fill: CHART.starDim }} /><Tooltip /><Legend /><Line name={t("dashboard.enrollment")} type="monotone" dataKey="enrollment" stroke={CHART.psi} strokeWidth={2} /><Line name={t("dashboard.target")} type="monotone" dataKey="target" stroke={CHART.gold} strokeDasharray="4 4" /></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title={t("dashboard.bdFees")}><ResponsiveContainer width="100%" height={250}><BarChart data={data.charts.bd_fees}><CartesianGrid stroke={CHART.line} strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fill: CHART.starDim }} /><YAxis tick={{ fill: CHART.starDim }} /><Tooltip /><Bar dataKey="total" name={t("dashboard.fees")} fill={CHART.psi} /></BarChart></ResponsiveContainer></ChartCard></div>
  </>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel"><h2 className="mb-4 font-bold">{title}</h2>{children}</section>; }
