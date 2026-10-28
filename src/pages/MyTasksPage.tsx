import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, patchBody } from "../api";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { useT } from "../i18n/LangContext";
import { MY_TASK_GROUPS, groupMyTasks, type MyTaskGroup, type MyTaskItem } from "../my-tasks";

const GROUP_KEY = { overdue: "mytasks.overdue", today: "mytasks.today", week: "mytasks.week", later: "mytasks.later", undated: "mytasks.undated" } as const;

/** 指派給我、還沒完成的任務與子任務，依到期日分組；勾選就完成。個人待辦另在「待辦」頁。 */
export function MyTasksPage() {
  const t = useT();
  const [data, setData] = useState<{ items: MyTaskItem[]; today: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => api<{ items: MyTaskItem[]; today: string }>("/my-tasks").then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("error.load")));
  useEffect(() => { void load(); }, []);

  const complete = async (item: MyTaskItem) => {
    setBusy(item.id); setError("");
    try {
      await api(item.kind === "task" ? `/tasks/${item.id}` : `/subtasks/${item.id}`, patchBody({ done: true }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.update"));
    } finally {
      setBusy("");
    }
  };

  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const groups = groupMyTasks(data.items, data.today);
  const shown = MY_TASK_GROUPS.filter((key) => groups[key].length || key === "today");
  return <>
    <PageHeader title={t("mytasks.title")} description={t("mytasks.description")} actions={<Link className="btn-secondary" to="/todos">{t("mytasks.todosLink")}</Link>} />
    {error && <ErrorBox message={error} />}
    {!data.items.length ? <Empty>{t("mytasks.empty")}</Empty> : <div className="space-y-5">{shown.map((key: MyTaskGroup) => <section key={key} className="panel" aria-labelledby={`mytasks-${key}`}>
      <h2 id={`mytasks-${key}`} className={`mb-3 font-bold ${key === "overdue" ? "text-danger" : ""}`}>{t(GROUP_KEY[key])} <span className="text-xs font-normal text-star-dim">{groups[key].length}</span></h2>
      {groups[key].length ? <ul className="divide-y divide-nexus-line">{groups[key].map((item) => <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
        <input type="checkbox" aria-label={t("mytasks.complete", { title: item.title })} disabled={!!busy} checked={busy === item.id} onChange={() => void complete(item)} />
        <span className="min-w-0 flex-1">
          <Link className="font-medium hover:text-psi" to={`/projects/${item.project_id}?task=${encodeURIComponent(item.kind === "task" ? item.id : item.task_id ?? "")}`}>{item.title}</Link>
          {item.kind === "subtask" && <span className="ml-2 text-xs text-star-dim">{t("mytasks.subtaskOf", { task: item.task_title ?? "" })}</span>}
          {item.kind === "task" && (item.subtask_total ?? 0) > 0 && <span className="ml-2 text-xs text-star-dim">☑ {item.subtask_done}/{item.subtask_total}</span>}
          <span className="mt-0.5 block text-xs text-star-dim"><Link className="text-psi hover:text-star" to={`/projects/${item.project_id}`}>{item.project_name}</Link>{item.stage ? ` · ${item.stage}` : ""}</span>
        </span>
        <span className={`shrink-0 font-mono text-xs ${key === "overdue" ? "font-semibold text-danger" : "text-star-dim"}`}>{item.due_date ?? "—"}</span>
      </li>)}</ul> : <p className="text-sm text-star-dim">{t("mytasks.nothingToday")}</p>}
    </section>)}</div>}
  </>;
}
