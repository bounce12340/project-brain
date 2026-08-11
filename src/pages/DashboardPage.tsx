import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";
import { useAuth } from "../auth";
import { CHART } from "../chartTheme";
import { Empty, ErrorBox, Loading, PageHeader, ProgressBar, RiskBadge } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import { archivableSelection, canArchive, ongoingOnly } from "../project-archive";
import type { Project } from "../types";

const DashboardCharts = lazy(() => import("../components/DashboardCharts"));

interface DashboardData {
  kpis: { active_projects: number; overdue_milestones: number; today_todos: number; week_updates: number };
  projects: Project[]; recent_updates: Array<{ id: string; project_id: string; project_name: string; author_name: string; content: string; created_at: string }>;
  charts: { group_status: Array<Record<string, string | number>>; clinical_enrollments: Array<{ record_date: string; count: number; project_name: string; target_n: number }>; bd_fees: Array<{ month: string; currency: string; total: number }> };
  v6: { quarter: string; key_results: { completed: number; total: number }; license_alerts: Array<{ id: string; name: string; subject: string; expires_at: string; status: string; project_id: string; project_name: string }> };
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null); const t = useT(); const { lang } = useLang(); const { user } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = () => api<DashboardData>("/dashboard").then(setData);
  useEffect(() => { void load(); }, []);
  const clinical = useMemo(() => { let total = 0; return (data?.charts.clinical_enrollments ?? []).map((item) => ({ ...item, enrollment: total += Number(item.count), target: item.target_n })); }, [data]);
  // 進度條只列進行中的專案；已完成與已歸檔的收在歸檔專區。
  const ongoing = useMemo(() => ongoingOnly(data?.projects ?? []), [data]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const archiveSelected = async () => {
    const ids = archivableSelection(ongoing, selected, user);
    if (!ids.length || !window.confirm(t("dashboard.archiveConfirm", { count: ids.length }))) return;
    setBusy(true); setError("");
    const results = await Promise.allSettled(ids.map((id) => api(`/projects/${id}/archive`, { method: "POST" })));
    const failed = results.filter((result) => result.status === "rejected").length;
    // 部分成功時仍要重新載入：成功的那幾件已經離開清單了。
    if (failed) setError(t("dashboard.archiveFailed", { count: failed }));
    setSelected(new Set()); await load().catch(() => undefined); setBusy(false);
  };

  if (!data) return <Loading />;
  const selectable = ongoing.filter((project) => canArchive(project, user));
  const pending = archivableSelection(ongoing, selected, user).length;
  const cards = [[t("dashboard.activeProjects"), data.kpis.active_projects, "text-psi"], [t("dashboard.overdueMilestones"), data.kpis.overdue_milestones, "text-danger"], [t("dashboard.todayTodos"), data.kpis.today_todos, "text-warn"], [t("dashboard.weekUpdates"), data.kpis.week_updates, "text-ok"], [`${data.v6.quarter} KR`, `${data.v6.key_results.completed}/${data.v6.key_results.total}`, "text-gold-bright"]] as const;
  return <><PageHeader title={t("nav.dashboard")} description={t("dashboard.description")} />
    <div data-tour="kpi" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">{cards.map(([label, value, color]) => <div className="panel !p-4 sm:!p-5" key={label}><p className="text-sm text-star-dim">{label}</p><p className={`mt-1 text-2xl font-black sm:mt-2 sm:text-3xl ${color}`}>{value}</p></div>)}</div>
    {data.v6.license_alerts.length > 0 && <section className="panel mb-6 border-danger"><h2 className="font-bold text-danger">{t("dashboard.licenseAlerts")}</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.v6.license_alerts.map((item) => <Link className="border border-nexus-line p-3 hover:border-danger" to={`/projects/${item.project_id}`} key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.project_name} · {item.subject}</p></div><span className="badge text-danger">{item.expires_at}</span></div></Link>)}</div></section>}
    <div className="grid gap-6 lg:grid-cols-3"><section className="panel lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">{t("dashboard.groupProgress")}</h2>
        {selectable.length > 0 && <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={!pending || busy} onClick={() => void archiveSelected()}>{busy ? t("common.processing") : t("dashboard.archiveSelected", { count: pending })}</button>}
      </div>
      {error && <ErrorBox message={error} />}
      <div className="space-y-4">{ongoing.length ? ongoing.map((project) => <div className="flex items-start gap-2 border border-nexus-line p-3 transition hover:shadow-[0_0_14px_rgb(var(--color-psi)/.25)]" key={project.id}>
        {canArchive(project, user) && <label className="touch-target shrink-0 cursor-pointer"><input type="checkbox" className="h-4 w-4" checked={selected.has(project.id)} onChange={() => toggle(project.id)} aria-label={t("dashboard.selectProject", { name: project.name })} /></label>}
        <Link to={`/projects/${project.id}`} className="block min-w-0 flex-1">
          <div className="mb-2 flex justify-between gap-3"><span className="font-medium">{project.visibility === "private" && "🔒 "}{project.name}</span><span className="flex items-center gap-2 text-xs text-star-dim">{project.group_name}<RiskBadge level={project.risk_level} /></span></div>
          <ProgressBar value={project.progress} />
        </Link>
      </div>) : <Empty>{t("dashboard.noProjects")}</Empty>}</div>
      {selectable.length > 0 && <p className="mt-4 text-sm text-star-dim">{t("dashboard.archiveHint")} <Link className="font-semibold text-psi hover:text-star" to="/archive">{t("archive.title")}</Link></p>}
    </section>
      <section className="panel"><h2 className="mb-4 font-bold">{t("dashboard.recentActivity")}</h2><div className="space-y-4">{data.recent_updates.map((item) => <Link to={`/projects/${item.project_id}`} className="block border-l-2 border-gold-dim pl-3 hover:text-psi" key={item.id}><p className="text-sm font-medium">{item.project_name}</p><p className="mt-1 line-clamp-2 text-sm text-star-dim">{item.content}</p><p className="mt-1 text-xs text-star-dim">{item.author_name} · {formatDate(item.created_at, true, lang)}</p></Link>)}</div></section>
    </div>
    <Suspense fallback={<div className="mt-6 grid gap-6 lg:grid-cols-3">{[0, 1, 2].map((i) => <section className="panel h-[318px]" key={i} />)}</div>}>
      <DashboardCharts groupStatus={data.charts.group_status} clinical={clinical} bdFees={data.charts.bd_fees} />
    </Suspense>
  </>;
}

