import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { OnboardingTour } from "./OnboardingTour";
import { AiSidebar } from "./AiSidebar";
import { useLang, useT } from "../i18n/LangContext";
import { useTheme } from "../theme/ThemeContext";
import { NavMenu } from "./NavMenu";
import { NAV_GROUPS, activeNavGroup } from "../nav-structure";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth(); const [unread, setUnread] = useState(0);
  const t = useT(); const { lang, toggleLang } = useLang(); const { theme, toggleTheme } = useTheme();
  const activeGroup = activeNavGroup(useLocation().pathname);
  useEffect(() => { api<{ unread: number }>("/notifications").then((data) => setUnread(data.unread)).catch(() => undefined); }, []);
  const notificationsLabel = unread > 0 ? t("nav.unread", { label: t("nav.notifications"), count: unread }) : t("nav.notifications");
  return <div className="min-h-screen bg-void">
    <nav data-tour="nav" className="sticky top-0 z-30 border-b border-gold backdrop-blur">
      {/* 手機上圖示佔掉的寬度從間距拿回來，否則 360–390px 的「登出」會被擠成兩行。 */}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:gap-5">
        <NavLink to="/" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-serif text-base font-bold text-gold-bright sm:text-lg lg:mr-2 lg:gap-2"><img src="/favicon.svg" alt="" width={24} height={24} className="h-6 w-6 lg:h-7 lg:w-7" />{t("app.brand")}</NavLink>
        <div className="hidden flex-1 items-end gap-1 self-stretch lg:flex">
          <NavLink to="/" end className={({ isActive }) => topLink(isActive)}>{t("nav.dashboard")}</NavLink>
          {NAV_GROUPS.map((group) => <NavMenu key={group.key} group={group} active={activeGroup === group.key} />)}
          <NavLink data-tour="notification-nav" to="/notifications" className={({ isActive }) => `relative ${topLink(isActive)} ${unread > 0 ? "has-unread" : ""}`}>{notificationsLabel}</NavLink>
          {user?.role === "admin" && <NavLink to="/admin" className={({ isActive }) => topLink(isActive)}>{t("nav.admin")}</NavLink>}
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-sm sm:gap-2"><button className="grid h-8 min-w-8 place-items-center rounded-control border border-gold-dim bg-nexus px-2 font-semibold text-star-dim" aria-label={t("nav.language")} onClick={toggleLang}>{lang === "zh" ? t("lang.en") : t("lang.zh")}</button><button className="grid h-8 w-8 place-items-center rounded-control border border-gold-dim bg-nexus text-star-dim" aria-label={t(theme === "dark" ? "theme.light" : "theme.dark")} onClick={toggleTheme}>{theme === "dark" ? "☀" : "🌙"}</button><NavLink data-tour="help-nav" to="/help" className="grid h-8 w-8 place-items-center rounded-control border border-gold-dim bg-nexus font-bold text-star-dim" aria-label={t("nav.help")}>？</NavLink><NavLink to="/profile" className="hidden text-right sm:block"><span className="block font-medium text-star">{user?.name}</span><span className="text-xs text-star-dim">{user?.group_name}</span></NavLink><button className="btn-secondary !px-3 !py-1.5" onClick={() => void logout()}>{t("nav.logout")}</button></div>
      </div>
      {/* 手機版同一套階層：最上層只剩四、五項，不必再橫向捲動，展開的選單也不會被捲動容器裁掉。
          左右內距收到 px-2，管理員多一個「管理」時 360px 也還是一行；觸控範圍仍有 44px。 */}
      <div className="flex flex-wrap items-end gap-0.5 border-t border-gold-dim/60 px-2 lg:hidden">
        <NavLink to="/" end className={({ isActive }) => mobileLink(isActive)}>{t("nav.dashboard")}</NavLink>
        {NAV_GROUPS.map((group) => <NavMenu key={group.key} group={group} active={activeGroup === group.key} compact />)}
        <NavLink to="/notifications" className={({ isActive }) => `relative ${mobileLink(isActive)} ${unread > 0 ? "has-unread" : ""}`}>{notificationsLabel}</NavLink>
        {user?.role === "admin" && <NavLink to="/admin" className={({ isActive }) => mobileLink(isActive)}>{t("nav.admin")}</NavLink>}
      </div>
    </nav>
    <main className="mx-auto max-w-7xl px-4 py-7">{children}</main><OnboardingTour /><AiSidebar />
  </div>;
}

// 導覽項目是卷宗的頁籤（樣式在 styles.css 的 .nav-tab）：目前所在的那一張和桌面同色、接到底下的頁面。
const topLink = (isActive: boolean) => `nav-tab ${isActive ? "is-active" : ""}`;
const mobileLink = (isActive: boolean) => `nav-tab whitespace-nowrap !px-2 ${isActive ? "is-active" : ""}`;
