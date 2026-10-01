import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useT } from "../i18n/LangContext";
import type { NavGroup } from "../nav-structure";

/**
 * 導覽列的下拉選單：點按鈕展開，選了項目、點外面、按 Esc 或換頁都會收起來。
 * 用「按鈕＋展開清單」的揭露模式（aria-expanded），清單裡就是一般連結，Tab 鍵照常走得到。
 */
export function NavMenu({ group, active, compact = false }: { group: NavGroup; active: boolean; compact?: boolean }) {
  const t = useT(); const location = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = `nav-menu-${useId().replaceAll(":", "")}`;

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const label = t(group.label);
  const trigger = compact
    ? `whitespace-nowrap border-b-2 px-2 py-1.5 text-sm ${active ? "border-psi text-psi" : "border-transparent text-star-dim"}`
    : `border-b-2 px-3 py-2 text-sm font-medium ${active ? "border-psi text-psi" : "border-transparent text-star-dim hover:bg-nexus-raised hover:text-star"}`;
  return <div ref={rootRef} className="relative">
    <button ref={buttonRef} type="button" data-tour={group.tour} className={`${trigger} inline-flex items-center gap-1`} aria-expanded={open} aria-controls={listId} aria-label={t("nav.menu", { label })} onClick={() => setOpen(!open)}>
      {label}<span aria-hidden="true" className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
    </button>
    {open && <ul id={listId} className="absolute left-0 top-full z-40 mt-1 min-w-44 border border-gold-dim bg-nexus py-1 shadow-2xl">
      {group.items.map((item) => <li key={item.to}><NavLink to={item.to} end={item.to === "/projects"} onClick={() => setOpen(false)} className={({ isActive }) => `flex w-full items-center justify-start whitespace-nowrap px-4 py-2 text-sm ${isActive ? "bg-nexus-raised font-semibold text-psi" : "text-star hover:bg-nexus-raised hover:text-psi"}`}>{t(item.label)}</NavLink></li>)}
    </ul>}
  </div>;
}
