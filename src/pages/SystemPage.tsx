import { useEffect, useState, type FormEvent } from "react";
import { api, formatDate, jsonBody, patchBody } from "../api";
import { ErrorBox, PageHeader } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";

/**
 * 系統管理（只有系統管理員看得到）：建立公司、發邀請、查看各公司的帳號與狀態。
 * 各公司的日常管理（核准同仁、組別）在各自的「管理」頁。
 */

type CompanyStatus = "setup" | "active" | "suspended";
type StageKey = "accounts" | "projects" | "workspace" | "regulatory" | "ai";
interface Isolation { stages: Record<StageKey, boolean>; complete: boolean }
interface Company { id: string; name: string; status: CompanyStatus; created_at: string; users: number; active_users: number; admins: number; pending: number; groups: number; home: boolean }
interface CompanyUser { id: string; name: string; email: string; role: "admin" | "member" | "intern"; is_active: number; approval_status: "pending" | "approved" | "rejected"; created_at: string; group_name: string }
interface Invite { id: string; role: "admin" | "member"; group_name: string | null; note: string; max_uses: number; used_count: number; expires_at: string; created_at: string; created_by_name: string | null; state: "open" | "used" | "expired" | "revoked" }
interface Detail { company: Company; users: CompanyUser[]; groups: Array<{ id: string; name: string }>; invites: Invite[] }
interface CreatedInvite { code: string; url: string; expires_at: string }

const STAGES: StageKey[] = ["accounts", "projects", "workspace", "regulatory", "ai"];

export function SystemPage() {
  const t = useT();
  const { lang } = useLang();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isolation, setIsolation] = useState<Isolation | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [created, setCreated] = useState<(CreatedInvite & { emailSent: boolean; emailed: boolean }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await api<{ companies: Company[]; isolation: Isolation }>("/system/companies");
    setCompanies(result.companies); setIsolation(result.isolation);
  };
  const loadDetail = async (id: string) => setDetail(await api<Detail>(`/system/companies/${id}`));

  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, []);
  useEffect(() => {
    setCreated(null);
    if (selected) loadDetail(selected).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    else setDetail(null);
  }, [selected]);

  const run = async (work: () => Promise<void>) => {
    setError(""); setBusy(true);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };

  const createCompany = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    void run(async () => {
      const result = await api<{ company: Company }>("/system/companies", jsonBody({ name }));
      form.reset(); await load(); setSelected(result.company.id);
    });
  };

  const setStatus = (status: CompanyStatus) => {
    if (!detail) return;
    if (status === "suspended" && !window.confirm(t("system.suspendConfirm", { name: detail.company.name }))) return;
    void run(async () => { await api(`/system/companies/${detail.company.id}`, patchBody({ status })); await Promise.all([load(), loadDetail(detail.company.id)]); });
  };

  const createInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const email = String(values.email ?? "").trim();
    void run(async () => {
      const result = await api<{ invite: CreatedInvite; email_sent: boolean }>(`/system/companies/${detail.company.id}/invites`, jsonBody({
        role: values.role, email: email || undefined, max_uses: Number(values.max_uses), expires_days: Number(values.expires_days),
      }));
      setCopied(false);
      setCreated({ ...result.invite, emailSent: result.email_sent, emailed: Boolean(email) });
      await Promise.all([load(), loadDetail(detail.company.id)]);
    });
  };

  const revoke = (invite: Invite) => {
    if (!detail || !window.confirm(t("system.revokeConfirm"))) return;
    void run(async () => { await api(`/system/invites/${invite.id}/revoke`, { method: "POST" }); await loadDetail(detail.company.id); });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };

  const doneStages = isolation ? STAGES.filter((key) => isolation.stages[key]).length : 0;
  const statusLabel = (status: CompanyStatus) => t(`system.status.${status}`);

  return <div>
    <PageHeader title={t("system.title")} description={t("system.description")} />
    {error && <ErrorBox message={error} />}

    {isolation && <section className={`panel mb-6 border ${isolation.complete ? "border-ok" : "border-warn"}`}>
      <p className={`font-semibold ${isolation.complete ? "text-ok" : "text-warn"}`}>{isolation.complete ? t("system.isolationDone") : t("system.isolation", { done: doneStages, total: STAGES.length })}</p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {STAGES.map((key, index) => <li key={key} className={isolation.stages[key] ? "text-ok" : "text-star-dim"}>{isolation.stages[key] ? "✓" : "○"} {index + 1}. {t(`system.stage.${key}`)}</li>)}
      </ul>
    </section>}

    <section className="panel mb-6">
      <h2 className="mb-3 text-lg font-semibold">{t("system.newCompany")}</h2>
      <form className="flex flex-wrap gap-2" onSubmit={createCompany}>
        <input aria-label={t("system.companyName")} className="min-w-0 flex-1" name="name" maxLength={80} placeholder={t("system.companyName")} required />
        <button className="btn" disabled={busy}>{t("system.create")}</button>
      </form>
    </section>

    <section className="panel mb-6 overflow-x-auto">
      <h2 className="mb-3 text-lg font-semibold">{t("system.companies")}</h2>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-star-dim"><th className="py-2">{t("system.companyName")}</th><th>{t("system.statusLabel")}</th><th>{t("system.users")}</th><th>{t("system.admins")}</th><th>{t("system.pending")}</th><th>{t("system.createdAt")}</th><th /></tr></thead>
        <tbody>{companies.map((company) => <tr key={company.id} className={`border-t border-line ${selected === company.id ? "bg-void" : ""}`}>
          <td className="py-2 font-semibold">{company.name}{company.home && <span className="ml-2 text-xs text-star-dim">{t("system.home")}</span>}</td>
          <td>{statusLabel(company.status)}</td>
          <td>{company.active_users}／{company.users}</td>
          <td>{company.admins}</td>
          <td>{company.pending}</td>
          <td>{formatDate(company.created_at, false, lang)}</td>
          <td className="text-right"><button className="btn-secondary !px-3 !py-1" type="button" onClick={() => setSelected(selected === company.id ? null : company.id)}>{t("system.manage")}</button></td>
        </tr>)}</tbody>
      </table>
    </section>

    {detail && <section className="panel mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{detail.company.name} <span className="text-sm font-normal text-star-dim">{statusLabel(detail.company.status)}</span></h2>
        {!detail.company.home && <div className="flex flex-wrap gap-2">
          {detail.company.status !== "active" && <button className="btn" type="button" disabled={busy || !isolation?.complete} title={isolation?.complete ? undefined : t("system.activateBlocked")} onClick={() => setStatus("active")}>{t("system.activate")}</button>}
          {detail.company.status !== "suspended" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => setStatus("suspended")}>{t("system.suspend")}</button>}
          {detail.company.status === "suspended" && <button className="btn-secondary" type="button" disabled={busy} onClick={() => setStatus("setup")}>{t("system.backToSetup")}</button>}
        </div>}
      </div>
      {!detail.company.home && detail.company.status !== "active" && !isolation?.complete && <p className="mt-2 text-sm text-star-dim">{t("system.activateBlocked")}</p>}

      <h3 className="mb-2 mt-6 font-semibold">{t("system.newInvite")}</h3>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={createInvite}>
        <label className="text-sm">{t("system.inviteRole")}<select className="mt-1 w-full" name="role" defaultValue={detail.company.admins ? "member" : "admin"}><option value="admin">{t("system.inviteAdmin")}</option><option value="member">{t("system.inviteMember")}</option></select></label>
        <label className="text-sm">{t("system.inviteEmail")}<input className="mt-1 w-full" type="email" name="email" placeholder="name@example.com" /></label>
        <label className="text-sm">{t("system.inviteMaxUses")}<input className="mt-1 w-full" type="number" name="max_uses" min={1} max={500} defaultValue={1} required /></label>
        <label className="text-sm">{t("system.inviteDays")}<input className="mt-1 w-full" type="number" name="expires_days" min={1} max={30} defaultValue={7} required /></label>
        <div className="sm:col-span-2"><button className="btn" disabled={busy || detail.company.status === "suspended"}>{t("system.inviteCreate")}</button></div>
      </form>

      {created && <div className="mt-4 rounded-card border border-psi bg-void p-4 text-sm">
        <p className="font-semibold text-star">{t("system.inviteCreated")}</p>
        {created.emailed && <p className={`mt-1 ${created.emailSent ? "text-ok" : "text-warn"}`}>{t(created.emailSent ? "system.inviteEmailSent" : "system.inviteEmailFailed")}</p>}
        <p className="mt-2 break-all"><code>{created.url}</code></p>
        <p className="mt-1">{t("system.inviteCode")}：<code>{created.code}</code>　{t("system.expires")} {formatDate(created.expires_at, true, lang)}</p>
        <button className="btn-secondary mt-2 !px-3 !py-1" type="button" onClick={() => void copy(created.url)}>{copied ? t("system.copied") : t("system.copy")}</button>
      </div>}

      <h3 className="mb-2 mt-6 font-semibold">{t("system.invites")}</h3>
      {detail.invites.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-star-dim"><th className="py-2">{t("system.inviteRole")}</th><th>{t("system.inviteNote")}</th><th>{t("system.inviteUsage")}</th><th>{t("system.expires")}</th><th>{t("system.statusLabel")}</th><th /></tr></thead>
        <tbody>{detail.invites.map((invite) => <tr key={invite.id} className="border-t border-line">
          <td className="py-2">{t(invite.role === "admin" ? "system.inviteAdmin" : "system.inviteMember")}</td>
          <td className="break-all">{invite.note || "—"}</td>
          <td>{invite.used_count}／{invite.max_uses}</td>
          <td>{formatDate(invite.expires_at, true, lang)}</td>
          <td>{t(`system.inviteState.${invite.state}`)}</td>
          <td className="text-right">{invite.state === "open" && <button className="btn-secondary !px-3 !py-1" type="button" disabled={busy} onClick={() => revoke(invite)}>{t("system.revoke")}</button>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-star-dim">{t("system.noInvites")}</p>}

      <h3 className="mb-2 mt-6 font-semibold">{t("system.users")}</h3>
      {detail.users.length ? <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-star-dim"><th className="py-2">{t("admin.nameEmail")}</th><th>{t("admin.role")}</th><th>{t("admin.group")}</th><th>{t("system.statusLabel")}</th><th>{t("system.createdAt")}</th></tr></thead>
        <tbody>{detail.users.map((account) => <tr key={account.id} className="border-t border-line">
          <td className="py-2"><span className="font-semibold">{account.name}</span><br /><span className="text-star-dim">{account.email}</span></td>
          <td>{t(`admin.${account.role}`)}</td>
          <td>{account.group_name}</td>
          <td>{account.is_active ? t(`system.approval.${account.approval_status}`) : t("system.inactive")}</td>
          <td>{formatDate(account.created_at, false, lang)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-star-dim">{t("system.noUsers")}</p>}
    </section>}
  </div>;
}
