import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useLang } from "../i18n/LangContext";
import type { Project, ProjectDetail } from "../types";

export type TourName = "project" | "regulatory";

interface TourStep {
  selector: string;
  path: string;
  text: { zh: string; en: string };
}

export const TOUR_DEFINITIONS: Record<TourName, readonly TourStep[]> = {
  project: [
    { selector: "[data-tour='nav']", path: "/", text: { zh: "主導覽列可前往所有專案與個人工具。", en: "The main navigation opens every project and personal tool." } },
    { selector: "[data-tour='kpi']", path: "/", text: { zh: "KPI 與近期動態只彙整你有權查看的專案。", en: "KPIs and activity include only projects you may view." } },
    { selector: "[data-tour='project-card']", path: "/projects", text: { zh: "從專案清單新增專案，或點卡片進入現有專案。", en: "Create a project from the list or open an existing card." } },
    { selector: "[data-tour='project-overview']", path: "project:overview", text: { zh: "總覽集中目標、進度模式、成員與專案日期。", en: "Overview combines goals, progress mode, members, and dates." } },
    { selector: "[data-tour='project-milestones']", path: "project:overview", text: { zh: "里程碑記未來關鍵節點，完成後可推進自動進度。", en: "Milestones are future checkpoints that can advance auto progress." } },
    { selector: "[data-tour='project-history']", path: "project:overview", text: { zh: "歷程事件記已發生事實，不會改變完成百分比。", en: "History events record facts without changing completion." } },
    { selector: "[data-tour='task-views']", path: "project:tasks", text: { zh: "用看板、清單、日曆或甘特查看同一批任務。", en: "View the same tasks as Kanban, list, calendar, or Gantt." } },
    { selector: "[data-tour='task-drawer']", path: "project:task", text: { zh: "任務抽屜可設依賴，並讓後續日期自動接龍。", en: "Set dependencies in the drawer to chain later task dates." } },
    { selector: "[data-tour='progress-updates']", path: "project:updates", text: { zh: "發布週進度後，可逐項套用 AI 連動建議。", en: "After a weekly update, review and apply linked AI actions." } },
    { selector: "[data-tour='project-files']", path: "project:files", text: { zh: "檔案可放在整個專案，也可綁定單一任務。", en: "Files may belong to the project or one specific task." } },
    { selector: "[data-tour='automation']", path: "project:automation", text: { zh: "自動化把完成事件轉成通知、待辦或進度紀錄。", en: "Automation turns completion events into alerts, to-dos, or updates." } },
    { selector: "[data-tour='reports-generate']", path: "/reports", text: { zh: "依群組與週月範圍產生報表，私人專案另行控制。", en: "Generate weekly or monthly reports by group and privacy scope." } },
    { selector: "[data-tour='timeline-lanes']", path: "/timeline", text: { zh: "時間軸泳道用來跨組別比較專案與任務時程。", en: "Timeline lanes compare project and task schedules across groups." } },
    { selector: "[data-tour='help-nav']", path: "/help", text: { zh: "完成！之後可從說明頁重播任一套導覽。", en: "Done. Replay either tour from Help whenever needed." } },
  ],
  regulatory: [
    { selector: "[data-tour='regwatch-nav']", path: "/regwatch", text: { zh: "法規動態集中已發布公告與外部會議。", en: "Regulatory Watch collects published notices and external meetings." } },
    { selector: "[data-tour='regwatch']", path: "/regwatch", text: { zh: "用產品線、類別、年、月與關鍵字縮小清單。", en: "Filter the list by product, type, year, month, or keyword." } },
    { selector: "[data-tour='regwatch']", path: "/regwatch", text: { zh: "公告日期是發布日，不一定等於規定施行日。", en: "Announcement date is publication, not necessarily effective date." } },
    { selector: "[data-tour='regwatch-drafts']", path: "/regwatch?view=drafts", text: { zh: "TFDA 草稿核准前只供管理者檢查。", en: "TFDA drafts remain reviewer-only until approved." } },
    { selector: "[aria-label] [role='status']", path: "/regwatch?view=drafts", text: { zh: "批次選取可一次核准或刪除多則待審草稿。", en: "Batch selection approves or deletes several pending drafts." } },
    { selector: "[data-tour='regwatch-ai-mode']", path: "/regwatch", text: { zh: "AI 匯入可選單則，或依日期與標題拆成多則。", en: "AI import keeps one entry or splits by date and title." } },
    { selector: "[data-tour='regwatch-ai-mode']", path: "/regwatch", text: { zh: "檔案模式可合併分析最多五個 TXT 或 PDF。", en: "File mode can jointly analyze up to five TXT or PDF files." } },
    { selector: "[data-tour='regwatch-attachments']", path: "/regwatch", text: { zh: "附件保留原始公告，供下載核對完整條文。", en: "Attachments preserve the source for full-text verification." } },
    { selector: "[data-regwatch-row-delete]", path: "/regwatch", text: { zh: "刪除或駁回會留下墓碑，避免同一公告再次匯入。", en: "Delete or reject leaves a tombstone to prevent re-import." } },
  ],
} as const;

const copy = {
  zh: {
    chooseTitle: "第一次使用，想先看哪一套？",
    chooseText: "兩套導覽都能稍後從說明頁重播。",
    project: "先看專案系統",
    regulatory: "先看法規系統",
    skip: "略過",
    next: "下一步",
    done: "完成",
    step: (current: number, total: number) => `導覽 ${current} / ${total}`,
  },
  en: {
    chooseTitle: "Which system would you like to see first?",
    chooseText: "You can replay both tours later from Help.",
    project: "Project system first",
    regulatory: "Regulatory system first",
    skip: "Skip",
    next: "Next",
    done: "Done",
    step: (current: number, total: number) => `Tour ${current} of ${total}`,
  },
} as const;

type TourState = "choose" | TourName | null;
const TOUR_SESSION_KEY = "project-brain:active-tour";

function readTourSession(): { tour: TourName; index: number } | null {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(TOUR_SESSION_KEY) ?? "null") as { tour?: unknown; index?: unknown } | null;
    if (!stored || (stored.tour !== "project" && stored.tour !== "regulatory") || !Number.isInteger(stored.index)) return null;
    return { tour: stored.tour, index: Math.max(0, Number(stored.index)) };
  } catch {
    return null;
  }
}

export function startTour(name: TourName) {
  window.dispatchEvent(new CustomEvent("project-brain:start-tour", { detail: { tour: name } }));
}

export function OnboardingTour() {
  const { user, refresh } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialSession] = useState(readTourSession);
  const [tour, setTour] = useState<TourState>(initialSession?.tour ?? null);
  const [index, setIndex] = useState(initialSession?.index ?? 0);
  const [demoProjectId, setDemoProjectId] = useState("");
  const [demoTaskId, setDemoTaskId] = useState("");
  const [catalogReady, setCatalogReady] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (user?.onboarding_done === 0 && !readTourSession()) setTour("choose");
  }, [user?.onboarding_done]);

  useEffect(() => {
    const replay = (event: Event) => {
      const requested = (event as CustomEvent<{ tour?: TourName }>).detail?.tour;
      window.sessionStorage.setItem(TOUR_SESSION_KEY, JSON.stringify({ tour: requested === "regulatory" ? "regulatory" : "project", index: 0 }));
      setIndex(0);
      setRect(null);
      setTour(requested === "regulatory" ? "regulatory" : "project");
    };
    window.addEventListener("project-brain:start-tour", replay);
    return () => window.removeEventListener("project-brain:start-tour", replay);
  }, []);

  useEffect(() => {
    if (tour === "project" || tour === "regulatory") {
      window.sessionStorage.setItem(TOUR_SESSION_KEY, JSON.stringify({ tour, index }));
    }
  }, [tour, index]);

  useEffect(() => {
    if (tour !== "project") return;
    setCatalogReady(false);
    void api<{ projects: Array<Project & { is_demo?: number }> }>("/projects")
      .then(async (result) => {
        const demo = result.projects.find((project) => project.is_demo === 1);
        setDemoProjectId(demo?.id ?? "");
        if (demo) {
          const detail = await api<ProjectDetail>(`/projects/${demo.id}`);
          setDemoTaskId(detail.tasks[0]?.id ?? "");
        } else {
          setDemoTaskId("");
        }
      })
      .catch(() => {
        setDemoProjectId("");
        setDemoTaskId("");
      })
      .finally(() => setCatalogReady(true));
  }, [tour]);

  const finish = async () => {
    window.sessionStorage.removeItem(TOUR_SESSION_KEY);
    setTour(null);
    setRect(null);
    if (user?.onboarding_done === 0) {
      await api("/auth/onboarding-done", { method: "POST" });
      await refresh();
    }
  };

  const steps = tour === "project" || tour === "regulatory" ? TOUR_DEFINITIONS[tour] : null;
  const step = steps?.[index];

  useEffect(() => {
    if (!step || !steps || (tour === "project" && !catalogReady)) return;
    let path = step.path;
    if (path.startsWith("project:")) {
      if (!demoProjectId) {
        if (index >= steps.length - 1) void finish();
        else setIndex((value) => value + 1);
        return;
      }
      const target = path.slice("project:".length);
      const query = target === "task"
        ? demoTaskId ? `?task=${demoTaskId}` : "?tour=tasks"
        : `?tour=${target}`;
      path = `/projects/${demoProjectId}${query}`;
    }
    if (location.pathname + location.search !== path) navigate(path);
    const timer = window.setTimeout(() => {
      const target = document.querySelector(step.selector);
      if (!target) {
        if (index >= steps.length - 1) void finish();
        else setIndex((value) => value + 1);
        return;
      }
      setRect(target.getBoundingClientRect());
    }, 400);
    const update = () => setRect(document.querySelector(step.selector)?.getBoundingClientRect() ?? null);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  // finish deliberately reads the latest auth state after the timer fires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, steps, tour, index, catalogReady, demoProjectId, demoTaskId, location.pathname, location.search, navigate]);

  if (!tour) return null;
  if (tour === "choose") {
    return <div className="fixed inset-0 z-[80] grid place-items-center bg-void/80 p-4">
      <section className="panel w-full max-w-xl p-6" role="dialog" aria-modal="true" aria-labelledby="tour-choice-title">
        <h2 className="text-xl font-bold" id="tour-choice-title">{copy[lang].chooseTitle}</h2>
        <p className="mt-2 text-sm text-star-dim">{copy[lang].chooseText}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="btn min-h-20" onClick={() => { window.sessionStorage.setItem(TOUR_SESSION_KEY, JSON.stringify({ tour: "project", index: 0 })); setIndex(0); setTour("project"); }}>{copy[lang].project}</button>
          <button className="btn min-h-20" onClick={() => { window.sessionStorage.setItem(TOUR_SESSION_KEY, JSON.stringify({ tour: "regulatory", index: 0 })); setIndex(0); setTour("regulatory"); }}>{copy[lang].regulatory}</button>
        </div>
        <button className="mt-5 text-sm text-star-dim underline" onClick={() => void finish()}>{copy[lang].skip}</button>
      </section>
    </div>;
  }
  if (!steps || !step) return null;

  const bubbleStyle = rect
    ? {
        top: Math.max(16, Math.min(window.innerHeight - 230, rect.bottom + 14)),
        left: Math.max(16, Math.min(window.innerWidth - 326, rect.left)),
      }
    : { top: window.innerHeight / 2 - 90, left: Math.max(16, window.innerWidth / 2 - 150) };

  return <div className="pointer-events-none fixed inset-0 z-[80]">
    {rect
      ? <div className="absolute ring-4 ring-psi" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: "0 0 0 9999px rgb(var(--color-void) / .8)" }} />
      : <div className="absolute inset-0 bg-void/80" />}
    <section className="panel pointer-events-auto absolute w-[300px] p-5 shadow-2xl" role="dialog" aria-live="polite" style={bubbleStyle}>
      <p className="text-xs font-semibold text-psi">{copy[lang].step(index + 1, steps.length)}</p>
      <p className="mt-2 text-sm leading-6">{step.text[lang]}</p>
      <div className="mt-4 flex justify-between gap-3">
        <button className="text-sm text-star-dim" onClick={() => void finish()}>{copy[lang].skip}</button>
        <button className="btn" onClick={() => index === steps.length - 1 ? void finish() : setIndex((value) => value + 1)}>{copy[lang][index === steps.length - 1 ? "done" : "next"]}</button>
      </div>
    </section>
  </div>;
}
