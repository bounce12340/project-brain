export const ccrStatuses = ["申請", "評估中", "已核准", "執行中", "效期確認", "已結案", "駁回"] as const;
export type CcrStatus = typeof ccrStatuses[number];

const transitions: Record<CcrStatus, CcrStatus[]> = {
  申請: ["評估中"],
  評估中: ["已核准", "駁回"],
  已核准: ["執行中"],
  執行中: ["效期確認"],
  效期確認: ["已結案"],
  已結案: [],
  駁回: [],
};

export function nextCcrStatuses(status: CcrStatus, isAdmin = false): CcrStatus[] {
  if (isAdmin && (status === "已結案" || status === "駁回")) return ["評估中"];
  return transitions[status];
}
export function canTransitionCcr(from: CcrStatus, to: CcrStatus, isAdmin = false): boolean {
  return nextCcrStatuses(from, isAdmin).includes(to);
}

export function nextCcrSequenceNumber(existing: string[], year: number): number {
  const prefix = `CCR-${year}-`;
  return existing.reduce((max, value) => {
    if (!value.startsWith(prefix)) return max;
    const sequence = Number(value.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > max ? sequence : max;
  }, 0) + 1;
}

export function formatCcrNo(year: number, sequence: number): string {
  return `CCR-${year}-${String(sequence).padStart(3, "0")}`;
}

/**
 * 核准／駁回 CCR 是品質把關：只有公司管理員或 QA 組（groups.type='qa'）的成員能做。
 * 先前任何有編輯權的人（含實習生）都能把自己提的 CCR 推到「已核准」，等於沒有把關。
 */
export function canApproveCcr(user: { role: string; group_type?: string | null }): boolean {
  return user.role === "admin" || user.group_type === "qa";
}

/** 這些狀態代表「已經過核准」；匯入時直接落在這些狀態也要有核准資格。 */
export const CCR_APPROVED_STATES: readonly CcrStatus[] = ["已核准", "執行中", "效期確認", "已結案"];
