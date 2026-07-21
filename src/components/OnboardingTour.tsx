import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Project, ProjectDetail } from "../types";
import { useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";

const steps = [
  { selector: "[data-tour='nav']", path: "/", text: "tour.nav" }, { selector: "[data-tour='kpi']", path: "/", text: "tour.kpi" }, { selector: "[data-tour='project-card']", path: "/projects", text: "tour.project" }, { selector: "[data-tour='project-tabs']", path: "project", text: "tour.tabs" }, { selector: "[data-tour='task-views']", path: "project", text: "tour.views" }, { selector: "[data-tour='task-drawer']", path: "task", text: "tour.drawer" }, { selector: "[data-tour='automation']", path: "automation", text: "tour.automation" }, { selector: "[data-tour='timeline-nav']", path: "/timeline", text: "tour.timeline" }, { selector: "[data-tour='regwatch-nav']", path: "/regwatch", text: "tour.regwatch" }, { selector: "[data-tour='notification-nav']", path: "/notifications", text: "tour.notifications" }, { selector: "[data-tour='help-nav']", path: "/help", text: "tour.help" },
] as const satisfies ReadonlyArray<{ selector: string; path: string; text: TransKey }>;

export function OnboardingTour() {
  const { user, refresh } = useAuth(); const navigate = useNavigate(); const location = useLocation(); const [active, setActive] = useState(false); const [index, setIndex] = useState(0); const [projectId, setProjectId] = useState(""); const [taskId, setTaskId] = useState(""); const [rect, setRect] = useState<DOMRect | null>(null);
  const t = useT();
  useEffect(() => { setActive(user?.onboarding_done === 0); }, [user?.onboarding_done]);
  useEffect(() => { const replay = () => { setIndex(0); setActive(true); }; window.addEventListener("project-brain:start-tour", replay); return () => window.removeEventListener("project-brain:start-tour", replay); }, []);
  useEffect(() => { if (!active) return; void api<{ projects: Project[] }>("/projects").then(async (result) => { const id = result.projects[0]?.id ?? ""; setProjectId(id); if (id) { const detail = await api<ProjectDetail>(`/projects/${id}`); setTaskId(detail.tasks[0]?.id ?? ""); } }); }, [active]);
  const step = steps[index];
  useEffect(() => { if (!active) return; let path: string = step.path; if (path === "project") path = projectId ? `/projects/${projectId}?tour=tasks` : "/projects"; if (path === "task") path = projectId ? `/projects/${projectId}${taskId ? `?task=${taskId}` : "?tour=tasks"}` : "/projects"; if (path === "automation") path = projectId ? `/projects/${projectId}?tour=automation` : "/projects"; if (location.pathname + location.search !== path) navigate(path); const timer = window.setTimeout(() => setRect(document.querySelector(step.selector)?.getBoundingClientRect() ?? null), 250); const update = () => setRect(document.querySelector(step.selector)?.getBoundingClientRect() ?? null); window.addEventListener("resize", update); return () => { window.clearTimeout(timer); window.removeEventListener("resize", update); }; }, [active, index, projectId, taskId, step, location.pathname, location.search, navigate]);
  const finish = async () => { setActive(false); if (user?.onboarding_done === 0) { await api("/auth/onboarding-done", { method: "POST" }); await refresh(); } };
  if (!active) return null;
  const bubbleStyle = rect ? { top: Math.min(window.innerHeight - 180, rect.bottom + 14), left: Math.min(window.innerWidth - 330, Math.max(16, rect.left)) } : { top: window.innerHeight / 2 - 80, left: window.innerWidth / 2 - 150 };
  return <div className="fixed inset-0 z-[80] pointer-events-none">{rect && <div className="absolute rounded-xl ring-4 ring-psi" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgb(var(--color-void) / .8)" }} />} {!rect && <div className="absolute inset-0 bg-void/80" />}<div className="panel pointer-events-auto absolute w-[300px] p-5 shadow-2xl" style={bubbleStyle}><p className="text-xs font-semibold text-psi">{t("tour.step", { current: index + 1, total: steps.length })}</p><p className="mt-2 text-sm leading-6">{t(step.text)}</p><div className="mt-4 flex justify-between"><button className="text-sm text-star-dim" onClick={() => void finish()}>{t("tour.skip")}</button><button className="btn" onClick={() => index === steps.length - 1 ? void finish() : setIndex(index + 1)}>{t(index === steps.length - 1 ? "tour.done" : "tour.next")}</button></div></div></div>;
}
