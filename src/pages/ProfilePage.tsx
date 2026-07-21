import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, PageHeader } from "../components/UI";

export function ProfilePage() {
  const { user, refresh } = useAuth(); const [enabled, setEnabled] = useState(!!user?.email_notifications); const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const saveNotice = async () => { await api("/profile", { method: "PATCH", body: JSON.stringify({ email_notifications: enabled }) }); await refresh(); setMessage("通知偏好已儲存"); };
  const password = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }); setCurrent(""); setNext(""); setMessage("密碼已變更"); } catch (cause) { setError(cause instanceof Error ? cause.message : "變更失敗"); } };
  return <><PageHeader title="個人設定" description={`${user?.name} · ${user?.email} · ${user?.group_name}`} />{error && <ErrorBox message={error} />}{message && <div className="mb-4 rounded-lg border border-ok bg-void p-3 text-sm text-ok">{message}</div>}<div className="grid gap-6 md:grid-cols-2"><section className="panel"><h2 className="mb-4 font-bold">Email 通知</h2><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />接收每日提醒彙整信</label><button className="btn mt-5" onClick={() => void saveNotice()}>儲存偏好</button></section><form className="panel" onSubmit={password}><h2 className="mb-4 font-bold">變更密碼</h2><label className="label">目前密碼</label><input className="mb-3 w-full" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /><label className="label">新密碼（至少 8 碼）</label><input className="mb-4 w-full" type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /><button className="btn">變更密碼</button></form></div><p className="mt-6 text-sm text-star-dim">若您被要求強制變更密碼，請前往 <Link className="text-psi" to="/change-password">強制改密頁</Link>。</p></>;
}
