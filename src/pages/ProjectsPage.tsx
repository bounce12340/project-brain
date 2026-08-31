import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { ProjectCard } from "../components/ProjectCard";
import { useT } from "../i18n/LangContext";
import { statusQuery } from "../project-archive";
import type { Metadata, Project } from "../types";

export function ProjectsPage() {
  const { user } = useAuth(); const t = useT(); const [projects, setProjects] = useState<Project[] | null>(null); const [meta, setMeta] = useState<Metadata | null>(null); const [showNew, setShowNew] = useState(false); const [filters, setFilters] = useState({ group: "", status: "", keyword: "" });
  // status 一律帶值：不帶的話後端回傳全部狀態，已完成與已歸檔的專案會漏進這份清單。
  const load = () => { const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key !== "status")), status: statusQuery("active", filters.status) }); api<{ projects: Project[] }>(`/projects?${query}`).then((data) => setProjects(data.projects)); };
  useEffect(load, [filters]); useEffect(() => { api<Metadata>("/metadata").then(setMeta); }, []);
  return <><PageHeader title={t("nav.projects")} description={t("projects.description")} actions={user?.role !== "intern" && <button className="btn" onClick={() => setShowNew(!showNew)}>{t("projects.new")}</button>} />
    {showNew && meta && <NewProject metadata={meta} onDone={() => { setShowNew(false); load(); }} />}
    <div className="panel mb-5 grid gap-3 md:grid-cols-3"><select aria-label={t("a11y.filterGroup")} value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}><option value="">{t("projects.allGroups")}</option>{meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><select aria-label={t("a11y.filterStatus")} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{t("projects.allOngoing")}</option><option value="active">{t("status.active")}</option><option value="paused">{t("status.paused")}</option></select><input placeholder={t("projects.search")} value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} /></div>
    {!projects ? <Loading /> : projects.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{projects.map((project, index) => <ProjectCard key={project.id} project={project} tour={index === 0} />)}</div> : <Empty>{t("projects.notFound")}</Empty>}
    <p className="mt-6 text-sm text-star-dim">{t("projects.archiveHint")} <Link className="font-semibold text-psi hover:text-star" to="/archive">{t("archive.title")}</Link></p>
  </>;
}

function NewProject({ metadata, onDone }: { metadata: Metadata; onDone(): void }) {
  const t = useT(); const [form, setForm] = useState({ name: "", description: "", group_id: metadata.groups[0]?.id ?? "", visibility: "group", template_id: "", target_date: "" }); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api("/projects", { method: "POST", body: JSON.stringify(form) }); onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.create")); } };
  return <form onSubmit={submit} className="panel mb-5"><h2 className="mb-4 font-bold">{t("projects.createTitle")}</h2>{error && <ErrorBox message={error} />}<div className="grid gap-3 md:grid-cols-3"><input placeholder={t("projects.namePlaceholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>{metadata.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="all">{t("projects.visibility.all")}</option><option value="group">{t("projects.visibility.group")}</option><option value="private">{t("projects.visibility.private")}</option></select><input className="md:col-span-2" placeholder={t("projects.descriptionPlaceholder")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /><select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}><option value="">{t("projects.noTemplate")}</option>{metadata.templates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="btn">{t("projects.create")}</button></div></form>;
}
