import { NavLink } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { OnboardingTour } from "./OnboardingTour";

const items = [["/", "儀表板"], ["/projects", "專案"], ["/timeline", "時間軸"], ["/reports", "報表"], ["/todos", "待辦"], ["/notifications", "通知"]] as const;

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const [unread, setUnread] = useState(0);
  useEffect(() => { api<{ unread: number }>("/notifications").then((data) => setUnread(data.unread)).catch(() => undefined); }, []);
  return <div className="min-h-screen bg-slate-50">
    <nav data-tour="nav" className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-3">
        <NavLink to="/" className="mr-2 whitespace-nowrap text-lg font-black text-brand-700">艾爾水晶</NavLink>
        <div className="hidden flex-1 items-center gap-1 lg:flex">{items.map(([to, label]) => <NavLink data-tour={to === "/timeline" ? "timeline-nav" : to === "/notifications" ? "notification-nav" : undefined} key={to} to={to} end={to === "/"} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}>{label}{to === "/notifications" && unread > 0 ? ` (${unread})` : ""}</NavLink>)}{user?.role === "admin" && <NavLink to="/admin" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>管理</NavLink>}</div>
        <div className="ml-auto flex items-center gap-3 text-sm"><NavLink data-tour="help-nav" to="/help" className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-bold text-slate-600" aria-label="功能說明">？</NavLink><NavLink to="/profile" className="text-right"><span className="block font-medium">{user?.name}</span><span className="text-xs text-slate-500">{user?.group_name}</span></NavLink><button className="btn-secondary !px-3 !py-1.5" onClick={() => void logout()}>登出</button></div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden">{items.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>{label}</NavLink>)}</div>
    </nav>
    <main className="mx-auto max-w-7xl px-4 py-7">{children}</main><OnboardingTour />
  </div>;
}
