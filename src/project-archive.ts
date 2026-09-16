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

/**
 * 儀表板「各組專案進度」與專案清單看同一籃。先前只改了專案清單，儀表板仍直接列出
 * `/dashboard` 回傳的全部專案，於是歸檔後的專案還留在進度條裡。
 */
export function ongoingOnly<T extends Pick<Project, "status">>(projects: T[]): T[] {
  return projects.filter((project) => bucketOf(project.status) === "active");
}

/** 封存會改動專案狀態，因此與後端 `POST /projects/:id/archive` 一樣只開放給管理員與 owner。 */
export function canArchive(project: Pick<Project, "owner_id">, user: { id: string; role: string } | null): boolean {
  return !!user && (user.role === "admin" || project.owner_id === user.id);
}

/** 過濾出勾選清單中確實可封存的 id，避免送出注定被擋下的請求。 */
export function archivableSelection<T extends Pick<Project, "id" | "owner_id">>(
  projects: T[], selected: Set<string>, user: { id: string; role: string } | null,
): string[] {
  return projects.filter((project) => selected.has(project.id) && canArchive(project, user)).map((project) => project.id);
}

/** 專區標頭的統計：總數，以及已完成與已歸檔各自幾件。 */
export function archiveSummary(projects: Project[]): { total: number; done: number; archived: number } {
  return {
    total: projects.length,
    done: projects.filter((project) => project.status === "done").length,
    archived: projects.filter((project) => project.status === "archived").length,
  };
}

/**
 * 刪除前的打字確認。刪除會連帶清掉任務、里程碑、進度紀錄與檔案且無法復原，
 * 一個 OK 鈕擋不住誤觸——要求把指定字詞打出來，手比腦快的時候才會停下來。
 * 前後空白忽略，英文不分大小寫；中文沒有大小寫，兩邊都套不影響。
 */
export function deleteConfirmed(typed: string | null | undefined, required: string): boolean {
  if (typeof typed !== "string") return false;
  return typed.trim().toLowerCase() === required.trim().toLowerCase();
}
