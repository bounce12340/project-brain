import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n/LangContext";
import { useLang } from "../i18n/LangContext";
import { planCount, type PlanMilestone, type PlanTask, type ProjectPlan } from "../ai-plan";

/** 專案內頁的網址。側邊欄掛在 Layout 上，不經過頁面，因此從路徑判斷「現在開著哪個專案」。 */
const projectIdFromPath = (pathname: string): string => /^\/projects\/([^/]+)$/.exec(pathname)?.[1] ?? "";

const OPEN_KEY = "ai-sidebar-open";
const readOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const writeOpen = (value: boolean) => { try { localStorage.setItem(OPEN_KEY, value ? "1" : "0"); } catch { /* 無痕模式會丟例外，開合狀態不值得為此中斷 */ } };

/** 寫入之後通知專案內頁重抓。側邊欄在 Layout 上，拿不到頁面的 reload。 */
export const PROJECT_CHANGED = "project-data-changed";

interface ChatMessage { role: "user" | "assistant"; content: string }
interface Stage { id: string; name: string }

export function AiSidebar() {
  const t = useT(); const { lang } = useLang();
  const [open, setOpen] = useState(readOpen);
  const [tab, setTab] = useState<"ask" | "plan">("ask");
  const projectId = projectIdFromPath(useLocation().pathname);
  return <>
    {/* 名稱固定為「AI 小幫手」，開合狀態交給 aria-expanded。名稱跟著狀態變的話，
        面板打開時它會跟標題列的「收起」同名，靠名稱定位的工具就分不出要按哪一顆。 */}
    <button className="btn-secondary fixed bottom-5 right-5 z-40 !px-4 shadow-lg" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); writeOpen(next); }}>
      {t("ai.open")}
    </button>
    {open && <aside aria-label={t("ai.title")} className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-gold bg-void shadow-2xl sm:w-[26rem]">
      <header className="flex items-center gap-2 border-b border-gold-dim px-4 py-3">
        <h2 className="flex-1 text-base font-semibold text-gold-bright">{t("ai.title")}</h2>
        <button className="text-sm text-star-dim" aria-label={t("ai.close")} onClick={() => { setOpen(false); writeOpen(false); }}>✕</button>
      </header>
      <div className="flex gap-0.5 border-b border-gold-dim bg-nexus-raised p-1">
        {(["ask", "plan"] as const).map((key) => <button key={key} onClick={() => setTab(key)}
          className={`flex-1 px-3 py-1.5 text-sm ${tab === key ? "border-b-2 border-psi bg-nexus font-semibold text-psi" : "text-star-dim"}`}>
          {t(key === "ask" ? "ai.tabAsk" : "ai.tabPlan")}
        </button>)}
      </div>
      {tab === "ask" ? <AskPane projectId={projectId} lang={lang} /> : <PlanPane projectId={projectId} lang={lang} />}
    </aside>}
  </>;
}

function AskPane({ projectId, lang }: { projectId: string; lang: string }) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

  const send = async () => {
    const asked = question.trim();
    if (!asked || busy) return;
    // 先把提問放進畫面再送出。等回應才顯示的話，按下送出後幾秒鐘畫面毫無變化。
    const history = messages.slice(-6);
    setMessages([...messages, { role: "user", content: asked }]);
    setQuestion(""); setBusy(true); setError("");
    try {
      const data = await api<{ reply: string }>("/ai/assistant", { method: "POST", body: JSON.stringify({ question: asked, history, project_id: projectId || undefined, lang }) });
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.operation"));
    } finally { setBusy(false); }
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {!messages.length && <p className="text-sm text-star-dim">{t(projectId ? "ai.emptyProject" : "ai.empty")}</p>}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "text-right" : ""}>
        <p className={`inline-block max-w-[92%] whitespace-pre-wrap border p-2.5 text-left text-sm ${message.role === "user" ? "border-psi-deep bg-nexus-raised" : "border-gold-dim bg-nexus"}`}>{message.content}</p>
      </div>)}
      {busy && <p className="text-sm text-star-dim">{t("ai.thinking")}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div ref={endRef} />
    </div>
    <div className="border-t border-gold-dim p-3">
      <textarea className="w-full" rows={3} aria-label={t("ai.questionLabel")} placeholder={t("ai.placeholder")} value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn flex-1" disabled={busy || !question.trim()} onClick={() => void send()}>{t(busy ? "ai.thinking" : "ai.send")}</button>
        {messages.length > 0 && <button className="btn-secondary !px-3" onClick={() => { setMessages([]); setError(""); }}>{t("ai.clear")}</button>}
      </div>
      <p className="mt-2 text-xs text-star-dim">{t("ai.readOnlyNote")}</p>
    </div>
  </div>;
}

function PlanPane({ projectId: openProjectId, lang }: { projectId: string; lang: string }) {
  const t = useT();
  const [brief, setBrief] = useState("");
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // 不在專案內頁時讓使用者在面板裡選一個。第一版只顯示「請先開啟一個專案」，
  // 於是這個分頁在其他頁面連一個輸入框都沒有——被回報成「不能輸入任何東西」。
  const [options, setOptions] = useState<Array<{ id: string; name: string; group_name: string }>>([]);
  const [chosen, setChosen] = useState("");
  useEffect(() => {
    if (openProjectId) return;
    api<{ projects: Array<{ id: string; name: string; group_name: string }> }>("/projects?summary=1")
      .then((data) => setOptions(data.projects)).catch(() => setOptions([]));
  }, [openProjectId]);
  const projectId = openProjectId || chosen;

  const key = (kind: string, index: number) => `${kind}:${index}`;
  const toggle = (id: string) => setSkipped((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });

  const draft = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true); setError(""); setDone(""); setPlan(null); setSkipped(new Set());
    try {
      const data = await api<{ plan: ProjectPlan; stages: Stage[] }>("/ai/plan-project", { method: "POST", body: JSON.stringify({ project_id: projectId, brief, lang }) });
      setPlan(data.plan); setStages(data.stages);
      if (!planCount(data.plan)) setError(t("ai.planEmpty"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.operation"));
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!plan || busy) return;
    const stageId = (name: string) => stages.find((stage) => stage.name === name)?.id ?? "";
    const tasks = plan.tasks.filter((_, index) => !skipped.has(key("task", index)));
    const milestones = plan.milestones.filter((_, index) => !skipped.has(key("ms", index)));
    if (!tasks.length && !milestones.length) return;
    setBusy(true); setError(""); setDone("");
    // 一筆一筆打既有的建立端點，權限、稽核與自動進度才會照原本的路徑跑。
    // 用 allSettled：其中一筆撞到重複或權限，不該讓其餘的也不寫。
    const results = await Promise.allSettled([
      ...tasks.map((task) => api(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify({ title: task.title, stage_id: stageId(task.stage), due_date: task.due_date || undefined }) })),
      ...milestones.map((milestone) => api(`/projects/${projectId}/milestones`, { method: "POST", body: JSON.stringify({ title: milestone.title, due_date: milestone.due_date || undefined, end_date: milestone.end_date || undefined, kind: "milestone" }) })),
    ]);
    setBusy(false);
    const failed = results.filter((result) => result.status === "rejected").length;
    const written = results.length - failed;
    if (written) { window.dispatchEvent(new CustomEvent(PROJECT_CHANGED, { detail: { projectId } })); setPlan(null); }
    setDone(t("ai.planWritten", { count: written }));
    if (failed) setError(t("ai.planPartial", { count: failed }));
  };

  const remaining = plan ? plan.tasks.filter((_, index) => !skipped.has(key("task", index))).length + plan.milestones.filter((_, index) => !skipped.has(key("ms", index))).length : 0;

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {!openProjectId && <label className="mb-3 block"><span className="label">{t("ai.planPick")}</span>
        <select className="w-full" value={chosen} onChange={(event) => { setChosen(event.target.value); setPlan(null); setError(""); setDone(""); }}>
          <option value="">{t("ai.planPickPlaceholder")}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}（{option.group_name}）</option>)}
        </select>
      </label>}
      {!projectId
        ? <p className="text-sm text-star-dim">{t(options.length ? "ai.planNeedsProject" : "ai.planNoProjects")}</p>
        : <>
      <label className="label" htmlFor="ai-brief">{t("ai.briefLabel")}</label>
      <textarea id="ai-brief" className="w-full" rows={5} placeholder={t("ai.briefPlaceholder")} value={brief} onChange={(e) => setBrief(e.target.value)} />
      <button className="btn mt-2 w-full" disabled={busy || !brief.trim()} onClick={() => void draft()}>{t(busy ? "ai.thinking" : "ai.draft")}</button>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {done && <p className="mt-3 text-sm text-psi" role="status">{done}</p>}

      </>}
      {plan && planCount(plan) > 0 && <div className="mt-4 space-y-3">
        <p className="text-xs text-star-dim">{t("ai.planReview")}</p>
        {plan.tasks.length > 0 && <Section title={t("views.task")}>
          {plan.tasks.map((task, index) => <Row key={key("task", index)} id={key("task", index)} skipped={skipped} onToggle={toggle} label={taskLabel(task)} />)}
        </Section>}
        {plan.milestones.length > 0 && <Section title={t("timeline.kindMilestone")}>
          {plan.milestones.map((milestone, index) => <Row key={key("ms", index)} id={key("ms", index)} skipped={skipped} onToggle={toggle} label={milestoneLabel(milestone)} />)}
        </Section>}
      </div>}
    </div>
    {plan && planCount(plan) > 0 && <div className="border-t border-gold-dim p-3">
      <button className="btn w-full" disabled={busy || !remaining} onClick={() => void apply()}>{t("ai.planApply", { count: remaining })}</button>
      <p className="mt-2 text-xs text-star-dim">{t("ai.planConfirmNote")}</p>
    </div>}
  </div>;
}

const taskLabel = (task: PlanTask): string => `${task.title}　·　${task.stage}${task.due_date ? `　·　${task.due_date}` : ""}`;
const milestoneLabel = (milestone: PlanMilestone): string => `${milestone.title}${milestone.due_date ? `　·　${milestone.due_date}${milestone.end_date ? ` ~ ${milestone.end_date}` : ""}` : ""}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1 text-sm font-semibold text-gold-bright">{title}</h3><div className="space-y-1">{children}</div></section>;
}

function Row({ id, label, skipped, onToggle }: { id: string; label: string; skipped: Set<string>; onToggle(id: string): void }) {
  return <label className="flex items-start gap-2 border border-nexus-line bg-nexus-raised p-2 text-sm">
    <input type="checkbox" className="mt-0.5" checked={!skipped.has(id)} onChange={() => onToggle(id)} />
    <span className={skipped.has(id) ? "text-star-dim line-through" : ""}>{label}</span>
  </label>;
}
