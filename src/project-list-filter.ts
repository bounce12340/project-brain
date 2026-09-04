const PROJECT_GROUP_KEY = "brain.projects.group";

/**
 * 沒有紀錄時回傳 null，這與「明確選了全部組別」（空字串）必須分得開——
 * 兩者都當成空字串的話，使用者選了「全部」，下次進頁面又會被預設打回自己的組別。
 */
export function readProjectGroup(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(PROJECT_GROUP_KEY);
  } catch {
    // 無痕視窗或封鎖站台資料時 localStorage 會直接丟例外，視同沒有偏好。
    return null;
  }
}

export function writeProjectGroup(groupId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(PROJECT_GROUP_KEY, groupId);
  } catch {
    // 存不進去只是下次要重選，不該讓畫面壞掉。
  }
}

/**
 * 初次進入預設自己的組別，讓自己的案子先出現，而不是先看到全公司 25 件。
 * 選過就一律尊重選擇，包含選「全部組別」。
 *
 * 實習生不套用這個預設：他們只看得到被指派的專案，本來就沒有雜訊要濾掉，
 * 再依組別篩反而會把跨組指派給他們的專案藏起來。
 */
export function defaultProjectGroup(saved: string | null, user: { group_id: string; role: string } | null): string {
  if (saved !== null) return saved;
  if (!user || user.role === "intern") return "";
  return user.group_id;
}

/** 「未指定廠區」在下拉選單裡用這個值代表——空字串已經被「全部廠區」佔用了。 */
export const SITE_UNSET = "__unset__";

/**
 * 只列出目前這份清單裡實際出現過的廠區，避免選了就空白的選項。
 * 廠區是人工填的自由文字，前後空白視為同一個。
 */
export function projectSites(projects: Array<{ site?: string }>): string[] {
  const seen = new Set<string>();
  for (const project of projects) {
    const value = (project.site ?? "").trim();
    if (value) seen.add(value);
  }
  return [...seen].sort((left, right) => left.localeCompare(right, "zh-TW", { numeric: true }));
}

/**
 * 選過的廠區可能因為其他篩選改變而不在清單裡了。這時退回「全部」，
 * 而不是讓使用者面對空清單卻找不到原因。
 */
export function resolveSite(selected: string, sites: string[], allowUnset = true): string {
  if (selected === SITE_UNSET) return allowUnset ? selected : "";
  return sites.includes(selected) ? selected : "";
}

export function filterProjectsBySite<T extends { site?: string }>(projects: T[], selected: string): T[] {
  if (!selected) return projects;
  if (selected === SITE_UNSET) return projects.filter((project) => !(project.site ?? "").trim());
  return projects.filter((project) => (project.site ?? "").trim() === selected);
}

/** 有沒有專案是沒填廠區的。全都填了就不必列出「未指定廠區」——那個選項選了必定是空清單。 */
export function hasUnsetSite(projects: Array<{ site?: string }>): boolean {
  return projects.some((project) => !(project.site ?? "").trim());
}
