import { NavLink } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { OnboardingTour } from "./OnboardingTour";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { useTheme } from "../theme/ThemeContext";

const items: ReadonlyArray<readonly [string, TransKey]> = [["/", "nav.dashboard"], ["/projects", "nav.projects"], ["/timeline", "nav.timeline"], ["/reports", "nav.reports"], ["/regwatch", "nav.regwatch"], ["/todos", "nav.todos"], ["/notifications", "nav.notifications"]];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const [unread, setUnread] = useState(0);
  const t = useT(); const { lang, toggleLang } = useLang(); const { theme, toggleTheme } = useTheme();
  useEffect(() => { api<{ unread: number }>("/notifications").then((data) => setUnread(data.unread)).catch(() => undefined); }, []);
  return <div className="min-h-screen bg-void">
    <nav data-tour="nav" className="sticky top-0 z-30 border-b border-gold bg-void/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-3">
        <NavLink to="/" className="mr-2 whitespace-nowrap text-lg font-black text-gold-bright">{t("app.brand")}</NavLink>
        <div className="hidden flex-1 items-center gap-1 lg:flex">{items.map(([to, key]) => { const label = t(key); return <NavLink data-tour={to === "/timeline" ? "timeline-nav" : to === "/notifications" ? "notification-nav" : to === "/regwatch" ? "regwatch-nav" : undefined} key={to} to={to} end={to === "/"} className={({ isActive }) => `relative border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim hover:bg-nexus-raised hover:text-star"} ${to === "/notifications" && unread > 0 ? "has-unread" : ""}`}>{to === "/notifications" && unread > 0 ? t("nav.unread", { label, count: unread }) : label}</NavLink>; })}{user?.role === "admin" && <NavLink to="/admin" className={({ isActive }) => `border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim"}`}>{t("nav.admin")}</NavLink>}</div>
        <div className="ml-auto flex items-center gap-2 text-sm"><button className="grid h-8 min-w-8 place-items-center border border-gold-dim bg-nexus px-2 font-semibold text-star-dim" aria-label={t("nav.language")} onClick={toggleLang}>{lang === "zh" ? t("lang.en") : t("lang.zh")}</button><button className="grid h-8 w-8 place-items-center border border-gold-dim bg-nexus text-star-dim" aria-label={t(theme === "dark" ? "theme.light" : "theme.dark")} onClick={toggleTheme}>{theme === "dark" ? "☀" : "🌙"}</button><NavLink data-tour="help-nav" to="/help" className="grid h-8 w-8 place-items-center border border-gold-dim bg-nexus font-bold text-star-dim" aria-label={t("nav.help")}>？</NavLink><NavLink to="/profile" className="hidden text-right sm:block"><span className="block font-medium text-star">{user?.name}</span><span className="text-xs text-star-dim">{user?.group_name}</span></NavLink><button className="btn-secondary !px-3 !py-1.5" onClick={() => void logout()}>{t("nav.logout")}</button></div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-t border-gold-dim px-3 py-2 lg:hidden">{items.map(([to, key]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-1.5 text-sm ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim"}`}>{t(key)}</NavLink>)}</div>
    </nav>
    <main className="mx-auto max-w-7xl px-4 py-7">{children}</main><OnboardingTour />
  </div>;
}
