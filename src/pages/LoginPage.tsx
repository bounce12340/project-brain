import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { oauthReturnPath } from "../auth-redirect";
import { AuthCrystal } from "../components/AuthCrystal";
import { ErrorBox } from "../components/UI";
import { useT } from "../i18n/LangContext";

export function LoginPage() {
  const { user, login } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const t = useT();
  const [email, setEmail] = useState("bd1@demo.local"); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  // AI 工具連接時先被帶來登入，登入完回到授權頁（Worker 的頁面，要整頁跳轉）。
  const oauthReturn = oauthReturnPath(location.search);
  useEffect(() => { if (user && oauthReturn && !user.must_change_password) window.location.replace(oauthReturn); }, [user, oauthReturn]);
  if (user && oauthReturn && !user.must_change_password) return null;
  if (user) return <Navigate to={user.must_change_password ? "/change-password" : "/"} replace />;
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const account = await login(email, password); /* 上面的 effect 會整頁跳回授權頁；這裡再跳一次會把那次跳轉打斷。 */ if (oauthReturn && !account.must_change_password) return; navigate(account.must_change_password ? "/change-password" : ((location.state as { from?: string } | null)?.from ?? "/"), { replace: true }); } catch (cause) { setError(cause instanceof Error ? cause.message : t("auth.loginFailed")); } finally { setBusy(false); } };
  return <main className="auth-stage grid min-h-screen place-items-center px-4 py-10"><form onSubmit={submit} className="panel auth-panel w-full max-w-md !p-8"><AuthCrystal /><div className="mb-7"><p className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-gold-bright">{t("app.internal")}</p><h1 className="text-3xl font-black text-gold-bright">{t("app.fullName")}</h1><p className="mt-2 text-sm text-star-dim">{t("app.tagline")}</p><p data-app-credit className="app-credit mt-3 font-bold text-star">{t("app.credit")}</p></div>{error && <ErrorBox message={error} />}<label className="label">{t("auth.email")}</label><input aria-label={t("auth.email")} className="mb-4 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><label className="label">{t("auth.password")}</label><input aria-label={t("auth.password")} className="mb-6 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="btn w-full" disabled={busy}>{t(busy ? "auth.loggingIn" : "auth.login")}</button><p className="mt-5 text-center text-sm text-star-dim">{t("auth.noAccount")} <Link className="font-semibold text-psi hover:text-star" to="/register">{t("auth.applyAccount")}</Link></p></form></main>;
}
