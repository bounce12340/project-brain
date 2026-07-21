import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ErrorBox } from "../components/UI";

interface RegisterMeta {
  enabled: boolean;
  groups: Array<{ id: string; name: string }>;
}

export function RegisterPage() {
  const [meta, setMeta] = useState<RegisterMeta | null>(null);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { api<RegisterMeta>("/register/meta").then(setMeta).catch((cause) => setError(cause instanceof Error ? cause.message : "無法取得註冊資訊")); }, []);
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : "驗證碼寄送失敗"); }
    finally { setBusy(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.password !== values.password_confirm) { setError("兩次輸入的密碼不一致"); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/register/submit", { method: "POST", body: JSON.stringify({ name: values.name, email, password: values.password, group_id: values.group_id, code: values.code }) });
      setNotice(result.message); setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "申請送出失敗"); }
    finally { setBusy(false); }
  };

  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-10"><section className="card w-full max-w-lg !p-8"><p className="mb-2 text-sm font-semibold tracking-widest text-brand-600">UIC INTERNAL</p><h1 className="text-3xl font-black">申請艾爾水晶帳號</h1><p className="mt-2 text-sm text-slate-500">完成 Email 驗證後送出，待管理員核准即可登入。</p>{error && <div className="mt-5"><ErrorBox message={error} /></div>}{notice && <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}{meta && !meta.enabled ? <div className="mt-6 rounded-lg bg-amber-50 p-4 text-amber-800">目前未開放自助註冊</div> : done ? <div className="mt-7 text-center"><p className="font-semibold text-slate-700">申請狀態：待核准</p><Link className="btn mt-5 inline-flex" to="/login">返回登入</Link></div> : <form className="mt-6 space-y-4" onSubmit={submit}><div><label className="label">姓名</label><input className="w-full" name="name" required /></div><div><label className="label">公司 Email</label><div className="flex gap-2"><input className="min-w-0 flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><button className="btn-secondary shrink-0" type="button" disabled={busy || cooldown > 0 || !email} onClick={() => void sendCode()}>{cooldown > 0 ? `${cooldown} 秒` : "取得驗證碼"}</button></div></div><div><label className="label">組別</label><select className="w-full" name="group_id" required><option value="">請選擇</option>{meta?.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">密碼</label><input className="w-full" type="password" name="password" minLength={8} required /></div><div><label className="label">再次輸入密碼</label><input className="w-full" type="password" name="password_confirm" minLength={8} required /></div></div><div><label className="label">6 位數驗證碼</label><input className="w-full" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></div><button className="btn w-full" disabled={busy || !meta}>{busy ? "處理中…" : "送出申請"}</button></form>}<p className="mt-6 text-center text-sm"><Link className="text-brand-600 hover:text-brand-700" to="/login">已有帳號？返回登入</Link></p></section></main>;
}
