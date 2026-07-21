import { useEffect, useState, type FormEvent } from "react";
import { api, formatDate, patchBody } from "../api";
import { ErrorBox, PageHeader } from "../components/UI";
import type { Metadata } from "../types";

interface AdminUser {
  id: string; name: string; email: string; role: string; group_id: string; group_name: string;
  is_active: number; is_demo: number; approval_status: "pending" | "approved" | "rejected";
}
interface Registration { id: string; name: string; email: string; role: "member" | "intern"; group_id: string; group_name: string; created_at: string }
interface Audit { id: string; user_name: string | null; action: string; entity_type: string; summary: string; created_at: string }

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [tab, setTab] = useState("registrations");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [userData, metadata, auditData, registrationData] = await Promise.all([
        api<{ users: AdminUser[] }>("/admin/users"),
        api<Metadata>("/metadata"),
        api<{ audit_log: Audit[] }>("/admin/audit-log"),
        api<{ registrations: Registration[]; enabled: boolean }>("/admin/registrations"),
      ]);
      setUsers(userData.users); setMeta(metadata); setAudits(auditData.audit_log);
      setRegistrations(registrationData.registrations); setRegistrationEnabled(registrationData.enabled);
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
  const tabs = [["registrations", `註冊申請${registrations.length ? ` (${registrations.length})` : ""}`], ["users", "使用者"], ["groups", "組別"], ["templates", "階段模板"], ["audit", "稽核紀錄"]];

  return <>
    <PageHeader title="管理中心" description="管理註冊申請、帳號、組別、流程模板與稽核軌跡。" actions={<div className="flex gap-2"><button className="btn-secondary" onClick={() => void testEmail()}>寄測試信</button><button className="btn-danger" onClick={() => { if (window.confirm("確定清除所有示範帳號與專案？")) void action(() => api("/admin/clear-demo", { method: "POST" }), "示範資料已清除"); }}>清除示範資料</button></div>} />
    {error && <ErrorBox message={error} />}{message && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
    <div className="mb-5 flex gap-1 overflow-x-auto border-b">{tabs.map(([key, label]) => <button className={`whitespace-nowrap px-4 py-3 text-sm ${tab === key ? "border-b-2 border-brand-600 font-semibold text-brand-700" : "text-slate-500"}`} key={key} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "registrations" && <div className="space-y-5"><section className="card flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">開放自助註冊</h2><p className="mt-1 text-sm text-slate-500">關閉後公開頁仍可查看，但不接受驗證碼與新申請。</p></div><button role="switch" aria-checked={registrationEnabled} className={`relative h-7 w-12 rounded-full transition ${registrationEnabled ? "bg-brand-600" : "bg-slate-300"}`} onClick={() => void toggleRegistration()}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${registrationEnabled ? "left-6" : "left-1"}`} /></button></section><section className="card overflow-x-auto"><h2 className="mb-4 font-bold">待核清單</h2>{registrations.length === 0 ? <p className="text-sm text-slate-500">目前沒有待核准申請。</p> : <table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">姓名／Email</th><th>申請時間</th><th>角色</th><th>組別</th><th>操作</th></tr></thead><tbody>{registrations.map((item) => <tr className="border-b border-slate-100" key={item.id}><td className="py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-slate-500">{item.email}</p></td><td>{formatDate(item.created_at, true)}</td><td><select value={item.role} onChange={(event) => updateRegistration(item.id, { role: event.target.value as "member" | "intern" })}><option value="member">正職成員</option><option value="intern">實習生</option></select></td><td><select value={item.group_id} onChange={(event) => updateRegistration(item.id, { group_id: event.target.value })}>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></td><td className="space-x-3"><button className="font-semibold text-emerald-600" onClick={() => void action(() => api(`/admin/registrations/${item.id}/approve`, { method: "POST", body: JSON.stringify({ role: item.role, group_id: item.group_id }) }), "申請已核准並寄送通知")}>核准</button><button className="font-semibold text-red-500" onClick={() => { if (window.confirm(`確定拒絕 ${item.name} 的申請？`)) void action(() => api(`/admin/registrations/${item.id}/reject`, { method: "POST" }), "申請已拒絕並寄送通知"); }}>拒絕</button></td></tr>)}</tbody></table>}</section></div>}

    {tab === "users" && <div className="space-y-6"><form className="card grid gap-3 md:grid-cols-5" onSubmit={createUser}><input name="name" placeholder="姓名" required /><input name="email" type="email" placeholder="Email" required /><select name="group_id">{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><select name="role"><option value="member">正職成員</option><option value="intern">實習生</option><option value="admin">管理員</option></select><input name="password" placeholder="初始密碼" minLength={8} required /><button className="btn md:col-start-5">建立帳號</button></form><section className="card overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">姓名</th><th>Email</th><th>組別</th><th>角色</th><th>狀態</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr className="border-b border-slate-100" key={user.id}><td className="py-3">{user.name}</td><td>{user.email}</td><td>{user.group_name}</td><td>{user.role}</td><td>{user.approval_status === "pending" ? "待核准" : user.approval_status === "rejected" ? "未通過" : user.is_active ? "啟用" : "停用"}</td><td className="space-x-2">{user.approval_status === "approved" ? <><button className="text-brand-600" onClick={() => void resetPassword(user.id)}>重設密碼</button>{user.is_active ? <button className="text-red-500" onClick={() => void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), "帳號已停用")}>停用</button> : <button className="text-emerald-600" onClick={() => void action(() => api(`/admin/users/${user.id}`, patchBody({ is_active: true })), "帳號已啟用")}>啟用</button>}</> : <button className="text-red-500" onClick={() => { if (window.confirm(`確定刪除 ${user.email}？`)) void action(() => api(`/admin/users/${user.id}`, { method: "DELETE" }), "未核准帳號已刪除"); }}>刪除</button>}</td></tr>)}</tbody></table></section></div>}

    {tab === "groups" && <div className="grid gap-6 md:grid-cols-2"><form className="card space-y-3" onSubmit={createGroup}><h2 className="font-bold">新增組別</h2><input className="w-full" name="name" placeholder="組別名稱" required /><select className="w-full" name="type"><option value="general">一般</option><option value="clinical">臨床</option><option value="bd">BD</option></select><button className="btn">新增</button></form><section className="card"><h2 className="mb-3 font-bold">目前組別</h2>{meta?.groups.map((group) => <div className="flex justify-between border-b py-3 text-sm" key={group.id}><span>{group.name}</span><span className="badge">{group.type}</span></div>)}</section></div>}
    {tab === "templates" && <div className="grid gap-6 md:grid-cols-2"><form className="card space-y-3" onSubmit={createTemplate}><h2 className="font-bold">新增階段模板</h2><input className="w-full" name="name" placeholder="模板名稱" required /><select className="w-full" name="group_id"><option value="">所有組別</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input className="w-full" name="stages" placeholder="待辦 → 進行中 → 完成" required /><button className="btn">新增</button></form><section className="card"><h2 className="mb-3 font-bold">目前模板</h2>{meta?.templates.map((template) => <div className="border-b py-3" key={template.id}><p className="font-medium">{template.name}</p><p className="mt-1 text-xs text-slate-500">{(JSON.parse(template.stages_json) as string[]).join(" → ")}</p></div>)}</section></div>}
    {tab === "audit" && <section className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-400"><th className="py-2">時間</th><th>人員</th><th>動作</th><th>摘要</th></tr></thead><tbody>{audits.map((item) => <tr className="border-b border-slate-100" key={item.id}><td className="py-3">{item.created_at}</td><td>{item.user_name || "系統"}</td><td>{item.action} / {item.entity_type}</td><td>{item.summary}</td></tr>)}</tbody></table></section>}
  </>;
}
