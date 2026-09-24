import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, today } from "../api";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { buildGlance, limitHistory, type GlanceItem, type GlanceKind, type UpcomingItem } from "../project-glance";
import { targetLabel } from "../project-quarter";
import type { ProjectDetail } from "../types";
import { ErrorBox } from "./UI";

/** 歷程先顯示幾筆。夠看出最近在忙什麼，又不會把清單撐得太長。 */
const RECENT_HISTORY = 6;
/** 接下來先顯示幾項。 */
const UPCOMING_LIMIT = 5;
/** 超過這麼多天沒動靜，閒置天數改用警示色。與每日提醒的「專案停滯」門檻相同。 */
const IDLE_WARN_DAYS = 21;

const kindLabel: Record<GlanceKind, TransKey> = {
  task: "glance.kind.task", milestone: "glance.kind.milestone", event: "glance.kind.event",
  note: "glance.kind.note", progress: "glance.kind.progress",
};
const kindMark: Record<GlanceKind, string> = { task: "✔", milestone: "◆", event: "●", note: "✎", progress: "↗" };
const kindColor: Record<GlanceKind, string> = {
  task: "text-ok", milestone: "text-gold-bright", event: "text-psi", note: "text-star", progress: "text-star-dim",
};

/**
 * 一個專案的進度快覽：目前做到哪、接下來要做什麼、過去發生了什麼。
 *
 * 給 projectId 時自己去抓（儀表板、專案清單展開用）；給 detail 時直接用（專案內頁用，
 * 那裡已經載入過了，不必再抓一次）。旁邊已經有「開啟專案」連結的地方把 openLink 關掉，
 * 否則同一頁會有兩個同名連結；專案內頁下方本來就有「專案目標」，那裡把 goal 關掉。
 */
export function ProjectGlance({ projectId, detail: provided, openLink = true, goal = true }: { projectId?: string; detail?: ProjectDetail; openLink?: boolean; goal?: boolean }) {
  const t = useT();
  const [fetched, setFetched] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const id = provided?.project.id ?? projectId ?? "";

  useEffect(() => {
    if (provided || !projectId) return;
    let alive = true;
    setFetched(null); setError("");
    api<ProjectDetail>(`/projects/${projectId}?sections=core,updates`)
      .then((result) => { if (alive) setFetched(result); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : t("glance.loadFailed")); });
    // 快速連點展開不同專案時，晚回來的舊回應不能蓋掉新的。
    return () => { alive = false; };
  }, [projectId, provided]);

  const data = provided ?? fetched;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <p className="py-6 text-center text-sm text-star-dim" role="status">{t("common.loading")}</p>;
  return <GlanceBody data={data} projectId={id} openLink={openLink} goal={goal} />;
}

function GlanceBody({ data, projectId, openLink, goal }: { data: ProjectDetail; projectId: string; openLink: boolean; goal: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const glance = useMemo(() => buildGlance(data, today()), [data]);
  const [allHistory, setAllHistory] = useState(false);
  const [fullNote, setFullNote] = useState(false);
  const { project } = data;
  const history = allHistory ? glance.history : limitHistory(glance.history, RECENT_HISTORY);
  const upcoming = glance.upcoming.slice(0, UPCOMING_LIMIT);
  const hiddenUpcoming = glance.upcoming.length - upcoming.length;
  const month = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "zh-TW", { year: "numeric", month: "long", timeZone: "UTC" });
  const target = targetLabel(project.target_date);
  const note = glance.latest?.content ?? "";
  const longNote = note.length > 220 || note.split("\n").length > 6;

  const facts = [
    t("common.owner", { name: project.owner_name }),
    glance.counts.tasks > 0 && t("glance.tasks", { done: glance.counts.tasksDone, total: glance.counts.tasks }),
    glance.counts.milestones > 0 && t("glance.milestones", { done: glance.counts.milestonesDone, total: glance.counts.milestones }),
    target && t("glance.target", { value: target }),
  ].filter(Boolean) as string[];
  const idle = glance.idleDays;
  const quietTooLong = idle !== null && idle >= IDLE_WARN_DAYS && project.progress < 100;

  return <section aria-label={t("glance.region", { name: project.name })} className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {facts.map((fact) => <span key={fact} className="text-star-dim">{fact}</span>)}
      {idle !== null && <span className={quietTooLong ? "font-semibold text-danger" : "text-star-dim"}>{idle === 0 ? t("glance.activeToday") : t("glance.idle", { count: idle })}</span>}
      {openLink && <Link className="ml-auto text-sm font-semibold text-psi hover:text-star" to={`/projects/${projectId}`}
        aria-label={t("projects.openNamed", { name: project.name })}>{t("projects.openProject")} →</Link>}
    </div>

    {goal && (project.goal_summary || project.description) && <p className="line-clamp-2 text-sm text-star-dim">{project.goal_summary || project.description}</p>}

    {project.progress >= 100 && project.status === "active" && <p className="border border-ok/60 bg-void p-3 text-sm text-ok">{t("glance.completeHint")}</p>}

    <div className="grid gap-5 lg:grid-cols-5">
      <div className="space-y-5 lg:col-span-3">
        <div>
          <h3 className="mb-2 text-sm font-bold text-gold-bright">{t("glance.latest")}</h3>
          {glance.latest ? <div className="border-l-2 border-psi pl-3">
            <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${longNote && !fullNote ? "line-clamp-6" : ""}`}>{note}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-star-dim">
              <span>{glance.latest.author_name} · {formatDate(glance.latest.created_at, false, lang)}</span>
              {longNote && <button type="button" className="font-semibold text-psi hover:text-star" aria-expanded={fullNote} onClick={() => setFullNote(!fullNote)}>{t(fullNote ? "glance.shortText" : "glance.fullText")}</button>}
            </p>
          </div> : <p className="text-sm text-star-dim">{t("glance.noNote")} <Link className="font-semibold text-psi hover:text-star" to={`/projects/${projectId}?tab=updates`}>{t("glance.writeNote")}</Link></p>}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold text-gold-bright">{t("glance.upcoming")}</h3>
          {upcoming.length ? <ul className="space-y-2">{upcoming.map((item) => <UpcomingRow key={item.id} item={item} />)}</ul>
            : <p className="text-sm text-star-dim">{t("glance.noUpcoming")}</p>}
          {hiddenUpcoming > 0 && <Link className="mt-2 inline-block text-sm font-semibold text-psi hover:text-star" to={`/projects/${projectId}?tab=tasks`}>{t("glance.moreUpcoming", { count: hiddenUpcoming })} →</Link>}
        </div>
      </div>

      <div className="lg:col-span-2">
        <h3 className="mb-2 text-sm font-bold text-gold-bright">{t("glance.history")}</h3>
        {history.length ? <ol className="space-y-3">{history.map((group) => <li key={group.month}>
          <p className="mb-1 text-xs font-semibold text-star-dim">{month.format(new Date(`${group.month}-01T00:00:00Z`))}</p>
          <ol className="space-y-1.5 border-l border-nexus-line pl-3">{group.items.map((item) => <HistoryRow key={`${item.kind}-${item.id}`} item={item} />)}</ol>
        </li>)}</ol> : <p className="text-sm text-star-dim">{t("glance.noHistory")}</p>}
        {glance.historyCount > RECENT_HISTORY && <button type="button" className="mt-3 text-sm font-semibold text-psi hover:text-star" aria-expanded={allHistory} onClick={() => setAllHistory(!allHistory)}>
          {allHistory ? t("glance.showRecentHistory") : t("glance.showAllHistory", { count: glance.historyCount })}
        </button>}
      </div>
    </div>
  </section>;
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const t = useT();
  const when = item.days === null ? t("glance.undated")
    : item.days < 0 ? t("glance.overdue", { count: -item.days })
      : item.days === 0 ? t("glance.today") : t("glance.inDays", { count: item.days });
  const tone = item.days === null ? "text-star-dim" : item.days < 0 ? "text-danger" : item.days <= 3 ? "text-warn" : "text-star-dim";
  const kind = item.kind === "task" ? t("glance.kind.openTask") : t(kindLabel[item.kind]);
  // 還沒做的任務不能用打勾符號，否則一眼看去像已經完成。
  const mark = item.kind === "task" ? "☐" : kindMark[item.kind];
  return <li className="flex gap-3 text-sm">
    <span className={`w-24 shrink-0 text-xs font-semibold leading-5 ${tone}`}>{when}{item.date && <span className="block font-normal text-star-dim">{item.date.slice(5)}</span>}</span>
    <span className="min-w-0 flex-1">
      <span className={`mr-1.5 ${item.kind === "task" ? "text-star-dim" : kindColor[item.kind]}`} aria-hidden="true">{mark}</span>
      <span className="break-words">{item.title}</span>
      <span className="mt-0.5 block text-xs text-star-dim">{kind}{item.detail ? ` · ${item.detail}` : ""}</span>
    </span>
  </li>;
}

function HistoryRow({ item }: { item: GlanceItem }) {
  const t = useT();
  const range = item.endDate && item.endDate !== item.date ? ` ~ ${item.endDate.slice(5)}` : "";
  return <li className="flex gap-2 text-sm">
    <span className="w-11 shrink-0 text-xs leading-5 text-star-dim">{item.date?.slice(5)}</span>
    <span className="min-w-0 flex-1">
      {/* 符號要跟標題放在同一個區塊裡，否則會自己佔一行。截斷的那種不能再加 block：
          line-clamp 靠 display:-webkit-box 才有作用，block 會把它蓋掉，長文就整段攤開。 */}
      <span className={`break-words ${item.kind === "note" ? "line-clamp-3 whitespace-pre-wrap" : "block"}`}>
        <span className={`mr-1.5 ${kindColor[item.kind]}`} aria-hidden="true">{kindMark[item.kind]}</span>{item.title}
      </span>
      <span className="block text-xs text-star-dim">{t(kindLabel[item.kind])}{range}{item.detail ? ` · ${item.detail}` : ""}</span>
    </span>
  </li>;
}
