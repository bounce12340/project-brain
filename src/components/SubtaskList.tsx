import { useEffect, useState } from "react";
import { api, patchBody } from "../api";
import { useT } from "../i18n/LangContext";
import type { Metadata, Subtask } from "../types";
import { ErrorBox } from "./UI";

/**
 * 任務抽屜裡的子任務清單：勾選即存，名稱、負責人、到期日都可以就地改。
 * 子任務只顯示在任務上（看板卡片的 2/4），不計入專案自動進度。
 */
export function SubtaskList({ taskId, canEdit, metadata, onChanged }: { taskId: string; canEdit: boolean; metadata: Metadata | null; onChanged(): void }) {
  const t = useT();
  const [items, setItems] = useState<Subtask[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => api<{ subtasks: Subtask[] }>(`/tasks/${taskId}/subtasks`).then((result) => setItems(result.subtasks));
  useEffect(() => { setItems(null); void load().catch(() => setItems([])); }, [taskId]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try {
      await work();
      await load();
      onChanged(); // 看板卡片上的 2/4 跟著更新
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.save"));
    } finally {
      setBusy(false);
    }
  };
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    void run(async () => { await api(`/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify({ title: name }) }); setTitle(""); });
  };
  const update = (item: Subtask, patch: Partial<Pick<Subtask, "title" | "done" | "assignee_id" | "due_date">>) => {
    // 勾選先反映在畫面上，等回應才變會讓清單感覺卡住。
    setItems((rows) => rows?.map((row) => row.id === item.id ? { ...row, ...patch } : row) ?? rows);
    void run(() => api(`/subtasks/${item.id}`, patchBody(patch)));
  };
  const remove = (item: Subtask) => {
    if (!window.confirm(t("subtasks.deleteConfirm", { title: item.title }))) return;
    void run(() => api(`/subtasks/${item.id}`, { method: "DELETE" }));
  };

  const done = items?.filter((item) => item.done).length ?? 0;
  const total = items?.length ?? 0;

  return <section data-task-drawer-section="subtasks" className="rounded-card border border-nexus-line p-3">
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="font-bold">{t("subtasks.title")}</h3>
      {total > 0 && <span className="text-xs text-star-dim">{t("subtasks.progress", { done, total })}</span>}
    </div>
    {total > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-nexus-line"><div className="h-full bg-ok transition-all" style={{ width: `${(done / total) * 100}%` }} /></div>}
    {error && <div className="mt-2"><ErrorBox message={error} /></div>}
    {items === null ? <p className="mt-2 text-sm text-star-dim">{t("common.loading")}</p> : <>
      {items.length === 0 && <p className="mt-2 text-xs text-star-dim">{t("subtasks.empty")}</p>}
      <ul className="mt-2 divide-y divide-nexus-line">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
        <input type="checkbox" aria-label={t("subtasks.toggle", { title: item.title })} checked={!!item.done} disabled={!canEdit || busy} onChange={(event) => update(item, { done: event.target.checked ? 1 : 0 })} />
        {canEdit
          ? <input aria-label={t("subtasks.rename", { title: item.title })} className={`min-w-0 flex-1 !border-transparent !bg-transparent !px-1 !py-0.5 text-sm hover:!border-nexus-line focus:!border-psi ${item.done ? "text-star-dim line-through" : ""}`} defaultValue={item.title} maxLength={200}
              onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== item.title) update(item, { title: next }); else event.target.value = item.title; }}
              onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
          : <span className={`min-w-0 flex-1 text-sm ${item.done ? "text-star-dim line-through" : ""}`}>{item.title}</span>}
        {canEdit
          ? <select aria-label={t("subtasks.assignee", { title: item.title })} className="!py-0.5 text-xs" value={item.assignee_id ?? ""} disabled={busy} onChange={(event) => update(item, { assignee_id: event.target.value || null })}>
              <option value="">{t("common.notAssigned")}</option>
              {metadata?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          : item.assignee_name && <span className="text-xs text-star-dim">{item.assignee_name}</span>}
        {canEdit
          ? <input type="date" aria-label={t("subtasks.due", { title: item.title })} className="!py-0.5 text-xs" value={item.due_date ?? ""} disabled={busy} onChange={(event) => update(item, { due_date: event.target.value || null })} />
          : item.due_date && <span className="text-xs text-star-dim">{item.due_date}</span>}
        {canEdit && <button type="button" className="text-xs text-danger" aria-label={t("subtasks.delete", { title: item.title })} disabled={busy} onClick={() => remove(item)}>×</button>}
      </li>)}</ul>
      {canEdit && <form className="mt-2 flex gap-2" onSubmit={add}>
        <input aria-label={t("subtasks.new")} className="min-w-0 flex-1 text-sm" maxLength={200} placeholder={t("subtasks.placeholder")} value={title} onChange={(event) => setTitle(event.target.value)} />
        <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy || !title.trim()}>{t("subtasks.add")}</button>
      </form>}
      <p className="mt-2 text-xs text-star-dim">{t("subtasks.hint")}</p>
    </>}
  </section>;
}
