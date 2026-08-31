import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";
import { Empty, Loading, PageHeader } from "../components/UI";
import { ProjectCard } from "../components/ProjectCard";
import { useLang, useT } from "../i18n/LangContext";
import { archiveDate, archiveSummary, groupArchiveByYear, statusQuery } from "../project-archive";
import type { Metadata, Project } from "../types";

/**
 * 歸檔專區：已完成與已歸檔的專案集中在此，依歸檔年份分段。
 * 卡片仍連到專案內頁，歸檔只是把它們移出日常清單，不是唯讀或刪除。
 */
export function ArchivePage() {
  const t = useT(); const { lang } = useLang();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [filters, setFilters] = useState({ group: "", status: "", keyword: "" });

  useEffect(() => {
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key !== "status")), status: statusQuery("archive", filters.status) });
    setProjects(null);
    api<{ projects: Project[] }>(`/projects?${query}`).then((data) => setProjects(data.projects)).catch(() => setProjects([]));
  }, [filters]);
  useEffect(() => { api<Metadata>("/metadata").then(setMeta).catch(() => undefined); }, []);

  const summary = projects ? archiveSummary(projects) : null;
  const years = projects ? groupArchiveByYear(projects) : [];

  return <><PageHeader title={t("archive.title")} description={t("archive.description")} />
    <div className="panel mb-5 grid gap-3 md:grid-cols-3">
      <select aria-label={t("a11y.filterGroup")} value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}><option value="">{t("projects.allGroups")}</option>{meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <select aria-label={t("a11y.filterStatus")} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{t("archive.allArchived")}</option><option value="done">{t("status.done")}</option><option value="archived">{t("status.archived")}</option></select>
      <input placeholder={t("projects.search")} value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} />
    </div>
    {summary && summary.total > 0 && <p className="mb-5 text-sm text-star-dim">{t("archive.summary", { total: summary.total, done: summary.done, archived: summary.archived })}</p>}
    {!projects ? <Loading /> : years.length ? <div className="space-y-8">{years.map(({ year, projects: list }) => <section key={year}>
      <h2 className="mb-3 border-b border-gold-dim pb-2 font-bold text-gold-bright">{year === "—" ? t("archive.noYear") : t("archive.year", { year })}<span className="ml-2 text-sm font-normal text-star-dim">{t("common.items", { count: list.length })}</span></h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{list.map((project) => <ProjectCard key={project.id} project={project} meta={t("archive.at", { date: formatDate(archiveDate(project), false, lang) || t("common.none") })} />)}</div>
    </section>)}</div> : <Empty>{t("archive.empty")}</Empty>}
    <p className="mt-6 text-sm text-star-dim">{t("archive.backHint")} <Link className="font-semibold text-psi hover:text-star" to="/projects">{t("nav.projects")}</Link></p>
  </>;
}
