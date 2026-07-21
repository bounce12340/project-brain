import { useEffect, useMemo, useState, type FormEvent } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, patchBody } from "../api";
import type { KeyResult, Metadata } from "../types";
import { Empty, ErrorBox, Loading } from "./UI";

function currentQuarter(): string { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric" }).formatToParts(); const year = Number(parts.find((part) => part.type === "year")?.value); const month = Number(parts.find((part) => part.type === "month")?.value); return `${year}Q${Math.floor((month - 1) / 3) + 1}`; }
function quarterOptions(): string[] { const now = currentQuarter(); const year = Number(now.slice(0, 4)); return Array.from({ length: 12 }, (_, index) => `${year - 1 + Math.floor(index / 4)}Q${index % 4 + 1}`); }

export function OkrPanel({ projectId, metadata, onChanged }: { projectId: string; metadata: Metadata | null; onChanged(): void }) {
  const [quarter, setQuarter] = useState(currentQuarter());
  const [data, setData] = useState<{ objective: { objective: string } | null; key_results: KeyResult[]; can_edit: boolean } | null>(null);
  const [error, setError] = useState("");
  const load = () => api<{ objective: { objective: string } | null; key_results: KeyResult[]; can_edit: boolean }>(`/projects/${projectId}/okr?quarter=${quarter}`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "OKR 載入失敗"));
  useEffect(() => { void load(); }, [projectId, quarter]);
  const ids = useMemo(() => data?.key_results.map((item) => item.id) ?? [], [data]);
  const saveObjective = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await api(`/projects/${projectId}/quarter-goals/${quarter}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await load(); };
  const createKr = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await api(`/projects/${projectId}/key-results`, { method: "POST", body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)), quarter }) }); event.currentTarget.reset(); await load(); onChanged(); };
  const update = async (id: string, patch: Record<string, unknown>) => { await api(`/key-results/${id}`, patchBody(patch)); await load(); onChanged(); };
  const remove = async (id: string) => { await api(`/key-results/${id}`, { method: "DELETE" }); await load(); onChanged(); };
  const dragEnd = async ({ active, over }: DragEndEvent) => { if (!data || !over || active.id === over.id) return; const from = ids.indexOf(String(active.id)); const to = ids.indexOf(String(over.id)); const ordered = arrayMove(data.key_results, from, to); setData({ ...data, key_results: ordered }); await api(`/projects/${projectId}/key-results/reorder`, { method: "POST", body: JSON.stringify({ ids: ordered.map((item) => item.id) }) }); };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <section className="panel mt-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">OKR</h2><p className="text-sm text-star-dim">季度目標與可衡量的 Key Results</p></div><select value={quarter} onChange={(event) => setQuarter(event.target.value)}>{quarterOptions().map((value) => <option key={value}>{value}</option>)}</select></div>
    {data.can_edit ? <form className="mb-5 flex gap-2" key={`${quarter}-${data.objective?.objective ?? ""}`} onSubmit={saveObjective}><input className="min-w-0 flex-1" name="objective" defaultValue={data.objective?.objective ?? ""} placeholder="本季一句 objective" required /><button className="btn">儲存目標</button></form> : <p className="mb-5 text-sm text-star-dim">{data.objective?.objective || "尚未設定本季目標"}</p>}
    <DndContext collisionDetection={closestCenter} onDragEnd={(event) => void dragEnd(event)}><SortableContext items={ids} strategy={verticalListSortingStrategy}><div className="space-y-2">{data.key_results.map((item) => <SortableKr key={item.id} item={item} canEdit={data.can_edit} onUpdate={update} onRemove={remove} />)}{data.key_results.length === 0 && <Empty>本季尚無 KR</Empty>}</div></SortableContext></DndContext>
    {data.can_edit && <form className="mt-5 grid gap-3 md:grid-cols-4" onSubmit={createKr}><input name="title" placeholder="新增 Key Result" required /><select name="owner_id"><option value="">未指定負責人</option>{metadata?.users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select><select name="status"><option>未開始</option><option>進行中</option><option>完成</option><option>暫停</option></select><input name="note" placeholder="備註" /><button className="btn md:col-span-4">新增 KR</button></form>}
  </section>;
}

function SortableKr({ item, canEdit, onUpdate, onRemove }: { item: KeyResult; canEdit: boolean; onUpdate(id: string, patch: Record<string, unknown>): Promise<void>; onRemove(id: string): Promise<void> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canEdit });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex flex-wrap items-center gap-3 border border-nexus-line p-3 ${isDragging ? "border-gold shadow-lg" : ""}`}><button type="button" className="cursor-grab text-star-dim" disabled={!canEdit} {...attributes} {...listeners} aria-label="拖拉排序">⋮⋮</button><input type="checkbox" checked={item.status === "完成"} disabled={!canEdit} onChange={(event) => void onUpdate(item.id, { status: event.target.checked ? "完成" : "進行中" })} /><div className="min-w-48 flex-1"><p className={item.status === "完成" ? "text-star-dim line-through" : "font-medium"}>{item.title}</p><p className="text-xs text-star-dim">{item.owner_name || "未指定負責人"}{item.note ? ` · ${item.note}` : ""}</p></div><select value={item.status} disabled={!canEdit} onChange={(event) => void onUpdate(item.id, { status: event.target.value })}><option>未開始</option><option>進行中</option><option>完成</option><option>暫停</option></select>{canEdit && <button className="text-danger" onClick={() => { if (window.confirm(`刪除 KR「${item.title}」？`)) void onRemove(item.id); }}>刪除</button>}</div>;
}
