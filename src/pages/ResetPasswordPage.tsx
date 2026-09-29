import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, jsonBody } from "../api";
import { AuthCrystal } from "../components/AuthCrystal";
import { ErrorBox } from "../components/UI";
import { useT } from "../i18n/LangContext";

/**
 * 從重設密碼信的連結進來：/reset-password?token=…
 * 讀到代碼後就從網址拿掉，免得留在瀏覽紀錄或被截圖；重新整理時用記在這一頁的代碼。
 */
export function ResetPasswordPage() {
  const t = useT();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!token) return;
    window.history.replaceState(null, "", "/reset-password");
    void api<{ valid: boolean }>(`/auth/reset-password?token=${encodeURIComponent(token)}`).then((result) => setValid(result.valid)).catch(() => setValid(false));
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError(t("auth.passwordMismatch")); return; }
    setBusy(true);
    try { await api("/auth/reset-password", jsonBody({ token, new_password: password })); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("auth.resetFailed")); }
    finally { setBusy(false); }
  };
  const body = done
    ? <><p role="status" className="mb-6 rounded-lg border border-ok bg-void p-3 text-sm leading-6 text-ok">{t("auth.resetDone")}</p><Link className="btn block w-full text-center" to="/login">{t("auth.login")}</Link></>
    : valid === null ? <p className="text-sm text-star-dim">{t("common.loading")}</p>
    : !valid ? <><ErrorBox message={t("auth.resetInvalid")} /><Link className="btn block w-full text-center" to="/forgot-password">{t("auth.requestAgain")}</Link></>
    : <>
      {error && <ErrorBox message={error} />}
      <label className="label" htmlFor="reset-password">{t("auth.newPassword")}</label>
      <input id="reset-password" className="mb-4 w-full" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label className="label" htmlFor="reset-confirm">{t("auth.confirmPassword")}</label>
      <input id="reset-confirm" className="mb-2 w-full" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      <p className="mb-6 text-xs leading-5 text-star-dim">{t("auth.resetHint")}</p>
      <button className="btn w-full" disabled={busy}>{t(busy ? "common.processing" : "auth.setNewPassword")}</button>
    </>;
  return <main className="auth-stage grid min-h-screen place-items-center px-4 py-10"><form onSubmit={submit} className="panel auth-panel w-full max-w-md !p-8">
    <AuthCrystal />
    <h1 className="mb-6 text-2xl font-black text-gold-bright">{t("auth.resetTitle")}</h1>
    {body}
    {!done && <p className="mt-5 text-center text-sm"><Link className="font-semibold text-psi hover:text-star" to="/login">{t("auth.backToLogin")}</Link></p>}
  </form></main>;
}
