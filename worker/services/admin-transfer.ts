import type { Role } from "../types";

export type TransferMode = "co_admin" | "full_transfer";

export interface AdminState {
  role: Role;
  is_active: number;
  approval_status: "pending" | "approved" | "rejected";
}

export interface TransferCandidateState extends AdminState {
  id: string;
}

export function isActiveApprovedAdmin(account: AdminState): boolean {
  return account.role === "admin" && account.is_active === 1 && account.approval_status === "approved";
}

export function successorEligibilityError(candidate: TransferCandidateState | null, currentUserId: string): string | null {
  if (!candidate || candidate.id === currentUserId) return "接班人不存在或不符合資格";
  if (candidate.is_active !== 1) return "接班人必須是啟用中的帳號";
  if (candidate.approval_status !== "approved") return "接班人必須已通過核准";
  if (candidate.role === "admin") return "接班人必須是尚未擔任管理員的使用者";
  // 實習生的權限本來就限縮到「只看得到被指派的專案」，直接升為管理員等於一步跨過整套分級。
  if (candidate.role !== "member") return "接班人必須是正職成員";
  return null;
}

export function removesActiveApprovedAdmin(current: AdminState, nextRole: Role, nextIsActive: number): boolean {
  return isActiveApprovedAdmin(current) && (nextRole !== "admin" || nextIsActive !== 1);
}

export function shouldBlockAdminMutation(current: AdminState, nextRole: Role, nextIsActive: number, activeAdminCount: number): boolean {
  return removesActiveApprovedAdmin(current, nextRole, nextIsActive) && activeAdminCount <= 1;
}

export function transferRoleSequence(mode: TransferMode, currentUserId: string, successorId: string): Array<{ id: string; role: Role }> {
  const changes: Array<{ id: string; role: Role }> = [{ id: successorId, role: "admin" }];
  if (mode === "full_transfer") changes.push({ id: currentUserId, role: "member" });
  return changes;
}

export function nextCredentialFailure(failedCount: number, now = Date.now()): { failedCount: number; lockedUntil: string | null } {
  const nextCount = failedCount + 1;
  return nextCount >= 5
    ? { failedCount: 0, lockedUntil: new Date(now + 15 * 60_000).toISOString() }
    : { failedCount: nextCount, lockedUntil: null };
}
