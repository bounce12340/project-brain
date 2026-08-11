import type { Project } from "./types";

/**
 * 專案分成兩籃：進行中與歸檔。專案清單只顯示進行中那一籃，已完成與已歸檔的移到歸檔專區，
 * 免得結案的案子長期擠在日常清單裡。兩籃互斥且涵蓋全部四種狀態，不會有專案兩邊都不出現。
 */
export const ACTIVE_STATUSES = ["active", "paused"] as const;
export const ARCHIVE_STATUSES = ["done", "archived"] as const;

export type ProjectStatus = Project["status"];
export type Bucket = "active" | "archive";

export function bucketStatuses(bucket: Bucket): readonly ProjectStatus[] {
  return bucket === "archive" ? ARCHIVE_STATUSES : ACTIVE_STATUSES;
}

export function bucketOf(status: ProjectStatus): Bucket {
  return (ARCHIVE_STATUSES as readonly string[]).includes(status) ? "archive" : "active";
}

/**
 * 篩選器選了單一狀態就送那一個，沒選就送整籃。無論如何一定帶 status，
 * 因為後端沒帶 status 時回傳全部，那會讓歸檔專案漏進專案清單。
 */
export function statusQuery(bucket: Bucket, selected: string): string {
  const allowed = bucketStatuses(bucket) as readonly string[];
  return allowed.includes(selected) ? selected : allowed.join(",");
}

/**
 * 歸檔時間：已歸檔的用 archived_at，已完成但尚未歸檔的沒有這個欄位，退回最後活動時間。
 * 兩者都缺才回空字串，交由呼叫端歸到「未標示年份」。
 */
export function archiveDate(project: Pick<Project, "archived_at" | "last_activity_at">): string {
  return (project.archived_at ?? project.last_activity_at ?? "").slice(0, 10);
}

export interface ArchiveYear {
  year: string;
  projects: Project[];
}

/** 依歸檔年份分組，年份新的在前；同一年內依歸檔日期新到舊，日期相同再依名稱。 */
export function groupArchiveByYear(projects: Project[]): ArchiveYear[] {
  const byYear = new Map<string, Project[]>();
  for (const project of projects) {
    const year = archiveDate(project).slice(0, 4) || "—";
    byYear.set(year, [...(byYear.get(year) ?? []), project]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, list]) => ({
      year,
      projects: [...list].sort((a, b) =>
        archiveDate(b).localeCompare(archiveDate(a)) || a.name.localeCompare(b.name, "zh-TW", { numeric: true })),
    }));
}

/** 專區標頭的統計：總數，以及已完成與已歸檔各自幾件。 */
export function archiveSummary(projects: Project[]): { total: number; done: number; archived: number } {
  return {
    total: projects.length,
    done: projects.filter((project) => project.status === "done").length,
    archived: projects.filter((project) => project.status === "archived").length,
  };
}
