import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { ChecklistIcon, Empty, Loading, PageHeader } from "../components/UI";
import { useT } from "../i18n/LangContext";
import type { Project } from "../types";

export interface Todo {
  id: string;
  title: string;
  due_date: string | null;
  done: number;
  project_id: string | null;
  project_name: string | null;
}

export function TodosPage() {
  const t = useT();
  // null＝還沒載入。跟「載入了但一件都沒有」分開，才不會一進頁面先閃一下空狀態。
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [toast, setToast] = useState("");
  const [todoSubmitting, setTodoSubmitting] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const load = () => api<{ todos: Todo[] }>("/todos").then((data) => setTodos(data.todos));
  useEffect(() => { void load(); }, []);
  useEffect(() => { void api<{ projects: Project[] }>("/projects").then((data) => setProjects(data.projects)); }, []);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setTodoSubmitting(true);
    try {
      await api("/todos", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset();
      await load();
    } finally {
      setTodoSubmitting(false);
    }
  };

  const toggle = async (item: Todo, done: boolean) => {
    const result = await api<{ project_progress?: number }>(`/todos/${item.id}`, patchBody({ done }));
    if (done && item.project_name && result.project_progress !== undefined) {
      setToast(t("todos.completedToast", { title: item.title, project: item.project_name, progress: result.project_progress }));
      window.setTimeout(() => setToast(""), 3500);
    }
    await load();
  };

  return <>
    <PageHeader title={t("todos.title")} description={t("todos.description")} />
    {toast && <div className="toast fixed right-5 top-20 z-50" role="status">{toast}</div>}
    <form className="panel mb-6 grid gap-3 md:grid-cols-4" onSubmit={add}>
      <input ref={titleInput} name="title" placeholder={t("todos.placeholder")} required />
      <input name="due_date" type="date" />
      <select aria-label={t("a11y.todoProject")} name="project_id">
        <option value="">{t("todos.noProject")}</option>
        {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
      </select>
      <button className="btn" disabled={todoSubmitting}>{t(todoSubmitting ? "common.processing" : "common.add")}</button>
    </form>
    {todos === null ? <Loading /> : <TodoGroups todos={todos} currentDate={today()} onToggle={(item, done) => void toggle(item, done)} onDelete={(item) => void api(`/todos/${item.id}`, { method: "DELETE" }).then(load)} onAddFirst={() => titleInput.current?.focus()} />}
  </>;
}

/** 依日期把待辦分成五組；順序就是畫面上的順序。 */
export function groupTodos<T extends Pick<Todo, "done" | "due_date">>(todos: T[], currentDate: string) {
  return [
    { key: "todos.today", items: todos.filter((item) => !item.done && item.due_date === currentDate) },
    { key: "todos.overdue", items: todos.filter((item) => !item.done && !!item.due_date && item.due_date < currentDate) },
    { key: "todos.unscheduled", items: todos.filter((item) => !item.done && !item.due_date) },
    { key: "todos.later", items: todos.filter((item) => !item.done && !!item.due_date && item.due_date > currentDate) },
    { key: "todos.completed", items: todos.filter((item) => !!item.done) },
  ] as const;
}

/**
 * 只畫有項目的分組。五組都空的時候給一個空狀態和一個動作，
 * 而不是五個各寫著「沒有項目」的框——那樣看不出這一頁要拿來做什麼。
 */
export function TodoGroups({ todos, currentDate, onToggle, onDelete, onAddFirst }: { todos: Todo[]; currentDate: string; onToggle(item: Todo, done: boolean): void; onDelete(item: Todo): void; onAddFirst(): void }) {
  const t = useT();
  const groups = groupTodos(todos, currentDate).filter((group) => group.items.length > 0);
  // 實心按鈕留給上面表單的「新增」；這裡只是把游標帶過去，用次要樣式。
  if (!groups.length) return <Empty icon={<ChecklistIcon />} action={<button type="button" className="btn-secondary" onClick={onAddFirst}>{t("todos.addFirst")}</button>}>{t("todos.empty")}</Empty>;
  return <div className="grid gap-5 lg:grid-cols-2">{groups.map((group) => <section className="panel" key={group.key}>
      <h2 className="mb-3 font-bold">{t(group.key)} <span className="text-xs text-star-dim">{group.items.length}</span></h2>
      <div className="space-y-2">{group.items.map((item) => <label className="flex items-center gap-3 rounded-card border border-nexus-line p-3" key={item.id}>
        <input type="checkbox" checked={!!item.done} onChange={(event) => onToggle(item, event.target.checked)} />
        <span className={`flex-1 text-sm ${item.done ? "line-through text-star-dim" : ""}`}>{item.title}{item.project_name && <small className="ml-2 text-psi">{item.project_name}</small>}</span>
        <span className="text-xs text-star-dim">{item.due_date}</span>
        <button aria-label={t("a11y.deleteNamed", { title: item.title })} className="text-danger" onClick={(event) => { event.preventDefault(); onDelete(item); }}>×</button>
      </label>)}</div>
    </section>)}</div>;
}
