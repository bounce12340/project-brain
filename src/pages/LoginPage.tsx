import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/UI";

export function LoginPage() {
  const { user, login } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [email, setEmail] = useState("bd1@demo.local"); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const account = await login(email, password); navigate(account.must_change_password ? "/change-password" : ((location.state as { from?: string } | null)?.from ?? "/"), { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : "登入失敗"); } finally { setBusy(false); } };
  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4"><form onSubmit={submit} className="card w-full max-w-md !p-8"><div className="mb-7"><p className="mb-2 text-sm font-semibold tracking-widest text-brand-600">UIC INTERNAL</p><h1 className="text-3xl font-black">艾爾水晶-專案進度</h1><p className="mt-2 text-sm text-slate-500">如同卡拉，讓團隊在水晶中共同感知每個專案的脈動</p></div>{error && <ErrorBox message={error} />}<label className="label">Email</label><input className="mb-4 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><label className="label">密碼</label><input className="mb-6 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="btn w-full" disabled={busy}>{busy ? "登入中…" : "登入"}</button></form></main>;
}
