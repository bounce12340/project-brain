import { useEffect, useState } from "react";
import { api, formatDate, patchBody } from "../api";
import { useLang, useT } from "../i18n/LangContext";
import {
  applyDependencyDateChange,
  type DependencyDateResult,
  type DependencyDateStatus,
} from "../task-dependency-dates";
import type { Metadata, ProjectDetail, Task, TaskComment } from "../types";
import { relativeTime } from "../utils/localized";
import { ProjectFiles } from "./ProjectFiles";
import { ErrorBox, Markdown } from "./UI";

interface Mentionable { id: string; name: string }

export function TaskDrawer({ task, data, metadata, onClose, reload }: {
  task: Task;
  data: ProjectDetail;
  metadata: Metadata | null;
  onClose(): void;
  reload(): void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [form, setForm] = useState(task);
  const [startDateTouched, setStartDateTouched] = useState(false);
  const [dateStatus, setDateStatus] = useState<DependencyDateStatus>("none");
  const [suggestedStartDate, setSuggestedStartDate] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [mentionables, setMentionables] = useState<Mentionable[]>([]);
  const [comment, setComment] = useState("");
  const [summary, setSummary] = useState<{ summary: string; unresolved: string[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(task);
    setStartDateTouched(false);
    setDateStatus("none");
    setSuggestedStartDate(null);
  }, [task]);

  const loadComments = () => api<{ comments: TaskComment[] }>(`/tasks/${task.id}/comments`)
    .then((result) => setComments(result.comments));

  useEffect(() => {
    void loadComments();
    void api<{ users: Mentionable[] }>(`/projects/${data.project.id}/mentionables`)
      .then((result) => setMentionables(result.users));
  }, [task.id, data.project.id]);

  const updateDateFeedback = (result: DependencyDateResult) => {
    setDateStatus(result.status);
    setSuggestedStartDate(result.suggestedStartDate);
  };

  const selectedDependencies = (dependencyIds: string[]) => data.tasks
    .filter((item) => dependencyIds.includes(item.id))
    .map(({ id, due_date }) => ({ id, due_date }));

  const toggleDependency = (id: string, enabled: boolean) => {
    const currentIds = form.dependency_ids ?? [];
    const dependencyIds = enabled
      ? [...new Set([...currentIds, id])]
      : currentIds.filter((dependencyId) => dependencyId !== id);
    const result = applyDependencyDateChange({
      dependencies: selectedDependencies(dependencyIds),
      startDate: form.start_date,
      dueDate: form.due_date,
      startDateTouched,
    });
    setForm({ ...form, dependency_ids: dependencyIds, start_date: result.startDate, due_date: result.dueDate });
    updateDateFeedback(result);
  };

  const changeStartDate = (value: string | null) => {
    const result = applyDependencyDateChange({
      dependencies: selectedDependencies(form.dependency_ids ?? []),
      startDate: value,
      dueDate: form.due_date,
      startDateTouched: true,
    });
    setForm({ ...form, start_date: value });
    setStartDateTouched(true);
    updateDateFeedback(result);
  };

  const applySuggestedStartDate = () => {
    const result = applyDependencyDateChange({
      dependencies: selectedDependencies(form.dependency_ids ?? []),
      startDate: form.start_date,
      dueDate: form.due_date,
      startDateTouched: false,
    });
    setForm({ ...form, start_date: result.startDate, due_date: result.dueDate });
    setStartDateTouched(false);
    updateDateFeedback(result);
  };

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await api(`/tasks/${task.id}`, patchBody({
        title: form.title,
        description: form.description,
        assignee_id: form.assignee_id,
        dependency_ids: form.dependency_ids ?? [],
        start_date: form.start_date,
        due_date: form.due_date,
        done: !!form.done,
      }));
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.save"));
    } finally {
      setSaving(false);
    }
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    await api(`/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ content: comment }) });
    setComment("");
    await loadComments();
    reload();
  };

  const summarize = async () => {
    setBusy(true);
    try {
      setSummary(await api<{ summary: string; unresolved: string[] }>("/ai/task-summary", {
        method: "POST",
        body: JSON.stringify({ task_id: task.id, lang }),
      }));
    } finally {
      setBusy(false);
    }
  };

  const mentionQuery = comment.match(/@([^\s@]*)$/)?.[1] ?? null;
  const candidates = mentionQuery === null
    ? []
    : mentionables.filter((user) => user.name.includes(mentionQuery)).slice(0, 6);
  const insertMention = (name: string) => setComment(comment.replace(/@[^\s@]*$/, `@${name} `));

  return <div className="fixed inset-0 z-50 flex justify-end bg-void/80" onMouseDown={onClose}>
    <aside data-tour="task-drawer" className="panel h-full w-full max-w-2xl overflow-y-auto p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold">{t("task.content")}</h2>
        <button className="btn-secondary !px-3 !py-1.5" onClick={onClose}>{t("common.close")}</button>
      </header>
      {error && <ErrorBox message={error} />}

      <div className="space-y-4">
        <div>
          <label className="label">{t("common.title")}</label>
          <input className="w-full" value={form.title} disabled={!data.permissions.can_edit} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>
        <div>
          <label className="label">{t("common.description")}</label>
          <textarea className="min-h-24 w-full" value={form.description} disabled={!data.permissions.can_edit} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </div>
        <div>
          <label className="label">{t("task.assignee")}</label>
          <select className="w-full" value={form.assignee_id ?? ""} disabled={!data.permissions.can_edit} onChange={(event) => setForm({ ...form, assignee_id: event.target.value || null })}>
            <option value="">{t("common.notAssigned")}</option>
            {metadata?.users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}
          </select>
        </div>

        <section data-task-drawer-section="dependencies" className="rounded-lg border border-nexus-line p-3">
          <h3 className="font-bold">{t("task.dependencies")}</h3>
          <p className="mt-1 text-xs text-star-dim">{t("task.dependencyHint")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.tasks.filter((item) => item.id !== task.id).map((item) => <label className="flex items-center gap-2 rounded-lg border border-nexus-line p-2 text-sm" key={item.id}>
              <input
                type="checkbox"
                checked={form.dependency_ids?.includes(item.id) ?? false}
                disabled={!data.permissions.can_edit}
                onChange={(event) => toggleDependency(item.id, event.target.checked)}
              />
              <span>{item.title} ({item.due_date ?? t("task.dueUnset")})</span>
            </label>)}
          </div>
        </section>

        <div data-task-drawer-section="dates" className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t("task.start")}</label>
            <input className="w-full" type="date" value={form.start_date ?? ""} disabled={!data.permissions.can_edit} onChange={(event) => changeStartDate(event.target.value || null)} />
            {dateStatus === "auto-applied" && <p className="mt-1 text-xs text-psi">{t("task.autoStartApplied")}</p>}
            {dateStatus === "suggestion" && suggestedStartDate && <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gold-bright">
              <span>{t("task.suggestedStart", { date: suggestedStartDate })}</span>
              <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={applySuggestedStartDate}>{t("task.applySuggestion")}</button>
            </p>}
            {dateStatus === "missing-due-date" && <p className="mt-1 text-xs text-gold-bright">{t("task.missingDependencyDue")}</p>}
          </div>
          <div>
            <label className="label">{t("task.end")}</label>
            <input className="w-full" type="date" value={form.due_date ?? ""} disabled={!data.permissions.can_edit} onChange={(event) => setForm({ ...form, due_date: event.target.value || null })} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.done} disabled={!data.permissions.can_edit} onChange={(event) => setForm({ ...form, done: event.target.checked ? 1 : 0 })} />
          {t("task.completed")}
        </label>
        {data.permissions.can_edit && <button className="btn" disabled={saving} onClick={() => void save()}>{t(saving ? "common.saving" : "task.save")}</button>}
      </div>

      <section className="mt-7 border-t pt-5">
        <h3 className="mb-3 font-bold">{t("task.comments")}</h3>
        <div className="space-y-3">{comments.map((item) => <article className="rounded-lg bg-nexus-raised p-3" key={item.id}>
          <div className="mb-2 flex justify-between text-xs text-star-dim">
            <span>{item.author_name}</span>
            <span title={formatDate(item.created_at, true, lang)}>{relativeTime(item.created_at, lang)}</span>
          </div>
          <Markdown content={item.content} />
        </article>)}</div>
        {data.permissions.can_edit && <div className="relative mt-4">
          <textarea className="min-h-20 w-full" placeholder={t("task.commentPlaceholder")} value={comment} onChange={(event) => setComment(event.target.value)} />
          {candidates.length > 0 && <div className="absolute bottom-full mb-1 w-56 rounded-lg border bg-nexus p-1 shadow-lg">
            {candidates.map((user) => <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-nexus-raised" key={user.id} onClick={() => insertMention(user.name)}>@{user.name}</button>)}
          </div>}
          <button className="btn mt-2" disabled={!comment.trim()} onClick={() => void sendComment()}>{t("task.sendComment")}</button>
        </div>}
      </section>

      <section className="mt-7 border-t pt-5">
        <h3 className="mb-3 font-bold">{t("task.attachments")}</h3>
        <ProjectFiles projectId={data.project.id} taskId={task.id} canEdit={data.permissions.can_edit} compact onChanged={reload} />
      </section>

      <section className="mt-7 border-t pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">{t("task.aiSummary")}</h3>
          <button className="btn-secondary !px-3 !py-1.5" disabled={busy} onClick={() => void summarize()}>{t(busy ? "task.summarizing" : "task.generateSummary")}</button>
        </div>
        {summary && <div className="rounded-lg bg-psi-deep/30 p-4 text-sm">
          <p>{summary.summary}</p>
          {summary.unresolved.length > 0 && <>
            <p className="mt-3 font-semibold">{t("task.openItems")}</p>
            <ul className="list-disc pl-5">{summary.unresolved.map((item) => <li key={item}>{item}</li>)}</ul>
          </>}
        </div>}
      </section>
    </aside>
  </div>;
}
