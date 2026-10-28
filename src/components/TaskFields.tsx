import { createContext, useContext, useEffect, useState } from "react";
import { api, patchBody } from "../api";
import { useT } from "../i18n/LangContext";
import type { Task, TaskField } from "../types";
import { ErrorBox } from "./UI";

const TYPE_KEY = { text: "fields.type.text", number: "fields.type.number", date: "fields.type.date", select: "fields.type.select" } as const;
const splitOptions = (value: string) => value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);

/**
 * 任務自訂欄位的管理面板（任務分頁上方）：新增、改名、改單選的選項、刪除。
 * 刪除欄位會連同每個任務填的值一起刪；拿掉單選的某個選項，選了它的任務會變成未填。
 */
export function TaskFieldsManager({ projectId, fields, onChanged, onClose }: { projectId: string; fields: TaskField[]; onChanged(): void; onClose(): void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskField["type"]>("select");
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); onChanged(); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.save")); return false; } finally { setBusy(false); }
  };
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await run(() => api(`/projects/${projectId}/task-fields`, { method: "POST", body: JSON.stringify({ name, type, options: type === "select" ? splitOptions(options) : undefined }) }));
    if (ok) { setName(""); setOptions(""); }
  };

  return <section className="panel mb-5" aria-labelledby="task-fields-title">
    <div className="mb-3 flex items-baseline justify-between gap-3"><h3 id="task-fields-title" className="font-bold">{t("fields.manage")}</h3><button type="button" className="text-sm text-star-dim hover:text-star" onClick={onClose}>{t("common.close")}</button></div>
    <p className="mb-3 text-xs text-star-dim">{t("fields.manageHint")}</p>
    {error && <ErrorBox message={error} />}
    {fields.length > 0 && <ul className="mb-4 divide-y divide-nexus-line">{fields.map((field) => <FieldRow key={field.id} field={field} busy={busy} run={run} />)}</ul>}
    <form className="grid gap-2 sm:grid-cols-[1fr_auto_2fr_auto]" onSubmit={(event) => void add(event)}>
      <input aria-label={t("fields.name")} placeholder={t("fields.namePlaceholder")} maxLength={40} value={name} onChange={(event) => setName(event.target.value)} required />
      <select aria-label={t("fields.type")} value={type} onChange={(event) => setType(event.target.value as TaskField["type"])}>
        {(Object.keys(TYPE_KEY) as Array<TaskField["type"]>).map((key) => <option key={key} value={key}>{t(TYPE_KEY[key])}</option>)}
      </select>
      {type === "select"
        ? <input aria-label={t("fields.options")} placeholder={t("fields.optionsPlaceholder")} value={options} onChange={(event) => setOptions(event.target.value)} required />
        : <span className="self-center text-xs text-star-dim">{t("fields.noOptions")}</span>}
      <button className="btn" disabled={busy || !name.trim()}>{t("fields.add")}</button>
    </form>
  </section>;
}

function FieldRow({ field, busy, run }: { field: TaskField; busy: boolean; run(work: () => Promise<unknown>): Promise<boolean> }) {
  const t = useT();
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(field.options.join("、"));
  useEffect(() => { setName(field.name); setOptions(field.options.join("、")); }, [field]);
  const changed = name.trim() !== field.name || (field.type === "select" && splitOptions(options).join("\u0000") !== field.options.join("\u0000"));
  const save = () => {
    const removed = field.type === "select" ? field.options.filter((option) => !splitOptions(options).includes(option)) : [];
    if (removed.length && !window.confirm(t("fields.removeOptionsConfirm", { options: removed.join("、") }))) return;
    void run(() => api(`/task-fields/${field.id}`, patchBody({ name: name.trim(), ...(field.type === "select" ? { options: splitOptions(options) } : {}) })));
  };
  const remove = () => { if (window.confirm(t("fields.deleteConfirm", { name: field.name }))) void run(() => api(`/task-fields/${field.id}`, { method: "DELETE" })); };
  return <li className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_auto_2fr_auto_auto]">
    <input aria-label={t("fields.renameNamed", { name: field.name })} maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
    <span className="badge justify-self-start">{t(TYPE_KEY[field.type])}</span>
    {field.type === "select" ? <input aria-label={t("fields.optionsNamed", { name: field.name })} value={options} onChange={(event) => setOptions(event.target.value)} /> : <span />}
    <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={busy || !changed || !name.trim()} onClick={save}>{t("common.save")}</button>
    <button type="button" className="text-sm text-danger" disabled={busy} aria-label={t("fields.deleteNamed", { name: field.name })} onClick={remove}>{t("common.delete")}</button>
  </li>;
}

/** 任務抽屜裡填自訂欄位：改了就存（文字與數字在離開欄位時存）。 */
export function TaskFieldInputs({ task, fields, canEdit, onSaved }: { task: Task; fields: TaskField[]; canEdit: boolean; onSaved(): void }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(task.fields ?? {});
  const [error, setError] = useState("");
  useEffect(() => { setValues(task.fields ?? {}); }, [task]);
  if (!fields.length) return null;
  const save = async (field: TaskField, value: string) => {
    if ((task.fields?.[field.id] ?? "") === value) return;
    setError("");
    try {
      await api(`/tasks/${task.id}/fields`, { method: "PUT", body: JSON.stringify({ [field.id]: value || null }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.save"));
      setValues((current) => ({ ...current, [field.id]: task.fields?.[field.id] ?? "" }));
    }
  };
  const set = (field: TaskField, value: string, commit: boolean) => { setValues((current) => ({ ...current, [field.id]: value })); if (commit) void save(field, value); };
  return <section data-task-drawer-section="fields" className="rounded-card border border-nexus-line p-3">
    <h3 className="font-bold">{t("fields.title")}</h3>
    {error && <div className="mt-2"><ErrorBox message={error} /></div>}
    <div className="mt-2 grid gap-3 sm:grid-cols-2">{fields.map((field) => {
      const value = values[field.id] ?? "";
      return <label key={field.id} className="block"><span className="label">{field.name}</span>
        {field.type === "select"
          ? <select className="w-full" value={value} disabled={!canEdit} onChange={(event) => set(field, event.target.value, true)}>
              <option value="">{t("fields.empty")}</option>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              {value && !field.options.includes(value) && <option value={value}>{value}</option>}
            </select>
          : <input className="w-full" type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} maxLength={field.type === "text" ? 500 : undefined}
              value={value} disabled={!canEdit}
              onChange={(event) => set(field, event.target.value, field.type === "date")}
              onBlur={(event) => { if (field.type !== "date") void save(field, event.target.value.trim()); }} />}
      </label>;
    })}</div>
  </section>;
}

/** 任務分頁提供這個專案的欄位定義，看板卡片不必一層層傳下去。 */
export const TaskFieldsContext = createContext<TaskField[]>([]);

/** 看板卡片上顯示單選欄位的值（最多三個），方便一眼分辨。 */
export function TaskFieldBadges({ task }: { task: Task }) {
  const fields = useContext(TaskFieldsContext);
  const shown = fields.filter((field) => field.type === "select" && task.fields?.[field.id]).slice(0, 3);
  if (!shown.length) return null;
  return <p className="mt-2 flex flex-wrap gap-1">{shown.map((field) => <span key={field.id} className="badge !text-[11px]" title={field.name}>{task.fields![field.id]}</span>)}</p>;
}
