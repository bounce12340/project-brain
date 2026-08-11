import { Link } from "react-router-dom";
import { ProgressBar } from "./UI";
import { useT } from "../i18n/LangContext";
import type { Project } from "../types";

/** 專案清單與歸檔專區共用同一張卡，差別只在右下角那一格顯示什麼。 */
export function ProjectCard({ project, tour, meta }: { project: Project; tour?: boolean; meta?: string }) {
  const t = useT();
  const statusLabel = { active: t("status.active"), paused: t("status.paused"), done: t("status.done"), archived: t("status.archived") };
  return <Link data-tour={tour ? "project-card" : undefined} to={`/projects/${project.id}`} className="panel transition hover:shadow-[0_0_16px_rgb(var(--color-psi)/.28)]">
    <div className="mb-4 flex items-start justify-between gap-2">
      <div><span className="badge mb-2">{project.group_name}</span><h2 className="font-bold">{project.visibility === "private" && "🔒 "}{project.name}</h2></div>
      <span className="text-xs text-star-dim">{statusLabel[project.status]}</span>
    </div>
    <p className="mb-4 line-clamp-2 min-h-10 text-sm text-star-dim">{project.description || t("projects.noDescription")}</p>
    <ProgressBar value={project.progress} />
    <div className="mt-4 flex justify-between text-xs text-star-dim">
      <span>{t("common.owner", { name: project.owner_name })}</span>
      <span>{meta ?? t("common.target", { date: project.target_date || t("common.none") })}</span>
    </div>
  </Link>;
}
