import { useEffect, useState } from "react";
import { api, today } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, Markdown, PageHeader } from "../components/UI";
import type { Metadata } from "../types";
import { useT } from "../i18n/LangContext";
import { HelpTip } from "../components/HelpTip";

interface Summary {
  projects: Array<{ id: string; name: string; group_name: string; progress: number; progress_change: number; updates: number; completed_tasks: number; enrollments: number; bd_events: number }>;
  totals: { completed_tasks: number; enrollments: number; bd_events: number };
  fees: Array<{ project_id: string; currency: string; total: number }>;
}

interface AiReport {
  id: string;
  period_start: string;
  period_end: string;
  period_type: "week" | "month";
  scope_name: string;
  content_md: string;
  include_private: number;
  created_at: string;
}

function monthStart() { const value = today(); return `${value.slice(0, 8)}01`; }
function weekRange(offset = 0) { const current = new Date(); const taipei = new Date(current.toLocaleString("en-US", { timeZone: "Asia/Taipei" })); const day = taipei.getDay() || 7; taipei.setDate(taipei.getDate() - day + 1 + offset * 7); const start = taipei.toISOString().slice(0, 10); taipei.setDate(taipei.getDate() + 6); return { from: start, to: taipei.toISOString().slice(0, 10) }; }

export function ReportsPage() {
  const { user } = useAuth();
  const t = useT();
  const currentWeek = weekRange();
  const [range, setRange] = useState({ from: currentWeek.from, to: currentWeek.to, group: "" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reports, setReports] = useState<AiReport[]>([]);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [scope, setScope] = useState(user?.role === "admin" ? "all" : user?.group_id ?? "");
  const [period, setPeriod] = useState("last-week");
  const [includePrivate, setIncludePrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSummary = () => api<Summary>(`/reports/summary?${new URLSearchParams(range)}`).then(setSummary);
  const loadReports = () => api<{ reports: AiReport[] }>("/reports/ai").then((data) => setReports(data.reports));
  useEffect(() => { void loadSummary(); }, [range]);
  useEffect(() => { void loadReports(); void api<Metadata>("/metadata").then(setMeta); }, []);

  const preset = (value: string) => {
    if (value === "this-week") setRange({ ...range, ...weekRange() });
    else if (value === "last-week") setRange({ ...range, ...weekRange(-1) });
    else setRange({ ...range, from: monthStart(), to: today() });
  };
  const csv = (kind: "summary" | "fees") => {
    if (!summary) return;
    const rows = kind === "summary"
      ? [[t("nav.projects"), t("reports.group"), t("reports.progress"), t("reports.change"), t("reports.completedTasks"), t("reports.newEnrollments"), t("reports.bdEvents")], ...summary.projects.map((project) => [project.name, project.group_name, project.progress, project.progress_change, project.completed_tasks, project.enrollments, project.bd_events])]
      : [["Project ID", "Currency", t("dashboard.fees")], ...summary.fees.map((fee) => [fee.project_id, fee.currency, fee.total])];
    const content = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${kind}-${range.from}-${range.to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const generate = async () => {
    setBusy(true); setError("");
    try {
      await api("/reports/ai/generate", { method: "POST", body: JSON.stringify({ scope, period, include_private: includePrivate }) });
      await loadReports();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("reports.failed"));
    } finally { setBusy(false); }
  };
  const selectableGroups = user?.role === "admin" ? meta?.groups ?? [] : (meta?.groups ?? []).filter((group) => group.id === user?.group_id);

  return <>
    <PageHeader title={t("reports.title")} description={t("reports.description")} actions={<div className="flex gap-2 no-print"><button className="btn-secondary" onClick={() => window.print()}>{t("reports.print")}</button><button className="btn-secondary" onClick={() => csv("summary")}>{t("reports.exportCsv")}</button></div>} />
    <section className="panel mb-6 no-print">
      <h2 className="mb-4 text-lg font-bold" data-tour="reports-generate">{t("reports.generateTitle")}<HelpTip topic="reportScope" /></h2>
      {error && <ErrorBox message={error} />}
      <div className="grid gap-3 md:grid-cols-4">
        <label><span className="label">{t("reports.group")}</span><select className="w-full" value={scope} onChange={(event) => setScope(event.target.value)}>{user?.role === "admin" && <option value="all">{t("reports.company")}</option>}{selectableGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <label><span className="label">{t("reports.period")}</span><select className="w-full" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="this-week">{t("reports.thisWeek")}</option><option value="last-week">{t("reports.lastWeek")}</option><option value="this-month">{t("reports.thisMonth")}</option><option value="last-month">{t("reports.lastMonth")}</option></select></label>
        {user?.role === "admin" ? <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={includePrivate} onChange={(event) => setIncludePrivate(event.target.checked)} />{t("reports.includePrivate")}</label> : <p className="self-end pb-2 text-sm text-star-dim">{t("reports.privateExcluded")}</p>}
        <button className="btn self-end" disabled={busy || !scope} onClick={() => void generate()}>{t(busy ? "reports.generating" : "reports.generate")}</button>
      </div>
    </section>
    <section className="panel mb-6 grid gap-3 md:grid-cols-5 no-print"><select aria-label={t("a11y.summaryPreset")} onChange={(event) => preset(event.target.value)}><option value="this-week">{t("reports.thisWeek")}</option><option value="last-week">{t("reports.lastWeek")}</option><option value="month">{t("reports.thisMonth")}</option></select><input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /><input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /><select aria-label={t("a11y.summaryGroup")} value={range.group} onChange={(event) => setRange({ ...range, group: event.target.value })}><option value="">{t("projects.allGroups")}</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><button className="btn-secondary" onClick={() => csv("fees")}>{t("reports.exportFees")}</button></section>
    {!summary ? <Loading /> : <><div className="mb-6 grid gap-4 sm:grid-cols-3"><Stat label={t("reports.completedTasks")} value={summary.totals.completed_tasks} /><Stat label={t("reports.newEnrollments")} value={summary.totals.enrollments} /><Stat label={t("reports.bdEvents")} value={summary.totals.bd_events} /></div><section className="panel mb-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("nav.projects")}</th><th>{t("reports.progress")}</th><th>{t("reports.change")}</th><th>{t("reports.updates")}</th><th>{t("reports.completedTasks")}</th><th>{t("reports.enrollments")}</th><th>{t("reports.bdEvents")}</th></tr></thead><tbody>{summary.projects.map((project) => <tr className="border-b border-nexus-line" key={project.id}><td className="py-3 font-medium">{project.name}<span className="ml-2 text-xs text-star-dim">{project.group_name}</span></td><td>{project.progress}%</td><td className={project.progress_change >= 0 ? "text-ok" : "text-danger"}>{project.progress_change >= 0 ? "+" : ""}{project.progress_change}%</td><td>{project.updates}</td><td>{project.completed_tasks}</td><td>{project.enrollments}</td><td>{project.bd_events}</td></tr>)}</tbody></table></section></>}
    <h2 className="mb-4 text-xl font-bold">{t("reports.aiTitle")}</h2>
    {reports.length ? <div className="grid gap-5 lg:grid-cols-2">{reports.map((report) => <article className="panel" key={report.id}><header className="mb-3 flex items-start justify-between gap-3"><p className="text-xs font-medium text-psi">{report.scope_name} · {t(report.period_type === "month" ? "reports.monthly" : "reports.weekly")} · {report.period_start} ～ {report.period_end}{report.include_private ? ` · ${t("reports.privateIncluded")}` : ""}</p><button className="btn-secondary no-print !px-3 !py-1" onClick={() => window.print()}>{t("reports.print")}</button></header><Markdown content={report.content_md} /></article>)}</div> : <Empty>{t("reports.empty")}</Empty>}
  </>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="panel"><p className="text-sm text-star-dim">{label}</p><p className="mt-2 text-3xl font-black text-psi">{value}</p></div>; }
