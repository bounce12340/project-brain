import type { AuthUser } from "../types";

export function canManageRegwatch(user: Pick<AuthUser, "role" | "group_id">): boolean {
  return user.role === "admin" || (user.role === "member" && user.group_id === "grp_general");
}

export function regwatchListStatus(
  user: Pick<AuthUser, "role" | "group_id">,
  requestedView: string | undefined,
): "published" | "draft" {
  return requestedView === "drafts" && canManageRegwatch(user) ? "draft" : "published";
}

export interface RegwatchAttachment {
  entry_id: string;
  id: string;
  filename: string;
  size: number;
  content_type: string;
  position: number;
}

export function mergeRegwatchAttachments(...groups: RegwatchAttachment[][]): Map<string, RegwatchAttachment[]> {
  const byEntry = new Map<string, Map<string, RegwatchAttachment>>();
  for (const attachment of groups.flat()) {
    const files = byEntry.get(attachment.entry_id) ?? new Map<string, RegwatchAttachment>();
    const existing = files.get(attachment.id);
    if (!existing || attachment.position < existing.position) files.set(attachment.id, attachment);
    byEntry.set(attachment.entry_id, files);
  }
  return new Map([...byEntry].map(([entryId, files]) => [
    entryId,
    [...files.values()].sort((left, right) => left.position - right.position || left.filename.localeCompare(right.filename, "zh-TW")),
  ]));
}

export function orphanRegwatchFileIds(candidateIds: Iterable<string>, referencedIds: Iterable<string>): string[] {
  const referenced = new Set(referencedIds);
  return [...new Set(candidateIds)].filter((id) => !referenced.has(id));
}
