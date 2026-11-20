import type { AuthUser, ProjectAccess } from "../types";

/**
 * 多公司：使用者只碰得到自己公司的專案，管理員也一樣（admin 看到的是「自己公司的全部專案」）。
 * 每個權限檢查都先過這一關。公司不明的一律拒絕（fail closed），不會因為呼叫端漏帶而放行。
 */
export function sameCompany(user: Pick<AuthUser, "company_id">, project: Pick<ProjectAccess, "company_id">): boolean {
  return Boolean(project.company_id) && project.company_id === user.company_id;
}

function isMember(user: AuthUser, project: ProjectAccess): boolean {
  return project.member_ids.includes(user.id);
}

export function canViewProject(user: AuthUser, project: ProjectAccess): boolean {
  if (!sameCompany(user, project)) return false;
  if (user.role === "admin") return true;
  // 擁有者與成員一律看得到，與可見性和組別無關。這兩項先前散落在各可見性分支裡，
  // owner 只寫在 private 那一行，因此「可見性＝同組、擁有者卻在別組」的專案會把
  // 擁有者自己擋在門外——正式站有 7 個 BD 組專案由 RA/PV 組的人擁有，全數中招。
  if (project.owner_id === user.id || isMember(user, project)) return true;
  // 實習生只看得到被指派進去的專案，不吃可見性規則。
  if (user.role === "intern") return false;
  if (project.visibility === "all") return true;
  return project.visibility === "group" && user.group_id === project.group_id;
}

// 會改到專案內容、看到費用或設自動化的權限，一律先要「看得到這個專案」：
// 否則同組成員只要拿到私人專案的網址，就能改一個自己打不開的專案。
export function canEditProgress(user: AuthUser, project: ProjectAccess): boolean {
  if (!canViewProject(user, project)) return false;
  if (user.role === "admin" || project.owner_id === user.id || isMember(user, project)) return true;
  return user.role === "member" && user.group_id === project.group_id;
}

export function canEditProgressUpdate(user: AuthUser, project: ProjectAccess, authorId: string): boolean {
  return canEditProgress(user, project) && (user.id === authorId || project.owner_id === user.id || user.role === "admin");
}

export function canManageProject(user: AuthUser, project: ProjectAccess): boolean {
  if (!sameCompany(user, project)) return false;
  return user.role === "admin" || project.owner_id === user.id;
}

export function canViewFees(user: AuthUser, project: ProjectAccess): boolean {
  if (!canViewProject(user, project)) return false;
  return user.role === "admin" || project.owner_id === user.id || (user.role === "member" && user.group_id === project.group_id);
}

export function canManageAutomation(user: AuthUser, project: ProjectAccess): boolean {
  if (!canViewProject(user, project)) return false;
  return user.role === "admin" || project.owner_id === user.id || (user.role === "member" && user.group_id === project.group_id);
}
