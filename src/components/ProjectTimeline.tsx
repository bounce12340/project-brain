import { useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { ErrorBox } from "./UI";
import { HelpTip } from "./HelpTip";
import { useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { buildProjectTimeline, timelineCounts, todayDividerIndex } from "../project-timeline";
import type { Milestone } from "../types";

/**
 * 里程碑與歷程事件合併成一條時間流。兩者本來就存在同一張表，只差 kind 欄位，
 * 卻被拆成兩個面板各自新增——同一件事常被記兩次，這是使用者實際反映的問題。
 */
export function ProjectTimeline({ projectId, milestones, canEdit, reload }: {
  projectId: string;
  milestones: Milestone[];
  canEdit: boolean;
  reload(): void;
}) {
  const t = useT();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Milestone["kind"]>("event");

  const items = buildProjectTimeline(milestones, today());
  const divider = todayDividerIndex(items);
  const counts = timelineCounts(items);

  const run = async (operation: () => Promise<unknown>, failure: TransKey) => {
    setBusy(true); setError("");
    try { await operation(); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t(failure)); }
    finally { setBusy(false); }
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    void run(async () => {
      await api(`/projects/${projectId}/milestones`, { method: "POST", body: JSON.stringify({ ...body, kind }) });
      form.reset();
    }, "error.create");
  };

  return <section data-tour="project-milestones" className="panel">
    <h2 className="mb-1 font-bold">{t("timeline.heading")}<HelpTip topic="milestones" /></h2>
    <p className="mb-4 text-sm text-star-dim">{t("timeline.summary", counts)}</p>
    {error && <ErrorBox message={error} />}
    <div className="space-y-2">{items.length ? items.map((row, index) => <div key={row.item.id}>
      {index === divider && <div className="my-3 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-gold-dim" /><span className="text-xs font-semibold text-gold-bright">{t("timeline.today")}</span><span className="h-px flex-1 bg-gold-dim" />
      </div>}
      <div className={`flex items-center gap-3 border p-3 ${row.isOverdue ? "border-danger bg-danger/10" : "border-nexus-line"}`}>
        {row.item.kind === "milestone"
          ? <input type="checkbox" aria-label={t("timeline.toggle", { title: row.item.title })} checked={!!row.item.done} disabled={!canEdit || busy}
            onChange={(event) => void run(() => api(`/milestones/${row.item.id}`, patchBody({ done: event.target.checked })), "error.update")} />
          : <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 border border-gold-dim" aria-hidden="true" />}
        <span className={`min-w-0 flex-1 text-sm ${row.item.done ? "text-star-dim line-through" : ""}`}>
          {row.item.title}
          <span className="ml-2 text-xs text-star-dim">{t(row.item.kind === "milestone" ? "timeline.kindMilestone" : "timeline.kindEvent")}</span>
        </span>
        <span className="shrink-0 text-xs text-star-dim">{row.date ? `${row.date}${row.item.end_date ? ` ~ ${row.item.end_date}` : ""}` : t("common.notScheduled")}</span>
        {canEdit && <button className="shrink-0 text-xs text-danger" type="button" disabled={busy}
          onClick={() => { if (window.confirm(t("timeline.deleteConfirm", { title: row.item.title }))) void run(() => api(`/milestones/${row.item.id}`, { method: "DELETE" }), "error.operation"); }}>{t("common.delete")}</button>}
      </div>
    </div>) : <p className="empty-inline text-sm text-star-dim">{t("timeline.empty")}</p>}</div>

    {canEdit && <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={add}>
      <label><span className="label">{t("compose.kind")}<HelpTip topic="historyEvents" /></span>
        <select value={kind} onChange={(event) => setKind(event.target.value as Milestone["kind"])}>
          <option value="event">{t("timeline.kindEvent")}</option>
          <option value="milestone">{t("timeline.kindMilestone")}</option>
        </select></label>
      <input name="title" maxLength={80} placeholder={t(kind === "event" ? "project.newHistoryEvent" : "project.newMilestone")} required />
      <input aria-label={t("common.date")} name="due_date" type="date" required={kind === "event"} />
      <label><span className="label">{t("project.endDateOptional")}<HelpTip topic="milestonePeriods" /></span>
        <input aria-label={t("project.endDateOptional")} name="end_date" type="date" /></label>
      <button className="btn" disabled={busy}>{t(busy ? "common.processing" : "common.add")}</button>
    </form>}
  </section>;
}
