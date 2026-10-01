import type { TransKey } from "./i18n/translations";

/**
 * 主導覽的階層：相關的頁面收在同一個下拉選單裡。
 * 「專案」管日常推進的東西，「資源」是查資料、對外的東西；儀表板與通知單獨放在最上層。
 */
export interface NavItem { to: string; label: TransKey }
export interface NavGroup { key: "projects" | "resources"; label: TransKey; tour?: string; items: readonly NavItem[]; also?: readonly string[] }

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: "projects", label: "nav.projects",
    items: [
      { to: "/projects", label: "nav.projectList" },
      { to: "/meetings", label: "nav.meetings" },
      { to: "/todos", label: "nav.todos" },
      { to: "/timeline", label: "nav.timeline" },
      { to: "/reports", label: "nav.reports" },
      { to: "/archive", label: "nav.archive" },
    ],
    // 專案內頁與批次匯入也算在「專案」底下。
    also: ["/import"],
  },
  {
    // 新手導覽的「法規動態」那一步指向這個選單。
    key: "resources", label: "nav.groupResources", tour: "regwatch-nav",
    items: [
      { to: "/regwatch", label: "nav.regwatch" },
      { to: "/courses", label: "nav.courses" },
      { to: "/contacts", label: "nav.contacts" },
    ],
  },
];

const within = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/** 目前的頁面屬於哪個選單（用來把選單標成「目前位置」）；不屬於任何選單回 null。 */
export function activeNavGroup(pathname: string): NavGroup["key"] | null {
  const group = NAV_GROUPS.find((item) => [...item.items.map((entry) => entry.to), ...(item.also ?? [])].some((to) => within(pathname, to)));
  return group?.key ?? null;
}
