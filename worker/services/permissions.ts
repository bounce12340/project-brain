import type { AuthUser, ProjectAccess } from "../types";

function isMember(user: AuthUser, project: ProjectAccess): boolean {
  return project.member_ids.includes(user.id);
}

export function canViewProject(user: AuthUser, project: ProjectAccess): boolean {
  if (user.role === "admin") return true;
  if (user.role === "intern") return isMember(user, project);
  if (project.visibility === "all") return true;
  if (project.visibility === "group") return user.group_id === project.group_id || isMember(user, project);
  return project.owner_id === user.id || isMember(user, project);
}

export function canEditProgress(user: AuthUser, project: ProjectAccess): boolean {
  if (user.role === "admin" || project.owner_id === user.id || isMember(user, project)) return true;
  return user.role === "member" && user.group_id === project.group_id;
}

export function canManageProject(user: AuthUser, project: ProjectAccess): boolean {
  return user.role === "admin" || project.owner_id === user.id;
}

export function canViewFees(user: AuthUser, project: ProjectAccess): boolean {
  return user.role === "admin" || project.owner_id === user.id || (user.role === "member" && user.group_id === project.group_id);
}

export function canManageAutomation(user: AuthUser, project: ProjectAccess): boolean {
  return user.role === "admin" || project.owner_id === user.id || (user.role === "member" && user.group_id === project.group_id);
}
