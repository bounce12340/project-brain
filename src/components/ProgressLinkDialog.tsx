import { useEffect, useMemo, useRef, useState } from "react";
import { api, patchBody } from "../api";
import { useT } from "../i18n/LangContext";
import { progressLinkDrafts, type ProgressLinksResponse } from "../progress-links";
import type { Stage, Task } from "../types";
import { HelpTip } from "./HelpTip";

interface ApplySummary {
  completed: number;
  created: number;
  milestones: number;
  events: number;
  dates: number;
}

export function ProgressLinkDialog({
  response,
  projectId,
  stages,
  tasks,
  onClose,
  onApplied,
}: {
  response: ProgressLinksResponse;
  projectId: string;
  stages: Stage[];
  tasks: Task[];
  onClose(): void;
  onApplied(summary: ApplySummary): void;
}) {
  const t = useT();
  const initial = useMemo(() => progressLinkDrafts(response, stages, tasks), [response, stages, tasks]);
  const [complete, setComplete] = useState(initial.complete);
  const [create, setCreate] = useState(initial.create);
  const [milestones, setMilestones] = useState(initial.milestones);
  const [events, setEvents] = useState(initial.events);
  const [dates, setDates] = useState(initial.dates);
  const [applied, setApplied] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      previous?.focus();
    };
  }, [onClose]);

  const selectedCount = [...complete, ...create, ...milestones, ...events, ...dates].filter((item) => item.selected && !applied.has(item.key)).length;
  const apply = async () => {
    if (!selectedCount) return;
    setBusy(true);
    setErrors([]);
    const nextApplied = new Set(applied);
    const failures: string[] = [];
    let completed = 0;
    let created = 0;
    let milestoneCount = 0;
    let eventCount = 0;
    let dateCount = 0;
    for (const item of complete.filter((candidate) => candidate.selected && !applied.has(candidate.key))) {
      try {
        await api(`/tasks/${item.task_id}`, patchBody({ done: true }));
        nextApplied.add(item.key);
        completed += 1;
      } catch (error) {
        console.error("progress link complete failed", error);
        failures.push(t("progressLinks.itemFailed", { item: item.title }));
      }
    }
    for (const item of create.filter((candidate) => candidate.selected && !applied.has(candidate.key))) {
      if (!item.title.trim() || !item.stage_id) {
        failures.push(t("progressLinks.itemInvalid", { item: item.title || t("progressLinks.untitled") }));
        continue;
      }
      try {
        await api(`/projects/${projectId}/tasks`, {
          method: "POST",
          body: JSON.stringify({ title: item.title.trim(), stage_id: item.stage_id, due_date: item.due_date || null }),
        });
        nextApplied.add(item.key);
        created += 1;
      } catch (error) {
        console.error("progress link create failed", error);
        failures.push(t("progressLinks.itemFailed", { item: item.title }));
      }
    }
    for (const item of milestones.filter((candidate) => candidate.selected && !applied.has(candidate.key))) {
      if (!item.title.trim() || !item.due_date) {
        failures.push(t("progressLinks.milestoneInvalid", { item: item.title || t("progressLinks.untitledMilestone") }));
        continue;
      }
      try {
        await api(`/projects/${projectId}/milestones`, {
          method: "POST",
          body: JSON.stringify({ title: item.title.trim(), due_date: item.due_date, end_date: item.end_date || null }),
        });
        nextApplied.add(item.key);
        milestoneCount += 1;
      } catch (error) {
        console.error("progress link milestone failed", error);
        failures.push(error instanceof Error ? error.message : t("progressLinks.itemFailed", { item: item.title }));
      }
    }
    for (const item of events.filter((candidate) => candidate.selected && !applied.has(candidate.key))) {
      if (!item.title.trim() || !item.event_date) {
        failures.push(t("progressLinks.eventInvalid", { item: item.title || t("progressLinks.untitledEvent") }));
        continue;
      }
      try {
        await api(`/projects/${projectId}/milestones`, {
          method: "POST",
          body: JSON.stringify({ title: item.title.trim(), due_date: item.event_date, end_date: item.end_date || null, kind: "event" }),
        });
        nextApplied.add(item.key);
        eventCount += 1;
      } catch (error) {
        console.error("progress link event failed", error);
        failures.push(error instanceof Error ? error.message : t("progressLinks.itemFailed", { item: item.title }));
      }
    }
    for (const item of dates.filter((candidate) => candidate.selected && !applied.has(candidate.key))) {
      if (!item.due_date) {
        failures.push(t("progressLinks.dateInvalid", { item: item.title }));
        continue;
      }
      try {
        await api(`/tasks/${item.task_id}`, patchBody({ due_date: item.due_date }));
        nextApplied.add(item.key);
        dateCount += 1;
      } catch (error) {
        console.error("progress link date failed", error);
        failures.push(t("progressLinks.itemFailed", { item: item.title }));
      }
    }
    setApplied(nextApplied);
    setErrors(failures);
    setBusy(false);
    if (completed || created || milestoneCount || eventCount || dateCount) onApplied({ completed, created, milestones: milestoneCount, events: eventCount, dates: dateCount });
    if (!failures.length) onClose();
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4" onMouseDown={() => { if (!busy) onClose(); }}>
    <section className="panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="progress-links-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-bold" id="progress-links-title">{t("progressLinks.title")}<HelpTip topic="aiLinkSuggestions" /></h2><p className="mt-1 text-sm text-star-dim">{t("progressLinks.description")}</p></div>
        <button ref={closeRef} className="btn-secondary !px-3 !py-1.5" disabled={busy} onClick={onClose}>{t("common.close")}</button>
      </header>
      {complete.length > 0 && <section className="mb-6"><h3 className="mb-3 font-bold">{t("progressLinks.completeHeading")}</h3><div className="space-y-2">{complete.map((item) => <label className={`block border border-nexus-line p-3 ${applied.has(item.key) ? "opacity-60" : ""}`} key={item.key}><span className="flex items-start gap-3"><input type="checkbox" checked={item.selected} disabled={busy || applied.has(item.key)} onChange={(event) => setComplete((rows) => rows.map((row) => row.key === item.key ? { ...row, selected: event.target.checked } : row))} /><span className="min-w-0 flex-1"><span className="font-medium">{item.title}</span><span className="ml-2 text-xs text-star-dim">{item.stage_name}</span><span className="mt-1 block text-sm text-star-dim">{t("progressLinks.reason", { reason: item.reason })}</span></span>{applied.has(item.key) && <span className="text-xs text-ok">{t("progressLinks.applied")}</span>}</span></label>)}</div></section>}
      {create.length > 0 && <section className="mb-6"><h3 className="mb-3 font-bold">{t("progressLinks.createHeading")}</h3><div className="space-y-3">{create.map((item) => <div className={`grid gap-3 border border-nexus-line p-3 sm:grid-cols-[auto_1fr_11rem_10rem] ${applied.has(item.key) ? "opacity-60" : ""}`} key={item.key}><input aria-label={t("progressLinks.selectCreate", { title: item.title })} type="checkbox" checked={item.selected} disabled={busy || applied.has(item.key)} onChange={(event) => setCreate((rows) => rows.map((row) => row.key === item.key ? { ...row, selected: event.target.checked } : row))} /><input aria-label={t("common.title")} maxLength={80} value={item.title} disabled={busy || applied.has(item.key)} onChange={(event) => setCreate((rows) => rows.map((row) => row.key === item.key ? { ...row, title: event.target.value } : row))} /><select aria-label={t("automation.stage")} value={item.stage_id} disabled={busy || applied.has(item.key)} onChange={(event) => setCreate((rows) => rows.map((row) => row.key === item.key ? { ...row, stage_id: event.target.value } : row))}>{stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}</select><input aria-label={t("task.end")} type="date" value={item.due_date} disabled={busy || applied.has(item.key)} onChange={(event) => setCreate((rows) => rows.map((row) => row.key === item.key ? { ...row, due_date: event.target.value } : row))} />{applied.has(item.key) && <span className="text-xs text-ok sm:col-start-2">{t("progressLinks.applied")}</span>}</div>)}</div></section>}
      {milestones.length > 0 && <section className="mb-6"><h3 className="mb-3 font-bold">{t("progressLinks.milestoneHeading")}</h3><div className="space-y-3">{milestones.map((item) => <div className={`grid gap-3 border border-nexus-line p-3 sm:grid-cols-[auto_1fr_10rem_10rem] ${applied.has(item.key) ? "opacity-60" : ""}`} key={item.key}><input aria-label={t("progressLinks.selectMilestone", { title: item.title })} type="checkbox" checked={item.selected} disabled={busy || applied.has(item.key)} onChange={(event) => setMilestones((rows) => rows.map((row) => row.key === item.key ? { ...row, selected: event.target.checked } : row))} /><input aria-label={t("common.title")} maxLength={80} value={item.title} disabled={busy || applied.has(item.key)} onChange={(event) => setMilestones((rows) => rows.map((row) => row.key === item.key ? { ...row, title: event.target.value } : row))} /><input aria-label={t("common.date")} type="date" value={item.due_date} disabled={busy || applied.has(item.key)} onChange={(event) => setMilestones((rows) => rows.map((row) => row.key === item.key ? { ...row, due_date: event.target.value } : row))} /><input aria-label={t("project.endDateOptional")} type="date" min={item.due_date} value={item.end_date} disabled={busy || applied.has(item.key)} onChange={(event) => setMilestones((rows) => rows.map((row) => row.key === item.key ? { ...row, end_date: event.target.value } : row))} />{applied.has(item.key) && <span className="text-xs text-ok sm:col-start-2">{t("progressLinks.applied")}</span>}</div>)}</div></section>}
      {events.length > 0 && <section className="mb-6"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-bold">{t("progressLinks.eventHeading")}</h3><button className="btn-secondary !px-3 !py-1.5" type="button" disabled={busy || events.every((item) => applied.has(item.key))} onClick={() => { const select = events.some((item) => !applied.has(item.key) && !item.selected); setEvents((rows) => rows.map((row) => applied.has(row.key) ? row : { ...row, selected: select })); }}>{t(events.some((item) => !applied.has(item.key) && !item.selected) ? "progressLinks.selectAllEvents" : "progressLinks.clearAllEvents")}</button></div><div className="space-y-3">{events.map((item) => <div className={`grid gap-3 border border-nexus-line p-3 sm:grid-cols-[auto_1fr_10rem_10rem] ${applied.has(item.key) ? "opacity-60" : ""}`} key={item.key}><input aria-label={t("progressLinks.selectEvent", { title: item.title })} type="checkbox" checked={item.selected} disabled={busy || applied.has(item.key)} onChange={(event) => setEvents((rows) => rows.map((row) => row.key === item.key ? { ...row, selected: event.target.checked } : row))} /><input aria-label={t("common.title")} maxLength={60} value={item.title} disabled={busy || applied.has(item.key)} onChange={(event) => setEvents((rows) => rows.map((row) => row.key === item.key ? { ...row, title: event.target.value } : row))} /><input aria-label={t("common.date")} type="date" value={item.event_date} disabled={busy || applied.has(item.key)} onChange={(event) => setEvents((rows) => rows.map((row) => row.key === item.key ? { ...row, event_date: event.target.value } : row))} /><input aria-label={t("project.endDateOptional")} type="date" min={item.event_date} value={item.end_date} disabled={busy || applied.has(item.key)} onChange={(event) => setEvents((rows) => rows.map((row) => row.key === item.key ? { ...row, end_date: event.target.value } : row))} />{applied.has(item.key) && <span className="text-xs text-ok sm:col-start-2">{t("progressLinks.applied")}</span>}</div>)}</div></section>}
      {dates.length > 0 && <section className="mb-6"><h3 className="mb-3 font-bold">{t("progressLinks.dateHeading")}</h3><div className="space-y-3">{dates.map((item) => <div className={`grid gap-3 border border-nexus-line p-3 sm:grid-cols-[auto_1fr_10rem] ${applied.has(item.key) ? "opacity-60" : ""}`} key={item.key}><input aria-label={t("progressLinks.selectDate", { title: item.title })} type="checkbox" checked={item.selected} disabled={busy || applied.has(item.key)} onChange={(event) => setDates((rows) => rows.map((row) => row.key === item.key ? { ...row, selected: event.target.checked } : row))} /><span className="min-w-0"><span className="font-medium">{item.title}</span><span className="mt-1 block text-sm text-star-dim">{t("progressLinks.reason", { reason: item.reason })}</span></span><input aria-label={t("task.end")} type="date" value={item.due_date} disabled={busy || applied.has(item.key)} onChange={(event) => setDates((rows) => rows.map((row) => row.key === item.key ? { ...row, due_date: event.target.value } : row))} />{applied.has(item.key) && <span className="text-xs text-ok sm:col-start-2">{t("progressLinks.applied")}</span>}</div>)}</div></section>}
      {errors.length > 0 && <div className="mb-4 border border-danger bg-void p-3 text-sm text-danger"><p className="font-semibold">{t("progressLinks.partialFailure")}</p><ul className="mt-2 list-disc pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      <footer className="flex justify-end gap-3"><button className="btn-secondary" disabled={busy} onClick={onClose}>{t("progressLinks.skip")}</button><button className="btn" disabled={busy || selectedCount === 0} onClick={() => void apply()}>{t(busy ? "progressLinks.applying" : "progressLinks.apply")}</button></footer>
    </section>
  </div>;
}
