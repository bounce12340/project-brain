import type { AuthUser } from "../types";

export function canManageRegwatch(user: Pick<AuthUser, "role" | "group_id">): boolean {
  return user.role === "admin" || (user.role === "member" && user.group_id === "grp_general");
}
