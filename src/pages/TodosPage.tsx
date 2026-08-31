import { useEffect, useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { HelpTip } from "../components/HelpTip";
import { Empty, PageHeader } from "../components/UI";
import { useT } from "../i18n/LangContext";
import type { Project } from "../types";

interface Todo {
  id: string;
  title: string;
  due_date: string | null;
  done: number;
  project_id: string | null;
  project_name: string | null;
}

export function TodosPage() {
  const t = useT();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [toast, setToast] = useState("");
  const [todoSubmitting, setTodoSubmitting] = useState(false);
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

  const groups = [
    { title: t("todos.today"), items: todos.filter((item) => !item.done && item.due_date === today()) },
    { title: t("todos.overdue"), items: todos.filter((item) => !item.done && !!item.due_date && item.due_date < today()) },
    { title: t("todos.unscheduled"), items: todos.filter((item) => !item.done && !item.due_date) },
    { title: t("todos.later"), items: todos.filter((item) => !item.done && !!item.due_date && item.due_date > today()) },
    { title: t("todos.completed"), items: todos.filter((item) => !!item.done) },
  ];

  const toggle = async (item: Todo, done: boolean) => {
    const result = await api<{ project_progress?: number }>(`/todos/${item.id}`, patchBody({ done }));
    if (done && item.project_name && result.project_progress !== undefined) {
      setToast(t("todos.completedToast", { title: item.title, project: item.project_name, progress: result.project_progress }));
      window.setTimeout(() => setToast(""), 3500);
    }
    await load();
  };

  return <>
    <PageHeader title={<>{t("todos.title")}<HelpTip topic="todos" /></>} description={t("todos.description")} />
    {toast && <div className="fixed right-5 top-20 z-50 rounded-lg bg-ok px-4 py-3 text-sm text-white shadow-lg">{toast}</div>}
    <form className="panel mb-6 grid gap-3 md:grid-cols-4" onSubmit={add}>
      <input name="title" placeholder={t("todos.placeholder")} required />
      <input name="due_date" type="date" />
      <select aria-label={t("a11y.todoProject")} name="project_id">
        <option value="">{t("todos.noProject")}</option>
        {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
      </select>
      <button className="btn" disabled={todoSubmitting}>{t(todoSubmitting ? "common.processing" : "common.add")}</button>
    </form>
    <div className="grid gap-5 lg:grid-cols-2">{groups.map((group) => <section className="panel" key={group.title}>
      <h2 className="mb-3 font-bold">{group.title} <span className="text-xs text-star-dim">{group.items.length}</span></h2>
      {group.items.length ? <div className="space-y-2">{group.items.map((item) => <label className="flex items-center gap-3 rounded-lg border border-nexus-line p-3" key={item.id}>
        <input type="checkbox" checked={!!item.done} onChange={(event) => void toggle(item, event.target.checked)} />
        <span className={`flex-1 text-sm ${item.done ? "line-through text-star-dim" : ""}`}>{item.title}{item.project_name && <small className="ml-2 text-psi">{item.project_name}</small>}</span>
        <span className="text-xs text-star-dim">{item.due_date}</span>
        <button aria-label={t("a11y.deleteNamed", { title: item.title })} className="text-danger" onClick={(event) => { event.preventDefault(); void api(`/todos/${item.id}`, { method: "DELETE" }).then(load); }}>×</button>
      </label>)}</div> : <Empty>{t("common.noItems")}</Empty>}
    </section>)}</div>
  </>;
}
