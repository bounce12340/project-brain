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

export type RegwatchDraftBatchAction = "approve" | "delete";

export interface RegwatchDraftBatchInput {
  action: RegwatchDraftBatchAction;
  ids: string[];
}

export interface RegwatchDraftBatchResult {
  processed: number;
  skipped: number;
}

export function parseRegwatchDraftBatchInput(value: unknown): RegwatchDraftBatchInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.action !== "approve" && body.action !== "delete") return null;
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100) return null;
  if (!body.ids.every((id) => typeof id === "string" && id.length > 0)) return null;
  return { action: body.action, ids: body.ids };
}

export async function deleteRegwatchEntry(
  env: Pick<Env, "DB" | "FILES">,
  id: string,
  rejectedBy: string,
  draftOnly = false,
): Promise<{ title: string; deletedFiles: number } | null> {
  const current = await env.DB.prepare(`SELECT title,file_id,source,source_ref FROM reg_entries WHERE id=?${draftOnly ? " AND status='draft'" : ""}`)
    .bind(id).first<{ title: string; file_id: string | null; source: string; source_ref: string | null }>();
  if (!current) return null;
  const linked = await env.DB.prepare("SELECT file_id FROM reg_entry_files WHERE entry_id=?").bind(id).all<{ file_id: string }>();
  const candidateIds = [...linked.results.map((row) => row.file_id), ...(current.file_id ? [current.file_id] : [])];
  const deleteStatement = env.DB.prepare(`DELETE FROM reg_entries WHERE id=?${draftOnly ? " AND status='draft'" : ""}`).bind(id);
  const result = current.source === "tfda_rss" && current.source_ref
    ? (await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO tfda_rejected(source_ref,title,rejected_by) VALUES (?,?,?)")
        .bind(current.source_ref, current.title, rejectedBy),
      deleteStatement,
    ]))[1]
    : await deleteStatement.run();
  if ((result.meta.changes ?? 0) === 0) return null;
  const referencedIds: string[] = [];
  for (const fileId of new Set(candidateIds)) {
    const references = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM reg_entry_files WHERE file_id=?) + (SELECT COUNT(*) FROM reg_entries WHERE file_id=?) AS value")
      .bind(fileId, fileId).first<number>("value");
    if ((references ?? 0) > 0) referencedIds.push(fileId);
  }
  const orphanIds = orphanRegwatchFileIds(candidateIds, referencedIds);
  let deletedFiles = 0;
  for (const fileId of orphanIds) {
    const file = await env.DB.prepare("SELECT storage_key FROM files WHERE id=? AND project_id IS NULL").bind(fileId).first<{ storage_key: string }>();
    if (!file) continue;
    await env.FILES.delete(file.storage_key);
    await env.DB.prepare("DELETE FROM files WHERE id=?").bind(fileId).run();
    deletedFiles += 1;
  }
  return { title: current.title, deletedFiles };
}

export async function processRegwatchDraftBatch(
  env: Pick<Env, "DB" | "FILES">,
  input: RegwatchDraftBatchInput,
  rejectedBy: string,
): Promise<RegwatchDraftBatchResult> {
  const uniqueIds = [...new Set(input.ids)];
  let processed = 0;
  if (input.action === "approve") {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const result = await env.DB.prepare(`UPDATE reg_entries SET status='published',updated_at=CURRENT_TIMESTAMP WHERE status='draft' AND id IN (${placeholders})`)
      .bind(...uniqueIds).run();
    processed = result.meta.changes ?? 0;
  } else {
    for (const id of uniqueIds) {
      if (await deleteRegwatchEntry(env, id, rejectedBy, true)) processed += 1;
    }
  }
  return { processed, skipped: input.ids.length - processed };
}
