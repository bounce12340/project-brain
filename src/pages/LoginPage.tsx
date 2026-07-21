import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/UI";

export function LoginPage() {
  const { user, login } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [email, setEmail] = useState("bd1@demo.local"); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const account = await login(email, password); navigate(account.must_change_password ? "/change-password" : ((location.state as { from?: string } | null)?.from ?? "/"), { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : "登入失敗"); } finally { setBusy(false); } };
  return <main className="login-stage grid min-h-screen place-items-center px-4"><form onSubmit={submit} className="panel login-panel w-full max-w-md !p-8"><div className="mb-7"><p className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-gold-bright">UIC INTERNAL</p><h1 className="text-3xl font-black text-gold-bright">艾爾水晶-專案進度</h1><p className="mt-2 text-sm text-star-dim">如同卡拉，讓團隊在水晶中共同感知每個專案的脈動</p></div>{error && <ErrorBox message={error} />}<label className="label">Email</label><input className="mb-4 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><label className="label">密碼</label><input className="mb-6 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="btn w-full" disabled={busy}>{busy ? "登入中…" : "登入"}</button><p className="mt-5 text-center text-sm text-star-dim">還沒有帳號？ <Link className="font-semibold text-psi hover:text-star" to="/register">申請帳號</Link></p></form></main>;
}
