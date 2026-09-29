import { useState, type ReactNode } from "react";
import { useT } from "../i18n/LangContext";
import { needsClamp, textLength } from "../project-text";
import { ErrorBox, Markdown } from "./UI";

interface Props {
  heading: ReactNode;
  /** 標題列右側的其他控制項（例如進度模式）。 */
  actions?: ReactNode;
  value: string;
  empty: string;
  /** 空白時給可編輯者的提示，也顯示在編輯框上方。 */
  hint?: string;
  placeholder: string;
  limit: number;
  rows: number;
  canEdit: boolean;
  /** 以精簡 Markdown 顯示（標題、項目符號、編號清單）。長的內容先只露出上半段。 */
  markdown?: boolean;
  editLabel: string;
  onSave(value: string): Promise<void>;
}

const FADE = "linear-gradient(to bottom, black 75%, transparent)";

/** 可以就地編輯的一段長文字：平常是閱讀模式，長的先摺起來；按「編輯」才換成輸入框。 */
export function EditableText({ heading, actions, value, empty, hint, placeholder, limit, rows, canEdit, markdown = false, editLabel, onSave }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const open = () => { setDraft(value); setError(""); setEditing(true); };
  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(draft); setEditing(false); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  };
  const long = needsClamp(value);
  const count = textLength(draft);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h2 className="font-bold">{heading}</h2>
        {canEdit && !editing && <button type="button" className="text-sm text-psi hover:underline" aria-label={editLabel} onClick={open}>{t("common.edit")}</button>}
      </div>
      {actions}
    </div>
    {editing ? <div className="mt-3 space-y-2">
      {error && <ErrorBox message={error} />}
      {hint && <p className="text-xs leading-5 text-star-dim">{hint}</p>}
      <textarea aria-label={editLabel} className="w-full leading-6" rows={rows} value={draft} placeholder={placeholder} autoFocus
        onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !saving) setEditing(false); }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${count > limit ? "text-danger" : "text-star-dim"}`}>{t("text.count", { count: count.toLocaleString("en-US"), limit: limit.toLocaleString("en-US") })}</span>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditing(false)}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={saving || count > limit} onClick={() => void save()}>{t(saving ? "common.processing" : "common.save")}</button>
        </div>
      </div>
    </div> : value ? <div className="mt-3">
      {markdown
        // line-clamp 只對單一段落有效；Markdown 是好幾個區塊，改用固定高度加漸層淡出。
        ? <div className={long && !expanded ? "max-h-72 overflow-hidden" : ""} style={long && !expanded ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}><Markdown content={value} /></div>
        : <p className={`whitespace-pre-line text-sm leading-7 ${long && !expanded ? "line-clamp-6" : ""}`}>{value}</p>}
      {long && <button type="button" className="mt-1 text-sm text-psi hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? "common.collapse" : "common.expand")}</button>}
    </div> : <div className="mt-3 text-sm text-star-dim">
      <p>{empty}</p>
      {canEdit && hint && <p className="mt-1 text-xs leading-5">{hint}</p>}
    </div>}
  </>;
}
