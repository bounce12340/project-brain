import type { AuthUser, ProjectAccess } from "../types";

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export async function getProjectAccess(db: D1Database, projectId: string): Promise<ProjectAccess | null> {
  const project = await db.prepare("SELECT id, owner_id, group_id, visibility FROM projects WHERE id = ?").bind(projectId).first<Omit<ProjectAccess, "member_ids">>();
  if (!project) return null;
  const members = await db.prepare("SELECT user_id FROM project_members WHERE project_id = ?").bind(projectId).all<{ user_id: string }>();
  return { ...project, member_ids: members.results.map((row) => row.user_id) };
}

export async function touchProject(db: D1Database, projectId: string): Promise<void> {
  await db.prepare("UPDATE projects SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId).run();
}

export async function writeAudit(
  db: D1Database,
  user: AuthUser,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
): Promise<void> {
  await db.prepare("INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(createId("audit"), user.id, action, entityType, entityId, summary).run();
}
