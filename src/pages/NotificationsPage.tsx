import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatDate } from "../api";
import { Empty, PageHeader } from "../components/UI";

interface Notice { id: string; title: string; body: string; link: string; read: number; created_at: string }
export function NotificationsPage() {
  const [items, setItems] = useState<Notice[]>([]); const navigate = useNavigate(); const load = () => api<{ notifications: Notice[] }>("/notifications").then((d) => setItems(d.notifications)); useEffect(() => { void load(); }, []);
  const open = async (item: Notice) => { await api(`/notifications/${item.id}/read`, { method: "POST" }); navigate(item.link); };
  return <><PageHeader title="通知中心" description="里程碑、待辦、BD 與停滯專案提醒。" actions={<button className="btn-secondary" onClick={() => void api("/notifications/read-all", { method: "POST" }).then(load)}>全部標為已讀</button>} />{items.length ? <div className="space-y-3">{items.map((item) => <button className={`card w-full text-left ${item.read ? "opacity-60" : "border-brand-200"}`} key={item.id} onClick={() => void open(item)}><div className="flex justify-between gap-3"><h2 className="font-semibold">{!item.read && <span className="mr-2 text-brand-600">●</span>}{item.title}</h2><span className="text-xs text-slate-400">{formatDate(item.created_at, true)}</span></div><p className="mt-2 text-sm text-slate-600">{item.body}</p></button>)}</div> : <Empty>目前沒有通知</Empty>}</>;
}
