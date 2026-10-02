import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatDate, jsonBody, patchBody } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorBox, Loading, PageHeader } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";

/** 聯絡人資料庫：外部醫院、公司的窗口。大家都能查看、新增與修改；刪除限建立的人與管理員。 */
interface Contact {
  id: string; organization: string; department: string; name: string; title: string;
  phone_area: string; phone: string; phone_ext: string; mobile: string; email: string; address: string; notes: string;
  created_by: string | null; created_by_name: string | null; updated_by_name: string | null; updated_at: string;
}
type Draft = Pick<Contact, "organization" | "department" | "name" | "title" | "phone_area" | "phone" | "phone_ext" | "mobile" | "email" | "address" | "notes">;
const EMPTY: Draft = { organization: "", department: "", name: "", title: "", phone_area: "", phone: "", phone_ext: "", mobile: "", email: "", address: "", notes: "" };
const FIELDS: ReadonlyArray<{ key: keyof Draft; label: TransKey; type?: string; max: number; required?: boolean; wide?: boolean; placeholder?: TransKey }> = [
  { key: "organization", label: "contacts.organization", max: 100, required: true, placeholder: "contacts.organizationPlaceholder" },
  { key: "department", label: "contacts.department", max: 100 },
  { key: "name", label: "contacts.name", max: 60, required: true },
  { key: "title", label: "contacts.jobTitle", max: 60 },
  { key: "phone", label: "contacts.phone", type: "tel", max: 60, placeholder: "contacts.phonePlaceholder" },
  { key: "mobile", label: "contacts.mobile", type: "tel", max: 60 },
  { key: "email", label: "contacts.email", type: "email", max: 200 },
  { key: "address", label: "contacts.address", max: 300, wide: true },
];

/** 「(02) 2312-3456 分機 35」：區碼放括號裡，有分機才接在後面；沒有的部分就不顯示。 */
export const formatPhone = (area: string, phone: string, ext = "", lang: "zh" | "en" = "zh") =>
  [area && `(${area})`, phone, ext && `${lang === "zh" ? "分機" : "ext."} ${ext}`].filter(Boolean).join(" ");
/** 撥號連結：區碼接號碼，分機用逗號（撥通後稍停再按分機）。 */
export const phoneHref = (area: string, phone: string, ext = "") => `tel:${`${area}${phone}`.replace(/[^\d+#,]/g, "")}${ext ? `,${ext}` : ""}`;

/** 全形半形、大小寫不影響搜尋。 */
const fold = (value: string) => value.normalize("NFKC").toLowerCase();

export function ContactsPage() {
  const t = useT(); const { lang } = useLang(); const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => api<{ contacts: Contact[] }>("/contacts").then((data) => setContacts(data.contacts)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t("error.operation")));
  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!contacts || !words.length) return contacts ?? [];
    return contacts.filter((contact) => { const text = fold([contact.organization, contact.department, contact.name, contact.title, contact.phone_area, contact.phone, contact.phone_ext, formatPhone(contact.phone_area, contact.phone, contact.phone_ext, lang), contact.mobile, contact.email, contact.address, contact.notes].join(" ")); return words.every((word) => text.includes(word)); });
  }, [contacts, query, lang]);

  // 編輯的卡片可能在很下面，表單在最上面：打開時捲過去並把游標放進第一格。
  const openForm = (id: string | null, draft: Draft) => { setError(""); setMessage(""); setEditing({ id, draft }); window.setTimeout(() => { document.getElementById("contact-form-title")?.scrollIntoView({ block: "start" }); document.getElementById("contact-organization")?.focus({ preventScroll: true }); }, 0); };
  const startNew = () => openForm(null, { ...EMPTY });
  const startEdit = (contact: Contact) => openForm(contact.id, Object.fromEntries(Object.keys(EMPTY).map((key) => [key, contact[key as keyof Draft] ?? ""])) as Draft);
  const setField = (key: keyof Draft, value: string) => setEditing((current) => current && { ...current, draft: { ...current.draft, [key]: value } });
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing) return; setBusy(true); setError("");
    try {
      if (editing.id) await api(`/contacts/${editing.id}`, patchBody(editing.draft)); else await api("/contacts", jsonBody(editing.draft));
      setMessage(t(editing.id ? "contacts.updated" : "contacts.added", { name: editing.draft.name.trim() })); setEditing(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); } finally { setBusy(false); }
  };
  const remove = async (contact: Contact) => {
    if (!window.confirm(t("contacts.deleteConfirm", { name: contact.name, organization: contact.organization }))) return;
    setError(""); setMessage("");
    try { await api(`/contacts/${contact.id}`, { method: "DELETE" }); setMessage(t("contacts.deleted", { name: contact.name })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); }
  };

  const form = editing && <form className="panel mb-6" onSubmit={save} aria-labelledby="contact-form-title">
    <h2 id="contact-form-title" className="mb-4 font-bold">{t(editing.id ? "contacts.editTitle" : "contacts.newTitle")}</h2>
    {/* grid-cols-1 讓欄寬可以縮：電話那列有三格，不設的話手機上會把表單撐出畫面。 */}
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {FIELDS.map((field) => field.key === "phone" ? <div key="phone" className="sm:col-span-2"><div className="flex items-end justify-between gap-2"><label className="label" htmlFor="contact-phone">{t("contacts.phone")}</label><label className="label whitespace-nowrap" htmlFor="contact-phone_ext">{t("contacts.phoneExt")}</label></div><div className="flex gap-2"><input id="contact-phone_area" aria-label={t("contacts.phoneArea")} className="w-16 shrink-0 sm:w-20" type="tel" inputMode="numeric" maxLength={8} placeholder={t("contacts.phoneAreaPlaceholder")} value={editing.draft.phone_area} onChange={(event) => setField("phone_area", event.target.value)} /><input id="contact-phone" className="min-w-0 flex-1" type="tel" maxLength={60} placeholder={t("contacts.phonePlaceholder")} value={editing.draft.phone} onChange={(event) => setField("phone", event.target.value)} /><input id="contact-phone_ext" className="w-[4.5rem] shrink-0 sm:w-24" type="tel" inputMode="numeric" maxLength={10} placeholder={t("contacts.phoneExtPlaceholder")} value={editing.draft.phone_ext} onChange={(event) => setField("phone_ext", event.target.value)} /></div></div> : <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}><label className="label" htmlFor={`contact-${field.key}`}>{t(field.label)}{field.required && <span className="text-danger"> *</span>}</label><input id={`contact-${field.key}`} className="w-full" type={field.type ?? "text"} maxLength={field.max} required={field.required} placeholder={field.placeholder ? t(field.placeholder) : undefined} value={editing.draft[field.key]} onChange={(event) => setField(field.key, event.target.value)} /></div>)}
      <div className="sm:col-span-2"><label className="label" htmlFor="contact-notes">{t("contacts.notes")}</label><textarea id="contact-notes" className="w-full" rows={3} maxLength={2000} placeholder={t("contacts.notesPlaceholder")} value={editing.draft.notes} onChange={(event) => setField("notes", event.target.value)} /></div>
    </div>
    {error && <div className="mt-4"><ErrorBox message={error} /></div>}
    <div className="mt-4 flex flex-wrap gap-2"><button className="btn" disabled={busy}>{t(busy ? "common.processing" : "common.save")}</button><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</button></div>
  </form>;

  return <>
    <PageHeader title={t("contacts.title")} description={t("contacts.description")} actions={!editing && <button className="btn" onClick={startNew}>{t("contacts.add")}</button>} />
    {error && !editing && <ErrorBox message={error} />}
    {message && <div role="status" className="mb-4 rounded-lg border border-ok bg-void p-3 text-sm text-ok">{message}</div>}
    {form}
    <div className="mb-4 flex flex-wrap items-center gap-3"><input aria-label={t("contacts.search")} className="min-w-0 flex-1" type="search" placeholder={t("contacts.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />{contacts && <span className="text-sm text-star-dim">{t(query.trim() ? "contacts.countFiltered" : "contacts.count", { shown: shown.length, total: contacts.length })}</span>}</div>
    {!contacts ? <Loading /> : !shown.length ? <Empty>{t(contacts.length ? "contacts.noMatch" : "contacts.empty")}</Empty> : <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {shown.map((contact) => <li key={contact.id} className="panel flex flex-col">
        <p className="text-xs font-semibold text-gold-bright break-words">{contact.organization}{contact.department && <span className="text-star-dim"> · {contact.department}</span>}</p>
        <h2 className="mt-1 text-lg font-bold break-words">{contact.name}{contact.title && <span className="ml-2 text-sm font-normal text-star-dim">{contact.title}</span>}</h2>
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
          {(contact.phone || contact.phone_area) && <><dt className="text-star-dim">{t("contacts.phone")}</dt><dd className="break-all"><a className="text-psi" href={phoneHref(contact.phone_area, contact.phone, contact.phone_ext)}>{formatPhone(contact.phone_area, contact.phone, contact.phone_ext, lang)}</a></dd></>}
          {contact.mobile && <><dt className="text-star-dim">{t("contacts.mobile")}</dt><dd className="break-all"><a className="text-psi" href={`tel:${contact.mobile.replace(/[^\d+]/g, "")}`}>{contact.mobile}</a></dd></>}
          {contact.email && <><dt className="text-star-dim">{t("contacts.email")}</dt><dd className="break-all"><a className="text-psi" href={`mailto:${contact.email}`}>{contact.email}</a></dd></>}
          {contact.address && <><dt className="text-star-dim">{t("contacts.address")}</dt><dd className="break-words">{contact.address}</dd></>}
        </dl>
        {contact.notes && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-star-dim">{contact.notes}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-star-dim">
          <span>{t("contacts.updatedBy", { name: contact.updated_by_name ?? contact.created_by_name ?? "—", date: formatDate(contact.updated_at, false, lang) })}</span>
          <span className="flex gap-3"><button className="font-semibold text-psi" aria-label={t("contacts.editNamed", { name: contact.name })} onClick={() => startEdit(contact)}>{t("common.edit")}</button>{(user?.role === "admin" || contact.created_by === user?.id) && <button className="font-semibold text-danger" aria-label={t("contacts.deleteNamed", { name: contact.name })} onClick={() => void remove(contact)}>{t("common.delete")}</button>}</span>
        </div>
      </li>)}
    </ul>}
  </>;
}
