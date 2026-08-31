import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AuthCrystal } from "../components/AuthCrystal";
import { ErrorBox } from "../components/UI";
import { useT } from "../i18n/LangContext";

interface RegisterMeta {
  enabled: boolean;
  groups: Array<{ id: string; name: string }>;
}

export function RegisterPage() {
  const t = useT();
  const [meta, setMeta] = useState<RegisterMeta | null>(null);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { api<RegisterMeta>("/register/meta").then(setMeta).catch((cause) => setError(cause instanceof Error ? cause.message : t("register.unavailable"))); }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown > 0]);

  const sendCode = async () => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const result = await api<{ message: string }>("/register/send-code", { method: "POST", body: JSON.stringify({ email }) });
      setNotice(result.message); setCooldown(60);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("register.sendFailed")); }
    finally { setBusy(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.password_confirm) { setError(t("register.passwordMismatch")); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/register/submit", { method: "POST", body: JSON.stringify({ name: values.name, email, password: values.password, group_id: values.group_id, code: values.code }) });
      setNotice(result.message); setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("register.submitFailed")); }
    finally { setBusy(false); }
  };

  return <main className="auth-stage grid min-h-screen place-items-center px-4 py-10"><section className="panel auth-panel w-full max-w-lg !p-8"><AuthCrystal /><p className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-gold-bright">{t("app.internal")}</p><h1 className="text-3xl font-black">{t("register.title")}</h1><p className="mt-2 text-sm text-star-dim">{t("register.intro")}</p>{error && <div className="mt-5"><ErrorBox message={error} /></div>}{notice && <div className="mt-5 rounded-lg border border-ok bg-void p-3 text-sm text-ok">{notice}</div>}{meta && !meta.enabled ? <div className="mt-6 rounded-lg border border-warn bg-void p-4 text-warn">{t("register.closed")}</div> : done ? <div className="mt-7 text-center"><p className="font-semibold text-star">{t("register.pending")}</p><Link className="btn mt-5 inline-flex" to="/login">{t("register.backToLogin")}</Link></div> : <form className="mt-6 space-y-4" onSubmit={submit}><div><label className="label">{t("register.name")}</label><input aria-label={t("register.name")} className="w-full" name="name" required /></div><div><label className="label">{t("register.companyEmail")}</label><div className="flex gap-2"><input className="min-w-0 flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><button className="btn-secondary shrink-0" type="button" disabled={busy || cooldown > 0 || !email} onClick={() => void sendCode()}>{cooldown > 0 ? t("common.seconds", { count: cooldown }) : t("register.getCode")}</button></div></div><div><label className="label">{t("register.group")}</label><select aria-label={t("a11y.filterGroup")} className="w-full" name="group_id" required><option value="">{t("register.choose")}</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">{t("auth.password")}</label><input aria-label={t("auth.password")} className="w-full" type="password" name="password" minLength={8} required /></div><div><label className="label">{t("register.confirmPassword")}</label><input aria-label={t("register.confirmPassword")} className="w-full" type="password" name="password_confirm" minLength={8} required /></div></div><div><label className="label">{t("register.code")}</label><input aria-label={t("register.code")} className="w-full" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></div><button className="btn w-full" disabled={busy || !meta}>{t(busy ? "common.processing" : "register.submit")}</button></form>}<p className="mt-6 text-center text-sm"><Link className="text-psi hover:text-star" to="/login">{t("register.hasAccount")}</Link></p></section></main>;
}
