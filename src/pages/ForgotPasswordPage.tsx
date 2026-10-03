import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, jsonBody } from "../api";
import { AuthCrystal } from "../components/AuthCrystal";
import { ErrorBox } from "../components/UI";
import { useT } from "../i18n/LangContext";

/** 忘記密碼：輸入 Email，寄出重設連結。不論有沒有這個帳號，畫面上都顯示同一句話。 */
export function ForgotPasswordPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { setSent((await api<{ message: string }>("/auth/forgot-password", jsonBody({ email }))).message); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("auth.forgotFailed")); }
    finally { setBusy(false); }
  };
  return <main className="auth-stage grid min-h-screen place-items-center px-4 py-10"><form onSubmit={submit} className="panel auth-panel w-full max-w-md !p-8">
    <AuthCrystal />
    <h1 className="mb-2 text-2xl font-black text-gold-bright">{t("auth.forgotTitle")}</h1>
    <p className="mb-6 text-sm leading-6 text-star-dim">{t("auth.forgotIntro")}</p>
    {error && <ErrorBox message={error} />}
    {sent ? <p role="status" className="mb-6 rounded-card border border-ok bg-void p-3 text-sm leading-6 text-ok">{sent}</p> : <>
      <label className="label" htmlFor="forgot-email">{t("auth.email")}</label>
      <input id="forgot-email" className="mb-6 w-full" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <button className="btn w-full" disabled={busy}>{t(busy ? "common.processing" : "auth.sendResetLink")}</button>
    </>}
    <p className="mt-5 text-center text-sm"><Link className="font-semibold text-psi hover:text-star" to="/login">{t("auth.backToLogin")}</Link></p>
  </form></main>;
}
