import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/UI";

export function ChangePasswordPage() {
  const { refresh } = useAuth(); const navigate = useNavigate(); const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }); await refresh(); navigate("/"); } catch (cause) { setError(cause instanceof Error ? cause.message : "變更失敗"); } };
  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4"><form onSubmit={submit} className="card w-full max-w-md !p-8"><h1 className="mb-2 text-2xl font-bold">設定新密碼</h1><p className="mb-6 text-sm text-slate-500">首次登入或管理員重設後，需先更換密碼。</p>{error && <ErrorBox message={error} />}<label className="label">目前密碼</label><input className="mb-4 w-full" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /><label className="label">新密碼（至少 8 碼）</label><input className="mb-6 w-full" type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /><button className="btn w-full">儲存新密碼</button></form></main>;
}
