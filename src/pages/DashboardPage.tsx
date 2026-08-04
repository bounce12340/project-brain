import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";
import { CHART } from "../chartTheme";
import { Empty, Loading, PageHeader, ProgressBar, RiskBadge } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import type { Project } from "../types";

const DashboardCharts = lazy(() => import("../components/DashboardCharts"));

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
    <div data-tour="kpi" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">{cards.map(([label, value, color]) => <div className="panel !p-4 sm:!p-5" key={label}><p className="text-sm text-star-dim">{label}</p><p className={`mt-1 text-2xl font-black sm:mt-2 sm:text-3xl ${color}`}>{value}</p></div>)}</div>
    {data.v6.license_alerts.length > 0 && <section className="panel mb-6 border-danger"><h2 className="font-bold text-danger">{t("dashboard.licenseAlerts")}</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.v6.license_alerts.map((item) => <Link className="border border-nexus-line p-3 hover:border-danger" to={`/projects/${item.project_id}`} key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.project_name} · {item.subject}</p></div><span className="badge text-danger">{item.expires_at}</span></div></Link>)}</div></section>}
    <div className="grid gap-6 lg:grid-cols-3"><section className="panel lg:col-span-2"><h2 className="mb-4 font-bold">{t("dashboard.groupProgress")}</h2><div className="space-y-4">{data.projects.length ? data.projects.map((project) => <Link to={`/projects/${project.id}`} className="block border border-nexus-line p-3 transition hover:shadow-[0_0_14px_rgb(var(--color-psi)/.25)]" key={project.id}><div className="mb-2 flex justify-between gap-3"><span className="font-medium">{project.visibility === "private" && "🔒 "}{project.name}</span><span className="flex items-center gap-2 text-xs text-star-dim">{project.group_name}<RiskBadge level={project.risk_level} /></span></div><ProgressBar value={project.progress} /></Link>) : <Empty>{t("dashboard.noProjects")}</Empty>}</div></section>
      <section className="panel"><h2 className="mb-4 font-bold">{t("dashboard.recentActivity")}</h2><div className="space-y-4">{data.recent_updates.map((item) => <Link to={`/projects/${item.project_id}`} className="block border-l-2 border-gold-dim pl-3 hover:text-psi" key={item.id}><p className="text-sm font-medium">{item.project_name}</p><p className="mt-1 line-clamp-2 text-sm text-star-dim">{item.content}</p><p className="mt-1 text-xs text-star-dim">{item.author_name} · {formatDate(item.created_at, true, lang)}</p></Link>)}</div></section>
    </div>
    <Suspense fallback={<div className="mt-6 grid gap-6 lg:grid-cols-3">{[0, 1, 2].map((i) => <section className="panel h-[318px]" key={i} />)}</div>}>
      <DashboardCharts groupStatus={data.charts.group_status} clinical={clinical} bdFees={data.charts.bd_fees} />
    </Suspense>
  </>;
}

