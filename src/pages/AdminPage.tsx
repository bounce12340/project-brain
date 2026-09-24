import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatDate, patchBody } from "../api";
import { ErrorBox, PageHeader } from "../components/UI";
import type { Metadata } from "../types";
import { useAuth } from "../auth";
import { createImportPreview, type ImportPreview } from "../import-preview";
import { useLang, useT } from "../i18n/LangContext";

interface AdminUser {
  id: string; name: string; email: string; role: string; group_id: string; group_name: string;
  is_active: number; is_demo: number; approval_status: "pending" | "approved" | "rejected";
}
interface Registration { id: string; name: string; email: string; role: "member" | "intern"; group_id: string; group_name: string; created_at: string }
interface Audit { id: string; user_name: string | null; action: string; entity_type: string; summary: string; created_at: string }
interface TransferCandidate { id: string; name: string; email: string; group_name: string; role: "member" | "intern" }
interface TransferPayload { successor_id: string; mode: "co_admin" | "full_transfer"; password: string }
interface ImportReport { projects: { created: number; updated: number }; tasks: { created: number; skipped: number }; milestones: { created: number; skipped: number }; events: { created: number; skipped: number }; progress_updates: { created: number; skipped: number }; reg_entries: { created: number; skipped: number }; warnings: string[] }

export function AdminPage() {
  const t = useT();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { user: currentUser, refresh } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activeAdminCount, setActiveAdminCount] = useState(0);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [successorId, setSuccessorId] = useState("");
  const [transferMode, setTransferMode] = useState<TransferPayload["mode"]>("co_admin");
  const [transferPassword, setTransferPassword] = useState("");
  const [pendingTransfer, setPendingTransfer] = useState<TransferPayload | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [tab, setTab] = useState("registrations");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importJson, setImportJson] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  const load = async () => {
    try {
      const [userData, metadata, auditData, registrationData, transferData] = await Promise.all([
        api<{ users: AdminUser[]; active_admin_count: number }>("/admin/users"),
        api<Metadata>("/metadata"),
        api<{ audit_log: Audit[] }>("/admin/audit-log"),
        api<{ registrations: Registration[]; enabled: boolean }>("/admin/registrations"),
        api<{ candidates: TransferCandidate[] }>("/admin/transfer/candidates"),
      ]);
      setUsers(userData.users); setActiveAdminCount(userData.active_admin_count); setMeta(metadata); setAudits(auditData.audit_log);
      setRegistrations(registrationData.registrations); setRegistrationEnabled(registrationData.enabled);
      setCandidates(transferData.candidates);
      setSuccessorId((current) => transferData.candidates.some((candidate) => candidate.id === current) ? current : transferData.candidates[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.load")); }
  };
  useEffect(() => { void load(); }, []);

  const action = async (operation: () => Promise<unknown>, success: string) => {
    setError(""); setMessage("");
    try { await operation(); setMessage(success); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); return false; }
  };
  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    if (await action(() => api("/admin/users", { method: "POST", body: JSON.stringify(values) }), t("admin.createAccount"))) form.reset();
  };
  const createGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    if (await action(() => api("/admin/groups", { method: "POST", body: JSON.stringify(values) }), t("admin.newGroup"))) form.reset();
  };
  const createTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, stages: String(values.stages).split("→").map((value) => value.trim()).filter(Boolean) };
    if (await action(() => api("/admin/templates", { method: "POST", body: JSON.stringify(payload) }), t("admin.newTemplate"))) form.reset();
  };
  const resetPassword = async (id: string) => {
    const password = window.prompt(t("admin.tempPrompt")); if (password === null) return;
    await action(async () => { const result = await api<{ temporary_password: string }>(`/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password: password || undefined }) }); window.alert(t("admin.tempPassword", { password: result.temporary_password })); }, t("admin.resetPassword"));
  };
  const testEmail = () => action(async () => { const result = await api<{ message_id?: string }>("/admin/test-email", { method: "POST" }); setMessage(`${t("admin.testEmail")}: ${result.message_id ?? "accepted"}`); }, t("admin.testEmail"));
  const updateRegistration = (id: string, patch: Partial<Registration>) => setRegistrations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const toggleRegistration = () => action(() => api("/admin/registration-toggle", { method: "POST", body: JSON.stringify({ enabled: !registrationEnabled }) }), registrationEnabled ? t("common.disable") : t("common.enable"));
  const changeRole = async (target: AdminUser, role: string) => {
    setError(""); setMessage("");
    try {
      await api(`/admin/users/${target.id}`, patchBody({ role }));
      if (target.id === currentUser?.id && role !== "admin") { await refresh(); navigate("/", { replace: true }); return; }
      setMessage(t("common.save")); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.update")); }
  };
  const executeTransfer = async (payload: TransferPayload) => {
    setTransferBusy(true); setError(""); setMessage("");
    try {
      await api("/admin/transfer", { method: "POST", body: JSON.stringify(payload) });
      setPendingTransfer(null); setTransferPassword("");
      await refresh();
      if (payload.mode === "full_transfer") navigate("/", { replace: true });
      else { setMessage(t("admin.coAdmin")); await load(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); }
    finally { setTransferBusy(false); }
  };
  const submitTransfer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = { successor_id: successorId, mode: transferMode, password: transferPassword };
    if (transferMode === "full_transfer") setPendingTransfer(payload);
    else void executeTransfer(payload);
  };
  const previewImport = (source = importJson) => {
    setError(""); setImportPreview(null); setImportReport(null);
    try {
      setImportPreview(createImportPreview(source));
    } catch (cause) { setError(cause instanceof Error ? `${t("admin.preview")}: ${cause.message}` : t("error.operation")); }
  };
  const loadImportFile = (file: File | undefined) => {
    if (!file) return;
    setError(""); setImportPreview(null); setImportReport(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { setError(t("error.load")); return; }
      setImportJson(reader.result);
      previewImport(reader.result);
    };
    reader.onerror = () => setError(t("error.load"));
    reader.readAsText(file);
  };
  const executeImport = async () => {
    if (!importPreview || !window.confirm(t("admin.importConfirm"))) return;
    setError(""); setImportReport(null);
    try { setImportReport(await api<ImportReport>("/admin/import", { method: "POST", body: importJson })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("error.operation")); }
  };
  const tabs = [["registrations", `${t("admin.tab.registrations")}${registrations.length ? ` (${registrations.length})` : ""}`], ["transfer", t("admin.tab.transfer")], ["users", t("admin.tab.users")], ["groups", t("admin.tab.groups")], ["templates", t("admin.tab.templates")], ["import", t("admin.tab.import")], ["audit", t("admin.tab.audit")]];

  return <>
    <PageHeader title={t("admin.title")} description={t("admin.description")} actions={<div className="flex gap-2"><button className="btn-secondary" onClick={() => void testEmail()}>{t("admin.testEmail")}</button><button className="btn-danger" onClick={() => { if (window.confirm(t("admin.clearConfirm"))) void action(() => api("/admin/clear-demo", { method: "POST" }), t("admin.clearDemo")); }}>{t("admin.clearDemo")}</button></div>} />
    {error && <ErrorBox message={error} />}{message && <div className="mb-4 rounded-lg border border-ok bg-void p-3 text-sm text-ok">{message}</div>}
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">{tabs.map(([key, label]) => <button className={`whitespace-nowrap px-4 py-3 text-sm ${tab === key ? "border-b-2 border-psi font-semibold text-psi" : "text-star-dim"}`} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "registrations" && <div className="space-y-5"><section className="panel flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">{t("admin.registrationOpen")}</h2><p className="mt-1 text-sm text-star-dim">{t("admin.registrationIntro")}</p></div><button role="switch" aria-checked={registrationEnabled} className={`relative h-7 w-12 rounded-full transition ${registrationEnabled ? "bg-psi-deep" : "bg-nexus-line"}`} onClick={() => void toggleRegistration()}><span className={`absolute top-1 h-5 w-5 rounded-full bg-nexus transition ${registrationEnabled ? "left-6" : "left-1"}`} /></button></section><section className="panel overflow-x-auto"><h2 className="mb-4 font-bold">{t("admin.pendingList")}</h2>{registrations.length === 0 ? <p className="empty-inline text-sm text-star-dim">{t("admin.noPending")}</p> : <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("admin.nameEmail")}</th><th>{t("admin.appliedAt")}</th><th>{t("admin.role")}</th><th>{t("admin.group")}</th><th>{t("common.actions")}</th></tr></thead><tbody>{registrations.map((item) => <tr className="border-b border-nexus-line" key={item.id}><td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-star-dim">{item.email}</p></td><td>{formatDate(item.created_at, true, lang)}</td><td><select value={item.role} onChange={(event) => updateRegistration(item.id, { role: event.target.value as "member" | "intern" })}><option value="member">{t("admin.member")}</option><option value="intern">{t("admin.intern")}</option></select></td><td><select value={item.group_id} onChange={(event) => updateRegistration(item.id, { group_id: event.target.value })}>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></td><td className="space-x-3"><button className="font-semibold text-ok" onClick={() => void action(() => api(`/admin/registrations/${item.id}/approve`, { method: "POST", body: JSON.stringify({ role: item.role, group_id: item.group_id }) }), t("admin.approve"))}>{t("admin.approve")}</button><button className="font-semibold text-danger" onClick={() => { if (window.confirm(t("admin.rejectConfirm", { name: item.name }))) void action(() => api(`/admin/registrations/${item.id}/reject`, { method: "POST" }), t("admin.reject")); }}>{t("admin.reject")}</button></td></tr>)}</tbody></table>}</section></div>}

    {tab === "transfer" && <form className="panel max-w-3xl space-y-5" onSubmit={submitTransfer}><div><h2 className="text-lg font-bold">{t("admin.tab.transfer")}</h2><p className="mt-1 text-sm text-star-dim">{t("admin.transferIntro")}</p></div><div><label className="label">{t("admin.successor")}</label><select aria-label={t("admin.successor")} className="w-full" value={successorId} onChange={(event) => setSuccessorId(event.target.value)} required disabled={!candidates.length || transferBusy}><option value="">{t("admin.chooseSuccessor")}</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} ({candidate.email} / {candidate.group_name} / {t(candidate.role === "intern" ? "admin.intern" : "admin.member")})</option>)}</select>{!candidates.length && <p className="empty-inline mt-2 text-sm text-warn">{t("admin.noSuccessor")}</p>}</div><fieldset className="space-y-3"><legend className="label">{t("admin.transferMode")}</legend><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-nexus-line p-4"><input className="mt-1" type="radio" name="transfer_mode" value="co_admin" checked={transferMode === "co_admin"} onChange={() => setTransferMode("co_admin")} /><span><strong>{t("admin.coAdmin")}</strong><span className="mt-1 block text-sm text-star-dim">{t("admin.coAdminText")}</span></span></label><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-danger p-4"><input className="mt-1" type="radio" name="transfer_mode" value="full_transfer" checked={transferMode === "full_transfer"} onChange={() => setTransferMode("full_transfer")} /><span><strong>{t("admin.fullTransfer")}</strong><span className="mt-1 block text-sm text-danger">{t("admin.fullTransferText")}</span></span></label></fieldset><div><label className="label">{t("admin.yourPassword")}</label><input aria-label={t("admin.yourPassword")} className="w-full" type="password" autoComplete="current-password" value={transferPassword} onChange={(event) => setTransferPassword(event.target.value)} required /></div><button className={transferMode === "full_transfer" ? "btn-danger" : "btn"} disabled={!successorId || !transferPassword || transferBusy}>{t(transferBusy ? "admin.transferring" : "admin.confirmTransfer")}</button></form>}

    {tab === "users" && <div className="space-y-6"><form className="panel grid gap-3 md:grid-cols-5" onSubmit={createUser}><input name="name" placeholder={t("common.name")} required /><input name="email" type="email" placeholder="Email" required /><select name="group_id">{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><select name="role"><option value="member">{t("admin.member")}</option><option value="intern">{t("admin.intern")}</option><option value="admin">{t("admin.admin")}</option></select><input name="password" placeholder={t("admin.initialPassword")} minLength={8} required /><button className="btn md:col-start-5">{t("admin.createAccount")}</button></form><section className="panel overflow-x-auto"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{t("admin.userList")}</h2><span className="text-sm text-star-dim">{t("admin.activeAdmins", { count: activeAdminCount })}</span></div><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("common.name")}</th><th>Email</th><th>{t("admin.group")}</th><th>{t("admin.role")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead><tbody>{users.map((user) => { const isLastAdmin = user.role === "admin" && user.is_active === 1 && user.approval_status === "approved" && activeAdminCount === 1; const reason = isLastAdmin ? t("admin.lastAdmin") : undefined; const deactivateReason = reason ?? (user.id === currentUser?.id ? t("admin.cannotDisableSelf") : undefined); return <tr className="border-b border-nexus-line" key={user.id}><td className="py-3">{user.name}</td><td>{user.email}</td><td>{user.group_name}</td><td>{user.approval_status === "approved" ? <select aria-label={t("admin.roleAria", { name: user.name })} value={user.role} title={reason} onChange={(event) => void changeRole(user, event.target.value)}><option value="member" disabled={isLastAdmin}>{t("admin.member")}</option><option value="intern" disabled={isLastAdmin}>{t("admin.intern")}</option><option value="admin">{t("admin.admin")}</option></select> : user.role}</td><td>{t(user.approval_status === "pending" ? "status.pending" : user.approval_status === "rejected" ? "status.rejected" : user.is_active ? "status.enabled" : "status.disabled")}</td><td className="space-x-2">{user.approval_status === "approved" ? <><button className="text-psi" onClick={() => void resetPassword(user.id)}>{t("admin.resetPassword")}</button>{user.is_active ? <span title={deactivateReason}><button className="text-danger" disabled={isLastAdmin || user.id === currentUser?.id} onClick={() => void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), t("common.disable"))}>{t("common.disable")}</button></span> : <button className="text-ok" onClick={() => void action(() => api(`/admin/users/${user.id}`, patchBody({ is_active: true })), t("common.enable"))}>{t("common.enable")}</button>}</> : <button className="text-danger" onClick={() => { if (window.confirm(t("admin.deleteConfirm", { email: user.email }))) void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), t("common.delete")); }}>{t("common.delete")}</button>}</td></tr>; })}</tbody></table></section></div>}

    {tab === "groups" && <div className="grid gap-6 md:grid-cols-2"><form className="panel space-y-3" onSubmit={createGroup}><h2 className="font-bold">{t("admin.newGroup")}</h2><input className="w-full" name="name" placeholder={t("admin.groupName")} required /><select className="w-full" name="type"><option value="general">{t("admin.general")}</option><option value="clinical">Clinical</option><option value="bd">BD</option><option value="qa">QA</option></select><button className="btn">{t("common.add")}</button></form><section className="panel"><h2 className="mb-3 font-bold">{t("admin.currentGroups")}</h2>{meta?.groups.map((group) => <div className="flex justify-between border-b py-3 text-sm" key={group.id}><span>{group.name}</span><span className="badge">{group.type}</span></div>)}</section></div>}
    {tab === "templates" && <div className="grid gap-6 md:grid-cols-2"><form className="panel space-y-3" onSubmit={createTemplate}><h2 className="font-bold">{t("admin.newTemplate")}</h2><input className="w-full" name="name" placeholder={t("admin.templateName")} required /><select className="w-full" name="group_id"><option value="">{t("admin.allGroups")}</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input className="w-full" name="stages" placeholder={t("admin.templateExample")} required /><button className="btn">{t("common.add")}</button></form><section className="panel"><h2 className="mb-3 font-bold">{t("admin.currentTemplates")}</h2>{meta?.templates.map((template) => <div className="border-b py-3" key={template.id}><p className="font-medium">{template.name}</p><p className="mt-1 text-xs text-star-dim">{(JSON.parse(template.stages_json) as string[]).join(" → ")}</p></div>)}</section></div>}
    {tab === "import" && <section className="panel space-y-5"><p className="border border-psi p-3 text-sm">{t("admin.importPageHint")} <Link className="font-semibold text-psi hover:text-star" to="/import">{t("import.title")}</Link></p><div><h2 className="font-bold">{t("admin.importJson")}</h2><p className="mt-1 text-sm text-star-dim">{t("admin.importIntro")}</p></div><label className="btn-secondary inline-flex cursor-pointer"><span>{t("admin.chooseFile")}</span><input className="sr-only" type="file" accept=".json" onChange={(event) => { loadImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><textarea aria-label={t("admin.importJson")} className="min-h-80 w-full font-mono text-sm" value={importJson} onChange={(event) => { setImportJson(event.target.value); setImportPreview(null); setImportReport(null); }} placeholder={'{\n  "projects": [],\n  "reg_entries": []\n}'} /><div className="flex flex-wrap gap-3"><button className="btn-secondary" disabled={!importJson.trim()} onClick={() => previewImport()}>{t("admin.preview")}</button><button className="btn" disabled={!importPreview} onClick={() => void executeImport()}>{t("admin.execute")}</button></div>{importPreview && <div className="border border-psi p-4 text-sm"><h3 className="font-bold">{t("admin.localPreview")}</h3><p className="mt-2">{t("admin.previewCounts", { projects: importPreview.projects, tasks: importPreview.tasks, updates: importPreview.progress_updates, entries: importPreview.reg_entries })}</p><p>Milestones: {importPreview.milestones} / Events: {importPreview.events}</p></div>}{importReport && <div className="border border-ok p-4 text-sm"><h3 className="font-bold text-ok">{t("admin.importDone")}</h3><p className="mt-2">Projects: created {importReport.projects.created} / updated {importReport.projects.updated}</p><p>Tasks: created {importReport.tasks.created} / skipped {importReport.tasks.skipped}</p><p>Milestones: created {importReport.milestones.created} / skipped {importReport.milestones.skipped}</p><p>Events: created {importReport.events.created} / skipped {importReport.events.skipped}</p><p>Progress updates: created {importReport.progress_updates.created} / skipped {importReport.progress_updates.skipped}</p><p>Regulatory entries: created {importReport.reg_entries.created} / skipped {importReport.reg_entries.skipped}</p>{importReport.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-warn">{importReport.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}</section>}
    {tab === "audit" && <section className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-nexus-line text-gold-bright"><th className="py-2">{t("admin.time")}</th><th>{t("admin.person")}</th><th>{t("admin.action")}</th><th>{t("admin.summary")}</th></tr></thead><tbody>{audits.map((item) => <tr className="border-b border-nexus-line" key={item.id}><td className="py-3">{item.created_at}</td><td>{item.user_name || t("admin.system")}</td><td>{item.action} / {item.entity_type}</td><td>{item.summary}</td></tr>)}</tbody></table></section>}
    {pendingTransfer && <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !transferBusy) setPendingTransfer(null); }}><section className="panel w-full max-w-md p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="transfer-confirm-title"><h2 className="text-xl font-bold" id="transfer-confirm-title">{t("admin.confirmFullTitle")}</h2><p className="mt-3 leading-7 text-star-dim">{t("admin.confirmFullText")}<strong className="block text-danger">{t("admin.loseAdmin")}</strong></p><div className="mt-6 flex justify-end gap-3"><button className="btn-secondary" disabled={transferBusy} onClick={() => setPendingTransfer(null)}>{t("common.cancel")}</button><button className="btn-danger" disabled={transferBusy} onClick={() => void executeTransfer(pendingTransfer)}>{t(transferBusy ? "admin.transferring" : "admin.confirmFull")}</button></div></section></div>}
  </>;
}
