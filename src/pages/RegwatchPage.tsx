import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, patchBody, today } from "../api";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import type { RegEntry } from "../types";

const productLines = ["藥品", "醫療器材", "化粧品", "健康食品", "食品", "再生醫療", "包裝容器", "寵物食品", "其他"];

export function RegwatchPage() {
  const [filters, setFilters] = useState({ product_line: "", entry_type: "", year: "", keyword: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: RegEntry[]; page: number; total: number; total_pages: number; can_manage: boolean } | null>(null);
  const [editing, setEditing] = useState<RegEntry | "new" | null>(null);
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
  return <><PageHeader title="法規動態" description="法規公告與外部會議資訊集中追蹤；全員皆可閱讀。" actions={data.can_manage && <button className="btn" onClick={() => setEditing("new")}>＋ 新增動態</button>} />
    <section data-tour="regwatch" className="panel mb-5 flex flex-wrap gap-3"><select value={filters.product_line} onChange={(event) => changeFilter("product_line", event.target.value)}><option value="">全部產品線</option>{productLines.map((value) => <option key={value}>{value}</option>)}</select><select value={filters.entry_type} onChange={(event) => changeFilter("entry_type", event.target.value)}><option value="">全部類型</option><option value="announcement">法規公告</option><option value="meeting">外部會議</option></select><input className="w-28" inputMode="numeric" placeholder="年份" value={filters.year} onChange={(event) => changeFilter("year", event.target.value)} /><input className="min-w-52 flex-1" placeholder="搜尋標題或重點" value={filters.keyword} onChange={(event) => changeFilter("keyword", event.target.value)} /></section>
    <section className="space-y-3">{data.entries.map((item) => { const open = expanded.has(item.id); return <article className="panel" key={item.id}><button className="w-full text-left" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-star-dim">{item.entry_date} · {item.entry_type === "announcement" ? "法規公告" : "外部會議"}</p><h2 className="mt-1 font-bold">{item.title}</h2><div className="mt-2 flex gap-2"><span className="badge">{item.product_line}</span>{item.category && <span className="badge">{item.category}</span>}</div></div><span className="text-psi">{open ? "收合" : "展開"}</span></div></button>{open && <div className="mt-4 border-t border-nexus-line pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-star-dim">{item.key_points || "未填重點"}</p>{item.link && <a className="mt-3 inline-block text-sm text-psi underline" href={item.link} target="_blank" rel="noreferrer">開啟來源連結</a>}<p className="mt-3 text-xs text-star-dim">建立者：{item.created_by_name}</p>{data.can_manage && <div className="mt-4 flex gap-3"><button className="btn-secondary" onClick={() => setEditing(item)}>編輯</button><button className="btn-danger" onClick={() => void remove(item)}>刪除</button></div>}</div>}</article>; })}{data.entries.length === 0 && <Empty>沒有符合條件的法規動態</Empty>}</section>
    {data.total_pages > 1 && <div className="mt-5 flex items-center justify-center gap-3"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</button><span className="text-sm text-star-dim">第 {data.page} / {data.total_pages} 頁，共 {data.total} 筆</span><button className="btn-secondary" disabled={page >= data.total_pages} onClick={() => setPage(page + 1)}>下一頁</button></div>}
    {editing && <div className="fixed inset-0 z-50 flex justify-end bg-void/80" onMouseDown={() => setEditing(null)}><aside className="panel h-full w-full max-w-xl overflow-y-auto p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="regwatch-drawer-title" onMouseDown={(event) => event.stopPropagation()}><header className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold" id="regwatch-drawer-title">{editing === "new" ? "新增法規動態" : "編輯法規動態"}</h2><button className="btn-secondary" onClick={() => setEditing(null)}>關閉</button></header><RegwatchForm item={editing === "new" ? null : editing} onSubmit={save} /></aside></div>}
  </>;
}

function RegwatchForm({ item, onSubmit }: { item: RegEntry | null; onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> }) {
  return <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}><div><label className="label">日期</label><input className="w-full" name="entry_date" type="date" defaultValue={item?.entry_date ?? today()} required /></div><div><label className="label">類型</label><select className="w-full" name="entry_type" defaultValue={item?.entry_type ?? "announcement"}><option value="announcement">法規公告</option><option value="meeting">外部會議</option></select></div><div><label className="label">產品線</label><select className="w-full" name="product_line" defaultValue={item?.product_line ?? "藥品"}>{productLines.map((value) => <option key={value}>{value}</option>)}</select></div><div><label className="label">類別</label><input className="w-full" name="category" defaultValue={item?.category ?? ""} placeholder="自由短標籤" /></div><div><label className="label">標題</label><input className="w-full" name="title" defaultValue={item?.title ?? ""} required /></div><div><label className="label">重點</label><textarea className="min-h-40 w-full" name="key_points" defaultValue={item?.key_points ?? ""} /></div><div><label className="label">連結</label><input className="w-full" name="link" type="url" defaultValue={item?.link ?? ""} /></div><button className="btn w-full">{item ? "儲存變更" : "新增"}</button></form>;
}
