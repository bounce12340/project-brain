import type { Project } from "./types";

const DASHBOARD_GROUP_KEY = "brain.dashboard.group";

export interface DashboardGroup {
  id: string;
  name: string;
}

/** 只列出目前實際有專案的組別，避免下拉選單出現選了就空白的項目。 */
export function dashboardGroups(projects: Array<Pick<Project, "group_id" | "group_name">>): DashboardGroup[] {
  const byId = new Map<string, string>();
  for (const project of projects) byId.set(project.group_id, project.group_name);
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-TW", { numeric: true }) || left.id.localeCompare(right.id));
}

/**
 * 記住的組別可能已經沒有專案了（全部歸檔、或權限變動）。這時退回「全部」，
 * 而不是讓使用者面對一個空清單卻找不到原因。
 */
export function resolveDashboardGroup(saved: string, groups: DashboardGroup[]): string {
  return groups.some((group) => group.id === saved) ? saved : "";
}

export function readDashboardGroup(storage: Pick<Storage, "getItem"> = localStorage): string {
  try {
    return storage.getItem(DASHBOARD_GROUP_KEY) ?? "";
  } catch {
    // 無痕視窗或封鎖站台資料時 localStorage 會直接丟例外，視同沒有偏好。
    return "";
  }
}

export function writeDashboardGroup(groupId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(DASHBOARD_GROUP_KEY, groupId);
  } catch {
    // 存不進去只是下次要重選，不該讓畫面壞掉。
  }
}

export function filterProjectsByGroup<T extends Pick<Project, "group_id">>(projects: T[], groupId: string): T[] {
  return groupId ? projects.filter((project) => project.group_id === groupId) : projects;
}

/**
 * 最近動態依「該筆更新所屬專案是否在篩選結果內」過濾。
 * 注意：伺服器只回傳全部可見專案中最新的 12 筆，因此篩選後看到的是「這 12 筆裡屬於該組的」，
 * 而不是「該組最新的 12 筆」。要做到後者必須讓 /dashboard 接受組別參數。
 */
export function filterUpdatesByGroup<T extends { project_id: string }>(
  updates: T[], visibleProjects: Array<Pick<Project, "id">>, groupId: string,
): T[] {
  if (!groupId) return updates;
  const allowed = new Set(visibleProjects.map((project) => project.id));
  return updates.filter((update) => allowed.has(update.project_id));
}
