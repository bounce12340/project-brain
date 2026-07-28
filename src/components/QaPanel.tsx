import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatDate } from "../api";
import { Empty, ErrorBox, Loading } from "./UI";
import type { CcrEvent, CcrRecord, CcrStatus, License } from "../types";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";

const nextStatuses: Record<CcrStatus, CcrStatus[]> = { 申請: ["評估中"], 評估中: ["已核准", "駁回"], 已核准: ["執行中"], 執行中: ["效期確認"], 效期確認: ["已結案"], 已結案: [], 駁回: [] };
const statusKeys: Record<CcrStatus, TransKey> = { 申請: "qa.status.applied", 評估中: "qa.status.evaluating", 已核准: "qa.status.approved", 執行中: "qa.status.executing", 效期確認: "qa.status.validity", 已結案: "qa.status.closed", 駁回: "qa.status.rejected" };
const targetKeys: Record<string, TransKey> = { 產品: "qa.product", 文件: "qa.document", 供應商: "qa.supplier", 製程: "qa.process", 設備: "qa.equipment", 其他: "qa.other" };

function daysRemaining(expiresAt: string, base: string): number {
  return Math.round((Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86_400_000);
}

function ExpiryBadge({ expiresAt, base }: { expiresAt: string; base: string }) {
  const t = useT();
  const days = daysRemaining(expiresAt, base);
  const style = days < 0 ? "border-danger bg-danger/20 text-danger" : days <= 30 ? "border-danger text-danger" : days <= 90 ? "border-warn text-warn" : days <= 180 ? "border-gold text-gold-bright" : "border-ok text-ok";
  return <span className={`badge border ${style}`}>{t(days < 0 ? "qa.expired" : "qa.daysRemaining", { days })}</span>;
}

export function QaPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const [section, setSection] = useState<"licenses" | "ccr">("licenses");
  return <div className="space-y-5"><div className="flex gap-2"><button className={section === "licenses" ? "btn" : "btn-secondary"} onClick={() => setSection("licenses")}>{t("qa.licenses")}</button><button className={section === "ccr" ? "btn" : "btn-secondary"} onClick={() => setSection("ccr")}>{t("qa.ccr")}</button></div>{section === "licenses" ? <Licenses projectId={projectId} /> : <CcrRegistry projectId={projectId} />}</div>;
}

function Licenses({ projectId }: { projectId: string }) {
  const t = useT();
  const [data, setData] = useState<{ licenses: License[]; can_edit: boolean; today: string } | null>(null);
  const [editing, setEditing] = useState<License | null>(null);
  const [error, setError] = useState("");
  const [licenseSubmitting, setLicenseSubmitting] = useState(false);
  const load = () => api<{ licenses: License[]; can_edit: boolean; today: string }>(`/projects/${projectId}/licenses`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("error.load")));
  useEffect(() => { void load(); }, [projectId]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); setLicenseSubmitting(true);
    try {
      await api(editing ? `/licenses/${editing.id}` : `/projects/${projectId}/licenses`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(values), headers: editing ? { "Content-Type": "application/json" } : undefined });
      setEditing(null); form.reset(); await load();
    } finally {
      setLicenseSubmitting(false);
    }
  };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <div className="space-y-5">{data.can_edit && <form key={editing?.id ?? "new"} className="panel grid gap-3 md:grid-cols-4" onSubmit={save}><h2 className="font-bold md:col-span-4">{editing ? t("qa.editExpiry", { name: editing.name }) : t("qa.newExpiry")}</h2><input name="name" placeholder={t("common.name")} defaultValue={editing?.name} required /><input name="subject" placeholder={t("qa.subjectPlaceholder")} defaultValue={editing?.subject} required /><input name="authority" placeholder={t("qa.authority")} defaultValue={editing?.authority ?? "TFDA"} required /><input name="license_no" placeholder={t("qa.licenseNo")} defaultValue={editing?.license_no ?? ""} /><input name="issued_at" type="date" defaultValue={editing?.issued_at ?? ""} /><input name="expires_at" type="date" defaultValue={editing?.expires_at} required /><select name="status" defaultValue={editing?.status ?? "有效"}><option value="有效">{t("qa.valid")}</option><option value="換證中">{t("qa.renewing")}</option><option value="已過期">{t("qa.expiredStatus")}</option><option value="已停用">{t("qa.disabledStatus")}</option></select><input name="note" placeholder={t("common.notes")} defaultValue={editing?.note} /><div className="flex gap-2 md:col-span-4"><button className="btn" disabled={licenseSubmitting}>{t(licenseSubmitting ? "common.processing" : editing ? "common.save" : "common.add")}</button>{editing && <button type="button" className="btn-secondary" disabled={licenseSubmitting} onClick={() => setEditing(null)}>{t("common.cancel")}</button>}</div></form>}
    <section className="panel overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("qa.nameSubject")}</th><th>{t("qa.authority")}</th><th>{t("qa.licenseNo")}</th><th>{t("qa.expiryDate")}</th><th>{t("common.status")}</th><th>{t("common.notes")}</th>{data.can_edit && <th>{t("common.actions")}</th>}</tr></thead><tbody>{data.licenses.map((item) => <tr className="border-b border-nexus-line" key={item.id}><td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.subject}</p></td><td>{item.authority}</td><td>{item.license_no || "—"}</td><td><div className="flex items-center gap-2">{item.expires_at}<ExpiryBadge expiresAt={item.expires_at} base={data.today} /></div></td><td>{item.status}</td><td className="max-w-56 whitespace-pre-wrap">{item.note || "—"}</td>{data.can_edit && <td className="space-x-2"><button className="text-psi" onClick={() => setEditing(item)}>{t("common.edit")}</button><button className="text-danger" onClick={() => { if (window.confirm(t("files.deleteConfirm", { name: item.name }))) void api(`/licenses/${item.id}`, { method: "DELETE" }).then(load); }}>{t("common.delete")}</button></td>}</tr>)}</tbody></table>{data.licenses.length === 0 && <Empty>{t("qa.emptyExpiry")}</Empty>}</section>
  </div>;
}

function CcrRegistry({ projectId }: { projectId: string }) {
  const t = useT();
  const { lang } = useLang();
  const [data, setData] = useState<{ ccrs: CcrRecord[]; events: CcrEvent[]; can_edit: boolean; can_reopen: boolean } | null>(null);
  const [filters, setFilters] = useState({ status: "", classification: "", target_type: "", keyword: "" });
  const [error, setError] = useState("");
  const [ccrSubmitting, setCcrSubmitting] = useState(false);
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString(), [filters]);
  const statusLabel = (status: string | null | undefined) => status && status in statusKeys ? t(statusKeys[status as CcrStatus]) : t("qa.created");
  const load = () => api<{ ccrs: CcrRecord[]; events: CcrEvent[]; can_edit: boolean; can_reopen: boolean }>(`/projects/${projectId}/ccrs${query ? `?${query}` : ""}`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : t("error.load")));
  useEffect(() => { void load(); }, [projectId, query]);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; setCcrSubmitting(true);
    try { await api(`/projects/${projectId}/ccrs`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); await load(); }
    finally { setCcrSubmitting(false); }
  };
  const transition = async (item: CcrRecord, status: CcrStatus) => { const description = window.prompt(t("qa.transitionPrompt", { number: item.ccr_no, status: t(statusKeys[status]) }), "") ?? undefined; if (description === undefined) return; await api(`/ccrs/${item.id}/transition`, { method: "POST", body: JSON.stringify({ status, description }) }); await load(); };
  const addNote = async (id: string) => { const description = window.prompt(t("qa.notePrompt")); if (!description?.trim()) return; await api(`/ccrs/${id}/events`, { method: "POST", body: JSON.stringify({ description }) }); await load(); };
  if (error) return <ErrorBox message={error} />; if (!data) return <Loading />;
  return <div className="space-y-5">{data.can_edit && <form className="panel grid gap-3 md:grid-cols-3" onSubmit={create}><h2 className="font-bold md:col-span-3">{t("qa.newCcr")}</h2><input name="title" placeholder={t("common.title")} required /><select name="target_type">{Object.entries(targetKeys).map(([value, key]) => <option value={value} key={value}>{t(key)}</option>)}</select><select name="classification"><option value="次要">{t("qa.minor")}</option><option value="重大">{t("qa.major")}</option></select><textarea className="min-h-24" name="description" placeholder={t("qa.changeDescription")} required /><textarea className="min-h-24" name="reason" placeholder={t("qa.reason")} required /><textarea className="min-h-24" name="impact_assessment" placeholder={t("qa.impact")} /><button className="btn md:col-span-3" disabled={ccrSubmitting}>{t(ccrSubmitting ? "common.processing" : "qa.createCcr")}</button></form>}
    <section className="panel"><div className="mb-4 flex flex-wrap items-end gap-3"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{t("views.allStatuses")}</option>{(Object.keys(statusKeys) as CcrStatus[]).map((value) => <option value={value} key={value}>{t(statusKeys[value])}</option>)}</select><select value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value })}><option value="">{t("qa.allClassification")}</option><option value="重大">{t("qa.major")}</option><option value="次要">{t("qa.minor")}</option></select><select value={filters.target_type} onChange={(e) => setFilters({ ...filters, target_type: e.target.value })}><option value="">{t("qa.allTargets")}</option>{Object.entries(targetKeys).map(([value, key]) => <option value={value} key={value}>{t(key)}</option>)}</select><input placeholder={t("qa.keyword")} value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} /><a className="btn-secondary ml-auto" href={`/api/projects/${projectId}/ccrs/export`}>{t("qa.exportCsv")}</a></div>
      <div className="space-y-4">{data.ccrs.map((item) => <article className="border border-nexus-line p-4" key={item.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-psi">{item.ccr_no}</p><h3 className="mt-1 font-bold">{item.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm text-star-dim">{item.description}</p></div><div className="flex gap-2"><span className="badge">{t(item.classification === "重大" ? "qa.major" : "qa.minor")}</span><span className="badge">{t(statusKeys[item.status])}</span></div></div><dl className="mt-4 grid gap-3 text-sm md:grid-cols-3"><div><dt className="text-star-dim">{t("qa.target")}</dt><dd>{t(targetKeys[item.target_type] ?? "qa.other")}</dd></div><div><dt className="text-star-dim">{t("qa.requester")}</dt><dd>{item.requested_by_name}</dd></div><div><dt className="text-star-dim">{t("qa.requestedAt")}</dt><dd>{formatDate(item.requested_at, true, lang)}</dd></div><div className="md:col-span-3"><dt className="text-star-dim">{t("qa.reasonImpact")}</dt><dd className="whitespace-pre-wrap">{item.reason}{item.impact_assessment ? `\n${item.impact_assessment}` : ""}</dd></div></dl>{data.can_edit && <div className="mt-4 flex flex-wrap gap-2">{nextStatuses[item.status].map((status) => <button className={status === "駁回" ? "btn-danger" : "btn"} key={status} onClick={() => void transition(item, status)}>{t(statusKeys[status])}</button>)}{data.can_reopen && (item.status === "已結案" || item.status === "駁回") && <button className="btn-secondary" onClick={() => void transition(item, "評估中")}>{t("qa.reopen")}</button>}<button className="btn-secondary" onClick={() => void addNote(item.id)}>{t("qa.addNote")}</button></div>}<div className="mt-4 border-l-2 border-gold-dim pl-4">{data.events.filter((event) => event.ccr_id === item.id).map((event) => <div className="mb-3" key={event.id}><p className="text-sm">{event.event_type}{event.to_status ? `: ${statusLabel(event.from_status)} → ${statusLabel(event.to_status)}` : ""}</p><p className="text-xs text-star-dim">{event.description} · {event.created_by_name} · {formatDate(event.created_at, true, lang)}</p></div>)}</div></article>)}{data.ccrs.length === 0 && <Empty>{t("qa.emptyCcr")}</Empty>}</div>
    </section>
  </div>;
}
