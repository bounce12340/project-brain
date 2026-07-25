import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import type { RegEntry } from "../types";
import { useT } from "../i18n/LangContext";

const productLines = ["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"];

interface ExtractedEntry {
  entry_date: string;
  entry_type: "announcement" | "meeting";
  product_line: string;
  category: string;
  title: string;
  key_points: string;
  link?: string;
  duplicate?: boolean;
  date_suspect?: boolean;
  included: boolean;
}

interface RegwatchResponse {
  entries: RegEntry[];
  page: number;
  total: number;
  total_pages: number;
  can_manage: boolean;
  pending_count: number;
  view: "published" | "drafts";
}

interface TfdaFetchResult {
  fetched: number;
  new_drafts: number;
  skipped_ref: number;
  skipped_dup: number;
  ai_fallback: number;
  errors: string[];
}

const maxFileBytes = 10 * 1024 * 1024;
const maxTotalFileBytes = 25 * 1024 * 1024;
const maxFiles = 5;

function dateSuspect(value: string): boolean {
  const date = Date.parse(`${value}T00:00:00Z`);
  const threshold = new Date(`${today()}T00:00:00Z`);
  threshold.setUTCDate(threshold.getUTCDate() + 90);
  return Number.isFinite(date) && date > threshold.getTime();
}

export function RegwatchPage() {
  const t = useT();
  const [filters, setFilters] = useState({ product_line: "", entry_type: "", year: "", keyword: "" });
  const [page, setPage] = useState(1);
  const [draftMode, setDraftMode] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "drafts");
  const [data, setData] = useState<RegwatchResponse | null>(null);
  const [editing, setEditing] = useState<RegEntry | "new" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [fetchingTfda, setFetchingTfda] = useState(false);
  const query = useMemo(() => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page: String(page), ...(draftMode ? { view: "drafts" } : {}) }).toString(), [draftMode, filters, page]);
  const load = () => api<RegwatchResponse>(`/regwatch?${query}`).then((response) => {
    setData(response);
    if (draftMode && response.view !== "drafts") setDraftMode(false);
  }).catch((cause) => setError(cause instanceof Error ? cause.message : t("regwatch.loadFailed")));
  useEffect(() => { void load(); }, [query]);
  const changeFilter = (key: keyof typeof filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget));
    if (editing !== "new" && editing) await api(`/regwatch/${editing.id}`, patchBody(body));
    else await api("/regwatch", { method: "POST", body: JSON.stringify(body) });
    setEditing(null); await load();
  };
  const remove = async (item: RegEntry) => { if (!window.confirm(t("regwatch.deleteConfirm", { title: item.title }))) return; await api(`/regwatch/${item.id}`, { method: "DELETE" }); await load(); };
  const approve = async (item: RegEntry) => { await api(`/regwatch/${item.id}/approve`, { method: "POST" }); setToast(t("regwatch.approved", { title: item.title })); await load(); };
  const approveAll = async () => {
    if (!window.confirm(t("regwatch.approveAllConfirm"))) return;
    const result = await api<{ approved: number }>("/regwatch/approve-all", { method: "POST" });
    setToast(t("regwatch.approveAllResult", result));
    await load();
  };
  const fetchTfda = async () => {
    setFetchingTfda(true); setError("");
    try {
      const result = await api<TfdaFetchResult>("/regwatch/tfda-fetch", { method: "POST" });
      setToast(t("regwatch.tfdaFetchResult", { ...result, errors: result.errors.length }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("regwatch.tfdaFetchFailed")); }
    finally { setFetchingTfda(false); }
  };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <><PageHeader title={t("nav.regwatch")} description={t(draftMode ? "regwatch.draftDescription" : "regwatch.description")} actions={data.can_manage && <div className="flex flex-wrap gap-2">{(draftMode || data.pending_count > 0) && <button className="badge border-warn text-warn" onClick={() => { setDraftMode(!draftMode); setPage(1); }}>{draftMode ? t("regwatch.backPublished") : t("regwatch.pending", { count: data.pending_count })}</button>}{draftMode && <button className="btn" onClick={() => void approveAll()}>{t("regwatch.approveAll")}</button>}<button className="btn-secondary" disabled={fetchingTfda} onClick={() => void fetchTfda()}>{t(fetchingTfda ? "regwatch.tfdaFetching" : "regwatch.tfdaFetch")}</button><button className="btn-secondary" onClick={() => setAiOpen(true)}>{t("regwatch.aiImport")}</button><button className="btn" onClick={() => setEditing("new")}>{t("regwatch.new")}</button></div>} />
    {toast && <div className="fixed right-5 top-20 z-50 max-w-lg rounded-lg bg-ok px-4 py-3 text-sm text-white shadow-lg" role="status">{toast}</div>}
    <section data-tour="regwatch" className="panel mb-5 flex flex-wrap gap-3"><select value={filters.product_line} onChange={(event) => changeFilter("product_line", event.target.value)}><option value="">{t("regwatch.allProducts")}</option>{productLines.map((value) => <option key={value}>{value}</option>)}</select><select value={filters.entry_type} onChange={(event) => changeFilter("entry_type", event.target.value)}><option value="">{t("regwatch.allTypes")}</option><option value="announcement">{t("regwatch.announcement")}</option><option value="meeting">{t("regwatch.meeting")}</option></select><input className="w-28" inputMode="numeric" placeholder={t("regwatch.year")} value={filters.year} onChange={(event) => changeFilter("year", event.target.value)} /><input className="min-w-52 flex-1" placeholder={t("regwatch.search")} value={filters.keyword} onChange={(event) => changeFilter("keyword", event.target.value)} /></section>
    <section className="space-y-3">{data.entries.map((item) => { const open = expanded.has(item.id); return <article className={`panel ${item.status === "draft" ? "border-warn" : ""}`} key={item.id}><div className="flex items-start gap-2"><button className="min-w-0 flex-1 text-left" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-star-dim">{t("regwatch.announcedDate")}：{item.entry_date} · {t(item.entry_type === "announcement" ? "regwatch.announcement" : "regwatch.meeting")}</p><h2 className="mt-1 font-bold">{item.title}</h2><div className="mt-2 flex flex-wrap gap-2">{item.status === "draft" && <span className="badge border-warn text-warn">{t("regwatch.tfdaDraft")}</span>}<span className="badge">{item.product_line}</span>{item.category && <span className="badge">{item.category}</span>}{item.files.length > 0 && <span className="badge">{t("regwatch.attachmentCount", { count: item.files.length })}</span>}</div></div><span className="text-psi">{t(open ? "common.collapse" : "common.expand")}</span></div></button>{data.can_manage && <button type="button" className="regwatch-row-delete" data-regwatch-row-delete aria-label={t("common.delete")} title={t("common.delete")} onClick={(event) => { event.stopPropagation(); void remove(item); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>}</div>{open && <div className="mt-4 border-t border-nexus-line pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-star-dim">{item.key_points || t("regwatch.noPoints")}</p><div className="mt-3 flex flex-wrap gap-4">{item.link && <a className="text-sm text-psi underline" href={item.link} target="_blank" rel="noreferrer">{t("regwatch.openSource")}</a>}{item.files.map((file) => <a className="text-sm text-psi underline" href={`/api/files/${file.id}/download`} key={file.id}>{t("regwatch.downloadNamedSource", { name: file.filename })}</a>)}</div><p className="mt-3 text-xs text-star-dim">{t("common.createdBy", { name: item.created_by_name })}</p>{data.can_manage && <div className="mt-4 flex gap-3">{item.status === "draft" && <button className="btn" onClick={() => void approve(item)}>{t("regwatch.approve")}</button>}<button className="btn-secondary" onClick={() => setEditing(item)}>{t("common.edit")}</button><button className="btn-danger" onClick={() => void remove(item)}>{t("common.delete")}</button></div>}</div>}</article>; })}{data.entries.length === 0 && <Empty>{t(draftMode ? "regwatch.noDrafts" : "regwatch.empty")}</Empty>}</section>
    {data.total_pages > 1 && <div className="mt-5 flex items-center justify-center gap-3"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.previous")}</button><span className="text-sm text-star-dim">{t("common.pageSummary", { page: data.page, pages: data.total_pages, total: data.total })}</span><button className="btn-secondary" disabled={page >= data.total_pages} onClick={() => setPage(page + 1)}>{t("common.next")}</button></div>}
    {editing && <div className="fixed inset-0 z-50 flex justify-end bg-void/80" onMouseDown={() => setEditing(null)}><aside className="panel h-full w-full max-w-xl overflow-y-auto p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="regwatch-drawer-title" onMouseDown={(event) => event.stopPropagation()}><header className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold" id="regwatch-drawer-title">{t(editing === "new" ? "regwatch.newTitle" : "regwatch.editTitle")}</h2><button className="btn-secondary" onClick={() => setEditing(null)}>{t("common.close")}</button></header><RegwatchForm item={editing === "new" ? null : editing} onSubmit={save} /></aside></div>}
    {aiOpen && <AiImportDrawer onClose={() => setAiOpen(false)} onImported={load} />}
  </>;
}

function AiImportDrawer({ onClose, onImported }: { onClose(): void; onImported(): Promise<void> | void }) {
  const t = useT();
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [extractMode, setExtractMode] = useState<"single" | "multi">("single");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sourceLink, setSourceLink] = useState("");
  const [entries, setEntries] = useState<ExtractedEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const extract = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const options: RequestInit = { method: "POST" };
      if (sourceMode === "file") {
        if (!files.length) throw new Error(t("regwatch.fileRequired"));
        if (files.length > maxFiles || files.some((file) => file.size > maxFileBytes) || files.reduce((total, file) => total + file.size, 0) > maxTotalFileBytes) throw new Error(t("regwatch.fileLimits"));
        const form = new FormData(); files.forEach((file) => form.append("files", file)); form.set("mode", extractMode); if (sourceLink.trim()) form.set("source_link", sourceLink.trim()); options.body = form;
      } else options.body = JSON.stringify({ text, source_link: sourceLink.trim() || undefined, mode: extractMode });
      const response = await api<{ entries: Omit<ExtractedEntry, "included">[] }>("/regwatch/ai-extract", options);
      setEntries(response.entries.map((entry) => ({ ...entry, included: true })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("regwatch.parseFailed")); }
    finally { setBusy(false); }
  };
  const update = (index: number, key: keyof ExtractedEntry, value: string | boolean) => setEntries((current) => current.map((entry, itemIndex) => {
    if (itemIndex !== index) return entry;
    if (key === "entry_date") return { ...entry, entry_date: String(value), date_suspect: dateSuspect(String(value)) };
    return { ...entry, [key]: value };
  }));
  const submit = async () => {
    const selected = entries.filter((entry) => entry.included).map(({ included: _included, duplicate: _duplicate, ...entry }) => entry);
    if (!selected.length) { setError(t("regwatch.keepOne")); return; }
    setBusy(true); setError("");
    try {
      const options: RequestInit = { method: "POST" };
      if (sourceMode === "file" && files.length) { const form = new FormData(); form.set("entries", JSON.stringify(selected)); files.forEach((file) => form.append("files", file)); options.body = form; }
      else options.body = JSON.stringify({ entries: selected });
      const response = await api<{ created: number; skipped: number }>("/regwatch/batch", options);
      setResult(response); await onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("regwatch.batchFailed")); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-void/80"><aside className="panel h-full w-full max-w-6xl overflow-y-auto p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ai-import-title"><header className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold" id="ai-import-title">{t("regwatch.aiTitle")}</h2><p className="mt-1 text-sm text-star-dim">{t("regwatch.aiIntro")}</p></div><button className="btn-secondary" onClick={onClose}>{t("common.close")}</button></header>
    {!entries.length && <form className="space-y-4" onSubmit={(event) => void extract(event)}><fieldset><legend className="label">{t("regwatch.mode")}</legend><div className="grid gap-3 sm:grid-cols-2"><label className="panel flex cursor-pointer items-start gap-3 p-4"><input type="radio" name="extract-mode" value="single" checked={extractMode === "single"} onChange={() => setExtractMode("single")} /><span><strong className="block">{t("regwatch.single")}</strong><span className="mt-1 block text-xs text-star-dim">{t("regwatch.singleText")}</span></span></label><label className="panel flex cursor-pointer items-start gap-3 p-4"><input type="radio" name="extract-mode" value="multi" checked={extractMode === "multi"} onChange={() => setExtractMode("multi")} /><span><strong className="block">{t("regwatch.multi")}</strong><span className="mt-1 block text-xs text-star-dim">{t("regwatch.multiText")}</span></span></label></div></fieldset><div className="flex gap-3"><button type="button" className={sourceMode === "text" ? "btn" : "btn-secondary"} onClick={() => { setSourceMode("text"); setFiles([]); }}>{t("regwatch.paste")}</button><button type="button" className={sourceMode === "file" ? "btn" : "btn-secondary"} onClick={() => { setSourceMode("file"); setText(""); }}>{t("regwatch.upload")}</button></div>{sourceMode === "text" ? <textarea className="min-h-72 w-full" value={text} onChange={(event) => setText(event.target.value)} placeholder={t("regwatch.pastePlaceholder")} required /> : <div className="space-y-3"><input className="w-full" type="file" accept=".txt,.pdf,text/plain,application/pdf" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><p className="text-xs text-star-dim">{t("regwatch.fileLimits")}</p>{files.length > 0 && <ul className="space-y-2">{files.map((file, index) => <li className="flex items-center justify-between gap-3 rounded border border-nexus-line px-3 py-2 text-sm" key={`${file.name}-${file.size}-${file.lastModified}`}><span className="truncate">{file.name} · {(file.size / 1024).toFixed(1)} KB</span><button className="text-danger underline" type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t("common.remove")}</button></li>)}</ul>}</div>}<div><label className="label">{t("regwatch.sourceLink")}</label><input className="w-full" type="url" value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} placeholder="https://..." /></div><button className="btn" disabled={busy}>{t(busy ? "regwatch.parsing" : "regwatch.startParsing")}</button></form>}
    {entries.length > 0 && !result && <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-star-dim">{t("regwatch.previewSummary", { count: entries.length })}</p><button className="btn-secondary" onClick={() => setEntries([])}>{t("regwatch.restart")}</button></div><div className="overflow-x-auto"><table className="min-w-[1100px] text-sm"><thead><tr><th>{t("regwatch.import")}</th><th>{t("regwatch.announcedDate")}</th><th>{t("common.type")}</th><th>{t("regwatch.productLine")}</th><th>{t("common.category")}</th><th>{t("common.title")}</th><th>{t("regwatch.keyPoints")}</th></tr></thead><tbody>{entries.map((entry, index) => <tr className={entry.duplicate ? "border-danger/60 bg-danger/5" : entry.date_suspect ? "border-warn/60 bg-warn/5" : ""} key={`${entry.entry_date}-${index}`}><td><input type="checkbox" checked={entry.included} onChange={(event) => update(index, "included", event.target.checked)} />{entry.duplicate && <span className="mt-1 block text-xs text-danger">{t("regwatch.duplicate")}</span>}</td><td><input className="w-36" type="date" value={entry.entry_date} onChange={(event) => update(index, "entry_date", event.target.value)} />{entry.date_suspect && <span className="mt-1 block max-w-40 text-xs text-warn">{t("regwatch.dateSuspect")}</span>}</td><td><select value={entry.entry_type} onChange={(event) => update(index, "entry_type", event.target.value)}><option value="announcement">{t("regwatch.announcement")}</option><option value="meeting">{t("regwatch.meeting")}</option></select></td><td><select value={entry.product_line} onChange={(event) => update(index, "product_line", event.target.value)}>{productLines.map((value) => <option key={value}>{value}</option>)}</select></td><td><input className="w-28" maxLength={10} value={entry.category} onChange={(event) => update(index, "category", event.target.value)} /></td><td><textarea className="min-h-24 w-64" maxLength={100} value={entry.title} onChange={(event) => update(index, "title", event.target.value)} /></td><td><textarea className="min-h-24 w-80" value={entry.key_points} onChange={(event) => update(index, "key_points", event.target.value)} /></td></tr>)}</tbody></table></div><button className="btn mt-5" disabled={busy} onClick={() => void submit()}>{t(busy ? "regwatch.importing" : "regwatch.confirmImport")}</button></>}
    {result && <div className="panel border-ok"><h3 className="font-bold text-ok">{t("regwatch.importDone")}</h3><p className="mt-2">{t("regwatch.importResult", result)}</p><button className="btn mt-4" onClick={onClose}>{t("regwatch.back")}</button></div>}{error && <div className="mt-4"><ErrorBox message={error} /></div>}
  </aside></div>;
}

function RegwatchForm({ item, onSubmit }: { item: RegEntry | null; onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> }) {
  const t = useT();
  return <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}><div><label className="label">{t("regwatch.announcedDate")}</label><input className="w-full" name="entry_date" type="date" defaultValue={item?.entry_date ?? today()} required /></div><div><label className="label">{t("common.type")}</label><select className="w-full" name="entry_type" defaultValue={item?.entry_type ?? "announcement"}><option value="announcement">{t("regwatch.announcement")}</option><option value="meeting">{t("regwatch.meeting")}</option></select></div><div><label className="label">{t("regwatch.productLine")}</label><select className="w-full" name="product_line" defaultValue={item?.product_line ?? "藥品"}>{productLines.map((value) => <option key={value}>{value}</option>)}</select></div><div><label className="label">{t("common.category")}</label><input className="w-full" name="category" defaultValue={item?.category ?? ""} placeholder={t("regwatch.freeTag")} /></div><div><label className="label">{t("common.title")}</label><input className="w-full" name="title" defaultValue={item?.title ?? ""} required /></div><div><label className="label">{t("regwatch.keyPoints")}</label><textarea className="min-h-40 w-full" name="key_points" defaultValue={item?.key_points ?? ""} /></div><div><label className="label">{t("regwatch.link")}</label><input className="w-full" name="link" type="url" defaultValue={item?.link ?? ""} /></div><button className="btn w-full">{t(item ? "regwatch.saveChanges" : "common.add")}</button></form>;
}
