import { NavLink } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { OnboardingTour } from "./OnboardingTour";
import { AiSidebar } from "./AiSidebar";
import { useLang, useT } from "../i18n/LangContext";
import type { TransKey } from "../i18n/translations";
import { useTheme } from "../theme/ThemeContext";

const items: ReadonlyArray<readonly [string, TransKey]> = [["/", "nav.dashboard"], ["/projects", "nav.projects"], ["/archive", "nav.archive"], ["/timeline", "nav.timeline"], ["/reports", "nav.reports"], ["/regwatch", "nav.regwatch"], ["/todos", "nav.todos"], ["/contacts", "nav.contacts"], ["/notifications", "nav.notifications"]];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const [unread, setUnread] = useState(0);
  const t = useT(); const { lang, toggleLang } = useLang(); const { theme, toggleTheme } = useTheme();
  useEffect(() => { api<{ unread: number }>("/notifications").then((data) => setUnread(data.unread)).catch(() => undefined); }, []);
  return <div className="min-h-screen bg-void">
    <nav data-tour="nav" className="sticky top-0 z-30 border-b border-gold bg-void/95 backdrop-blur">
      {/* 手機上圖示佔掉的寬度從間距拿回來，否則 360–390px 的「登出」會被擠成兩行。 */}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:gap-5">
        <NavLink to="/" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-base font-black text-gold-bright sm:text-lg lg:mr-2 lg:gap-2"><img src="/favicon.svg" alt="" width={24} height={24} className="h-6 w-6 lg:h-7 lg:w-7" />{t("app.brand")}</NavLink>
        <div className="hidden flex-1 items-center gap-1 lg:flex">{items.map(([to, key]) => { const label = t(key); return <NavLink data-tour={to === "/timeline" ? "timeline-nav" : to === "/notifications" ? "notification-nav" : to === "/regwatch" ? "regwatch-nav" : undefined} key={to} to={to} end={to === "/"} className={({ isActive }) => `relative border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim hover:bg-nexus-raised hover:text-star"} ${to === "/notifications" && unread > 0 ? "has-unread" : ""}`}>{to === "/notifications" && unread > 0 ? t("nav.unread", { label, count: unread }) : label}</NavLink>; })}{user?.role === "admin" && <NavLink to="/admin" className={({ isActive }) => `border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim"}`}>{t("nav.admin")}</NavLink>}</div>
        <div className="ml-auto flex items-center gap-1.5 text-sm sm:gap-2"><button className="grid h-8 min-w-8 place-items-center border border-gold-dim bg-nexus px-2 font-semibold text-star-dim" aria-label={t("nav.language")} onClick={toggleLang}>{lang === "zh" ? t("lang.en") : t("lang.zh")}</button><button className="grid h-8 w-8 place-items-center border border-gold-dim bg-nexus text-star-dim" aria-label={t(theme === "dark" ? "theme.light" : "theme.dark")} onClick={toggleTheme}>{theme === "dark" ? "☀" : "🌙"}</button><NavLink data-tour="help-nav" to="/help" className="grid h-8 w-8 place-items-center border border-gold-dim bg-nexus font-bold text-star-dim" aria-label={t("nav.help")}>？</NavLink><NavLink to="/profile" className="hidden text-right sm:block"><span className="block font-medium text-star">{user?.name}</span><span className="text-xs text-star-dim">{user?.group_name}</span></NavLink><button className="btn-secondary !px-3 !py-1.5" onClick={() => void logout()}>{t("nav.logout")}</button></div>
      </div>
      {/* 手機每個項目被 44px 觸控下限撐成等寬，8 項在 390px 剛好差 17px。
          縮的是項目之間的間距與左右內距，觸控範圍本身不動。 */}
      <div className="flex gap-0.5 overflow-x-auto border-t border-gold-dim px-2 py-2 lg:hidden">{items.map(([to, key]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-1.5 text-sm ${isActive ? "border-psi text-psi" : "border-transparent text-star-dim"}`}>{t(key)}</NavLink>)}</div>
    </nav>
    <main className="mx-auto max-w-7xl px-4 py-7">{children}</main><OnboardingTour /><AiSidebar />
  </div>;
}
