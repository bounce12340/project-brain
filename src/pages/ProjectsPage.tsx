import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, PageHeader, ProgressBar } from "../components/UI";
import type { Metadata, Project } from "../types";

export function ProjectsPage() {
  const { user } = useAuth(); const [projects, setProjects] = useState<Project[] | null>(null); const [meta, setMeta] = useState<Metadata | null>(null); const [showNew, setShowNew] = useState(false); const [filters, setFilters] = useState({ group: "", status: "", keyword: "" });
  const load = () => { const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); api<{ projects: Project[] }>(`/projects?${query}`).then((data) => setProjects(data.projects)); };
  useEffect(load, [filters]); useEffect(() => { api<Metadata>("/metadata").then(setMeta); }, []);
  return <><PageHeader title="專案" description="依組別、狀態或關鍵字尋找專案。" actions={user?.role !== "intern" && <button className="btn" onClick={() => setShowNew(!showNew)}>＋ 新增專案</button>} />
    {showNew && meta && <NewProject metadata={meta} onDone={() => { setShowNew(false); load(); }} />}
    <div className="card mb-5 grid gap-3 md:grid-cols-3"><select value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}><option value="">全部組別</option>{meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">全部狀態</option><option value="active">進行中</option><option value="paused">暫停</option><option value="done">完成</option><option value="archived">歸檔</option></select><input placeholder="搜尋專案…" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} /></div>
    {!projects ? <Loading /> : projects.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{projects.map((project, index) => <Link data-tour={index === 0 ? "project-card" : undefined} to={`/projects/${project.id}`} className="card hover:border-brand-300 hover:shadow-md" key={project.id}><div className="mb-4 flex items-start justify-between gap-2"><div><span className="badge mb-2">{project.group_name}</span><h2 className="font-bold">{project.visibility === "private" && "🔒 "}{project.name}</h2></div><span className="text-xs text-slate-400">{statusLabel[project.status]}</span></div><p className="mb-4 line-clamp-2 min-h-10 text-sm text-slate-500">{project.description || "尚無說明"}</p><ProgressBar value={project.progress} /><div className="mt-4 flex justify-between text-xs text-slate-500"><span>Owner：{project.owner_name}</span><span>目標：{project.target_date || "—"}</span></div></Link>)}</div> : <Empty>找不到符合條件的專案</Empty>}
  </>;
}

const statusLabel: Record<string, string> = { active: "進行中", paused: "暫停", done: "完成", archived: "歸檔" };

function NewProject({ metadata, onDone }: { metadata: Metadata; onDone(): void }) {
  const [form, setForm] = useState({ name: "", description: "", group_id: metadata.groups[0]?.id ?? "", visibility: "group", template_id: "", target_date: "" }); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api("/projects", { method: "POST", body: JSON.stringify(form) }); onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "建立失敗"); } };
  return <form onSubmit={submit} className="card mb-5"><h2 className="mb-4 font-bold">建立新專案</h2>{error && <ErrorBox message={error} />}<div className="grid gap-3 md:grid-cols-3"><input placeholder="專案名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>{metadata.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="all">全公司</option><option value="group">同組＋成員</option><option value="private">保密</option></select><input className="md:col-span-2" placeholder="說明" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /><select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}><option value="">不套用階段模板</option>{metadata.templates.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select><button className="btn">建立專案</button></div></form>;
}
