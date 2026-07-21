import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatDate } from "../api";
import { Empty, ErrorBox, Loading } from "./UI";
import type { CcrEvent, CcrRecord, CcrStatus, License } from "../types";

const nextStatuses: Record<CcrStatus, CcrStatus[]> = { 申請: ["評估中"], 評估中: ["已核准", "駁回"], 已核准: ["執行中"], 執行中: ["效期確認"], 效期確認: ["已結案"], 已結案: [], 駁回: [] };

function daysRemaining(expiresAt: string, base: string): number {
  return Math.round((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000);
}

function ExpiryBadge({ expiresAt, base }: { expiresAt: string; base: string }) {
  const days = daysRemaining(expiresAt, base);
  const style = days < 0 ? "border-danger bg-danger/20 text-danger" : days <= 30 ? "border-danger text-danger" : days <= 90 ? "border-warn text-warn" : days <= 180 ? "border-gold text-gold-bright" : "border-ok text-ok";
  return <span className={`badge border ${style}`}>{days < 0 ? "已過期" : `剩 ${days} 天`}</span>;
}

export function QaPanel({ projectId }: { projectId: string }) {
  const [section, setSection] = useState<"licenses" | "ccr">("licenses");
  return <div className="space-y-5"><div className="flex gap-2"><button className={section === "licenses" ? "btn" : "btn-secondary"} onClick={() => setSection("licenses")}>證照與系統效期</button><button className={section === "ccr" ? "btn" : "btn-secondary"} onClick={() => setSection("ccr")}>CCR 變更管制</button></div>{section === "licenses" ? <Licenses projectId={projectId} /> : <CcrRegistry projectId={projectId} />}</div>;
}

function Licenses({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ licenses: License[]; can_edit: boolean; today: string } | null>(null);
  const [editing, setEditing] = useState<License | null>(null);
  const [error, setError] = useState("");
  const load = () => api<{ licenses: License[]; can_edit: boolean; today: string }>(`/projects/${projectId}/licenses`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "載入失敗"));
  useEffect(() => { void load(); }, [projectId]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    await api(editing ? `/licenses/${editing.id}` : `/projects/${projectId}/licenses`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(values), headers: editing ? { "Content-Type": "application/json" } : undefined });
    setEditing(null); event.currentTarget.reset(); await load();
  };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <div className="space-y-5">{data.can_edit && <form key={editing?.id ?? "new"} className="panel grid gap-3 md:grid-cols-4" onSubmit={save}><h2 className="font-bold md:col-span-4">{editing ? `編輯 ${editing.name}` : "新增效期紀錄"}</h2><input name="name" placeholder="名稱" defaultValue={editing?.name} required /><input name="subject" placeholder="標的（公司／廠／產品）" defaultValue={editing?.subject} required /><input name="authority" placeholder="主管機關" defaultValue={editing?.authority ?? "TFDA"} required /><input name="license_no" placeholder="證號" defaultValue={editing?.license_no ?? ""} /><input name="issued_at" type="date" defaultValue={editing?.issued_at ?? ""} /><input name="expires_at" type="date" defaultValue={editing?.expires_at} required /><select name="status" defaultValue={editing?.status ?? "有效"}><option>有效</option><option>換證中</option><option>已過期</option><option>已停用</option></select><input name="note" placeholder="備註" defaultValue={editing?.note} /><div className="flex gap-2 md:col-span-4"><button className="btn">{editing ? "儲存" : "新增"}</button>{editing && <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>取消</button>}</div></form>}
    <section className="panel overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">名稱／標的</th><th>主管機關</th><th>證號</th><th>效期迄日</th><th>狀態</th><th>備註</th>{data.can_edit && <th>操作</th>}</tr></thead><tbody>{data.licenses.map((item) => <tr className="border-b border-nexus-line" key={item.id}><td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.subject}</p></td><td>{item.authority}</td><td>{item.license_no || "—"}</td><td><div className="flex items-center gap-2">{item.expires_at}<ExpiryBadge expiresAt={item.expires_at} base={data.today} /></div></td><td>{item.status}</td><td className="max-w-56 whitespace-pre-wrap">{item.note || "—"}</td>{data.can_edit && <td className="space-x-2"><button className="text-psi" onClick={() => setEditing(item)}>編輯</button><button className="text-danger" onClick={() => { if (window.confirm(`刪除 ${item.name}？`)) void api(`/licenses/${item.id}`, { method: "DELETE" }).then(load); }}>刪除</button></td>}</tr>)}</tbody></table>{data.licenses.length === 0 && <Empty>尚無效期紀錄</Empty>}</section>
  </div>;
}

function CcrRegistry({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ ccrs: CcrRecord[]; events: CcrEvent[]; can_edit: boolean; can_reopen: boolean } | null>(null);
  const [filters, setFilters] = useState({ status: "", classification: "", target_type: "", keyword: "" });
  const [error, setError] = useState("");
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString(), [filters]);
  const load = () => api<{ ccrs: CcrRecord[]; events: CcrEvent[]; can_edit: boolean; can_reopen: boolean }>(`/projects/${projectId}/ccrs${query ? `?${query}` : ""}`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : "載入失敗"));
  useEffect(() => { void load(); }, [projectId, query]);
  const create = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await api(`/projects/${projectId}/ccrs`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.reset(); await load(); };
  const transition = async (item: CcrRecord, status: CcrStatus) => { const description = window.prompt(`將 ${item.ccr_no} 變更為「${status}」；可輸入說明`, "") ?? undefined; if (description === undefined) return; await api(`/ccrs/${item.id}/transition`, { method: "POST", body: JSON.stringify({ status, description }) }); await load(); };
  const addNote = async (id: string) => { const description = window.prompt("輸入 CCR 備註"); if (!description?.trim()) return; await api(`/ccrs/${id}/events`, { method: "POST", body: JSON.stringify({ description }) }); await load(); };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <div className="space-y-5">{data.can_edit && <form className="panel grid gap-3 md:grid-cols-3" onSubmit={create}><h2 className="font-bold md:col-span-3">新增 CCR</h2><input name="title" placeholder="標題" required /><select name="target_type"><option>產品</option><option>文件</option><option>供應商</option><option>製程</option><option>設備</option><option>其他</option></select><select name="classification"><option>次要</option><option>重大</option></select><textarea className="min-h-24" name="description" placeholder="變更說明" required /><textarea className="min-h-24" name="reason" placeholder="原因" required /><textarea className="min-h-24" name="impact_assessment" placeholder="影響評估" /><button className="btn md:col-span-3">建立 CCR</button></form>}
    <section className="panel"><div className="mb-4 flex flex-wrap items-end gap-3"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">全部狀態</option>{["申請", "評估中", "已核准", "執行中", "效期確認", "已結案", "駁回"].map((value) => <option key={value}>{value}</option>)}</select><select value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value })}><option value="">全部分級</option><option>重大</option><option>次要</option></select><select value={filters.target_type} onChange={(e) => setFilters({ ...filters, target_type: e.target.value })}><option value="">全部標的</option>{["產品", "文件", "供應商", "製程", "設備", "其他"].map((value) => <option key={value}>{value}</option>)}</select><input placeholder="關鍵字" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} /><a className="btn-secondary ml-auto" href={`/api/projects/${projectId}/ccrs/export`}>匯出 CSV</a></div>
      <div className="space-y-4">{data.ccrs.map((item) => <article className="border border-nexus-line p-4" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-psi">{item.ccr_no}</p><h3 className="mt-1 font-bold">{item.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-star-dim">{item.description}</p></div><div className="flex gap-2"><span className="badge">{item.classification}</span><span className="badge">{item.status}</span></div></div><dl className="mt-4 grid gap-3 text-sm md:grid-cols-3"><div><dt className="text-star-dim">標的</dt><dd>{item.target_type}</dd></div><div><dt className="text-star-dim">申請人</dt><dd>{item.requested_by_name}</dd></div><div><dt className="text-star-dim">申請時間</dt><dd>{formatDate(item.requested_at, true)}</dd></div><div className="md:col-span-3"><dt className="text-star-dim">原因／影響</dt><dd className="whitespace-pre-wrap">{item.reason}{item.impact_assessment ? `\n${item.impact_assessment}` : ""}</dd></div></dl>{data.can_edit && <div className="mt-4 flex flex-wrap gap-2">{nextStatuses[item.status].map((status) => <button className={status === "駁回" ? "btn-danger" : "btn"} key={status} onClick={() => void transition(item, status)}>{status}</button>)}{data.can_reopen && (item.status === "已結案" || item.status === "駁回") && <button className="btn-secondary" onClick={() => void transition(item, "評估中")}>管理員重開</button>}<button className="btn-secondary" onClick={() => void addNote(item.id)}>新增備註</button></div>}<div className="mt-4 border-l-2 border-gold-dim pl-4">{data.events.filter((event) => event.ccr_id === item.id).map((event) => <div className="mb-3" key={event.id}><p className="text-sm">{event.event_type}{event.to_status ? `：${event.from_status ?? "建立"} → ${event.to_status}` : ""}</p><p className="text-xs text-star-dim">{event.description} · {event.created_by_name} · {formatDate(event.created_at, true)}</p></div>)}</div></article>)}{data.ccrs.length === 0 && <Empty>尚無符合條件的 CCR</Empty>}</div>
    </section>
  </div>;
}
