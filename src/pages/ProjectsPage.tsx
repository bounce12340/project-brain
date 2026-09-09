import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, today } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { ProjectListRow } from "../components/ProjectListRow";
import { groupByProduct, hasClusters, relatedProjects } from "../project-grouping";
import { useT } from "../i18n/LangContext";
import { statusQuery } from "../project-archive";
import { formatQuarter, quarterOptions, quarterValue, resolveTargetDate } from "../project-quarter";
import { SITE_UNSET, defaultProjectGroup, filterProjectsBySite, hasUnsetSite, projectSites, readProjectGroup, resolveSite, writeProjectGroup } from "../project-list-filter";
import type { Metadata, Project } from "../types";

export function ProjectsPage() {
  const { user } = useAuth(); const t = useT(); const [projects, setProjects] = useState<Project[] | null>(null); const [meta, setMeta] = useState<Metadata | null>(null); const [showNew, setShowNew] = useState(false); // Protected 保證 user 已載入才渲染這頁，因此初始化時就能讀到組別。
  const [filters, setFilters] = useState(() => ({ group: defaultProjectGroup(readProjectGroup(), user), status: "", keyword: "" }));
  const [autoGroup, setAutoGroup] = useState(() => readProjectGroup() === null);
  // 廠區不放進 filters：filters 會被序列化成查詢字串送給後端，而廠區是在前端篩的。
  const [chosenSite, setChosenSite] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  // status 一律帶值：不帶的話後端回傳全部狀態，已完成與已歸檔的專案會漏進這份清單。
  const load = () => { const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key !== "status")), status: statusQuery("active", filters.status) }); api<{ projects: Project[] }>(`/projects?${query}`).then((data) => {
    // 預設帶出自己的組別，但那一組可能一件都沒有。這時退回「全部」，而不是讓使用者
    // 對著空清單猜原因。只退一次，避免與 effect 互相觸發成迴圈。
    if (autoGroup && filters.group && !data.projects.length) { setAutoGroup(false); setFilters((current) => ({ ...current, group: "" })); return; }
    setProjects(data.projects);
  }); };
  useEffect(load, [filters]); useEffect(() => { api<Metadata>("/metadata").then(setMeta); }, []);
  // 廠區選單只列出目前這份清單裡有的值；選過的若因其他篩選而消失則退回「全部」。
  const sites = projectSites(projects ?? []);
  const unset = hasUnsetSite(projects ?? []);
  const site = resolveSite(chosenSite, sites, unset);
  const visible = filterProjectsBySite(projects ?? [], site);
  return <><PageHeader title={t("nav.projects")} description={t("projects.description")} actions={user?.role !== "intern" && <button className="btn" onClick={() => setShowNew(!showNew)}>{t("projects.new")}</button>} />
    {showNew && meta && <NewProject metadata={meta} onDone={() => { setShowNew(false); load(); }} />}
    <div className={`panel mb-5 grid gap-3 ${sites.length ? "md:grid-cols-4" : "md:grid-cols-3"}`}><select aria-label={t("a11y.filterGroup")} value={filters.group} onChange={(e) => { setAutoGroup(false); writeProjectGroup(e.target.value); setFilters({ ...filters, group: e.target.value }); }}><option value="">{t("projects.allGroups")}</option>{meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><select aria-label={t("a11y.filterStatus")} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{t("projects.allOngoing")}</option><option value="active">{t("status.active")}</option><option value="paused">{t("status.paused")}</option></select><input placeholder={t("projects.search")} value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} />
      {/* 沒有人填過廠區時整個不顯示——一個只有「全部」可選的下拉只是噪音。 */}
      {sites.length > 0 && <select aria-label={t("a11y.filterSite")} value={site} onChange={(e) => setChosenSite(e.target.value)}>
        <option value="">{t("projects.allSites")}</option>
        {sites.map((value) => <option value={value} key={value}>{value}</option>)}
        {unset && <option value={SITE_UNSET}>{t("projects.siteUnset")}</option>}
      </select>}</div>
    {!projects ? <Loading /> : visible.length ? <ProjectSections projects={visible} open={open} onToggle={(id) => setOpen((current) => {
      const next = new Set(current); if (!next.delete(id)) next.add(id); return next;
    })} /> : <Empty>{t("projects.notFound")}</Empty>}
    <p className="mt-6 text-sm text-star-dim">{t("projects.archiveHint")} <Link className="font-semibold text-psi hover:text-star" to="/archive">{t("archive.title")}</Link></p>
  </>;
}

function NewProject({ metadata, onDone }: { metadata: Metadata; onDone(): void }) {
  const t = useT(); const [form, setForm] = useState({ name: "", description: "", group_id: metadata.groups[0]?.id ?? "", visibility: "group", template_id: "", start_date: "", target_quarter: "", product: "", site: "" }); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    // 後端收的是 target_date；季度只是輸入形式，這裡換算成該季最後一天。
    const { target_quarter, ...fields } = form;
    try { await api("/projects", { method: "POST", body: JSON.stringify({ ...fields, target_date: resolveTargetDate(target_quarter) ?? "" }) }); onDone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.create")); }
  };
  return <form onSubmit={submit} className="panel mb-5"><h2 className="mb-4 font-bold">{t("projects.createTitle")}</h2>{error && <ErrorBox message={error} />}<div className="grid gap-3 md:grid-cols-3"><input placeholder={t("projects.namePlaceholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /><select value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>{metadata.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="all">{t("projects.visibility.all")}</option><option value="group">{t("projects.visibility.group")}</option><option value="private">{t("projects.visibility.private")}</option></select><input aria-label={t("projects.product")} placeholder={t("projects.productPlaceholder")} value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /><input aria-label={t("projects.site")} placeholder={t("projects.sitePlaceholder")} value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} /><input className="md:col-span-2" placeholder={t("projects.descriptionPlaceholder")} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><input type="date" aria-label={t("project.startDate")} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /><select aria-label={t("project.targetQuarter")} value={form.target_quarter} onChange={(e) => setForm({ ...form, target_quarter: e.target.value })}><option value="">{t("projects.noTargetQuarter")}</option>{quarterOptions(today()).map((item) => <option key={quarterValue(item)} value={quarterValue(item)}>{formatQuarter(item)}</option>)}</select><select value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}><option value="">{t("projects.noTemplate")}</option>{metadata.templates.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button className="btn">{t("projects.create")}</button></div></form>;
}

/**
 * 依產品分區呈現。只有兩件以上的產品才給標題，其餘集中在「其他」——每個產品都給標題的
 * 話，畫面會變成一長串「一個標題配一列」，比原本的卡片更亂。
 */
function ProjectSections({ projects, open, onToggle }: { projects: Project[]; open: Set<string>; onToggle(id: string): void }) {
  const t = useT();
  const sections = groupByProduct(projects);
  const grouped = hasClusters(sections);
  let first = true;
  return <div className="space-y-6">
    {grouped && <p className="text-sm text-star-dim">{t("projects.groupHint")}</p>}
    {sections.map((section) => <section key={section.product || "__rest__"}>
      {grouped && <h2 className="mb-2 text-sm font-semibold text-gold-bright">
        {section.product ? t("projects.productCount", { product: section.product, count: section.projects.length }) : t("projects.otherProducts")}
      </h2>}
      <div className="space-y-2">{section.projects.map((project) => {
        const tour = first; first = false;
        return <ProjectListRow key={project.id} project={project} tour={tour} expanded={open.has(project.id)}
          related={relatedProjects(projects, project)} onToggle={() => onToggle(project.id)} />;
      })}</div>
    </section>)}
  </div>;
}
