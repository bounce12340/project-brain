import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import type { RegEntry } from "../types";

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
  included: boolean;
}

export function RegwatchPage() {
  const [filters, setFilters] = useState({ product_line: "", entry_type: "", year: "", keyword: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: RegEntry[]; page: number; total: number; total_pages: number; can_manage: boolean } | null>(null);
  const [editing, setEditing] = useState<RegEntry | "new" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const query = useMemo(() => new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page: String(page) }).toString(), [filters, page]);
  const load = () => api<{ entries: RegEntry[]; page: number; total: number; total_pages: number; can_manage: boolean }>(`/regwatch?${query}`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "載入法規動態失敗"));
  useEffect(() => { void load(); }, [query]);
  const changeFilter = (key: keyof typeof filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget));
    if (editing !== "new" && editing) await api(`/regwatch/${editing.id}`, patchBody(body));
    else await api("/regwatch", { method: "POST", body: JSON.stringify(body) });
    setEditing(null); await load();
  };
  const remove = async (item: RegEntry) => { if (!window.confirm(`刪除「${item.title}」？`)) return; await api(`/regwatch/${item.id}`, { method: "DELETE" }); await load(); };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <><PageHeader title="法規動態" description="法規公告與外部會議資訊集中追蹤；全員皆可閱讀。" actions={data.can_manage && <div className="flex gap-2"><button className="btn-secondary" onClick={() => setAiOpen(true)}>AI 匯入</button><button className="btn" onClick={() => setEditing("new")}>＋ 新增動態</button></div>} />
    <section data-tour="regwatch" className="panel mb-5 flex flex-wrap gap-3"><select value={filters.product_line} onChange={(event) => changeFilter("product_line", event.target.value)}><option value="">全部產品線</option>{productLines.map((value) => <option key={value}>{value}</option>)}</select><select value={filters.entry_type} onChange={(event) => changeFilter("entry_type", event.target.value)}><option value="">全部類型</option><option value="announcement">法規公告</option><option value="meeting">外部會議</option></select><input className="w-28" inputMode="numeric" placeholder="年份" value={filters.year} onChange={(event) => changeFilter("year", event.target.value)} /><input className="min-w-52 flex-1" placeholder="搜尋標題或重點" value={filters.keyword} onChange={(event) => changeFilter("keyword", event.target.value)} /></section>
    <section className="space-y-3">{data.entries.map((item) => { const open = expanded.has(item.id); return <article className="panel" key={item.id}><button className="w-full text-left" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-star-dim">{item.entry_date} · {item.entry_type === "announcement" ? "法規公告" : "外部會議"}</p><h2 className="mt-1 font-bold">{item.title}</h2><div className="mt-2 flex gap-2"><span className="badge">{item.product_line}</span>{item.category && <span className="badge">{item.category}</span>}</div></div><span className="text-psi">{open ? "收合" : "展開"}</span></div></button>{open && <div className="mt-4 border-t border-nexus-line pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-star-dim">{item.key_points || "未填重點"}</p><div className="mt-3 flex flex-wrap gap-4">{item.link && <a className="text-sm text-psi underline" href={item.link} target="_blank" rel="noreferrer">開啟來源連結</a>}{item.file_id && <a className="text-sm text-psi underline" href={`/api/files/${item.file_id}/download`}>下載原始檔</a>}</div><p className="mt-3 text-xs text-star-dim">建立者：{item.created_by_name}</p>{data.can_manage && <div className="mt-4 flex gap-3"><button className="btn-secondary" onClick={() => setEditing(item)}>編輯</button><button className="btn-danger" onClick={() => void remove(item)}>刪除</button></div>}</div>}</article>; })}{data.entries.length === 0 && <Empty>沒有符合條件的法規動態</Empty>}</section>
    {data.total_pages > 1 && <div className="mt-5 flex items-center justify-center gap-3"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</button><span className="text-sm text-star-dim">第 {data.page} / {data.total_pages} 頁，共 {data.total} 筆</span><button className="btn-secondary" disabled={page >= data.total_pages} onClick={() => setPage(page + 1)}>下一頁</button></div>}
    {editing && <div className="fixed inset-0 z-50 flex justify-end bg-void/80" onMouseDown={() => setEditing(null)}><aside className="panel h-full w-full max-w-xl overflow-y-auto p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="regwatch-drawer-title" onMouseDown={(event) => event.stopPropagation()}><header className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold" id="regwatch-drawer-title">{editing === "new" ? "新增法規動態" : "編輯法規動態"}</h2><button className="btn-secondary" onClick={() => setEditing(null)}>關閉</button></header><RegwatchForm item={editing === "new" ? null : editing} onSubmit={save} /></aside></div>}
    {aiOpen && <AiImportDrawer onClose={() => setAiOpen(false)} onImported={load} />}
  </>;
}

function AiImportDrawer({ onClose, onImported }: { onClose(): void; onImported(): Promise<void> | void }) {
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [extractMode, setExtractMode] = useState<"single" | "multi">("single");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
        if (!file) throw new Error("請選擇 .txt 或 .pdf 檔案");
        const form = new FormData(); form.set("file", file); form.set("mode", extractMode); if (sourceLink.trim()) form.set("source_link", sourceLink.trim()); options.body = form;
      } else options.body = JSON.stringify({ text, source_link: sourceLink.trim() || undefined, mode: extractMode });
      const response = await api<{ entries: Omit<ExtractedEntry, "included">[] }>("/regwatch/ai-extract", options);
      setEntries(response.entries.map((entry) => ({ ...entry, included: true })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 解析失敗"); }
    finally { setBusy(false); }
  };
  const update = (index: number, key: keyof ExtractedEntry, value: string | boolean) => setEntries((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, [key]: value } : entry));
  const submit = async () => {
    const selected = entries.filter((entry) => entry.included).map(({ included: _included, duplicate: _duplicate, ...entry }) => entry);
    if (!selected.length) { setError("請至少保留一筆條目"); return; }
    setBusy(true); setError("");
    try {
      const options: RequestInit = { method: "POST" };
      if (sourceMode === "file" && file) { const form = new FormData(); form.set("entries", JSON.stringify(selected)); form.set("file", file); options.body = form; }
      else options.body = JSON.stringify({ entries: selected });
      const response = await api<{ created: number; skipped: number }>("/regwatch/batch", options);
      setResult(response); await onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批次匯入失敗"); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-void/80"><aside className="panel h-full w-full max-w-6xl overflow-y-auto p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="ai-import-title"><header className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold" id="ai-import-title">法規動態 AI 匯入</h2><p className="mt-1 text-sm text-star-dim">貼上公告，或上傳單一 .txt／含文字層的 .pdf（上限 10 MB）。</p></div><button className="btn-secondary" onClick={onClose}>關閉</button></header>
    {!entries.length && <form className="space-y-4" onSubmit={(event) => void extract(event)}><fieldset><legend className="label">公告模式</legend><div className="grid gap-3 sm:grid-cols-2"><label className="panel flex cursor-pointer items-start gap-3 p-4"><input type="radio" name="extract-mode" value="single" checked={extractMode === "single"} onChange={() => setExtractMode("single")} /><span><strong className="block">單則公告（預設）</strong><span className="mt-1 block text-xs text-star-dim">整份內容匯成一筆，公告內項目整理在重點條列。</span></span></label><label className="panel flex cursor-pointer items-start gap-3 p-4"><input type="radio" name="extract-mode" value="multi" checked={extractMode === "multi"} onChange={() => setExtractMode("multi")} /><span><strong className="block">多則彙整</strong><span className="mt-1 block text-xs text-star-dim">只有不同日期或不同公告標題才拆成多筆。</span></span></label></div></fieldset><div className="flex gap-3"><button type="button" className={sourceMode === "text" ? "btn" : "btn-secondary"} onClick={() => setSourceMode("text")}>貼上文字</button><button type="button" className={sourceMode === "file" ? "btn" : "btn-secondary"} onClick={() => setSourceMode("file")}>上傳檔案</button></div>{sourceMode === "text" ? <textarea className="min-h-72 w-full" value={text} onChange={(event) => setText(event.target.value)} placeholder="貼上完整公告文字；多則彙整模式可一次包含多則公告。" required /> : <input className="w-full" type="file" accept=".txt,.pdf,text/plain,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />}<div><label className="label">來源連結（選填）</label><input className="w-full" type="url" value={sourceLink} onChange={(event) => setSourceLink(event.target.value)} placeholder="https://..." /></div><button className="btn" disabled={busy}>{busy ? "AI 解析中…" : "開始解析"}</button></form>}
    {entries.length > 0 && !result && <><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-star-dim">共 {entries.length} 筆；取消勾選可排除。標示撞鍵的資料送出後會略過。</p><button className="btn-secondary" onClick={() => setEntries([])}>重新輸入</button></div><div className="overflow-x-auto"><table className="min-w-[1100px] text-sm"><thead><tr><th>匯入</th><th>日期</th><th>類型</th><th>產品線</th><th>類別</th><th>標題</th><th>重點</th></tr></thead><tbody>{entries.map((entry, index) => <tr className={entry.duplicate ? "border-danger/60" : ""} key={`${entry.entry_date}-${index}`}><td><input type="checkbox" checked={entry.included} onChange={(event) => update(index, "included", event.target.checked)} />{entry.duplicate && <span className="mt-1 block text-xs text-danger">已存在，將略過</span>}</td><td><input className="w-36" type="date" value={entry.entry_date} onChange={(event) => update(index, "entry_date", event.target.value)} /></td><td><select value={entry.entry_type} onChange={(event) => update(index, "entry_type", event.target.value)}><option value="announcement">法規公告</option><option value="meeting">外部會議</option></select></td><td><select value={entry.product_line} onChange={(event) => update(index, "product_line", event.target.value)}>{productLines.map((value) => <option key={value}>{value}</option>)}</select></td><td><input className="w-28" maxLength={10} value={entry.category} onChange={(event) => update(index, "category", event.target.value)} /></td><td><textarea className="min-h-24 w-64" maxLength={100} value={entry.title} onChange={(event) => update(index, "title", event.target.value)} /></td><td><textarea className="min-h-24 w-80" value={entry.key_points} onChange={(event) => update(index, "key_points", event.target.value)} /></td></tr>)}</tbody></table></div><button className="btn mt-5" disabled={busy} onClick={() => void submit()}>{busy ? "匯入中…" : "確認匯入"}</button></>}
    {result && <div className="panel border-ok"><h3 className="font-bold text-ok">匯入完成</h3><p className="mt-2">建立 {result.created} 筆，略過 {result.skipped} 筆。</p><button className="btn mt-4" onClick={onClose}>返回列表</button></div>}{error && <div className="mt-4"><ErrorBox message={error} /></div>}
  </aside></div>;
}

function RegwatchForm({ item, onSubmit }: { item: RegEntry | null; onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> }) {
  return <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}><div><label className="label">日期</label><input className="w-full" name="entry_date" type="date" defaultValue={item?.entry_date ?? today()} required /></div><div><label className="label">類型</label><select className="w-full" name="entry_type" defaultValue={item?.entry_type ?? "announcement"}><option value="announcement">法規公告</option><option value="meeting">外部會議</option></select></div><div><label className="label">產品線</label><select className="w-full" name="product_line" defaultValue={item?.product_line ?? "藥品"}>{productLines.map((value) => <option key={value}>{value}</option>)}</select></div><div><label className="label">類別</label><input className="w-full" name="category" defaultValue={item?.category ?? ""} placeholder="自由短標籤" /></div><div><label className="label">標題</label><input className="w-full" name="title" defaultValue={item?.title ?? ""} required /></div><div><label className="label">重點</label><textarea className="min-h-40 w-full" name="key_points" defaultValue={item?.key_points ?? ""} /></div><div><label className="label">連結</label><input className="w-full" name="link" type="url" defaultValue={item?.link ?? ""} /></div><button className="btn w-full">{item ? "儲存變更" : "新增"}</button></form>;
}
