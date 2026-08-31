import { Link } from "react-router-dom";
import { ProgressBar } from "./UI";
import { useT } from "../i18n/LangContext";
import type { Project } from "../types";

/**
 * 專案清單的一列。卡片改成長條之後，「開啟專案」不能退化成要點兩下——所以標題列拆成
 * 兩個並排的可點區域：整條是展開／收合的按鈕，右側另有一個直接開啟的連結。兩者不能巢狀
 * （連結包在按鈕裡是無效的 HTML，而且點擊行為會互搶）。
 */
export function ProjectListRow({ project, related, expanded, onToggle, tour }: {
  project: Project;
  related: Project[];
  expanded: boolean;
  onToggle(): void;
  tour?: boolean;
}) {
  const t = useT();
  const statusLabel = { active: t("status.active"), paused: t("status.paused"), done: t("status.done"), archived: t("status.archived") };
  const detail = (label: string, value: string) => <div>
    <dt className="text-xs text-star-dim">{label}</dt>
    <dd className="mt-0.5 text-sm">{value || t("common.none")}</dd>
  </div>;

  return <div data-tour={tour ? "project-card" : undefined} className="border border-nexus-line bg-nexus-raised">
    <div className="flex items-center gap-2 px-3">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
        aria-expanded={expanded} aria-label={t("projects.rowToggle", { name: project.name })} onClick={onToggle}>
        <span aria-hidden="true" className={`shrink-0 text-star-dim transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{project.visibility === "private" && "🔒 "}{project.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-star-dim">
            <span className="badge">{project.group_name}</span>
            {project.product && <span className="badge">{project.product}</span>}
            {project.site && <span>{project.site}</span>}
            <span>{statusLabel[project.status]}</span>
            {related.length > 0 && <span className="text-psi">{t("projects.related")} {related.length}</span>}
          </span>
        </span>
        <span className="hidden w-44 shrink-0 sm:block"><ProgressBar value={project.progress} /></span>
      </button>
      <Link className="shrink-0 text-sm font-semibold text-psi hover:text-star" to={`/projects/${project.id}`}
        aria-label={t("projects.openNamed", { name: project.name })}>{t("projects.openProject")}</Link>
    </div>

    {expanded && <div className="border-t border-nexus-line px-3 py-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {detail(t("projects.product"), project.product)}
        {detail(t("projects.site"), project.site)}
        {detail(t("task.assignee"), project.owner_name)}
        {detail(t("project.targetDate"), project.target_date ?? "")}
      </dl>
      <p className="mt-4 text-sm text-star-dim">{project.goal_summary || project.description || t("projects.noDescription")}</p>
      <div className="mt-3 sm:hidden"><ProgressBar value={project.progress} /></div>
      {related.length > 0 && <div className="mt-4">
        <p className="mb-2 text-xs font-semibold text-gold-bright">{t("projects.related")}</p>
        <div className="flex flex-wrap gap-2">{related.map((item) => <Link key={item.id} to={`/projects/${item.id}`}
          className="border border-nexus-line px-2 py-1 text-sm hover:border-psi hover:text-psi">{item.name}</Link>)}</div>
      </div>}
    </div>}
  </div>;
}
