import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatDate, patchBody } from "../api";
import { ErrorBox, PageHeader } from "../components/UI";
import type { Metadata } from "../types";
import { useAuth } from "../auth";

interface AdminUser {
  id: string; name: string; email: string; role: string; group_id: string; group_name: string;
  is_active: number; is_demo: number; approval_status: "pending" | "approved" | "rejected";
}
interface Registration { id: string; name: string; email: string; role: "member" | "intern"; group_id: string; group_name: string; created_at: string }
interface Audit { id: string; user_name: string | null; action: string; entity_type: string; summary: string; created_at: string }
interface TransferCandidate { id: string; name: string; email: string; group_name: string; role: "member" | "intern" }
interface TransferPayload { successor_id: string; mode: "co_admin" | "full_transfer"; password: string }

export function AdminPage() {
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "管理資料載入失敗"); }
  };
  useEffect(() => { void load(); }, []);

  const action = async (operation: () => Promise<unknown>, success: string) => {
    setError(""); setMessage("");
    try { await operation(); setMessage(success); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失敗"); return false; }
  };
  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    if (await action(() => api("/admin/users", { method: "POST", body: JSON.stringify(values) }), "帳號已建立")) form.reset();
  };
  const createGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    if (await action(() => api("/admin/groups", { method: "POST", body: JSON.stringify(values) }), "組別已建立")) form.reset();
  };
  const createTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, stages: String(values.stages).split("→").map((value) => value.trim()).filter(Boolean) };
    if (await action(() => api("/admin/templates", { method: "POST", body: JSON.stringify(payload) }), "模板已建立")) form.reset();
  };
  const resetPassword = async (id: string) => {
    const password = window.prompt("輸入至少 8 碼臨時密碼；留空則自動產生"); if (password === null) return;
    await action(async () => { const result = await api<{ temporary_password: string }>(`/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password: password || undefined }) }); window.alert(`臨時密碼：${result.temporary_password}\n請安全交付給使用者，此畫面不會再次顯示。`); }, "密碼已重設");
  };
  const testEmail = () => action(async () => { const result = await api<{ message_id?: string }>("/admin/test-email", { method: "POST" }); setMessage(`測試信已寄出：${result.message_id ?? "已接受"}`); }, "測試信已寄出");
  const updateRegistration = (id: string, patch: Partial<Registration>) => setRegistrations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const toggleRegistration = () => action(() => api("/admin/registration-toggle", { method: "POST", body: JSON.stringify({ enabled: !registrationEnabled }) }), registrationEnabled ? "自助註冊已關閉" : "自助註冊已開放");
  const changeRole = async (target: AdminUser, role: string) => {
    setError(""); setMessage("");
    try {
      await api(`/admin/users/${target.id}`, patchBody({ role }));
      if (target.id === currentUser?.id && role !== "admin") { await refresh(); navigate("/", { replace: true }); return; }
      setMessage("角色已更新"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "角色更新失敗"); }
  };
  const executeTransfer = async (payload: TransferPayload) => {
    setTransferBusy(true); setError(""); setMessage("");
    try {
      await api("/admin/transfer", { method: "POST", body: JSON.stringify(payload) });
      setPendingTransfer(null); setTransferPassword("");
      await refresh();
      if (payload.mode === "full_transfer") navigate("/", { replace: true });
      else { setMessage("共同管理員已新增，雙方通知已建立"); await load(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "管理權移轉失敗"); }
    finally { setTransferBusy(false); }
  };
  const submitTransfer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = { successor_id: successorId, mode: transferMode, password: transferPassword };
    if (transferMode === "full_transfer") setPendingTransfer(payload);
    else void executeTransfer(payload);
  };
  const tabs = [["registrations", `註冊申請${registrations.length ? ` (${registrations.length})` : ""}`], ["transfer", "管理權移轉"], ["users", "使用者"], ["groups", "組別"], ["templates", "階段模板"], ["audit", "稽核紀錄"]];

  return <>
    <PageHeader title="管理中心" description="管理註冊申請、帳號、組別、流程模板與稽核軌跡。" actions={<div className="flex gap-2"><button className="btn-secondary" onClick={() => void testEmail()}>寄測試信</button><button className="btn-danger" onClick={() => { if (window.confirm("確定清除所有示範帳號與專案？")) void action(() => api("/admin/clear-demo", { method: "POST" }), "示範資料已清除"); }}>清除示範資料</button></div>} />
    {error && <ErrorBox message={error} />}{message && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">{tabs.map(([key, label]) => <button className={`whitespace-nowrap px-4 py-3 text-sm ${tab === key ? "border-b-2 border-brand-600 font-semibold text-brand-700" : "text-slate-500"}`} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "registrations" && <div className="space-y-5"><section className="card flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">開放自助註冊</h2><p className="mt-1 text-sm text-slate-500">關閉後公開頁仍可查看，但不接受驗證碼與新申請。</p></div><button role="switch" aria-checked={registrationEnabled} className={`relative h-7 w-12 rounded-full transition ${registrationEnabled ? "bg-brand-600" : "bg-slate-300"}`} onClick={() => void toggleRegistration()}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${registrationEnabled ? "left-6" : "left-1"}`} /></button></section><section className="card overflow-x-auto"><h2 className="mb-4 font-bold">待核清單</h2>{registrations.length === 0 ? <p className="text-sm text-slate-500">目前沒有待核准申請。</p> : <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">姓名／Email</th><th>申請時間</th><th>角色</th><th>組別</th><th>操作</th></tr></thead><tbody>{registrations.map((item) => <tr className="border-b border-slate-100" key={item.id}><td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.email}</p></td><td>{formatDate(item.created_at, true)}</td><td><select value={item.role} onChange={(event) => updateRegistration(item.id, { role: event.target.value as "member" | "intern" })}><option value="member">正職成員</option><option value="intern">實習生</option></select></td><td><select value={item.group_id} onChange={(event) => updateRegistration(item.id, { group_id: event.target.value })}>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></td><td className="space-x-3"><button className="font-semibold text-emerald-600" onClick={() => void action(() => api(`/admin/registrations/${item.id}/approve`, { method: "POST", body: JSON.stringify({ role: item.role, group_id: item.group_id }) }), "申請已核准並寄送通知")}>核准</button><button className="font-semibold text-red-500" onClick={() => { if (window.confirm(`確定拒絕 ${item.name} 的申請？`)) void action(() => api(`/admin/registrations/${item.id}/reject`, { method: "POST" }), "申請已拒絕並寄送通知"); }}>拒絕</button></td></tr>)}</tbody></table>}</section></div>}

    {tab === "transfer" && <form className="card max-w-3xl space-y-5" onSubmit={submitTransfer}><div><h2 className="text-lg font-bold">管理權移轉</h2><p className="mt-1 text-sm text-slate-500">指定已啟用且已核准的成員接任；執行前必須驗證你的目前密碼。</p></div><div><label className="label">接班人</label><select className="w-full" value={successorId} onChange={(event) => setSuccessorId(event.target.value)} required disabled={!candidates.length || transferBusy}><option value="">請選擇接班人</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}（{candidate.email}／{candidate.group_name}／{candidate.role === "intern" ? "實習生" : "正職成員"}）</option>)}</select>{!candidates.length && <p className="mt-2 text-sm text-amber-700">目前沒有符合資格的接班人。</p>}</div><fieldset className="space-y-3"><legend className="label">移轉模式</legend><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4"><input className="mt-1" type="radio" name="transfer_mode" value="co_admin" checked={transferMode === "co_admin"} onChange={() => setTransferMode("co_admin")} /><span><strong>升為共同管理員（建議）</strong><span className="mt-1 block text-sm text-slate-500">接班人升為管理員，你仍保有管理權，適合日常備援。</span></span></label><label className="flex cursor-pointer items-start gap-3 rounded-lg border border-red-200 p-4"><input className="mt-1" type="radio" name="transfer_mode" value="full_transfer" checked={transferMode === "full_transfer"} onChange={() => setTransferMode("full_transfer")} /><span><strong>完全移轉</strong><span className="mt-1 block text-sm text-red-600">接班人升為管理員後，你會立即降為正職成員。</span></span></label></fieldset><div><label className="label">你的目前密碼</label><input className="w-full" type="password" autoComplete="current-password" value={transferPassword} onChange={(event) => setTransferPassword(event.target.value)} required /></div><button className={transferMode === "full_transfer" ? "btn-danger" : "btn"} disabled={!successorId || !transferPassword || transferBusy}>{transferBusy ? "移轉中…" : "確認移轉"}</button></form>}

    {tab === "users" && <div className="space-y-6"><form className="card grid gap-3 md:grid-cols-5" onSubmit={createUser}><input name="name" placeholder="姓名" required /><input name="email" type="email" placeholder="Email" required /><select name="group_id">{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><select name="role"><option value="member">正職成員</option><option value="intern">實習生</option><option value="admin">管理員</option></select><input name="password" placeholder="初始密碼" minLength={8} required /><button className="btn md:col-start-5">建立帳號</button></form><section className="card overflow-x-auto"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">使用者清單</h2><span className="text-sm text-slate-500">啟用且已核准的管理員：{activeAdminCount}</span></div><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">姓名</th><th>Email</th><th>組別</th><th>角色</th><th>狀態</th><th>操作</th></tr></thead><tbody>{users.map((user) => { const isLastAdmin = user.role === "admin" && user.is_active === 1 && user.approval_status === "approved" && activeAdminCount === 1; const reason = isLastAdmin ? "系統至少需要一名管理員" : undefined; const deactivateReason = reason ?? (user.id === currentUser?.id ? "不可停用目前登入帳號" : undefined); return <tr className="border-b border-slate-100" key={user.id}><td className="py-3">{user.name}</td><td>{user.email}</td><td>{user.group_name}</td><td>{user.approval_status === "approved" ? <select aria-label={`${user.name}角色`} value={user.role} title={reason} onChange={(event) => void changeRole(user, event.target.value)}><option value="member" disabled={isLastAdmin}>正職成員</option><option value="intern" disabled={isLastAdmin}>實習生</option><option value="admin">管理員</option></select> : user.role}</td><td>{user.approval_status === "pending" ? "待核准" : user.approval_status === "rejected" ? "未通過" : user.is_active ? "啟用" : "停用"}</td><td className="space-x-2">{user.approval_status === "approved" ? <><button className="text-brand-600" onClick={() => void resetPassword(user.id)}>重設密碼</button>{user.is_active ? <span title={deactivateReason}><button className="text-red-500" disabled={isLastAdmin || user.id === currentUser?.id} onClick={() => void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), "帳號已停用")}>停用</button></span> : <button className="text-emerald-600" onClick={() => void action(() => api(`/admin/users/${user.id}`, patchBody({ is_active: true })), "帳號已啟用")}>啟用</button>}</> : <button className="text-red-500" onClick={() => { if (window.confirm(`確定刪除 ${user.email}？`)) void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), "未核准帳號已刪除"); }}>刪除</button>}</td></tr>; })}</tbody></table></section></div>}

    {tab === "groups" && <div className="grid gap-6 md:grid-cols-2"><form className="card space-y-3" onSubmit={createGroup}><h2 className="font-bold">新增組別</h2><input className="w-full" name="name" placeholder="組別名稱" required /><select className="w-full" name="type"><option value="general">一般</option><option value="clinical">臨床</option><option value="bd">BD</option></select><button className="btn">新增</button></form><section className="card"><h2 className="mb-3 font-bold">目前組別</h2>{meta?.groups.map((group) => <div className="flex justify-between border-b py-3 text-sm" key={group.id}><span>{group.name}</span><span className="badge">{group.type}</span></div>)}</section></div>}
    {tab === "templates" && <div className="grid gap-6 md:grid-cols-2"><form className="card space-y-3" onSubmit={createTemplate}><h2 className="font-bold">新增階段模板</h2><input className="w-full" name="name" placeholder="模板名稱" required /><select className="w-full" name="group_id"><option value="">所有組別</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input className="w-full" name="stages" placeholder="待辦 → 進行中 → 完成" required /><button className="btn">新增</button></form><section className="card"><h2 className="mb-3 font-bold">目前模板</h2>{meta?.templates.map((template) => <div className="border-b py-3" key={template.id}><p className="font-medium">{template.name}</p><p className="mt-1 text-xs text-slate-500">{(JSON.parse(template.stages_json) as string[]).join(" → ")}</p></div>)}</section></div>}
    {tab === "audit" && <section className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">時間</th><th>人員</th><th>動作</th><th>摘要</th></tr></thead><tbody>{audits.map((item) => <tr className="border-b border-slate-100" key={item.id}><td className="py-3">{item.created_at}</td><td>{item.user_name || "系統"}</td><td>{item.action} / {item.entity_type}</td><td>{item.summary}</td></tr>)}</tbody></table></section>}
    {pendingTransfer && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !transferBusy) setPendingTransfer(null); }}><section className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="transfer-confirm-title"><h2 className="text-xl font-bold" id="transfer-confirm-title">確認完全移轉管理權？</h2><p className="mt-3 leading-7 text-slate-600">接班人將先升為管理員，接著你會降為正職成員。<strong className="block text-red-600">你將立即失去管理權。</strong></p><div className="mt-6 flex justify-end gap-3"><button className="btn-secondary" disabled={transferBusy} onClick={() => setPendingTransfer(null)}>取消</button><button className="btn-danger" disabled={transferBusy} onClick={() => void executeTransfer(pendingTransfer)}>{transferBusy ? "移轉中…" : "確認完全移轉"}</button></div></section></div>}
  </>;
}
