import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/UI";
import { useT } from "../i18n/LangContext";

export function ChangePasswordPage() {
  const { refresh } = useAuth(); const navigate = useNavigate(); const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [error, setError] = useState("");
  const t = useT();
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }); await refresh(); navigate("/"); } catch (cause) { setError(cause instanceof Error ? cause.message : t("auth.changeFailed")); } };
  return <main className="grid min-h-screen place-items-center bg-nexus-raised px-4"><form onSubmit={submit} className="panel w-full max-w-md !p-8"><h1 className="mb-2 text-2xl font-bold">{t("auth.changeTitle")}</h1><p className="mb-6 text-sm text-star-dim">{t("auth.changeIntro")}</p>{error && <ErrorBox message={error} />}<label className="label">{t("auth.currentPassword")}</label><input className="mb-4 w-full" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /><label className="label">{t("auth.newPassword")}</label><input className="mb-6 w-full" type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /><button className="btn w-full">{t("auth.saveNewPassword")}</button></form></main>;
}
