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
