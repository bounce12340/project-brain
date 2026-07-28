import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatDate } from "../api";
import { HelpTip } from "../components/HelpTip";
import { Empty, PageHeader } from "../components/UI";
import { useLang, useT } from "../i18n/LangContext";

interface Notice {
  id: string;
  title: string;
  body: string;
  link: string;
  read: number;
  created_at: string;
}

export function NotificationsPage() {
  const t = useT();
  const { lang } = useLang();
  const [items, setItems] = useState<Notice[]>([]);
  const navigate = useNavigate();
  const load = () => api<{ notifications: Notice[] }>("/notifications").then((data) => setItems(data.notifications));
  useEffect(() => { void load(); }, []);
  const open = async (item: Notice) => {
    await api(`/notifications/${item.id}/read`, { method: "POST" });
    navigate(item.link);
  };

  return <>
    <PageHeader
      title={<>{t("notifications.title")}<HelpTip topic="notifications" /></>}
      description={t("notifications.description")}
      actions={<button className="btn-secondary" onClick={() => void api("/notifications/read-all", { method: "POST" }).then(load)}>{t("notifications.readAll")}</button>}
    />
    {items.length ? <div className="space-y-3">{items.map((item) => <button className={`panel w-full text-left ${item.read ? "opacity-60" : "border-psi-deep"}`} key={item.id} onClick={() => void open(item)}>
      <div className="flex justify-between gap-3">
        <h2 className="font-semibold">{!item.read && <span className="mr-2 text-psi">●</span>}{item.title}</h2>
        <span className="text-xs text-star-dim">{formatDate(item.created_at, true, lang)}</span>
      </div>
      <p className="mt-2 text-sm text-star-dim">{item.body}</p>
    </button>)}</div> : <Empty>{t("notifications.empty")}</Empty>}
  </>;
}
