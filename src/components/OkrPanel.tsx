import { useEffect, useMemo, useState, type FormEvent } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, patchBody } from "../api";
import type { KeyResult, Metadata } from "../types";
import { Empty, ErrorBox, Loading } from "./UI";
import { useT } from "../i18n/LangContext";
import { HelpTip } from "./HelpTip";
import type { TransKey } from "../i18n/translations";

function currentQuarter(): string { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "numeric" }).formatToParts(); const year = Number(parts.find((part) => part.type === "year")?.value); const month = Number(parts.find((part) => part.type === "month")?.value); return `${year}Q${Math.floor((month - 1) / 3) + 1}`; }
function quarterOptions(): string[] { const now = currentQuarter(); const year = Number(now.slice(0, 4)); return Array.from({ length: 12 }, (_, index) => `${year - 1 + Math.floor(index / 4)}Q${index % 4 + 1}`); }

export function OkrPanel({ projectId, metadata, onChanged }: { projectId: string; metadata: Metadata | null; onChanged(): void }) {
  const t = useT();
  const [quarter, setQuarter] = useState(currentQuarter());
  const [data, setData] = useState<{ objective: { objective: string } | null; key_results: KeyResult[]; can_edit: boolean } | null>(null);
  // 載入失敗會把整個面板換成錯誤訊息；寫入失敗不該這樣做——資料還在，只是這次動作沒成功。
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = () => api<{ objective: { objective: string } | null; key_results: KeyResult[]; can_edit: boolean }>(`/projects/${projectId}/okr?quarter=${quarter}`).then(setData).catch((cause) => setLoadError(cause instanceof Error ? cause.message : t("okr.loadFailed")));
  useEffect(() => { setSaved(false); void load(); }, [projectId, quarter]);
  const ids = useMemo(() => data?.key_results.map((item) => item.id) ?? [], [data]);

  // 每個寫入動作都走這裡。先前 saveObjective／update／remove／dragEnd 一律沒有 catch，
  // 失敗時 promise 靜靜地 reject，畫面完全不動——跟按鈕根本沒接上長得一模一樣。
  const run = async (operation: () => Promise<unknown>, failure: TransKey): Promise<boolean> => {
    setBusy(true); setActionError("");
    try { await operation(); return true; }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : t(failure)); return false; }
    finally { setBusy(false); }
  };

  const saveObjective = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)));
    // 存成功後輸入框的內容跟送出前一字不差，所以沒有這個提示就看不出到底存進去了沒有。
    setSaved(await run(async () => { await api(`/projects/${projectId}/quarter-goals/${quarter}`, { method: "PUT", body }); await load(); }, "error.save"));
  };
  const createKr = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget;
    const body = JSON.stringify({ ...Object.fromEntries(new FormData(form)), quarter });
    await run(async () => { await api(`/projects/${projectId}/key-results`, { method: "POST", body }); form.reset(); await load(); onChanged(); }, "error.create");
  };
  const update = async (id: string, patch: Record<string, unknown>) => { await run(async () => { await api(`/key-results/${id}`, patchBody(patch)); await load(); onChanged(); }, "error.update"); };
  const remove = async (id: string) => { await run(async () => { await api(`/key-results/${id}`, { method: "DELETE" }); await load(); onChanged(); }, "error.operation"); };
  const dragEnd = async ({ active, over }: DragEndEvent) => {
    if (!data || !over || active.id === over.id) return;
    const previous = data.key_results;
    const ordered = arrayMove(previous, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setData({ ...data, key_results: ordered });
    // 排序是先動畫面再送出。送出失敗就把順序放回去，否則畫面會顯示一個伺服器上不存在的排列。
    if (!await run(() => api(`/projects/${projectId}/key-results/reorder`, { method: "POST", body: JSON.stringify({ ids: ordered.map((item) => item.id) }) }), "error.update")) {
      setData((current) => current && { ...current, key_results: previous });
    }
  };
  if (loadError) return <ErrorBox message={loadError} />; if (!data) return <Loading />;
  return <section className="panel mt-6"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">OKR</h2><p className="text-sm text-star-dim">{t("okr.description")}</p></div><select aria-label={t("a11y.quarter")} value={quarter} onChange={(event) => setQuarter(event.target.value)}>{quarterOptions().map((value) => <option key={value}>{value}</option>)}</select></div>
    {actionError && <ErrorBox message={actionError} />}
    <div className="mb-2 text-sm font-semibold text-gold-bright">{t("okr.objectiveLabel")}<HelpTip topic="objective" /></div>
    {/* 一個專案的一個季度只會有一個目標——project_quarter_goals 上有 UNIQUE(project_id, quarter)，
        後端是 upsert，所以儲存是覆蓋而不是新增。先前目標只存在於輸入框裡，那個版面跟下方
        「新增 KR」的表單長得一樣，於是被讀成「新增一筆」，按完沒有出現新項目就像壞掉。
        現在把現行目標當成一句陳述顯示出來，按鈕也改口徑，讓「你在編輯唯一的一格」看得出來。 */}
    {data.objective?.objective
      ? <div className="mb-3 border border-gold-dim bg-void p-3">
        <p className="text-xs text-star-dim">{t("okr.objectiveCurrent", { quarter })}</p>
        <p className="mt-1 font-medium">{data.objective.objective}</p>
      </div>
      : <p className="mb-3 text-sm text-star-dim">{t("okr.noObjective")}</p>}
    {data.can_edit && <>
      <form className="flex flex-wrap items-center gap-2" key={`${quarter}-${data.objective?.objective ?? ""}`} onSubmit={saveObjective}>
        <input className="min-w-0 flex-1" name="objective" defaultValue={data.objective?.objective ?? ""} placeholder={t("okr.objectivePlaceholder")} required onChange={() => setSaved(false)} />
        <button className="btn" disabled={busy}>{t(busy ? "common.processing" : data.objective?.objective ? "okr.updateObjective" : "okr.saveObjective")}</button>
        {saved && <span className="text-sm text-gold-bright" role="status">{t("okr.saved")}</span>}
      </form>
      {data.objective?.objective && <p className="mt-2 text-xs text-star-dim">{t("okr.onePerQuarter")}</p>}
    </>}
    <div className="mb-2 mt-5 text-sm font-semibold text-gold-bright">{t("okr.keyResultsLabel")}<HelpTip topic="keyResults" /></div>
    <DndContext collisionDetection={closestCenter} onDragEnd={(event) => void dragEnd(event)}><SortableContext items={ids} strategy={verticalListSortingStrategy}><div className="space-y-2">{data.key_results.map((item) => <SortableKr key={item.id} item={item} canEdit={data.can_edit} onUpdate={update} onRemove={remove} />)}{data.key_results.length === 0 && <Empty>{t("okr.empty")}</Empty>}</div></SortableContext></DndContext>
    {data.can_edit && <form className="mt-5 grid gap-3 md:grid-cols-4" onSubmit={createKr}><input name="title" placeholder={t("okr.newKr")} required /><select aria-label={t("a11y.krOwner")} name="owner_id"><option value="">{t("okr.noOwner")}</option>{metadata?.users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select><select aria-label={t("a11y.krStatus")} name="status"><option value="未開始">{t("okr.notStarted")}</option><option value="進行中">{t("okr.inProgress")}</option><option value="完成">{t("okr.completed")}</option><option value="暫停">{t("okr.paused")}</option></select><input name="note" placeholder={t("common.notes")} /><button className="btn md:col-span-4" disabled={busy}>{t(busy ? "common.processing" : "okr.add")}</button></form>}
  </section>;
}

function SortableKr({ item, canEdit, onUpdate, onRemove }: { item: KeyResult; canEdit: boolean; onUpdate(id: string, patch: Record<string, unknown>): Promise<void>; onRemove(id: string): Promise<void> }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canEdit });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex flex-wrap items-center gap-3 border border-nexus-line p-3 ${isDragging ? "border-gold shadow-lg" : ""}`}><button type="button" className="cursor-grab text-star-dim" disabled={!canEdit} {...attributes} {...listeners} aria-label={t("okr.drag")}>⋮⋮</button><input aria-label={t("a11y.krDone", { title: item.title })} type="checkbox" checked={item.status === "完成"} disabled={!canEdit} onChange={(event) => void onUpdate(item.id, { status: event.target.checked ? "完成" : "進行中" })} /><div className="min-w-48 flex-1"><p className={item.status === "完成" ? "text-star-dim line-through" : "font-medium"}>{item.title}</p><p className="text-xs text-star-dim">{item.owner_name || t("okr.noOwner")}{item.note ? ` · ${item.note}` : ""}</p></div><select aria-label={t("a11y.krStatusOf", { title: item.title })} value={item.status} disabled={!canEdit} onChange={(event) => void onUpdate(item.id, { status: event.target.value })}><option value="未開始">{t("okr.notStarted")}</option><option value="進行中">{t("okr.inProgress")}</option><option value="完成">{t("okr.completed")}</option><option value="暫停">{t("okr.paused")}</option></select>{canEdit && <button aria-label={t("a11y.deleteNamed", { title: item.title })} className="text-danger" onClick={() => { if (window.confirm(t("okr.deleteConfirm", { title: item.title }))) void onRemove(item.id); }}>{t("common.delete")}</button>}</div>;
}
