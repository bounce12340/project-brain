import { useEffect, useState } from "react";
import { api, today } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, Markdown, PageHeader } from "../components/UI";
import type { Metadata } from "../types";

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
      ? [["專案", "組別", "目前進度", "進度變化", "完成任務", "新增收案", "BD事件"], ...summary.projects.map((project) => [project.name, project.group_name, project.progress, project.progress_change, project.completed_tasks, project.enrollments, project.bd_events])]
      : [["專案ID", "幣別", "費用小計"], ...summary.fees.map((fee) => [fee.project_id, fee.currency, fee.total])];
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
      setError(cause instanceof Error ? cause.message : "報告產生失敗");
    } finally { setBusy(false); }
  };
  const selectableGroups = user?.role === "admin" ? meta?.groups ?? [] : (meta?.groups ?? []).filter((group) => group.id === user?.group_id);

  return <>
    <PageHeader title="報表" description="依可見專案彙整期間成果；AI 組別報告預設排除保密專案。" actions={<div className="flex gap-2 no-print"><button className="btn-secondary" onClick={() => window.print()}>列印</button><button className="btn-secondary" onClick={() => csv("summary")}>匯出 CSV</button></div>} />
    <section className="panel mb-6 no-print">
      <h2 className="mb-4 text-lg font-bold">產生報告</h2>
      {error && <ErrorBox message={error} />}
      <div className="grid gap-3 md:grid-cols-4">
        <label><span className="label">組別</span><select className="w-full" value={scope} onChange={(event) => setScope(event.target.value)}>{user?.role === "admin" && <option value="all">全公司</option>}{selectableGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <label><span className="label">期間</span><select className="w-full" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="this-week">本週</option><option value="last-week">上週</option><option value="this-month">本月</option><option value="last-month">上月</option></select></label>
        {user?.role === "admin" ? <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={includePrivate} onChange={(event) => setIncludePrivate(event.target.checked)} />含保密專案（僅管理員可讀）</label> : <p className="self-end pb-2 text-sm text-star-dim">保密專案不納入報告</p>}
        <button className="btn self-end" disabled={busy || !scope} onClick={() => void generate()}>{busy ? "產生中…" : "產生"}</button>
      </div>
    </section>
    <section className="panel mb-6 grid gap-3 md:grid-cols-5 no-print"><select onChange={(event) => preset(event.target.value)}><option value="this-week">本週</option><option value="last-week">上週</option><option value="month">本月</option></select><input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /><input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /><select value={range.group} onChange={(event) => setRange({ ...range, group: event.target.value })}><option value="">全部組別</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><button className="btn-secondary" onClick={() => csv("fees")}>匯出費用 CSV</button></section>
    {!summary ? <Loading /> : <><div className="mb-6 grid gap-4 sm:grid-cols-3"><Stat label="完成任務" value={summary.totals.completed_tasks} /><Stat label="新增收案" value={summary.totals.enrollments} /><Stat label="BD 事件" value={summary.totals.bd_events} /></div><section className="panel mb-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">專案</th><th>進度</th><th>變化</th><th>更新</th><th>完成任務</th><th>收案</th><th>BD事件</th></tr></thead><tbody>{summary.projects.map((project) => <tr className="border-b border-nexus-line" key={project.id}><td className="py-3 font-medium">{project.name}<span className="ml-2 text-xs text-star-dim">{project.group_name}</span></td><td>{project.progress}%</td><td className={project.progress_change >= 0 ? "text-ok" : "text-danger"}>{project.progress_change >= 0 ? "+" : ""}{project.progress_change}%</td><td>{project.updates}</td><td>{project.completed_tasks}</td><td>{project.enrollments}</td><td>{project.bd_events}</td></tr>)}</tbody></table></section></>}
    <h2 className="mb-4 text-xl font-bold">AI 週報與月報</h2>
    {reports.length ? <div className="grid gap-5 lg:grid-cols-2">{reports.map((report) => <article className="panel" key={report.id}><header className="mb-3 flex items-start justify-between gap-3"><p className="text-xs font-medium text-psi">{report.scope_name} · {report.period_type === "month" ? "月報" : "週報"} · {report.period_start} ～ {report.period_end}{report.include_private ? " · 含保密專案" : ""}</p><button className="btn-secondary no-print !px-3 !py-1" onClick={() => window.print()}>列印</button></header><Markdown content={report.content_md} /></article>)}</div> : <Empty>尚未產生您可讀取的 AI 報告</Empty>}
  </>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="panel"><p className="text-sm text-star-dim">{label}</p><p className="mt-2 text-3xl font-black text-psi">{value}</p></div>; }
