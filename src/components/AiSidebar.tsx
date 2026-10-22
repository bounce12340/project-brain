import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n/LangContext";
import { useLang } from "../i18n/LangContext";

/** 專案內頁的網址。側邊欄掛在 Layout 上，不經過頁面，因此從路徑判斷「現在開著哪個專案」。 */
const projectIdFromPath = (pathname: string): string => /^\/projects\/([^/]+)$/.exec(pathname)?.[1] ?? "";

const OPEN_KEY = "ai-sidebar-open";
const readOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const writeOpen = (value: boolean) => { try { localStorage.setItem(OPEN_KEY, value ? "1" : "0"); } catch { /* 無痕模式會丟例外，開合狀態不值得為此中斷 */ } };

/** 寫入之後通知專案內頁重抓。側邊欄在 Layout 上，拿不到頁面的 reload。 */
export const PROJECT_CHANGED = "project-data-changed";

interface ChatMessage { role: "user" | "assistant"; content: string }

export function AiSidebar() {
  const t = useT(); const { lang } = useLang();
  const [open, setOpen] = useState(readOpen);
  const [tab, setTab] = useState<"ask" | "plan">("ask");
  const projectId = projectIdFromPath(useLocation().pathname);
  return <>
    {/* 名稱固定為「AI 小幫手」，開合狀態交給 aria-expanded。名稱跟著狀態變的話，
        面板打開時它會跟標題列的「收起」同名，靠名稱定位的工具就分不出要按哪一顆。 */}
    <button className="fixed bottom-6 right-0 z-40 rounded-l-card border border-r-0 border-gold bg-[rgb(var(--color-tab))] px-3 py-2 font-serif text-sm font-semibold text-star shadow-[0_8px_18px_-10px_rgb(var(--color-psi-deep)/.5)] hover:bg-nexus" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); writeOpen(next); }}>
      {t("ai.open")}
    </button>
    {open && <aside aria-label={t("ai.title")} className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-gold bg-nexus shadow-2xl sm:w-[26rem]">
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
      {tab === "ask" ? <AskPane projectId={projectId} lang={lang} /> : <OrganizePane projectId={projectId} lang={lang} />}
    </aside>}
  </>;
}

/** AI 提出、等使用者確認的一個寫入動作。伺服器只描述，不執行。 */
interface ProposedAction { id: string; tool: string; title: string; lines: string[]; args: Record<string, unknown>; destructive: boolean }
type ActionState = "pending" | "running" | "done" | "failed" | "cancelled";
interface ActionCard extends ProposedAction { state: ActionState; error?: string }
interface AskMessage extends ChatMessage { actions?: ActionCard[]; advisor?: string }

/** 送回給 AI 的對話：確認卡處理的結果也要讓 AI 知道，否則下一句它不曉得改了沒有。 */
const historyText = (message: AskMessage, lang: string): string => {
  if (!message.actions?.length) return message.content;
  const word: Record<ActionState, string> = lang === "en"
    ? { pending: "not confirmed yet", running: "running", done: "done", failed: "failed", cancelled: "cancelled by user" }
    : { pending: "使用者尚未確認", running: "執行中", done: "已執行", failed: "執行失敗", cancelled: "使用者取消" };
  return [message.content, ...message.actions.map((action) => `[${word[action.state]}] ${action.title}：${action.lines.join("；")}${action.error ? `（${action.error}）` : ""}`)].join("\n");
};

/** 依序執行勾選／確認的動作：同一份清單可能有先後（先建任務再改專案設定），也避免同時改同一筆。 */
function useActionRunner(projectId: string, update: (id: string, patch: Partial<ActionCard>) => void) {
  const t = useT();
  return async (cards: ActionCard[]) => {
    let changed = false;
    for (const card of cards) {
      if (card.state !== "pending" && card.state !== "failed") continue;
      update(card.id, { state: "running", error: undefined });
      try {
        await api("/ai/agent/execute", { method: "POST", body: JSON.stringify({ tool: card.tool, args: card.args }) });
        update(card.id, { state: "done" }); changed = true;
      } catch (cause) {
        update(card.id, { state: "failed", error: cause instanceof Error ? cause.message : t("error.operation") });
      }
    }
    // 專案內頁聽這個事件重抓資料；其他頁面重新整理後就會看到。
    if (changed) window.dispatchEvent(new CustomEvent(PROJECT_CHANGED, { detail: { projectId } }));
  };
}

function AskPane({ projectId, lang }: { projectId: string; lang: string }) {
  const t = useT();
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

  const send = async () => {
    const asked = question.trim();
    if (!asked || busy) return;
    // 先把提問放進畫面再送出。等回應才顯示的話，按下送出後幾秒鐘畫面毫無變化。
    const history = messages.slice(-6).map((message) => ({ role: message.role, content: historyText(message, lang) }));
    setMessages([...messages, { role: "user", content: asked }]);
    setQuestion(""); setBusy(true); setError("");
    const body = JSON.stringify({ question: asked, history, project_id: projectId || undefined, lang });
    try {
      const data = await api<{ reply?: string; actions?: ProposedAction[]; fallback?: boolean; advisor?: string }>("/ai/agent", { method: "POST", body });
      // 語言模型不支援工具（例如沒有設定金鑰、只剩 Workers AI）時退回原本的純問答。
      const reply = data.fallback ? (await api<{ reply: string }>("/ai/assistant", { method: "POST", body })).reply : data.reply ?? "";
      const actions = (data.fallback ? [] : data.actions ?? []).map((action): ActionCard => ({ ...action, state: "pending" }));
      setMessages((current) => [...current, { role: "assistant", content: reply, actions: actions.length ? actions : undefined, advisor: data.fallback ? undefined : data.advisor }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.operation"));
    } finally { setBusy(false); }
  };

  const setAction = (id: string, patch: Partial<ActionCard>) => setMessages((current) => current.map((message) =>
    message.actions?.some((action) => action.id === id) ? { ...message, actions: message.actions.map((action) => action.id === id ? { ...action, ...patch } : action) } : message));

  const confirm = useActionRunner(projectId, setAction);

  const running = messages.some((message) => message.actions?.some((action) => action.state === "running"));

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {!messages.length && <p className="text-sm text-star-dim">{t(projectId ? "ai.emptyProject" : "ai.empty")}</p>}
      {messages.map((message, index) => <div key={index} className={message.role === "user" ? "text-right" : ""}>
        {message.content && <p className={`inline-block max-w-[92%] whitespace-pre-wrap rounded-card border p-2.5 text-left text-sm ${message.role === "user" ? "border-psi-deep bg-nexus-raised" : "border-gold-dim bg-nexus"}`}>{message.content}</p>}
        {message.advisor && <AdvisorNote model={message.advisor} />}
        {message.actions && <ActionList actions={message.actions} disabled={running} onConfirm={(cards) => void confirm(cards)} onCancel={(id) => setAction(id, { state: "cancelled" })} />}
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
        {messages.length > 0 && <button className="btn-secondary !px-3" disabled={running} onClick={() => { setMessages([]); setError(""); }}>{t("ai.clear")}</button>}
      </div>
      <p className="mt-2 text-xs text-star-dim">{t("ai.actionNote")}</p>
    </div>
  </div>;
}

/** 這個回答有請教過顧問模型：讓使用者知道它多想了一層，也知道慢的原因。 */
function AdvisorNote({ model }: { model: string }) {
  const t = useT();
  return <p className="mt-1 text-xs text-star-dim">{t("ai.advisorConsulted", { model })}</p>;
}

const STATUS: Record<Exclude<ActionState, "pending">, { key: "ai.actionRunning" | "ai.actionDone" | "ai.actionFailed" | "ai.actionCancelled"; className: string }> = {
  running: { key: "ai.actionRunning", className: "text-star-dim" },
  done: { key: "ai.actionDone", className: "text-ok" },
  failed: { key: "ai.actionFailed", className: "text-danger" },
  cancelled: { key: "ai.actionCancelled", className: "text-star-dim" },
};

/** 一張確認卡：做什麼、改哪些欄位；底下的按鈕或勾選框由呼叫端決定。 */
function ActionCardView({ action, children }: { action: ActionCard; children: React.ReactNode }) {
  return <section aria-label={action.title}
    className={`rounded-card border p-2.5 text-left text-sm ${action.destructive ? "border-danger" : "border-psi-deep"} bg-nexus-raised ${action.state === "cancelled" ? "opacity-60" : ""}`}>
    <h3 className={`font-semibold ${action.destructive ? "text-danger" : "text-psi"}`}>{action.title}</h3>
    <ul className="mt-1 space-y-0.5 whitespace-pre-wrap break-words text-star">{action.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
    {children}
  </section>;
}

function ActionStatus({ action }: { action: ActionCard }) {
  const t = useT();
  if (action.state === "pending") return null;
  return <p className={`mt-2 text-xs font-semibold ${STATUS[action.state].className}`} role="status">{t(STATUS[action.state].key)}{action.error && `：${action.error}`}</p>;
}

function ActionList({ actions, disabled, onConfirm, onCancel }: { actions: ActionCard[]; disabled: boolean; onConfirm(cards: ActionCard[]): void; onCancel(id: string): void }) {
  const t = useT();
  const open = actions.filter((action) => action.state === "pending");
  return <div className="mt-2 space-y-2">
    {actions.map((action) => <ActionCardView key={action.id} action={action}>
      {action.state === "pending" || action.state === "failed"
        ? <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className={action.destructive ? "btn-danger" : "btn"} disabled={disabled} onClick={() => onConfirm([action])}>{t(action.state === "failed" ? "ai.actionRetry" : action.destructive ? "ai.actionConfirmDelete" : "ai.actionConfirm")}</button>
            <button className="btn-secondary" disabled={disabled} onClick={() => onCancel(action.id)}>{t("common.cancel")}</button>
            {action.error && <span className="w-full text-xs text-danger" role="alert">{action.error}</span>}
          </div>
        : <ActionStatus action={action} />}
    </ActionCardView>)}
    {open.length > 1 && <button className="btn w-full" disabled={disabled} onClick={() => onConfirm(open)}>{t("ai.actionConfirmAll", { count: open.length })}</button>}
  </div>;
}

/**
 * 整理專案：把專案目前的情況整段寫進來，AI 對照現有資料列出一份變更清單（設定、背景、任務、里程碑、進度紀錄）。
 * 清單預設全勾，取消勾選不要的，按下方按鈕才逐項以本人身分寫入。
 */
function OrganizePane({ projectId: openProjectId, lang }: { projectId: string; lang: string }) {
  const t = useT();
  const [brief, setBrief] = useState("");
  const [reply, setReply] = useState("");
  const [advisor, setAdvisor] = useState("");
  const [actions, setActions] = useState<ActionCard[] | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const reset = () => { setActions(null); setReply(""); setAdvisor(""); setError(""); setSkipped(new Set()); };

  const draft = async () => {
    if (!brief.trim() || busy || !projectId) return;
    reset(); setBusy(true);
    try {
      const data = await api<{ reply: string; actions: ProposedAction[]; advisor?: string }>("/ai/organize", { method: "POST", body: JSON.stringify({ project_id: projectId, brief, lang }) });
      setReply(data.reply); setAdvisor(data.advisor ?? ""); setActions(data.actions.map((action) => ({ ...action, state: "pending" })));
      if (!data.actions.length) setError(t("ai.organizeEmpty"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.operation"));
    } finally { setBusy(false); }
  };

  const setAction = (id: string, patch: Partial<ActionCard>) => setActions((current) => current && current.map((action) => action.id === id ? { ...action, ...patch } : action));
  const run = useActionRunner(projectId, setAction);
  const toggle = (id: string) => setSkipped((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const chosenCards = (actions ?? []).filter((action) => !skipped.has(action.id) && (action.state === "pending" || action.state === "failed"));
  const running = (actions ?? []).some((action) => action.state === "running");
  const apply = async () => { setBusy(true); await run(chosenCards); setBusy(false); };
  const finished = actions?.length && actions.every((action) => action.state !== "pending" && action.state !== "running" || skipped.has(action.id));

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {!openProjectId && <label className="mb-3 block"><span className="label">{t("ai.planPick")}</span>
        <select className="w-full" value={chosen} onChange={(event) => { setChosen(event.target.value); reset(); }}>
          <option value="">{t("ai.planPickPlaceholder")}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}（{option.group_name}）</option>)}
        </select>
      </label>}
      {!projectId
        ? <p className="text-sm text-star-dim">{t(options.length ? "ai.planNeedsProject" : "ai.planNoProjects")}</p>
        : <>
          <label className="label" htmlFor="ai-brief">{t("ai.organizeLabel")}</label>
          <textarea id="ai-brief" className="w-full" rows={8} maxLength={8000} placeholder={t("ai.organizePlaceholder")} value={brief} onChange={(e) => setBrief(e.target.value)} />
          <button className="btn mt-2 w-full" disabled={busy || running || !brief.trim()} onClick={() => void draft()}>{t(busy && !actions ? "ai.organizeThinking" : "ai.organizeDraft")}</button>
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        </>}
      {reply && <p className="mt-4 whitespace-pre-wrap rounded-card border border-gold-dim bg-nexus p-2.5 text-sm">{reply}</p>}
      {advisor && <AdvisorNote model={advisor} />}
      {actions && actions.length > 0 && <div className="mt-3 space-y-2">
        <p className="text-xs text-star-dim">{t("ai.organizeReview")}</p>
        {actions.map((action) => <ActionCardView key={action.id} action={action}>
          {action.state === "pending"
            ? <label className="mt-2 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={!skipped.has(action.id)} disabled={running} onChange={() => toggle(action.id)} />{t("ai.organizeInclude")}</label>
            : <ActionStatus action={action} />}
        </ActionCardView>)}
      </div>}
    </div>
    {actions && actions.length > 0 && <div className="border-t border-gold-dim p-3">
      {finished
        ? <p className="text-sm text-psi" role="status">{t("ai.organizeFinished", { done: actions.filter((action) => action.state === "done").length })}</p>
        : <button className="btn w-full" disabled={busy || running || !chosenCards.length} onClick={() => void apply()}>{t(running ? "ai.actionRunning" : "ai.organizeApply", { count: chosenCards.length })}</button>}
      <p className="mt-2 text-xs text-star-dim">{t("ai.planConfirmNote")}</p>
    </div>}
  </div>;
}
